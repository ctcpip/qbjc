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
  ReturnStmt,
  UnaryOp,
  UnaryOpExpr,
  UncondLoopStmt,
  VarRefExpr,
} from '../ast/ast';
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
    this.acceptAll(module.stmts);
    this.acceptAll(module.procs);
  }

  visitFnProc(node: FnProc): void {
    this.acceptAll(node.stmts);
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
    // TODO: Symbol table lookup.
    const lastCharInName = node.name[node.name.length - 1];
    // TODO: Support DEFINT etc.
    node.typeSpec = TYPE_SUFFIX_MAP[lastCharInName] ?? singleSpec();
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
    if (!isNumeric(rightTypeSpec)) {
      this.throwError(
        `Incompatible types for ${node.op} operator: ${rightTypeSpec.type}`,
        node
      );
    }
    switch (node.op) {
      case UnaryOp.NEG:
        node.typeSpec = rightTypeSpec;
        break;
      case UnaryOp.NOT:
        node.typeSpec = integerSpec();
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
}
