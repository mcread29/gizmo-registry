import { Worker } from "node:worker_threads";
import ts from "typescript";
import { executeUnityCommand } from "./unity-command";
import {
  listUnityCommands,
  type UnityRegisteredCommand,
} from "./unity-list-commands";
import {
  runUnityJson,
  unityJsonArgs,
  type UnityJsonDetails,
} from "./unity-json";
import { UnityRunner, type UnityCommandRunner } from "./unity-runner";

const allowedCommands = new Set(["status", "list", "command", "test"]);

export interface UnityScriptOptions {
  projectPath: string;
  runner?: UnityCommandRunner;
  timeoutSeconds?: number;
  signal?: AbortSignal;
  onLog?: (message: string) => void;
}

export interface UnityScriptDiagnostic {
  line?: number;
  column?: number;
  code: number;
  message: string;
}

export interface UnityScriptResult {
  ok: boolean;
  phase: "discovery" | "typecheck" | "execute";
  value?: unknown;
  logs: string[];
  diagnostics: UnityScriptDiagnostic[];
  error?: string;
  discoveredCommands: number;
}

interface RpcRequest {
  type: "rpc";
  id: number;
  method: "exec" | "json" | "command";
  args: unknown[];
}

interface WorkerMessage {
  type: "rpc" | "log" | "done";
  id?: number;
  method?: RpcRequest["method"];
  args?: unknown[];
  value?: unknown;
  error?: string;
}

export async function executeUnityScript(
  source: string,
  options: UnityScriptOptions,
): Promise<UnityScriptResult> {
  const timeoutSeconds = Math.min(
    300,
    Math.max(1, options.timeoutSeconds ?? 60),
  );
  const runner = options.runner ?? new UnityRunner({ timeoutMs: 300_000 });
  const catalog = await listUnityCommands(runner, {
    projectPath: options.projectPath,
    signal: options.signal,
    timeoutMs: timeoutSeconds * 1_000,
  });
  if (catalog.state === "unavailable" || catalog.state === "error") {
    return {
      ok: false,
      phase: "discovery",
      logs: [],
      diagnostics: [],
      error: catalog.errors.map((error) => error.message).join("\n"),
      discoveredCommands: 0,
    };
  }

  const declarations = unityScriptDeclarations(catalog.commands);
  const checked = compileUnityScript(source, declarations);
  if (checked.diagnostics.length) {
    return {
      ok: false,
      phase: "typecheck",
      logs: [],
      diagnostics: checked.diagnostics,
      discoveredCommands: catalog.commands.length,
    };
  }

  return await runWorker(checked.javascript, catalog.commands, runner, {
    ...options,
    timeoutSeconds,
  });
}

export function unityScriptDeclarations(
  commands: UnityRegisteredCommand[],
): string {
  const commandMembers = commands
    .map((command) => {
      const parameters = command.parameters
        .map((parameter) => {
          const optional = parameter.required ? "" : "?";
          return `${JSON.stringify(parameter.name)}${optional}: ${parameterType(parameter.type)};`;
        })
        .join(" ");
      return `${JSON.stringify(command.name)}: (parameters${command.parameters.every((item) => !item.required) ? "?" : ""}: { ${parameters} }) => Promise<unknown>;`;
    })
    .join("\n");

  return `
interface UnityCliMessage { code: string; message: string; file?: string; line?: number; column?: number; }
interface UnityExecResult {
  ok: boolean;
  command: readonly string[];
  exitCode: number | null;
  durationMs: number;
  data: unknown;
  errors: UnityCliMessage[];
  warnings: UnityCliMessage[];
  stderr?: string;
}
interface UnityRuntime {
  /** Execute an approved Unity CLI command and retain its full result envelope. */
  exec(args: readonly string[]): Promise<UnityExecResult>;
  /** Execute an approved Unity CLI command and return its data, throwing on failure. */
  json<T = unknown>(args: readonly string[]): Promise<T>;
  /** Commands discovered live from the connected Editor. */
  commands: {
${commandMembers}
  };
}
declare const unity: UnityRuntime;
declare const console: { log(...values: unknown[]): void };
`;
}

function compileUnityScript(
  source: string,
  declarations: string,
): { javascript: string; diagnostics: UnityScriptDiagnostic[] } {
  const scriptFile = "/unity-script.ts";
  const declarationsFile = "/unity-runtime.d.ts";
  const wrapped = `async function __run() {\n${source}\n}\n__run();`;
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.None,
    strict: true,
    noEmit: true,
    types: [],
    lib: ["lib.es2022.d.ts"],
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    if (fileName === scriptFile)
      return ts.createSourceFile(fileName, wrapped, languageVersion, true);
    if (fileName === declarationsFile)
      return ts.createSourceFile(fileName, declarations, languageVersion, true);
    return getSourceFile(fileName, languageVersion, onError, shouldCreate);
  };
  host.fileExists = (fileName) =>
    fileName === scriptFile ||
    fileName === declarationsFile ||
    ts.sys.fileExists(fileName);
  host.readFile = (fileName) =>
    fileName === scriptFile
      ? wrapped
      : fileName === declarationsFile
        ? declarations
        : ts.sys.readFile(fileName);
  const program = ts.createProgram(
    [scriptFile, declarationsFile],
    options,
    host,
  );
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.file?.fileName === scriptFile)
    .map((diagnostic) => {
      const position =
        diagnostic.file && diagnostic.start !== undefined
          ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
          : undefined;
      return {
        ...(position
          ? { line: Math.max(1, position.line), column: position.character + 1 }
          : {}),
        code: diagnostic.code,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      };
    });
  const javascript = ts.transpileModule(
    `async function __run(unity) {\n${source}\n}\n__run(unity);`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  return { javascript, diagnostics };
}

async function runWorker(
  javascript: string,
  commands: UnityRegisteredCommand[],
  runner: UnityCommandRunner,
  options: Required<
    Pick<UnityScriptOptions, "projectPath" | "timeoutSeconds">
  > &
    Pick<UnityScriptOptions, "signal" | "onLog">,
): Promise<UnityScriptResult> {
  const logs: string[] = [];
  const controller = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  const worker = new Worker(workerSource, {
    eval: true,
    workerData: { javascript },
  });
  const timeout = setTimeout(
    () => controller.abort(new Error("Unity script timed out")),
    options.timeoutSeconds * 1_000,
  );
  timeout.unref();
  const abort = () => void worker.terminate();
  signal.addEventListener("abort", abort, { once: true });

  return await new Promise((resolve) => {
    let settled = false;
    const finish = (result: UnityScriptResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      controller.abort(new Error("Unity script finished"));
      void worker.terminate();
      resolve(result);
    };
    worker.on("message", (message: WorkerMessage) => {
      if (message.type === "log") {
        const value = String(message.value);
        logs.push(value);
        options.onLog?.(value);
        return;
      }
      if (message.type === "rpc") {
        void handleRpc(message as RpcRequest, commands, runner, options, signal)
          .then((value) => {
            if (!settled)
              worker.postMessage({ type: "rpc", id: message.id, value });
          })
          .catch((error) => {
            if (!settled)
              worker.postMessage({
                type: "rpc",
                id: message.id,
                error: error instanceof Error ? error.message : String(error),
              });
          });
        return;
      }
      finish({
        ok: !message.error,
        phase: "execute",
        ...(message.error
          ? { error: message.error }
          : { value: message.value }),
        logs,
        diagnostics: [],
        discoveredCommands: commands.length,
      });
    });
    worker.once("error", (error: Error) =>
      finish({
        ok: false,
        phase: "execute",
        error: error.message,
        logs,
        diagnostics: [],
        discoveredCommands: commands.length,
      }),
    );
    signal.addEventListener(
      "abort",
      () =>
        finish({
          ok: false,
          phase: "execute",
          error:
            signal.reason instanceof Error
              ? signal.reason.message
              : "Unity script was cancelled",
          logs,
          diagnostics: [],
          discoveredCommands: commands.length,
        }),
      { once: true },
    );
    if (signal.aborted) {
      finish({
        ok: false,
        phase: "execute",
        error:
          signal.reason instanceof Error
            ? signal.reason.message
            : "Unity script was cancelled",
        logs,
        diagnostics: [],
        discoveredCommands: commands.length,
      });
    }
  });
}

async function handleRpc(
  request: RpcRequest,
  commands: UnityRegisteredCommand[],
  runner: UnityCommandRunner,
  options: Pick<UnityScriptOptions, "projectPath">,
  signal: AbortSignal,
): Promise<unknown> {
  if (request.method === "command") {
    const [name, parameters] = request.args;
    if (
      typeof name !== "string" ||
      !commands.some((item) => item.name === name)
    )
      throw new Error(`Unknown Unity command: ${String(name)}`);
    return await executeUnityCommand(runner, {
      projectPath: options.projectPath,
      command: name,
      parameters:
        parameters && typeof parameters === "object"
          ? (parameters as Record<string, unknown>)
          : {},
      signal,
    });
  }
  const args = request.args[0];
  if (!Array.isArray(args) || !args.every((item) => typeof item === "string"))
    throw new Error("Unity CLI arguments must be an array of strings");
  if (args.length > 100 || args.some((item) => item.length > 8_192))
    throw new Error("Unity CLI arguments exceed the script runtime limit");
  if (args.length === 0 || !allowedCommands.has(args[0]!))
    throw new Error(
      `Unity CLI command is not available to scripts: ${args[0] ?? ""}`,
    );
  const result = await runUnityJson(runner, [...unityJsonArgs, ...args], {
    signal,
  });
  if (request.method === "json") {
    if (!result.ok) throw new Error(resultError(result));
    return result.data;
  }
  return result;
}

function resultError(result: UnityJsonDetails): string {
  return (
    result.errors
      .map((error) => `${error.code}: ${error.message}`)
      .join("\n") ||
    `Unity CLI exited with code ${result.exitCode ?? "unknown"}`
  );
}

function parameterType(type: string): string {
  const normalized = type.toLowerCase().replace(/\s+/g, "");
  if (normalized.endsWith("[]"))
    return `${parameterType(normalized.slice(0, -2))}[]`;
  if (["bool", "boolean"].includes(normalized)) return "boolean";
  if (["int", "integer", "float", "double", "number"].includes(normalized))
    return "number";
  if (["string", "guid", "path"].includes(normalized)) return "string";
  return "unknown";
}

const workerSource = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const vm = require('node:vm');
let nextId = 0;
const pending = new Map();
function rpc(method, args) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    parentPort.postMessage({ type: 'rpc', id, method, args });
  });
}
parentPort.on('message', (message) => {
  if (message.type !== 'rpc') return;
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error));
  else request.resolve(message.value);
});
const bridge = (method, payload) => rpc(method, JSON.parse(payload)).then(
  (value) => JSON.stringify({ value }),
  (error) => JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
);
const log = (value) => parentPort.postMessage({ type: 'log', value });
Object.setPrototypeOf(bridge, null);
Object.setPrototypeOf(log, null);
const context = vm.createContext({ __bridge: bridge, __log: log }, {
  codeGeneration: { strings: false, wasm: false },
});
const setup = [
  'const hostBridge = __bridge;',
  'const hostLog = __log;',
  'const call = async (method, args) => {',
  '  const response = JSON.parse(await hostBridge(method, JSON.stringify(args)));',
  '  if (response.error) throw new Error(response.error);',
  '  return response.value;',
  '};',
  'globalThis.unity = Object.freeze({',
  "  exec: (args) => call('exec', [args]),",
  "  json: (args) => call('json', [args]),",
  '  commands: new Proxy(Object.create(null), {',
  "    get: (_target, name) => (parameters = {}) => call('command', [String(name), parameters]),",
  '  }),',
  '});',
  'globalThis.console = Object.freeze({',
  "  log: (...values) => hostLog(values.map(String).join(' ')),",
  '});',
].join('\n');
vm.runInContext(setup, context);
delete context.__bridge;
delete context.__log;
(async () => {
  try {
    const promise = vm.runInContext(workerData.javascript, context, { timeout: 1000 });
    const value = await promise;
    parentPort.postMessage({ type: 'done', value });
  } catch (error) {
    parentPort.postMessage({ type: 'done', error: error instanceof Error ? error.message : String(error) });
  }
})();
`;
