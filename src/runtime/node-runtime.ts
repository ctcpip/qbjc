import {CompiledModule} from './compiled-code';
import Executor from './executor';
import {RuntimePlatform} from './runtime';

export class NodePlatform implements RuntimePlatform {
  print(s: string) {
    process.stdout.write(s);
  }

  async inputLine(): Promise<string> {
    return new Promise<string>((resolve) => {
      process.stdin.resume();
      process.stdin.once('data', (chunk) => {
        process.stdin.pause();
        resolve(chunk.toString());
      });
    });
  }
}

export class NodeExecutor extends Executor {
  constructor() {
    super(new NodePlatform());
  }
}

// Generated by codegen.
declare var compiledModule: CompiledModule | undefined;

async function run() {
  const executor = new NodeExecutor();
  return await executor.executeModule(compiledModule!);
}

export default {
  ...(typeof compiledModule === 'undefined' ? {} : compiledModule),
  run,
};

if (require.main === module) {
  run();
}
