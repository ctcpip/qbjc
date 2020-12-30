import moo, {Token} from 'moo';
import {
  DataTypeSpec,
  doubleSpec,
  integerSpec,
  isNumeric,
  isString,
  longSpec,
  stringSpec,
  areMatchingElementaryTypes,
  arraySpec,
  isArray,
} from '../lib/types';
import {lookupSymbols} from '../lib/symbol-table';
import {PrintArg, PrintArgType, Ptr} from './compiled-code';
import QbArray from './qb-array';

/** Built-in function definition. */
export interface BuiltinFn<
  RunFnT extends (...args: Array<any>) => Promise<any> = (
    ...args: Array<any>
  ) => Promise<any>
> {
  name: string;
  paramTypeSpecs: Array<DataTypeSpec>;
  returnTypeSpec: DataTypeSpec;
  run: RunFnT;
}

export const BUILTIN_FNS: Array<BuiltinFn> = [
  {
    name: 'chr$',
    paramTypeSpecs: [longSpec()],
    returnTypeSpec: stringSpec(),
    async run(n: number) {
      return (String.fromCodePoint ?? String.fromCharCode)(Math.floor(n));
    },
  },
  {
    name: 'instr',
    paramTypeSpecs: [stringSpec(), stringSpec()],
    returnTypeSpec: integerSpec(),
    async run(haystack: string, needle: string) {
      return haystack.indexOf(needle) + 1;
    },
  },
  {
    name: 'instr',
    paramTypeSpecs: [longSpec(), stringSpec(), stringSpec()],
    returnTypeSpec: integerSpec(),
    async run(start: number, haystack: string, needle: string) {
      return haystack.indexOf(needle, Math.floor(start) - 1) + 1;
    },
  },
  {
    name: 'lbound',
    paramTypeSpecs: [arraySpec(doubleSpec(), [])],
    returnTypeSpec: longSpec(),
    async run(array: QbArray) {
      return array.typeSpec.dimensionSpecs[0][0];
    },
  },
  {
    name: 'lbound',
    paramTypeSpecs: [arraySpec(doubleSpec(), []), longSpec()],
    returnTypeSpec: longSpec(),
    async run(array: QbArray, dimensionIdx: number) {
      if (
        dimensionIdx < 1 ||
        dimensionIdx > array.typeSpec.dimensionSpecs.length
      ) {
        throw new Error(`Invalid dimension index: ${dimensionIdx}`);
      }
      return array.typeSpec.dimensionSpecs[dimensionIdx - 1][0];
    },
  },
  {
    name: 'lcase$',
    paramTypeSpecs: [stringSpec()],
    returnTypeSpec: stringSpec(),
    async run(s: string) {
      return s.toLowerCase();
    },
  },
  {
    name: 'left$',
    paramTypeSpecs: [stringSpec(), longSpec()],
    returnTypeSpec: stringSpec(),
    async run(s: string, n: number) {
      return s.substr(0, Math.floor(n));
    },
  },
  {
    name: 'len',
    paramTypeSpecs: [stringSpec()],
    returnTypeSpec: longSpec(),
    async run(s: string) {
      return s.length;
    },
  },
  {
    name: 'mid$',
    paramTypeSpecs: [stringSpec(), longSpec(), longSpec()],
    returnTypeSpec: stringSpec(),
    async run(s: string, startIdx: number, length: number) {
      return s.substr(Math.floor(startIdx) - 1, Math.floor(length));
    },
  },
  {
    name: 'right$',
    paramTypeSpecs: [stringSpec(), longSpec()],
    returnTypeSpec: stringSpec(),
    async run(s: string, n: number) {
      return s.substr(Math.max(0, s.length - Math.floor(n)));
    },
  },
  {
    name: 'str$',
    paramTypeSpecs: [doubleSpec()],
    returnTypeSpec: stringSpec(),
    async run(n: number) {
      return `${n >= 0 ? ' ' : ''}${n}`;
    },
  },
  {
    name: 'val',
    paramTypeSpecs: [stringSpec()],
    returnTypeSpec: doubleSpec(),
    async run(s: string) {
      const v = parseFloat(s);
      return isNaN(v) ? 0 : v;
    },
  },
  {
    name: 'ubound',
    paramTypeSpecs: [arraySpec(doubleSpec(), [])],
    returnTypeSpec: longSpec(),
    async run(array: QbArray) {
      return array.typeSpec.dimensionSpecs[0][1];
    },
  },
  {
    name: 'ubound',
    paramTypeSpecs: [arraySpec(doubleSpec(), []), longSpec()],
    returnTypeSpec: longSpec(),
    async run(array: QbArray, dimensionIdx: number) {
      if (
        dimensionIdx < 1 ||
        dimensionIdx > array.typeSpec.dimensionSpecs.length
      ) {
        throw new Error(`Invalid dimension index: ${dimensionIdx}`);
      }
      return array.typeSpec.dimensionSpecs[dimensionIdx - 1][1];
    },
  },
  {
    name: 'ucase$',
    paramTypeSpecs: [stringSpec()],
    returnTypeSpec: stringSpec(),
    async run(s: string) {
      return s.toUpperCase();
    },
  },
];

export function lookupBuiltinFn(
  name: string,
  argTypeSpecs: Array<DataTypeSpec>,
  {
    shouldReturnIfArgTypeMismatch,
  }: {
    shouldReturnIfArgTypeMismatch?: boolean;
  } = {}
) {
  const builtinFnsMatchingName = lookupSymbols(BUILTIN_FNS, name);
  const builtinFn = builtinFnsMatchingName.find(
    ({paramTypeSpecs}) =>
      paramTypeSpecs.length === argTypeSpecs.length &&
      paramTypeSpecs.every(
        (paramTypeSpec, i) =>
          areMatchingElementaryTypes(paramTypeSpec, argTypeSpecs[i]) ||
          (isArray(paramTypeSpec) && isArray(argTypeSpecs[i]))
      )
  );
  return (
    builtinFn ??
    (shouldReturnIfArgTypeMismatch && builtinFnsMatchingName.length > 0
      ? builtinFnsMatchingName[0]
      : null)
  );
}

/** Interface for platform-specific runtime functionality. */
export interface RuntimePlatform {
  /** Print a string to stdout. */
  print(s: string): void;
  /** Reads a line of text from stdin. */
  inputLine(): Promise<string>;
}

/** Runtime support library.
 *
 * This class provides the interface invoked by compiled code. It is platform-agnostic, and wraps
 * the low-level, platform-dependent functionality in the injected RuntimePlatform.
 */
export default class Runtime {
  constructor(private readonly platform: RuntimePlatform) {}

  async executeBuiltinFn(
    name: string,
    argTypeSpecs: Array<DataTypeSpec>,
    ...args: Array<Ptr>
  ) {
    const builtinFn = lookupBuiltinFn(name, argTypeSpecs);
    if (!builtinFn) {
      throw new Error(`No matching built-in function found: "${name}"`);
    }
    return await builtinFn.run(...args.map((ptr) => ptr[0][ptr[1]]));
  }

  print(...args: Array<PrintArg>) {
    const PRINT_ZONE_LENGTH = 14;
    let line = '';
    for (const arg of args) {
      switch (arg.type) {
        case PrintArgType.SEMICOLON:
          break;
        case PrintArgType.COMMA:
          const numPaddingChars =
            PRINT_ZONE_LENGTH - (line.length % PRINT_ZONE_LENGTH);
          line += ' '.repeat(numPaddingChars);
          break;
        case PrintArgType.VALUE:
          if (typeof arg.value === 'string') {
            line += `${arg.value}`;
            break;
          } else if (typeof arg.value === 'number') {
            line += `${arg.value >= 0 ? ' ' : ''}${arg.value} `;
            break;
          } else {
            // Fall through
          }
        default:
          throw new Error(`Unknown print arg: '${JSON.stringify(arg)}'`);
      }
    }
    if (
      args.length === 0 ||
      args[args.length - 1].type === PrintArgType.VALUE
    ) {
      line += '\n';
    }
    this.platform.print(line);
  }

  async inputLine(prompt: string) {
    this.platform.print(prompt);
    return await this.platform.inputLine();
  }

  async input(prompt: string, ...resultTypes: Array<DataTypeSpec>) {
    for (;;) {
      this.platform.print(prompt);

      const line = await this.platform.inputLine();
      const tokens = this.lexInput(line);
      let tokenIdx = 0;

      const results: Array<string | number> = [];
      let errorMessage: string | null = null;
      for (let resultIdx = 0; resultIdx < resultTypes.length; ++resultIdx) {
        const resultType = resultTypes[resultIdx];
        const errorMessagePrefix = `Error parsing value ${resultIdx + 1}: `;
        // Consume comma token for result 1+.
        if (resultIdx > 0) {
          if (tokenIdx < tokens.length && tokens[tokenIdx].type === 'COMMA') {
            ++tokenIdx;
          } else {
            errorMessage = `${errorMessagePrefix}Comma expected`;
            break;
          }
        }
        // Consume value.
        if (tokenIdx < tokens.length && tokens[tokenIdx].type === 'STRING') {
          const {value: tokenValue} = tokens[tokenIdx];
          if (isString(resultType)) {
            results.push(tokenValue);
          } else if (isNumeric(resultType)) {
            const numericValue = parseFloat(tokenValue);
            if (isNaN(numericValue)) {
              errorMessage = `${errorMessagePrefix}Invalid numeric value "${tokenValue}"`;
              break;
            } else {
              results.push(numericValue);
            }
          } else {
            throw new Error(`Unexpected result type ${resultType.type}`);
          }
          ++tokenIdx;
        } else {
          errorMessage = `${errorMessagePrefix}No value provided`;
          break;
        }
      }

      if (results.length === resultTypes.length) {
        return results;
      } else if (results.length < resultTypes.length) {
        this.platform.print(
          `\n${errorMessage ? `${errorMessage}\n` : ''}Redo from start\n`
        );
      } else {
        throw new Error(
          `Too many results: expected ${resultTypes.length}, got ${results.length}`
        );
      }
    }
  }

  private lexInput(line: string) {
    this.inputLexer.reset(line.trim());
    const tokens: Array<Token> = [];
    for (;;) {
      const token = this.inputLexer.next();
      if (!token) {
        break;
      }
      if (token.type !== 'WHITESPACE') {
        tokens.push(token);
      }
    }
    return tokens;
  }

  /** Lexer for input(). */
  private readonly inputLexer = moo.compile({
    WHITESPACE: {match: /\s+/, lineBreaks: true},
    QUOTED_STRING: {
      match: /"[^"]*"/,
      value: (text) => text.substr(1, text.length - 2),
      type: () => 'STRING',
    },
    COMMA: ',',
    STRING: /[^,\s]+/,
  });
}
