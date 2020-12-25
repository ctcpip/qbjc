import _ from 'lodash';
import {SourceNode} from 'source-map';
import {
  AssignStmt,
  AstNode,
  AstVisitor,
  BinaryOp,
  BinaryOpExpr,
  CondLoopStmt,
  CondLoopStructure,
  EndStmt,
  ExitForStmt,
  ExitLoopStmt,
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
  Stmts,
  UnaryOp,
  UnaryOpExpr,
  UncondLoopStmt,
  VarRefExpr,
} from '../ast/ast';
import {
  CompiledProcType,
  ExecutionDirectiveType,
  PrintArgType,
} from '../runtime/compiled-code';
// Generated by src/tools/build-runtime-bundle.ts at build time.
const nodeRuntimeBundleCode = require('../runtime/node-runtime-bundle')
  .default as string;

/** Default indentation per level. */
const DEFAULT_INDENT_WIDTH = 4;

type SourceChunk = string | SourceNode | Array<string | SourceNode>;
type SourceChunks = Array<SourceChunk>;

/** Temporary state for an open for loop during the codegen process. */
interface ForStmtState {
  forStmt: ForStmt;
  startLabel: string;
  endLabel: string;
  stepValue: string;
  endValue: string;
}

/** Temporary state for an open conditional / unconditional loop during the codegen process. */
interface LoopStmtState {
  loopStmt: CondLoopStmt | UncondLoopStmt;
  endLabel: string;
}

export interface CodeGeneratorOpts {
  sourceFileName?: string;
  indentWidth?: number;
  enableBundling?: boolean;
}

/** Code generation pass.
 *
 * Depends on semantic analysis info in the AST.
 */
export default class CodeGenerator extends AstVisitor<SourceNode> {
  constructor(private readonly module: Module, opts: CodeGeneratorOpts = {}) {
    super();
    this.opts = {
      sourceFileName: '',
      indentWidth: DEFAULT_INDENT_WIDTH,
      enableBundling: false,
      ...opts,
    };
    this.sourceFileName = this.opts.sourceFileName;
  }

  run() {
    const compiledModuleSourceNode = this.visitModule(this.module);
    return this.bundle(compiledModuleSourceNode).toStringWithSourceMap();
  }

  private bundle(compiledModuleSourceNode: SourceNode) {
    const sourceNode = new SourceNode();
    if (this.opts.enableBundling) {
      sourceNode.add('#!/usr/bin/env node\n\n');
      sourceNode.add(compiledModuleSourceNode);
      sourceNode.add(nodeRuntimeBundleCode);
    } else {
      sourceNode.add(compiledModuleSourceNode);
      sourceNode.add('module.exports = { default: compiledModule };\n');
    }
    return sourceNode;
  }

  visitModule(module: Module): SourceNode {
    this.indent = 0;

    const chunks: SourceChunks = [];
    chunks.push(
      this.lines(
        'const compiledModule = {',
        +1,
        `sourceFileName: ${JSON.stringify(this.opts.sourceFileName)},`,
        ''
      )
    );

    chunks.push(
      this.lines('stmts: [', '', +1),
      this.visitStmts(module.stmts),
      this.lines(-1, '],', '')
    );

    chunks.push(
      this.lines('procs: [', '', +1),
      this.acceptAll(module.procs),
      this.lines(-1, '],', '')
    );

    chunks.push(this.lines(-1, '};', ''));

    return new SourceNode(
      null,
      null,
      this.opts.sourceFileName,
      _.flatten(chunks)
    );
  }

  visitFnProc(node: FnProc): SourceNode {
    const chunks: SourceChunks = [];

    chunks.push(
      this.lines(
        '{',
        +1,
        this.generateLoc(node),
        `type: '${CompiledProcType.FN}',`,
        `name: '${node.name}',`,
        'stmts: [',
        '',
        +1
      ),
      this.visitStmts(node.stmts),
      this.lines(-1, '],', -1, '},', '')
    );

    return this.createSourceNode(node, ...chunks);
  }

  private visitStmts(stmts: Stmts) {
    const origOpenForStmtStatesLength = this.openForStmtStates.length;
    const sourceNodes = this.acceptAll(stmts);
    if (this.openForStmtStates.length > origOpenForStmtStatesLength) {
      this.throwError(
        'FOR statement without corresponding NEXT statement',
        this.openForStmtStates[this.openForStmtStates.length - 1].forStmt
      );
    }
    return sourceNodes;
  }

  visitLabelStmt(node: LabelStmt): SourceNode {
    return this.createSourceNode(
      node,
      this.generateLabelStmt(node, node.label)
    );
  }

  visitAssignStmt(node: AssignStmt): SourceNode {
    return this.createStmtSourceNode(node, () => [
      this.accept(node.targetExpr),
      ' = ',
      this.accept(node.valueExpr),
      ';',
    ]);
  }

  visitGotoStmt(node: GotoStmt): SourceNode {
    return this.createStmtSourceNode(node, () =>
      this.generateGotoCode(node.destLabel)
    );
  }

  visitIfStmt(node: IfStmt): SourceNode {
    // Generate labels for each "elseif" branch, the else branch, and the "end if".
    const branchLabelPrefix = this.generateLabel();
    const branchLabels: Array<{
      node: AstNode | null | undefined;
      label: string;
    }> = [];
    for (let i = 1; i < node.ifBranches.length; ++i) {
      branchLabels.push({
        node: node.ifBranches[i].stmts[0],
        label: `${branchLabelPrefix}_elif${i}`,
      });
    }
    if (node.elseBranch.length > 0) {
      branchLabels.push({
        node: node.elseBranch[0],
        label: `${branchLabelPrefix}_else`,
      });
    }
    const endIfLabel = `${branchLabelPrefix}_endif`;
    branchLabels.push({node: null, label: endIfLabel});

    const chunks: SourceChunks = [];
    let nextBranchLabelIdx = 0;

    // Generate code for "if" and "elseif" branches.
    for (const {condExpr, stmts} of node.ifBranches) {
      const {node: nextBranchNode, label: nextBranchLabel} = branchLabels[
        nextBranchLabelIdx
      ];
      chunks.push(
        this.createStmtSourceNode(condExpr, () => [
          'if (!(',
          this.accept(condExpr),
          `)) { ${this.generateGotoCode(nextBranchLabel)} }`,
        ])
      );
      ++this.indent;
      chunks.push(this.visitStmts(stmts));
      if (nextBranchLabelIdx < branchLabels.length - 1) {
        chunks.push(
          this.createStmtSourceNode(condExpr, () =>
            this.generateGotoCode(endIfLabel)
          )
        );
      }
      --this.indent;
      chunks.push(this.generateLabelStmt(nextBranchNode, nextBranchLabel));
      ++nextBranchLabelIdx;
    }

    // Generate code for "else" branch.
    if (node.elseBranch.length > 0) {
      ++this.indent;
      chunks.push(this.visitStmts(node.elseBranch));
      --this.indent;
      chunks.push(this.generateLabelStmt(null, endIfLabel));
    }

    return this.createSourceNode(node, ...chunks);
  }

  visitCondLoopStmt(node: CondLoopStmt): SourceNode {
    const labelPrefix = this.generateLabel();
    const loopStartLabel = `${labelPrefix}_loopStart`;
    const loopEndLabel = `${labelPrefix}_loopEnd`;

    const cond = node.isCondNegated
      ? [this.accept(node.condExpr)]
      : ['!(', this.accept(node.condExpr), ')'];
    const condStmt = this.createStmtSourceNode(node, () => [
      'if (',
      ...cond,
      `) { ${this.generateGotoCode(loopEndLabel)} }`,
    ]);
    ++this.indent;
    this.openLoopStmtStates.push({
      loopStmt: node,
      endLabel: loopEndLabel,
    });
    const stmts = this.visitStmts(node.stmts);
    this.openLoopStmtStates.pop();
    --this.indent;

    const chunks: SourceChunks = [];
    chunks.push(this.generateLabelStmt(node, loopStartLabel));
    switch (node.structure) {
      case CondLoopStructure.COND_EXPR_BEFORE_STMTS:
        chunks.push(condStmt, stmts);
        break;
      case CondLoopStructure.COND_EXPR_AFTER_STMTS:
        chunks.push(stmts, condStmt);
        break;
      default:
        this.throwError(
          `Unexpected loop structure: ${JSON.stringify(node)}`,
          node
        );
    }
    chunks.push(
      this.createStmtSourceNode(node, () =>
        this.generateGotoCode(loopStartLabel)
      ),
      this.generateLabelStmt(node, loopEndLabel)
    );

    return this.createSourceNode(node, ...chunks);
  }

  visitUncondLoopStmt(node: UncondLoopStmt): SourceNode {
    const labelPrefix = this.generateLabel();
    const loopStartLabel = `${labelPrefix}_loopStart`;
    const loopEndLabel = `${labelPrefix}_loopEnd`;

    const chunks: SourceChunks = [];
    chunks.push(this.generateLabelStmt(node, loopStartLabel));
    ++this.indent;
    this.openLoopStmtStates.push({
      loopStmt: node,
      endLabel: loopEndLabel,
    });
    chunks.push(this.visitStmts(node.stmts));
    this.openLoopStmtStates.pop();
    --this.indent;
    chunks.push(
      this.createStmtSourceNode(node, () =>
        this.generateGotoCode(loopStartLabel)
      ),
      this.generateLabelStmt(node, loopEndLabel)
    );

    return this.createSourceNode(node, ...chunks);
  }

  visitExitLoopStmt(node: ExitLoopStmt): SourceNode {
    if (this.openLoopStmtStates.length === 0) {
      this.throwError(`EXIT DO statement outside DO loop`, node);
    }
    return this.createStmtSourceNode(node, () =>
      this.generateGotoCode(
        this.openLoopStmtStates[this.openLoopStmtStates.length - 1].endLabel
      )
    );
  }

  visitForStmt(node: ForStmt): SourceNode {
    const labelPrefix = this.generateLabel();
    const startLabel = `${labelPrefix}_loopStart`;
    const endLabel = `${labelPrefix}_loopEnd`;
    const stepValue = this.generateTempVarRef(`${labelPrefix}_step`);
    const endValue = this.generateTempVarRef(`${labelPrefix}_end`);

    this.openForStmtStates.push({
      forStmt: node,
      startLabel,
      endLabel,
      stepValue,
      endValue,
    });

    const chunks: SourceChunks = [];
    chunks.push(
      this.createStmtSourceNode(node, () => [
        // Set counter = start
        ...[
          this.accept(node.counterExpr),
          ' = ',
          this.accept(node.startExpr),
          '; ',
        ],
        // Set stepValue = evaluate(stepExpr)
        ...[
          `${stepValue} = `,
          node.stepExpr ? this.accept(node.stepExpr) : '1',
          '; ',
        ],
        // Set endValue = evaluate(endExpr)
        ...[`${endValue} = `, this.accept(node.endExpr), ';'],
      ]),
      this.generateLabelStmt(node, startLabel)
    );
    ++this.indent;
    chunks.push(
      this.createStmtSourceNode(node, () => [
        ...[`const counterValue = `, this.accept(node.counterExpr), '; '],
        ...[
          'if (',
          `(${stepValue} >= 0 && counterValue > ${endValue}) || `,
          `(${stepValue} < 0 && counterValue < ${endValue})`,
          `) { ${this.generateGotoCode(endLabel)} }`,
        ],
      ])
    );
    return this.createSourceNode(node, ...chunks);
  }

  visitNextStmt(node: NextStmt): SourceNode {
    // Determine how many open FOR statements this NEXT statement will close.
    const numForStmtStatesToClose = node.counterExprs.length || 1;
    if (numForStmtStatesToClose > this.openForStmtStates.length) {
      this.throwError(
        `NEXT statement without corresponding FOR statement`,
        node
      );
    }
    // Verify that the counter expressions match the corresponding FOR statements.
    for (let i = 0; i < node.counterExprs.length; ++i) {
      const nextCounterExprString = this.accept(
        node.counterExprs[i]
      ).toString();
      const {forStmt} = this.openForStmtStates[
        this.openForStmtStates.length - 1 - i
      ];
      const forStmtCounterExprString = this.accept(
        forStmt.counterExpr
      ).toString();
      if (nextCounterExprString !== forStmtCounterExprString) {
        this.throwError(
          `Counter #${i + 1} does not match corresponding FOR statement`,
          node
        );
      }
    }

    // Generate code.
    const chunks: SourceChunks = [];
    for (let i = 0; i < numForStmtStatesToClose; ++i) {
      const {
        forStmt,
        startLabel,
        endLabel,
        stepValue,
        endValue,
      } = this.openForStmtStates.pop()!;
      chunks.push(
        this.createStmtSourceNode(node, () => [
          this.accept(forStmt.counterExpr),
          ` += ${stepValue}; `,
          this.generateGotoCode(startLabel),
        ])
      );
      --this.indent;
      chunks.push(this.generateLabelStmt(forStmt, endLabel));
      chunks.push(
        this.createStmtSourceNode(
          forStmt,
          () => `delete ${stepValue}; delete ${endValue};`
        )
      );
    }
    return this.createSourceNode(node, ...chunks);
  }

  visitExitForStmt(node: ExitForStmt): SourceNode {
    if (this.openForStmtStates.length === 0) {
      this.throwError(`EXIT FOR statement outside FOR loop`, node);
    }
    return this.createStmtSourceNode(node, () =>
      this.generateGotoCode(
        this.openForStmtStates[this.openForStmtStates.length - 1].endLabel
      )
    );
  }

  visitGosubStmt(node: GosubStmt): SourceNode {
    return this.createStmtSourceNode(
      node,
      () =>
        `return { type: '${ExecutionDirectiveType.GOSUB}', destLabel: '${node.destLabel}' };`
    );
  }

  visitReturnStmt(node: ReturnStmt): SourceNode {
    return this.createStmtSourceNode(
      node,
      () =>
        `return { type: '${ExecutionDirectiveType.RETURN}'${
          node.destLabel ? `, destLabel: '${node.destLabel}'` : ''
        } };`
    );
  }

  visitEndStmt(node: EndStmt): SourceNode {
    return this.createStmtSourceNode(
      node,
      () => `return { type: '${ExecutionDirectiveType.END}' };`
    );
  }

  visitPrintStmt(node: PrintStmt): SourceNode {
    return this.createStmtSourceNode(node, () => [
      'ctx.runtime.print(',
      ...node.args.map((arg) =>
        typeof arg === 'string'
          ? `{ type: '${arg}' },`
          : this.createSourceNode(
              arg,
              `{ type: '${PrintArgType.VALUE}', value: `,
              this.accept(arg),
              ' },'
            )
      ),
      ');',
    ]);
  }

  visitInputStmt(node: InputStmt): SourceNode {
    return this.createStmtSourceNode(node, () => [
      'const results = await ctx.runtime.input(',
      `${JSON.stringify(node.prompt)}, `,
      node.targetExprs.map((expr) => JSON.stringify(expr.typeSpec!)).join(', '),
      '); ',
      ...node.targetExprs.map((expr, i) =>
        this.createSourceNode(expr, this.accept(expr), ` = results[${i}]; `)
      ),
    ]);
  }

  private createStmtSourceNode(
    node: AstNode,
    generateRunCode: () => SourceChunk
  ) {
    return this.createSourceNode(
      node,
      this.lines('{', +1, ''),
      this.lines(this.generateLoc(node), ''),
      this.lines('async run(ctx) { '),
      generateRunCode(),
      ' },\n',
      this.lines(-1, '},', '')
    );
  }

  visitLiteralExpr(node: LiteralExpr): SourceNode {
    let valueString: string;
    if (typeof node.value === 'string') {
      valueString = `'${node.value}'`; // TODO: Escape literals
    } else if (typeof node.value === 'number') {
      valueString = `${node.value}`;
    } else {
      this.throwError(
        `Unrecognized literal value: ${JSON.stringify(node.value)}`,
        node
      );
    }
    return this.createSourceNode(node, valueString);
  }

  visitVarRefExpr(node: VarRefExpr): SourceNode {
    return this.createSourceNode(node, `ctx.localVars['${node.name}']`);
  }

  visitBinaryOpExpr(node: BinaryOpExpr): SourceNode {
    let chunks: Array<SourceNode | string> = [];
    switch (node.op) {
      case BinaryOp.EXP:
        chunks.push(
          'Math.pow(',
          this.accept(node.leftExpr),
          ', ',
          this.accept(node.rightExpr),
          ')'
        );
        break;
      case BinaryOp.INTDIV:
        chunks.push(
          'Math.floor(',
          this.accept(node.leftExpr),
          ' / ',
          this.accept(node.rightExpr),
          ')'
        );
        break;
      default:
        const OP_MAP = {
          [BinaryOp.ADD]: '+',
          [BinaryOp.SUB]: '-',
          [BinaryOp.MUL]: '*',
          [BinaryOp.DIV]: '/',
          [BinaryOp.MOD]: '%',
          [BinaryOp.AND]: '&&',
          [BinaryOp.OR]: '||',
          [BinaryOp.EQ]: '===',
          [BinaryOp.NE]: '!=',
          [BinaryOp.GT]: '>',
          [BinaryOp.GTE]: '>=',
          [BinaryOp.LT]: '<',
          [BinaryOp.LTE]: '<=',
        };
        chunks.push(
          '(',
          this.accept(node.leftExpr),
          ` ${OP_MAP[node.op]} `,
          this.accept(node.rightExpr),
          ')'
        );
        break;
    }
    return this.createSourceNode(node, ...chunks);
  }
  visitUnaryOpExpr(node: UnaryOpExpr): SourceNode {
    const OP_MAP = {
      [UnaryOp.NEG]: '-',
      [UnaryOp.NOT]: '!',
    };
    return this.createSourceNode(
      node,
      '(',
      OP_MAP[node.op],
      this.accept(node.rightExpr),
      ')'
    );
  }

  private createSourceNode(node: AstNode, ...chunks: SourceChunks) {
    return new SourceNode(
      node.loc.line,
      node.loc.col,
      this.opts.sourceFileName,
      _.flatten(chunks)
    );
  }

  private lines(...values: Array<string | number>) {
    const outputLines: Array<string> = [];
    for (const value of values) {
      if (typeof value === 'string') {
        const indentStr = value
          ? ' '.repeat(this.opts.indentWidth * this.indent)
          : '';
        outputLines.push(indentStr + value);
      } else if (typeof value === 'number') {
        this.indent += value;
      } else {
        throw new Error(`Unexpected line value: ${JSON.stringify(value)}`);
      }
    }
    return outputLines.join('\n');
  }

  private generateLabel() {
    return `$${this.nextGeneratedLabelIdx++}`;
  }

  private generateLoc(node: AstNode) {
    return node.loc ? `loc: [${node.loc.line}, ${node.loc.col}],` : '';
  }

  private generateLabelStmt(node: AstNode | null | undefined, label: string) {
    return this.lines(
      '{',
      +1,
      ...(node ? [this.generateLoc(node)] : []),
      `label: '${label}',`,
      -1,
      `},`,
      ''
    );
  }

  private generateGotoCode(destLabel: string) {
    return `return { type: '${ExecutionDirectiveType.GOTO}', destLabel: '${destLabel}' };`;
  }

  private generateTempVarRef(label: string) {
    return `ctx.tempVars['${label}']`;
  }

  private readonly opts: Required<CodeGeneratorOpts>;

  /** Stack of open for loops in current context. */
  private openForStmtStates: Array<ForStmtState> = [];
  /** Stack of open do loops in current context. */
  private openLoopStmtStates: Array<LoopStmtState> = [];

  /** Current indentation level. */
  private indent = 0;
  /** Current generated label index. */
  private nextGeneratedLabelIdx = 1;
}
