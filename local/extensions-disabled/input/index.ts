import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, constants, mkdtemp, rm, writeFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Type, type Static } from "typebox";

const MAX_ACTIONS = 100;
const MAX_TOTAL_DELAY_MS = 60_000;
const DEFAULT_TIMEOUT_SECONDS = 600;
const MAX_BODY_BYTES = 512 * 1024;
const MAX_RESPONSE_CHARACTERS = 20_000;
const MAX_HELPER_OUTPUT_BYTES = 4_096;

const ActionSchema = Type.Object({
  type: StringEnum(
    ["move", "click", "drag", "scroll", "key", "type", "wait"] as const,
    { description: "Desktop input action to perform" },
  ),
  x: Type.Optional(
    Type.Integer({
      description:
        "Physical screen X coordinate. For drag, this is the optional starting X coordinate.",
    }),
  ),
  y: Type.Optional(
    Type.Integer({
      description:
        "Physical screen Y coordinate. For drag, this is the optional starting Y coordinate.",
    }),
  ),
  toX: Type.Optional(
    Type.Integer({ description: "Required drag destination X coordinate" }),
  ),
  toY: Type.Optional(
    Type.Integer({ description: "Required drag destination Y coordinate" }),
  ),
  button: Type.Optional(
    StringEnum(["left", "right", "middle"] as const, {
      description: "Mouse button; defaults to left",
    }),
  ),
  count: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 100,
      description:
        "Click count (maximum 5) or key-chord repeat count (maximum 100); defaults to 1",
    }),
  ),
  delta: Type.Optional(
    Type.Integer({
      minimum: -12_000,
      maximum: 12_000,
      description:
        "Scroll amount in wheel units. Positive is up/right; negative is down/left. One notch is usually 120.",
    }),
  ),
  axis: Type.Optional(
    StringEnum(["vertical", "horizontal"] as const, {
      description: "Scroll axis; defaults to vertical",
    }),
  ),
  keys: Type.Optional(
    Type.Array(Type.String(), {
      minItems: 1,
      maxItems: 8,
      description: 'Keys pressed as a chord, such as ["CTRL", "SHIFT", "S"]',
    }),
  ),
  text: Type.Optional(
    Type.String({
      maxLength: 10_000,
      description: "Unicode text to type into the focused application",
    }),
  ),
  durationMs: Type.Optional(
    Type.Integer({
      minimum: 0,
      maximum: 30_000,
      description:
        "Move/drag duration, or required wait duration, in milliseconds",
    }),
  ),
  intervalMs: Type.Optional(
    Type.Integer({
      minimum: 0,
      maximum: 5_000,
      description: "Delay between repeated clicks, keys, or typed characters",
    }),
  ),
  steps: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 200,
      description: "Number of interpolation steps for a move or drag",
    }),
  ),
});

const DesktopInputParams = Type.Object({
  reason: Type.String({
    minLength: 1,
    maxLength: 200,
    description: "Short explanation of why desktop input is needed",
  }),
  actions: Type.Array(ActionSchema, {
    minItems: 1,
    maxItems: MAX_ACTIONS,
    description: "Ordered mouse and keyboard actions to perform",
  }),
  dryRun: Type.Optional(
    Type.Boolean({
      description:
        "Validate and summarize actions without sending any desktop input",
    }),
  ),
});

const RemoteInputParams = Type.Object({
  prompt: Type.String({
    minLength: 1,
    maxLength: 2_000,
    description:
      "Instructions shown above the private text box. Do not ask the user to reveal the text to the agent.",
  }),
  placeholder: Type.Optional(
    Type.String({
      maxLength: 300,
      description: "Optional placeholder displayed inside the text box",
    }),
  ),
  timeoutSeconds: Type.Optional(
    Type.Integer({
      minimum: 30,
      maximum: 3_600,
      description:
        "How long the page remains available; defaults to 600 seconds",
    }),
  ),
});

interface TailscaleConnection {
  ip: string;
  dnsName?: string;
}

interface FocusSnapshot {
  token: string;
}

interface PendingRequest {
  server: Server;
  url: string;
  requestId: string;
  expiresAt: string;
  timeout: NodeJS.Timeout;
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

type DesktopAction = {
  type: "move" | "click" | "drag" | "scroll" | "key" | "type" | "wait";
  x?: number;
  y?: number;
  toX?: number;
  toY?: number;
  button?: "left" | "right" | "middle";
  count?: number;
  delta?: number;
  axis?: "vertical" | "horizontal";
  keys?: string[];
  text?: string;
  durationMs?: number;
  intervalMs?: number;
  steps?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function isTailscaleIpv4(value: string) {
  const octets = value.split(".").map(Number);
  return (
    octets.length === 4 &&
    octets.every(
      (octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255,
    ) &&
    octets[0] === 100 &&
    octets[1] >= 64 &&
    octets[1] <= 127
  );
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function run(
  command: string,
  args: string[],
  options?: { input?: string; timeoutMs?: number },
) {
  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      callback();
    };
    const timer = setTimeout(
      () =>
        finish(() => {
          child.kill();
          reject(new Error(`${command} timed out.`));
        }),
      options?.timeoutMs ?? 15_000,
    );

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < 1_000_000) stdout += String(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_HELPER_OUTPUT_BYTES) stderr += String(chunk);
    });
    child.once("error", (error) =>
      finish(() => {
        clearTimeout(timer);
        reject(error);
      }),
    );
    child.once("close", (code) =>
      finish(() => {
        clearTimeout(timer);
        resolve({ code: code ?? -1, stdout, stderr });
      }),
    );

    if (options?.input !== undefined) {
      child.stdin.end(options.input);
    } else {
      child.stdin.end();
    }
  });
}

async function commandOnPath(name: string) {
  const result = await run("sh", ["-c", `command -v ${name}`], {
    timeoutMs: 5_000,
  });
  return result.code === 0 && result.stdout.trim().length > 0;
}

async function executableExists(path: string) {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Shared desktop-input validation
// ---------------------------------------------------------------------------

function hasCoordinatePair(action: DesktopAction) {
  return action.x !== undefined && action.y !== undefined;
}

function hasPartialCoordinatePair(action: DesktopAction) {
  return (action.x === undefined) !== (action.y === undefined);
}

function delayForAction(action: DesktopAction) {
  switch (action.type) {
    case "move":
    case "wait":
      return action.durationMs ?? 0;
    case "drag":
      return action.durationMs ?? 250;
    case "click":
    case "key":
      return Math.max(0, (action.count ?? 1) - 1) * (action.intervalMs ?? 0);
    case "type":
      return (
        Math.max(0, (action.text?.length ?? 0) - 1) * (action.intervalMs ?? 0)
      );
    case "scroll":
      return 0;
  }
}

export function validateActions(actions: DesktopAction[]) {
  if (actions.length === 0) return "At least one action is required.";
  if (actions.length > MAX_ACTIONS) {
    return `At most ${MAX_ACTIONS} actions may be sent in one call.`;
  }

  let totalDelayMs = 0;

  for (const [index, action] of actions.entries()) {
    const position = `Action ${index + 1} (${action.type})`;

    if (hasPartialCoordinatePair(action)) {
      return `${position}: x and y must be provided together.`;
    }

    switch (action.type) {
      case "move":
        if (!hasCoordinatePair(action)) {
          return `${position}: x and y are required.`;
        }
        break;
      case "click":
        if ((action.count ?? 1) > 5) {
          return `${position}: click count cannot exceed 5.`;
        }
        break;
      case "drag":
        if (action.toX === undefined || action.toY === undefined) {
          return `${position}: toX and toY are required.`;
        }
        break;
      case "scroll":
        if (action.delta === undefined || action.delta === 0) {
          return `${position}: delta must be a non-zero integer.`;
        }
        break;
      case "key":
        if (!action.keys || action.keys.length === 0) {
          return `${position}: keys must contain at least one key name.`;
        }
        if (action.keys.some((key) => key.trim().length === 0)) {
          return `${position}: key names cannot be empty.`;
        }
        break;
      case "type":
        if (action.text === undefined) {
          return `${position}: text is required.`;
        }
        break;
      case "wait":
        if (action.durationMs === undefined) {
          return `${position}: durationMs is required.`;
        }
        break;
    }

    totalDelayMs += delayForAction(action);
  }

  if (totalDelayMs > MAX_TOTAL_DELAY_MS) {
    return `The batch contains ${totalDelayMs}ms of delays; the maximum is ${MAX_TOTAL_DELAY_MS}ms.`;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Windows desktop input (SendInput via windows-input.ps1)
// ---------------------------------------------------------------------------

function parsePowerShellResult(stdout: string) {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const json = lines.at(-1);
  if (!json) throw new Error("Windows input helper returned no output.");

  try {
    return JSON.parse(json) as unknown;
  } catch {
    throw new Error(`Windows input helper returned invalid JSON: ${json}`);
  }
}

async function executeWindowsActions(
  pi: ExtensionAPI,
  helperPath: string,
  actions: DesktopAction[],
  dryRun: boolean,
) {
  const tempDirectory = await mkdtemp(join(tmpdir(), "pi-input-"));
  const payloadPath = join(tempDirectory, "actions.json");
  const timeout = Math.min(
    75_000,
    10_000 + actions.reduce((sum, action) => sum + delayForAction(action), 0),
  );

  try {
    await writeFile(payloadPath, JSON.stringify({ actions, dryRun }), {
      encoding: "utf8",
      mode: 0o600,
    });
    const result = await pi.exec(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        helperPath,
        "-PayloadPath",
        payloadPath,
      ],
      { timeout },
    );

    if (result.code !== 0) {
      const message = (result.stderr || result.stdout).trim();
      throw new Error(
        `Windows input helper failed with exit code ${result.code}${message ? `: ${message}` : ""}`,
      );
    }
    return parsePowerShellResult(result.stdout);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// macOS desktop input (cliclick for mouse, AppleScript for keys and typing)
// ---------------------------------------------------------------------------

const MAC_MODIFIERS: Record<string, string> = {
  CTRL: "control",
  CONTROL: "control",
  LCTRL: "control",
  RCTRL: "control",
  ALT: "option",
  MENU: "option",
  LALT: "option",
  RALT: "option",
  SHIFT: "shift",
  LSHIFT: "shift",
  RSHIFT: "shift",
  WIN: "command",
  LWIN: "command",
  RWIN: "command",
  WINDOWS: "command",
  META: "command",
};

const MAC_MODIFIER_CODES: Record<string, number> = {
  control: 59,
  option: 58,
  shift: 56,
  command: 55,
};

const MAC_KEY_CODES: Record<string, number> = {
  ENTER: 36,
  RETURN: 36,
  TAB: 48,
  ESC: 53,
  ESCAPE: 53,
  BACKSPACE: 51,
  BACK: 51,
  DEL: 117,
  DELETE: 117,
  SPACE: 49,
  PAGEUP: 116,
  PGUP: 116,
  PAGEDOWN: 121,
  PGDN: 121,
  HOME: 115,
  END: 119,
  LEFT: 123,
  UP: 126,
  RIGHT: 124,
  DOWN: 125,
  CAPSLOCK: 57,
  NUMLOCK: 71,
  INSERT: 114,
  INS: 114,
  F1: 122,
  F2: 120,
  F3: 99,
  F4: 118,
  F5: 96,
  F6: 97,
  F7: 98,
  F8: 100,
  F9: 101,
  F10: 109,
  F11: 103,
  F12: 111,
  F13: 105,
  F14: 107,
  F15: 113,
};

function appleScriptLiteral(text: string) {
  const normalized = text.replace(/\r\n?/g, "\n");
  return normalized
    .split("\n")
    .map((line) =>
      line
        .split("\t")
        .map(
          (chunk) =>
            `"${chunk.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`,
        )
        .join(" & tab "),
    )
    .join(" & return ");
}

function macModifierList(keys: string[]) {
  const modifiers = new Set<string>();
  for (const raw of keys) {
    const modifier = MAC_MODIFIERS[raw.trim().toUpperCase()];
    if (modifier) modifiers.add(modifier);
  }
  if (modifiers.size === 0) return "";
  return ` using {${[...modifiers].map((mod) => `${mod} down`).join(", ")}}`;
}

function macChordStatements(keys: string[]) {
  const modifiers = new Set<string>();
  const mains: string[] = [];

  for (const raw of keys) {
    const key = raw.trim();
    const upper = key.toUpperCase();
    const modifier = MAC_MODIFIERS[upper];
    if (modifier) {
      modifiers.add(modifier);
    } else {
      mains.push(key);
    }
  }

  const statements: string[] = [];

  if (mains.length === 0) {
    // Chord of only modifier keys: press and release each via key codes.
    for (const modifier of modifiers) {
      const code = MAC_MODIFIER_CODES[modifier];
      if (code === undefined) {
        throw new Error(`Unknown modifier key: ${modifier}`);
      }
      statements.push(`key code ${code}`);
    }
    return statements;
  }

  const usingClause = macModifierList(keys);

  for (const main of mains) {
    const upper = main.toUpperCase();
    if (main.length === 1) {
      statements.push(
        `keystroke "${main.replaceAll('"', '\\"')}"${usingClause}`,
      );
      continue;
    }
    if (upper.startsWith("F") && Number.isInteger(Number(upper.slice(1)))) {
      const functionNumber = Number(upper.slice(1));
      if (functionNumber >= 16 && functionNumber <= 24) {
        throw new Error(
          `F${functionNumber} is not supported on macOS; use F1-F15.`,
        );
      }
    }
    const code = MAC_KEY_CODES[upper];
    if (code === undefined) {
      throw new Error(
        `Unknown key name on macOS: ${main}. Use letters, digits, F1-F15, or names like ENTER, TAB, ESC, BACKSPACE, DEL, SPACE, PAGEUP, PAGEDOWN, HOME, END, LEFT, UP, RIGHT, DOWN.`,
      );
    }
    statements.push(`key code ${code}${usingClause}`);
  }

  return statements;
}

async function runAppleScript(statements: string[]) {
  const script = `tell application "System Events"\n${statements.join("\n")}\nend tell`;
  const result = await run("osascript", ["-e", script], {
    timeoutMs: 30_000,
  });
  if (result.code !== 0) {
    throw new Error(
      `macOS input failed: ${(result.stderr || result.stdout).trim()}. ` +
        "The host terminal needs Accessibility permission (System Settings > Privacy & Security > Accessibility).",
    );
  }
}

async function resolveCliclick() {
  const candidates = [
    "cliclick",
    "/opt/homebrew/bin/cliclick",
    "/usr/local/bin/cliclick",
  ];
  for (const candidate of candidates) {
    if (candidate.includes("/")) {
      if (await executableExists(candidate)) return candidate;
    } else if (await commandOnPath(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

async function executeDarwinActions(
  _pi: ExtensionAPI,
  _helperPath: string,
  actions: DesktopAction[],
  dryRun: boolean,
) {
  const summaries: string[] = [];

  if (dryRun) {
    for (const action of actions) summaries.push(`${action.type} (dry run)`);
    return {
      platform: "darwin",
      actionCount: actions.length,
      actions: summaries,
      dryRun,
    };
  }

  const needsMouse = actions.some((action) =>
    ["move", "click", "drag", "scroll"].includes(action.type),
  );
  let cliclick: string | undefined;
  if (needsMouse) {
    cliclick = await resolveCliclick();
    if (!cliclick) {
      throw new Error(
        "cliclick is required for mouse actions on macOS. Install it with: brew install cliclick",
      );
    }
  }

  const point = (x: number, y: number) => `${x},${y}`;

  for (const [index, action] of actions.entries()) {
    switch (action.type) {
      case "move": {
        await run(cliclick!, ["m:" + point(action.x!, action.y!)], {
          timeoutMs: 10_000,
        });
        summaries.push(`move to ${action.x},${action.y}`);
        break;
      }
      case "click": {
        const args: string[] = [];
        if (action.x !== undefined && action.y !== undefined) {
          args.push("m:" + point(action.x, action.y));
        }
        const button = action.button ?? "left";
        if (button === "middle") {
          throw new Error("Middle click is not supported on macOS.");
        }
        const count = action.count ?? 1;
        const command =
          button === "right"
            ? "rc:"
            : count >= 3
              ? "tc:"
              : count === 2
                ? "dc:"
                : "c:";
        args.push(
          command +
            (action.x !== undefined && action.y !== undefined
              ? point(action.x, action.y)
              : ""),
        );
        await run(cliclick!, args, { timeoutMs: 10_000 });
        if (count > 1 && action.intervalMs && action.intervalMs > 0) {
          await sleep(action.intervalMs);
        }
        summaries.push(`${button} click x${count}`);
        break;
      }
      case "drag": {
        const args: string[] = [];
        if (action.x !== undefined && action.y !== undefined) {
          args.push("dd:" + point(action.x, action.y));
        } else {
          args.push("dd:.");
        }
        args.push("du:" + point(action.toX!, action.toY!));
        await run(cliclick!, args, { timeoutMs: 30_000 });
        summaries.push(`drag to ${action.toX},${action.toY}`);
        break;
      }
      case "scroll": {
        throw new Error(
          "Scrolling is not supported on macOS. Use key actions (arrow keys, PAGEUP, PAGEDOWN) instead.",
        );
      }
      case "key": {
        const keys = action.keys!;
        const count = action.count ?? 1;
        const statements = macChordStatements(keys);
        for (let repeat = 0; repeat < count; repeat++) {
          await runAppleScript(statements);
          if (
            repeat < count - 1 &&
            action.intervalMs &&
            action.intervalMs > 0
          ) {
            await sleep(action.intervalMs);
          }
        }
        summaries.push(`keys ${keys.join("+")} x${count}`);
        break;
      }
      case "type": {
        const statements = [`keystroke ${appleScriptLiteral(action.text!)}`];
        await runAppleScript(statements);
        summaries.push(`type ${action.text!.length} character(s)`);
        break;
      }
      case "wait": {
        if (action.durationMs && action.durationMs > 0) {
          await sleep(action.durationMs);
        }
        summaries.push(`wait ${action.durationMs ?? 0}ms`);
        break;
      }
      default: {
        throw new Error(
          `Unknown action type at action ${index + 1}: ${(action as DesktopAction).type}`,
        );
      }
    }
  }

  return {
    platform: "darwin",
    actionCount: actions.length,
    actions: summaries,
    dryRun,
  };
}

// ---------------------------------------------------------------------------
// Linux desktop input (xdotool)
// ---------------------------------------------------------------------------

const XDOTOL_KEY_NAMES: Record<string, string> = {
  CTRL: "ctrl",
  CONTROL: "ctrl",
  LCTRL: "ctrl",
  RCTRL: "ctrl",
  ALT: "alt",
  MENU: "alt",
  LALT: "alt",
  RALT: "alt",
  SHIFT: "shift",
  LSHIFT: "shift",
  RSHIFT: "shift",
  WIN: "super",
  LWIN: "super",
  RWIN: "super",
  WINDOWS: "super",
  META: "super",
  ENTER: "Return",
  RETURN: "Return",
  ESC: "Escape",
  ESCAPE: "Escape",
  TAB: "Tab",
  BACKSPACE: "BackSpace",
  BACK: "BackSpace",
  DEL: "Delete",
  DELETE: "Delete",
  SPACE: "space",
  PAGEUP: "Page_Up",
  PGUP: "Page_Up",
  PAGEDOWN: "Page_Down",
  PGDN: "Page_Down",
  HOME: "Home",
  END: "End",
  LEFT: "Left",
  UP: "Up",
  RIGHT: "Right",
  DOWN: "Down",
  INSERT: "Insert",
  INS: "Insert",
  CAPSLOCK: "Caps_Lock",
  NUMLOCK: "Num_Lock",
  SCROLLLOCK: "Scroll_Lock",
  PRINTSCREEN: "Print",
  PRTSC: "Print",
  APPS: "Menu",
};

function xdotoolKeyName(raw: string) {
  const key = raw.trim();
  const upper = key.toUpperCase();

  if (upper.startsWith("VK_")) {
    const value = Number.parseInt(upper.slice(3), 16);
    if (Number.isNaN(value) || value < 0 || value > 0xff) {
      throw new Error(`Invalid VK_ key code: ${raw}`);
    }
    throw new Error(
      `VK_ key codes are Windows-only; use an X keysym name instead of ${raw}.`,
    );
  }

  const named = XDOTOL_KEY_NAMES[upper];
  if (named) return named;

  if (upper.startsWith("F") && Number.isInteger(Number(upper.slice(1)))) {
    const functionNumber = Number(upper.slice(1));
    if (functionNumber >= 1 && functionNumber <= 24) return upper;
  }

  if (key.length === 1) return key;

  throw new Error(`Unknown key name on Linux: ${raw}`);
}

async function executeLinuxActions(
  _pi: ExtensionAPI,
  _helperPath: string,
  actions: DesktopAction[],
  dryRun: boolean,
) {
  if (!(await commandOnPath("xdotool"))) {
    throw new Error(
      "xdotool is required for desktop input on Linux. Install it with your package manager (e.g. sudo apt install xdotool). Wayland sessions are not supported.",
    );
  }

  const summaries: string[] = [];

  if (dryRun) {
    for (const action of actions) summaries.push(`${action.type} (dry run)`);
    return {
      platform: "linux",
      actionCount: actions.length,
      actions: summaries,
      dryRun,
    };
  }

  const buttonNumber = (button: "left" | "right" | "middle") =>
    button === "right" ? 3 : button === "middle" ? 2 : 1;

  const xdotool = async (args: (string | number)[]) => {
    const result = await run(
      "xdotool",
      args.map((arg) => String(arg)),
      { timeoutMs: 30_000 },
    );
    if (result.code !== 0) {
      throw new Error(
        `xdotool failed: ${(result.stderr || result.stdout).trim()}`,
      );
    }
  };

  for (const [index, action] of actions.entries()) {
    switch (action.type) {
      case "move": {
        await xdotool(["mousemove", action.x!, action.y!]);
        summaries.push(`move to ${action.x},${action.y}`);
        break;
      }
      case "click": {
        if (action.x !== undefined && action.y !== undefined) {
          await xdotool(["mousemove", action.x, action.y]);
        }
        const button = action.button ?? "left";
        const count = action.count ?? 1;
        await xdotool(["click", "--repeat", count, buttonNumber(button)]);
        if (count > 1 && action.intervalMs && action.intervalMs > 0) {
          await sleep(action.intervalMs);
        }
        summaries.push(`${button} click x${count}`);
        break;
      }
      case "drag": {
        const button = action.button ?? "left";
        if (action.x !== undefined && action.y !== undefined) {
          await xdotool(["mousemove", action.x, action.y]);
        }
        await xdotool(["mousedown", buttonNumber(button)]);
        await xdotool(["mousemove", action.toX!, action.toY!]);
        await xdotool(["mouseup", buttonNumber(button)]);
        summaries.push(`drag to ${action.toX},${action.toY}`);
        break;
      }
      case "scroll": {
        const delta = action.delta!;
        const notches = Math.max(1, Math.round(Math.abs(delta) / 120));
        let button: number;
        if (action.axis === "horizontal") {
          button = delta > 0 ? 7 : 6;
        } else {
          button = delta > 0 ? 4 : 5;
        }
        await xdotool(["click", "--repeat", notches, button]);
        summaries.push(`${action.axis ?? "vertical"} scroll ${delta}`);
        break;
      }
      case "key": {
        const combo = action.keys!.map(xdotoolKeyName).join("+");
        const count = action.count ?? 1;
        for (let repeat = 0; repeat < count; repeat++) {
          await xdotool(["key", combo]);
          if (
            repeat < count - 1 &&
            action.intervalMs &&
            action.intervalMs > 0
          ) {
            await sleep(action.intervalMs);
          }
        }
        summaries.push(`keys ${action.keys!.join("+")} x${count}`);
        break;
      }
      case "type": {
        await xdotool([
          "type",
          "--delay",
          Math.max(0, action.intervalMs ?? 0),
          "--",
          action.text!,
        ]);
        summaries.push(`type ${action.text!.length} character(s)`);
        break;
      }
      case "wait": {
        if (action.durationMs && action.durationMs > 0) {
          await sleep(action.durationMs);
        }
        summaries.push(`wait ${action.durationMs ?? 0}ms`);
        break;
      }
      default: {
        throw new Error(
          `Unknown action type at action ${index + 1}: ${(action as DesktopAction).type}`,
        );
      }
    }
  }

  return {
    platform: "linux",
    actionCount: actions.length,
    actions: summaries,
    dryRun,
  };
}

// ---------------------------------------------------------------------------
// Tailscale (shared by remote_input)
// ---------------------------------------------------------------------------

async function findTailscaleExecutable() {
  const candidates =
    process.platform === "win32"
      ? [
          join(
            process.env.ProgramFiles ?? "C:\\Program Files",
            "Tailscale",
            "tailscale.exe",
          ),
          "tailscale.exe",
        ]
      : process.platform === "darwin"
        ? ["/Applications/Tailscale.app/Contents/MacOS/Tailscale", "tailscale"]
        : ["tailscale", "/usr/bin/tailscale", "/usr/local/bin/tailscale"];

  for (const candidate of candidates) {
    if (candidate.includes("/") || candidate.includes("\\")) {
      if (await executableExists(candidate)) return candidate;
    } else if (await commandOnPath(candidate)) {
      return candidate;
    }
  }
  return process.platform === "win32" ? "tailscale.exe" : "tailscale";
}

async function getTailscaleConnection(
  pi: ExtensionAPI,
  signal: AbortSignal | undefined,
) {
  const executable = await findTailscaleExecutable();
  const result = await pi.exec(executable, ["status", "--json"], {
    signal,
    timeout: 10_000,
  });

  if (result.code !== 0) {
    const message = (result.stderr || result.stdout).trim();
    throw new Error(
      `Unable to read Tailscale status${message ? `: ${message}` : "."}`,
    );
  }

  let status: unknown;
  try {
    status = JSON.parse(result.stdout) as unknown;
  } catch {
    throw new Error("Tailscale returned invalid status JSON.");
  }

  if (!isRecord(status)) throw new Error("Tailscale status is unavailable.");
  if (status.BackendState !== "Running") {
    throw new Error(
      `Tailscale is not connected (state: ${String(status.BackendState ?? "unknown")}).`,
    );
  }

  const self = isRecord(status.Self) ? status.Self : undefined;
  const addresses = [
    ...stringArray(self?.TailscaleIPs),
    ...stringArray(status.TailscaleIPs),
  ];
  const ip = addresses.find(isTailscaleIpv4);
  if (!ip) throw new Error("No Tailscale IPv4 address is available.");

  const rawDnsName = self?.DNSName;
  const dnsName =
    typeof rawDnsName === "string" && rawDnsName.length > 0
      ? rawDnsName.replace(/\.$/, "")
      : undefined;
  return { ip, dnsName } satisfies TailscaleConnection;
}

// ---------------------------------------------------------------------------
// Focus capture and blind typing (shared by remote_input)
// ---------------------------------------------------------------------------

async function captureFocus(
  pi: ExtensionAPI,
  helperPath: string,
  signal: AbortSignal | undefined,
): Promise<FocusSnapshot> {
  if (process.platform === "win32") {
    const result = await pi.exec(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        helperPath,
        "-Mode",
        "Capture",
      ],
      { signal, timeout: 10_000 },
    );
    if (result.code !== 0) {
      throw new Error("Unable to capture the focused desktop control.");
    }
    const snapshot = parsePowerShellResult(result.stdout) as unknown;
    if (
      !isRecord(snapshot) ||
      typeof snapshot.foreground !== "string" ||
      typeof snapshot.focused !== "string" ||
      !/^\d+$/.test(snapshot.foreground) ||
      !/^\d+$/.test(snapshot.focused) ||
      snapshot.foreground === "0" ||
      snapshot.focused === "0"
    ) {
      throw new Error("No focused desktop input control was detected.");
    }
    return {
      token: JSON.stringify({
        foreground: snapshot.foreground,
        focused: snapshot.focused,
      }),
    };
  }

  if (process.platform === "darwin") {
    const script = [
      'tell application "System Events"',
      "  set frontProcess to first application process whose frontmost is true",
      "  set appName to name of frontProcess",
      "  try",
      "    set windowName to name of front window of frontProcess",
      "  on error",
      '    set windowName to ""',
      "  end try",
      '  return appName & "|" & windowName',
      "end tell",
    ].join("\n");
    const result = await run("osascript", ["-e", script], {
      timeoutMs: 10_000,
    });
    if (result.code !== 0) {
      throw new Error(
        `Unable to capture the focused desktop control: ${(result.stderr || result.stdout).trim()}. The host terminal needs Accessibility permission.`,
      );
    }
    const token = result.stdout.trim();
    if (!token || token === "|") {
      throw new Error("No focused desktop input control was detected.");
    }
    return { token };
  }

  if (process.platform === "linux") {
    if (!(await commandOnPath("xdotool"))) {
      throw new Error(
        "xdotool is required for focus capture on Linux. Install it with your package manager (e.g. sudo apt install xdotool). Wayland sessions are not supported.",
      );
    }
    const result = await run("xdotool", ["getactivewindow"], {
      timeoutMs: 10_000,
    });
    if (result.code !== 0) {
      throw new Error(
        `Unable to capture the focused desktop control: ${(result.stderr || result.stdout).trim()}`,
      );
    }
    const token = result.stdout.trim();
    if (!token) {
      throw new Error("No focused desktop input control was detected.");
    }
    return { token };
  }

  throw new Error(
    `Private remote typing is not supported on ${process.platform}.`,
  );
}

function typeBlindText(
  pi: ExtensionAPI,
  helperPath: string,
  snapshot: FocusSnapshot,
  text: string,
) {
  if (process.platform === "win32") {
    return new Promise<void>((resolve, reject) => {
      const expected = JSON.parse(snapshot.token) as {
        foreground: string;
        focused: string;
      };
      const child = spawn(
        "powershell.exe",
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          helperPath,
          "-Mode",
          "Type",
          "-ExpectedForeground",
          expected.foreground,
          "-ExpectedFocused",
          expected.focused,
        ],
        { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
      );
      let stderr = "";
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        callback();
      };

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        if (stderr.length < MAX_HELPER_OUTPUT_BYTES) stderr += chunk;
      });
      child.once("error", () =>
        finish(() =>
          reject(new Error("The private typing helper could not start.")),
        ),
      );
      child.once("close", (code) => {
        if (code === 0) {
          finish(resolve);
          return;
        }
        const focusChanged = stderr.includes("FOCUS_CHANGED");
        finish(() =>
          reject(
            new Error(
              focusChanged
                ? "The target desktop field is no longer focused. Nothing was typed."
                : "The desktop blocked private typing. The target may be elevated or may not accept simulated input.",
            ),
          ),
        );
      });

      const encoded = Buffer.from(text, "utf16le").toString("base64");
      child.stdin.end(encoded, "ascii");
    });
  }

  return (async () => {
    // Verify focus has not drifted since the page was created.
    const current = await captureFocus(pi, helperPath, undefined);
    if (current.token !== snapshot.token) {
      throw new Error(
        "The target desktop field is no longer focused. Nothing was typed.",
      );
    }

    if (process.platform === "darwin") {
      const script = `tell application "System Events"\n  keystroke ${appleScriptLiteral(text)}\nend tell`;
      const result = await run("osascript", ["-e", script], {
        timeoutMs: 120_000,
      });
      if (result.code !== 0) {
        throw new Error(
          "The desktop blocked private typing. The host terminal may be missing Accessibility permission.",
        );
      }
      return;
    }

    if (process.platform === "linux") {
      const result = await run(
        "xdotool",
        ["type", "--delay", "1", "--", text],
        { timeoutMs: 120_000 },
      );
      if (result.code !== 0) {
        throw new Error("The desktop blocked private typing (xdotool failed).");
      }
      return;
    }

    throw new Error(
      `Private remote typing is not supported on ${process.platform}.`,
    );
  })();
}

// ---------------------------------------------------------------------------
// One-time private web form (shared by remote_input)
// ---------------------------------------------------------------------------

function pageHeaders(response: ServerResponse, statusCode = 200) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    Connection: "close",
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "Content-Type": "text/html; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
}

function renderForm(
  prompt: string,
  placeholder: string,
  timeoutSeconds: number,
  submitPath: string,
  requestId: string,
) {
  const timeoutMinutes = Math.max(1, Math.ceil(timeoutSeconds / 60));
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Private remote typing for pi</title>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0c111b; color: #edf2f7; }
    main { width: min(42rem, calc(100% - 2rem)); box-sizing: border-box; padding: 1.4rem; border: 1px solid #2b3950; border-radius: 1rem; background: #131c2b; box-shadow: 0 1rem 3rem #0008; }
    h1 { margin: 0 0 .45rem; font-size: 1.15rem; }
    .prompt { margin: 0 0 1rem; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
    .notice { padding: .75rem; margin-bottom: 1rem; border: 1px solid #67552d; border-radius: .65rem; background: #2b2415; color: #f1d58a; line-height: 1.4; }
    input[type="password"] { width: 100%; box-sizing: border-box; padding: .85rem; border: 1px solid #42536e; border-radius: .65rem; background: #0b1320; color: inherit; font: inherit; line-height: 1.45; }
    input[type="password"]:focus { outline: 2px solid #67a6ff; outline-offset: 2px; }
    button { width: 100%; margin-top: .8rem; padding: .8rem 1rem; border: 0; border-radius: .65rem; background: #3984ee; color: white; font: inherit; font-weight: 700; cursor: pointer; }
    button:hover { background: #4d92f2; }
    small { display: block; margin-top: .85rem; color: #9eacc0; line-height: 1.4; }
  </style>
</head>
<body>
  <main>
    <h1>Private remote typing · Request ${escapeHtml(requestId)}</h1>
    <p class="prompt">${escapeHtml(prompt)}</p>
    <div class="notice">Open this page from another Tailscale device. Keep the target field focused on the target computer.</div>
    <form method="post" action="${escapeHtml(submitPath)}">
      <input type="password" name="text" maxlength="${MAX_RESPONSE_CHARACTERS}" placeholder="${escapeHtml(placeholder)}" required autofocus autocomplete="off" autocapitalize="off" spellcheck="false">
      <button type="submit">Type into focused field</button>
    </form>
    <small>The submitted text is sent directly to the focused desktop control. It is not returned to the agent or stored in the pi session. This one-time page expires in about ${timeoutMinutes} minute${timeoutMinutes === 1 ? "" : "s"}.</small>
  </main>
</body>
</html>`;
}

function renderMessage(title: string, message: string) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0c111b; color: #edf2f7; }
    main { width: min(34rem, calc(100% - 2rem)); padding: 1.4rem; border: 1px solid #2b3950; border-radius: 1rem; background: #131c2b; text-align: center; }
    h1 { margin-top: 0; } p { color: #bdc9da; line-height: 1.5; }
  </style>
</head>
<body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body>
</html>`;
}

function readRequestBody(request: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    request.on("data", (chunk: Buffer) => {
      totalBytes += chunk.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        reject(new Error("Submission is too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function listen(server: Server, host: string) {
  return new Promise<number>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Remote input server did not receive a TCP port."));
        return;
      }
      resolve(address.port);
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, host);
  });
}

function closeServer(server: Server) {
  return new Promise<void>((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function inputExtension(pi: ExtensionAPI) {
  const helperPath = fileURLToPath(
    new URL("./windows-input.ps1", import.meta.url),
  );
  const privateTypePath = fileURLToPath(
    new URL("./private-type.ps1", import.meta.url),
  );

  const desktopTool = {
    name: "input",
    label: "Desktop Input",
    description:
      "Control the active desktop with an ordered batch of mouse and keyboard actions. Cross-platform: Windows (full support via SendInput), macOS (keys and typing via AppleScript; mouse actions require cliclick; scrolling is unsupported), Linux/X11 (requires xdotool; Wayland is unsupported). Supports move, click/double-click, drag, vertical/horizontal scroll, key chords, Unicode text typing, and waits. Coordinates are physical screen pixels and may be negative on monitors left/above the primary display. Key examples: CTRL, SHIFT, ALT, WIN, ENTER, ESC, TAB, arrows, A-Z, 0-9, F1-F24, or VK_XX hexadecimal virtual-key codes (VK_ codes are Windows-only). This tool cannot see the screen and cannot reliably interact with elevated/administrator windows. Use dryRun to validate without sending input.",
    promptSnippet:
      "Send batched mouse and keyboard input to the active desktop (Windows, macOS, Linux/X11)",
    promptGuidelines: [
      "Use input instead of generating shell commands with SendInput, osascript, cliclick, or xdotool for desktop mouse and keyboard automation.",
      "Use input only for user-directed desktop interaction; do not enter passwords, secrets, payment data, or approve destructive/security-sensitive dialogs without the user's explicit approval.",
      "Keep input batches short, include a clear reason, and add small waits when an application needs time to update between actions.",
    ],
    parameters: DesktopInputParams,
    executionMode: "sequential" as const,

    async execute(
      _toolCallId: string,
      params: Static<typeof DesktopInputParams>,
      _signal: AbortSignal | undefined,
    ) {
      const validationError = validateActions(params.actions);
      if (validationError) throw new Error(validationError);

      if (params.dryRun !== true && process.platform === "win32") {
        const details = await executeWindowsActions(
          pi,
          helperPath,
          params.actions,
          false,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Completed ${params.actions.length} desktop input action${params.actions.length === 1 ? "" : "s"}: ${params.reason}`,
            },
          ],
          details,
        };
      }

      if (params.dryRun !== true && process.platform === "darwin") {
        const details = await executeDarwinActions(
          pi,
          helperPath,
          params.actions,
          false,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Completed ${params.actions.length} desktop input action${params.actions.length === 1 ? "" : "s"}: ${params.reason}`,
            },
          ],
          details,
        };
      }

      if (params.dryRun !== true && process.platform === "linux") {
        const details = await executeLinuxActions(
          pi,
          helperPath,
          params.actions,
          false,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Completed ${params.actions.length} desktop input action${params.actions.length === 1 ? "" : "s"}: ${params.reason}`,
            },
          ],
          details,
        };
      }

      // Dry run (all platforms).
      const summaries = params.actions.map((action) => {
        const parts: string[] = [action.type];
        if (action.x !== undefined && action.y !== undefined) {
          parts.push(`at ${action.x},${action.y}`);
        }
        if (action.toX !== undefined && action.toY !== undefined) {
          parts.push(`to ${action.toX},${action.toY}`);
        }
        if (action.keys?.length) parts.push(action.keys.join("+"));
        if (action.text !== undefined) {
          parts.push(`${action.text.length} character(s)`);
        }
        if (action.count !== undefined && action.count > 1) {
          parts.push(`x${action.count}`);
        }
        return parts.join(" ");
      });
      return {
        content: [
          {
            type: "text" as const,
            text: `Validated ${params.actions.length} desktop input action${params.actions.length === 1 ? "" : "s"}: ${params.reason}`,
          },
        ],
        details: {
          platform: process.platform,
          actionCount: params.actions.length,
          actions: summaries,
          dryRun: true,
        },
      };
    },
  };

  let pending: PendingRequest | undefined;

  const clearPending = async (request: PendingRequest) => {
    clearTimeout(request.timeout);
    if (pending === request) pending = undefined;
    await closeServer(request.server);
  };

  pi.on("session_shutdown", async () => {
    if (pending) await clearPending(pending);
  });

  const remoteTool = {
    name: "remote_input",
    label: "Private Remote Typing",
    description:
      "Create a one-time Tailscale web form whose submitted text is typed directly into the currently focused desktop control (Windows, macOS, or Linux/X11). The submitted text is never returned to the model, included in tool results, written to disk, or stored in the pi session. Before calling this tool, focus the exact target field with the input tool. The focused window and control are captured when the page is created; typing is refused if focus changes. The user must open the link from another Tailscale device so the target keeps focus. The tool returns the private URL immediately and later sends only a generic success/failure notification to the session.",
    promptSnippet:
      "Privately type user-supplied text into an already-focused desktop field without exposing it to the model",
    promptGuidelines: [
      "Before using remote_input, use the input tool to click and focus the exact desktop field that should receive the user's private text.",
      "Use remote_input for blind desktop text entry: never ask the user to put the private text in chat, never infer or repeat it, and never use the ordinary ask_user tool for that text.",
      "Tell the user to open the remote_input URL from another Tailscale device and leave the target field focused until submission completes.",
      "After remote_input reports generic completion, continue without claiming to know what text was entered.",
    ],
    parameters: RemoteInputParams,
    executionMode: "sequential" as const,

    async execute(
      _toolCallId: string,
      params: Static<typeof RemoteInputParams>,
      signal: AbortSignal | undefined,
    ) {
      if (pending) {
        throw new Error(
          `Private remote typing request ${pending.requestId} is already waiting for a response: ${pending.url}`,
        );
      }

      const timeoutSeconds = params.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
      const snapshot = await captureFocus(pi, privateTypePath, signal);
      const connection = await getTailscaleConnection(pi, signal);
      const token = randomBytes(24).toString("base64url");
      const requestId = token.slice(0, 8);
      const formPath = `/${token}`;
      const submitPath = `${formPath}/submit`;
      let submitted = false;
      let failureNotified = false;
      let request: PendingRequest | undefined;
      const notifySession = (message: string) => {
        pi.sendMessage(
          {
            customType: "remote-input-status",
            content: message,
            display: true,
          },
          { deliverAs: "followUp", triggerTurn: true },
        );
      };

      const server = createServer((incoming, response) => {
        void (async () => {
          const url = new URL(incoming.url ?? "/", "http://tailscale.local");

          if (incoming.method === "GET" && url.pathname === formPath) {
            pageHeaders(response);
            response.end(
              renderForm(
                params.prompt,
                params.placeholder ?? "Enter private text…",
                timeoutSeconds,
                submitPath,
                requestId,
              ),
            );
            return;
          }

          if (incoming.method === "POST" && url.pathname === submitPath) {
            if (submitted) {
              pageHeaders(response, 409);
              response.end(
                renderMessage(
                  "Already submitted",
                  "This one-time form has already been used.",
                ),
              );
              return;
            }

            const body = await readRequestBody(incoming);
            const privateText = new URLSearchParams(body).get("text") ?? "";
            if (privateText.length === 0) {
              pageHeaders(response, 400);
              response.end(
                renderMessage(
                  "Text required",
                  "Go back and enter text before submitting.",
                ),
              );
              return;
            }
            if (privateText.length > MAX_RESPONSE_CHARACTERS) {
              pageHeaders(response, 413);
              response.end(
                renderMessage(
                  "Text too long",
                  `Private typing is limited to ${MAX_RESPONSE_CHARACTERS} characters.`,
                ),
              );
              return;
            }

            try {
              await typeBlindText(pi, privateTypePath, snapshot, privateText);
            } catch (error) {
              pageHeaders(response, 409);
              response.end(
                renderMessage(
                  "Target not ready",
                  error instanceof Error
                    ? `${error.message} Return focus to the original field, go back, and submit again.`
                    : "Private typing could not be completed.",
                ),
              );
              if (!failureNotified) {
                failureNotified = true;
                notifySession(
                  `Private remote typing request ${requestId} was not completed because the original desktop field lost focus or rejected simulated input. Refocus the same field before the user retries that request's existing page. The submitted text was not added to this session.`,
                );
              }
              return;
            }

            submitted = true;
            pageHeaders(response);
            response.end(
              renderMessage(
                "Typed successfully",
                "The private text was typed into the focused desktop field. It was not shared with the agent. You can close this page.",
              ),
            );

            if (request) await clearPending(request);
            notifySession(
              `Private remote typing request ${requestId} completed successfully. Its submitted text was typed into the focused desktop field and was not added to this pi session.`,
            );
            return;
          }

          pageHeaders(response, 404);
          response.end(
            renderMessage(
              "Not found",
              "This private typing link is invalid or has expired.",
            ),
          );
        })().catch(() => {
          if (!response.headersSent) {
            pageHeaders(response, 500);
            response.end(
              renderMessage(
                "Unable to submit",
                "Private typing could not be processed. No text was added to the pi session.",
              ),
            );
          }
        });
      });

      try {
        const port = await listen(server, connection.ip);
        if (signal?.aborted) {
          await closeServer(server);
          throw new Error("Private remote typing setup was cancelled.");
        }

        const url = `http://${connection.ip}:${port}${formPath}`;
        const dnsUrl = connection.dnsName
          ? `http://${connection.dnsName}:${port}${formPath}`
          : undefined;
        const expiresAt = new Date(
          Date.now() + timeoutSeconds * 1_000,
        ).toISOString();
        request = {
          server,
          url,
          requestId,
          expiresAt,
          timeout: setTimeout(() => {
            if (request) void clearPending(request);
          }, timeoutSeconds * 1_000),
        };
        pending = request;

        server.once("error", () => {
          if (request) void clearPending(request);
        });

        return {
          content: [
            {
              type: "text" as const,
              text: `Private remote typing request ${requestId} is ready. Keep the selected field focused and open this one-time link from another Tailscale device:\n${url}${dnsUrl ? `\nMagicDNS: ${dnsUrl}` : ""}\n\nThe page expires in ${timeoutSeconds} seconds. Its submitted text will be typed directly into the focused field and will not be returned to the agent.`,
            },
          ],
          details: {
            url,
            dnsUrl,
            requestId,
            prompt: params.prompt,
            expiresAt,
            status: "waiting",
            privateTyping: true,
          },
        };
      } catch (error) {
        await closeServer(server);
        throw error;
      }
    },
  };

  if (
    process.platform === "win32" ||
    process.platform === "darwin" ||
    process.platform === "linux"
  ) {
    pi.registerTool(desktopTool);
    pi.registerTool(remoteTool);
  }
}
