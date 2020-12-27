import _ from 'lodash';
import {
  AssignStmt,
  AstVisitor,
  BinaryOp,
  BinaryOpExpr,
  CondLoopStmt,
  EndStmt,
  ExitForStmt,
  ExitLoopStmt,
  Expr,
  ExprType,
  FnCallExpr,
  FnProc,
  ForStmt,
  GosubStmt,
  GotoStmt,
  IfStmt,
  InputStmt,
  LabelStmt,
  LiteralExpr,
  Module,
  NextStmt,
  PrintStmt,
  Proc,
  ProcType,
  ReturnStmt,
  UnaryOp,
  UnaryOpExpr,
  UncondLoopStmt,
  VarRefExpr,
} from '../lib/ast';
import {lookupSymbol, VarScope, VarSymbol, VarType} from '../lib/symbol-table';
import {
  areMatchingElementaryTypes,
  DataTypeSpec,
  doubleSpec,
  integerSpec,
  isElementaryType,
  isNumeric,
  isString,
  longSpec,
  singleSpec,
  stringSpec,
} from '../lib/types';

/** Map from variable type declaration suffix to the corresponding type spec. */
const TYPE_SUFFIX_MAP: {[key: string]: DataTypeSpec} = Object.freeze({
  '%': integerSpec(),
  '&': longSpec(),
  '!': singleSpec(),
  '#': doubleSpec(),
  $: stringSpec(),
});

/** Semantic analysis pass.
 *
 * Main tasks:
 *
 * - Type analysis for symbols, expressions and statements
 * - Build symbol table and resolve references
 */
export default class SemanticAnalyzer extends AstVisitor<void> {
  constructor(
    private readonly module: Module,
    {sourceFileName}: {sourceFileName?: string}
  ) {
    super();
    this.sourceFileName = sourceFileName;
  }

  run() {
    this.visitModule(this.module);
  }

  visitModule(module: Module): void {
    module.procs.forEach(this.preprocessProc.bind(this));

    this.currentProc = null;
    module.localSymbols = [];
    module.globalSymbols = [];
    this.acceptAll(module.stmts);

    this.acceptAll(module.procs);
  }

  private preprocessProc(node: Proc) {
    node.paramSymbols = node.params.map((param) => ({
      name: param.name,
      type: VarType.ARG,
      typeSpec: this.getTypeSpecFromSuffix(param.name),
    }));
    node.localSymbols = [];
    if (node.type === ProcType.FN) {
      node.returnTypeSpec = this.getTypeSpecFromSuffix(node.name);
      node.localSymbols.push({
        name: node.name,
        type: VarType.VAR,
        typeSpec: node.returnTypeSpec,
      });
    }
  }

  visitFnProc(node: FnProc): void {
    this.currentProc = node;
    this.acceptAll(node.stmts);
    this.currentProc = null;
  }

  visitLabelStmt(node: LabelStmt): void {}

  visitAssignStmt(node: AssignStmt): void {
    this.accept(node.targetExpr);
    this.accept(node.valueExpr);
    const targetTypeSpec = node.targetExpr.typeSpec!;
    const valueTypeSpec = node.valueExpr.typeSpec!;
    if (!areMatchingElementaryTypes(targetTypeSpec, valueTypeSpec)) {
      this.throwError(
        `Incompatible types in assignment: ${targetTypeSpec.type} and ${valueTypeSpec.type}`,
        node
      );
    }
  }

  visitGotoStmt(node: GotoStmt): void {}

  private requireNumericExpr(...exprs: Array<Expr>) {
    for (const expr of exprs) {
      this.accept(expr);
      if (!isNumeric(expr.typeSpec!)) {
        this.throwError(
          `Expected numeric expression instead of ${expr.typeSpec!.type}`,
          expr
        );
      }
    }
  }

  private requireElementaryTypeExpr(...exprs: Array<Expr>) {
    for (const expr of exprs) {
      this.accept(expr);
      if (!isElementaryType(expr.typeSpec!)) {
        this.throwError(
          `Expected elementary type expression instead of ${
            expr.typeSpec!.type
          }`,
          expr
        );
      }
    }
  }

  visitIfStmt(node: IfStmt): void {
    for (const {condExpr, stmts} of node.ifBranches) {
      this.requireNumericExpr(condExpr);
      this.acceptAll(stmts);
    }
    this.acceptAll(node.elseBranch);
  }

  visitCondLoopStmt(node: CondLoopStmt): void {
    this.requireNumericExpr(node.condExpr);
    this.acceptAll(node.stmts);
  }

  visitUncondLoopStmt(node: UncondLoopStmt): void {
    this.acceptAll(node.stmts);
  }

  visitExitLoopStmt(node: ExitLoopStmt): void {}

  visitForStmt(node: ForStmt): void {
    this.requireNumericExpr(
      node.counterExpr,
      node.startExpr,
      node.endExpr,
      ...(node.stepExpr ? [node.stepExpr] : [])
    );
  }

  visitNextStmt(node: NextStmt): void {
    this.requireNumericExpr(...node.counterExprs);
  }

  visitExitForStmt(node: ExitForStmt): void {}

  visitGosubStmt(node: GosubStmt): void {}

  visitReturnStmt(node: ReturnStmt): void {}

  visitEndStmt(node: EndStmt): void {}

  visitPrintStmt(node: PrintStmt): void {
    for (const arg of node.args) {
      if (typeof arg === 'string') {
        continue;
      }
      this.requireElementaryTypeExpr(arg);
    }
  }

  visitInputStmt(node: InputStmt): void {
    this.requireElementaryTypeExpr(...node.targetExprs);
  }

  visitLiteralExpr(node: LiteralExpr): void {
    if (typeof node.value === 'string') {
      node.typeSpec = stringSpec();
    } else if (typeof node.value === 'number') {
      // TODO
      node.typeSpec = singleSpec();
    } else {
      this.throwError(
        `Unknown literal expression value type: ${typeof node.value}`,
        node
      );
    }
  }

  visitVarRefExpr(node: VarRefExpr): void {
    let resolvedSymbol = this.lookupSymbol(node.name);
    if (!resolvedSymbol) {
      // VarRef may actually be a function invocation without args.
      let proc = lookupSymbol(this.module.procs, node.name);
      if (proc) {
        if (proc.type === ProcType.FN) {
          const fnCallExpr: FnCallExpr = {
            type: ExprType.FN_CALL,
            name: node.name,
            argExprs: [],
            loc: node.loc,
          };
          this.accept(fnCallExpr);
          Object.assign(node, fnCallExpr);
          return;
        } else {
          this.throwError(`Procedure "${proc.name}" is not a function`, node);
        }
      }

      resolvedSymbol = {
        symbol: {
          name: node.name,
          type: VarType.VAR,
          typeSpec: this.getTypeSpecFromSuffix(node.name),
        },
        scope: VarScope.LOCAL,
      };
      this.addLocalSymbol(resolvedSymbol.symbol);
    }
    node.typeSpec = resolvedSymbol.symbol.typeSpec;
    node.varType = resolvedSymbol.symbol.type;
    node.varScope = resolvedSymbol.scope;
  }

  visitFnCallExpr(node: FnCallExpr): void {
    const proc = lookupSymbol(this.module.procs, node.name);
    if (!proc || proc.type !== ProcType.FN) {
      this.throwError(`Function not found: "${node.name}"`, node);
    }
    if (proc.paramSymbols!.length !== node.argExprs.length) {
      this.throwError(
        `Incorrect number of arguments to function "${node.name}": ` +
          `expected ${proc.paramSymbols!.length}, got ${node.argExprs.length}`,
        node
      );
    }
    this.acceptAll(node.argExprs);
    for (let i = 0; i < node.argExprs.length; ++i) {
      const paramTypeSpec = proc.paramSymbols![i].typeSpec;
      const argTypeSpec = node.argExprs[i].typeSpec!;
      if (!areMatchingElementaryTypes(paramTypeSpec, argTypeSpec)) {
        this.throwError(
          `Incompatible argument ${i + 1} to function "${node.name}": ` +
            `expected ${paramTypeSpec.type}, got ${argTypeSpec.type}`,
          node
        );
      }
    }
    node.typeSpec = proc.returnTypeSpec!;
  }

  visitBinaryOpExpr(node: BinaryOpExpr): void {
    this.accept(node.leftExpr);
    this.accept(node.rightExpr);
    const leftTypeSpec = node.leftExpr.typeSpec!;
    const rightTypeSpec = node.rightExpr.typeSpec!;
    const errorMessage = `Incompatible types for ${node.op} operator: ${leftTypeSpec.type} and ${rightTypeSpec.type}`;
    const requireNumericOperands = () => {
      if (!isNumeric(leftTypeSpec, rightTypeSpec)) {
        this.throwError(errorMessage, node);
      }
    };
    const useCoercedNumericType = () => {
      node.typeSpec = this.coerceNumericTypes(leftTypeSpec, rightTypeSpec);
    };
    switch (node.op) {
      case BinaryOp.ADD:
        if (isString(leftTypeSpec, rightTypeSpec)) {
          node.typeSpec = stringSpec();
        } else {
          requireNumericOperands();
          useCoercedNumericType();
        }
        break;
      case BinaryOp.SUB:
      case BinaryOp.MUL:
      case BinaryOp.EXP:
      case BinaryOp.INTDIV:
      case BinaryOp.MOD:
        requireNumericOperands();
        useCoercedNumericType();
        break;
      case BinaryOp.DIV:
        requireNumericOperands();
        node.typeSpec = this.coerceNumericTypes(
          leftTypeSpec,
          rightTypeSpec,
          singleSpec()
        );
        break;
      case BinaryOp.AND:
      case BinaryOp.OR:
        requireNumericOperands();
        node.typeSpec = integerSpec();
        break;
      case BinaryOp.EQ:
      case BinaryOp.NE:
      case BinaryOp.GT:
      case BinaryOp.GTE:
      case BinaryOp.LT:
      case BinaryOp.LTE:
        if (!areMatchingElementaryTypes(leftTypeSpec, rightTypeSpec)) {
          this.throwError(errorMessage, node);
        }
        node.typeSpec = integerSpec();
        break;
      default:
        this.throwError(`Unknown operator ${node.op}`, node);
    }
  }

  visitUnaryOpExpr(node: UnaryOpExpr): void {
    this.accept(node.rightExpr);
    const rightTypeSpec = node.rightExpr.typeSpec!;
    switch (node.op) {
      case UnaryOp.NEG:
        this.requireNumericExpr(node.rightExpr);
        node.typeSpec = rightTypeSpec;
        break;
      case UnaryOp.NOT:
        this.requireNumericExpr(node.rightExpr);
        node.typeSpec = integerSpec();
        break;
      case UnaryOp.PARENS:
        node.typeSpec = rightTypeSpec;
        break;
      default:
        this.throwError(`Unknown operator ${node.op}`, node);
    }
  }

  /** Computes the output numeric type after an arithmetic operation. */
  private coerceNumericTypes(...t: Array<DataTypeSpec>): DataTypeSpec {
    const RULES: Array<{
      operands: [DataTypeSpec, DataTypeSpec];
      result: DataTypeSpec;
    }> = [
      {operands: [integerSpec(), integerSpec()], result: integerSpec()},
      {operands: [integerSpec(), longSpec()], result: longSpec()},
      {operands: [integerSpec(), singleSpec()], result: singleSpec()},
      {operands: [integerSpec(), doubleSpec()], result: doubleSpec()},
      {operands: [longSpec(), integerSpec()], result: longSpec()},
      {operands: [longSpec(), longSpec()], result: longSpec()},
      {operands: [longSpec(), singleSpec()], result: singleSpec()},
      {operands: [longSpec(), doubleSpec()], result: doubleSpec()},
      {operands: [singleSpec(), integerSpec()], result: singleSpec()},
      {operands: [singleSpec(), longSpec()], result: singleSpec()},
      {operands: [singleSpec(), singleSpec()], result: singleSpec()},
      {operands: [singleSpec(), doubleSpec()], result: doubleSpec()},
      {operands: [doubleSpec(), integerSpec()], result: doubleSpec()},
      {operands: [doubleSpec(), longSpec()], result: doubleSpec()},
      {operands: [doubleSpec(), singleSpec()], result: doubleSpec()},
      {operands: [doubleSpec(), doubleSpec()], result: doubleSpec()},
    ];
    if (t.length === 0) {
      throw new Error('Missing arguments');
    }
    if (!isNumeric(...t)) {
      throw new Error(`Expected numeric types`);
    }
    let resultTypeSpec = t[0];
    for (let i = 1; i < t.length; ++i) {
      const matchingRule = RULES.find(
        ({operands: [typeSpec1, typeSpec2]}) =>
          _.isEqual(typeSpec1, resultTypeSpec) && _.isEqual(typeSpec2, t[i])
      );
      if (matchingRule) {
        resultTypeSpec = matchingRule.result;
      } else {
        throw new Error(
          `Unknown numeric type combination: ${resultTypeSpec.type} and ${t[i].type}`
        );
      }
    }
    return resultTypeSpec;
  }

  private getLocalSymbols() {
    return this.currentProc
      ? this.currentProc.localSymbols!
      : this.module.localSymbols!;
  }

  private lookupSymbol(name: string) {
    let symbol: VarSymbol | null = null;
    if (this.currentProc) {
      symbol = lookupSymbol(this.currentProc.paramSymbols!, name);
      if (symbol) {
        return {symbol, scope: VarScope.LOCAL};
      }
    }
    symbol = lookupSymbol(this.getLocalSymbols(), name);
    if (symbol) {
      return {symbol, scope: VarScope.LOCAL};
    }
    symbol = lookupSymbol(this.module.globalSymbols!, name);
    if (symbol) {
      return {symbol, scope: VarScope.GLOBAL};
    }
    return null;
  }

  private addLocalSymbol(...args: Array<VarSymbol>) {
    return this.getLocalSymbols().push(...args);
  }

  private getTypeSpecFromSuffix(name: string) {
    const lastCharInName = name[name.length - 1];
    // TODO: Support DEFINT etc.
    return TYPE_SUFFIX_MAP[lastCharInName] ?? singleSpec();
  }

  /** The current proc being visited, or null if currently visiting module-level nodes. */
  private currentProc: Proc | null = null;
}