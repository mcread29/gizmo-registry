import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const bundledPiEntrypoint = path.join(
  root,
  "node_modules/@earendil-works/pi-coding-agent/dist/cli.js",
);

function readActivationProbe() {
  return new Promise<{ active: string[]; available: string[] }>(
    (resolve, reject) => {
      const configuredPiBin = process.env.PI_BIN;
      const child = spawn(
        configuredPiBin ?? process.execPath,
        [
          ...(configuredPiBin ? [] : [bundledPiEntrypoint]),
          "--mode",
          "rpc",
          "--no-session",
          "--no-approve",
          "--no-extensions",
          "--tools",
          "read,ask_user",
          "--extension",
          path.join(root, "extensions/ask-user.ts"),
          "--extension",
          path.join(root, "extensions/integration/tool-activation-probe.ts"),
        ],
        { cwd: root, stdio: ["pipe", "pipe", "pipe"] },
      );
      let stdout = "";
      let stderr = "";
      let settled = false;
      const finish = (
        error?: Error,
        value?: { active: string[]; available: string[] },
      ) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        child.kill("SIGTERM");
        if (error) reject(error);
        else resolve(value!);
      };
      const timeout = setTimeout(
        () =>
          finish(
            new Error(
              `Timed out waiting for activation probe. stderr: ${stderr}`,
            ),
          ),
        15_000,
      );
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
        while (stdout.includes("\n")) {
          const newline = stdout.indexOf("\n");
          const line = stdout.slice(0, newline).replace(/\r$/, "");
          stdout = stdout.slice(newline + 1);
          if (!line) continue;
          try {
            const event = JSON.parse(line);
            if (
              event.type === "extension_ui_request" &&
              event.method === "setWidget" &&
              event.widgetKey === "pi-tool-activation-probe" &&
              event.widgetLines?.[0] === "PI_TOOL_ACTIVATION_PROBE_V1"
            ) {
              finish(undefined, JSON.parse(event.widgetLines[1]));
            }
          } catch (error) {
            finish(error instanceof Error ? error : new Error(String(error)));
          }
        }
      });
      child.on("error", (error) => finish(error));
      child.on("exit", (code) => {
        if (!settled)
          finish(
            new Error(
              `Pi exited before publishing the activation probe (${code}). stderr: ${stderr}`,
            ),
          );
      });
    },
  );
}

test("--tools activates an extension tool after extension loading", async () => {
  const probe = await readActivationProbe();
  assert.deepEqual(probe.active, ["read", "ask_user"]);
  assert.deepEqual(probe.available, ["read", "ask_user"]);
});
