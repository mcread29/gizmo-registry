/**
 * Ollama host lifecycle: detect the binary, check versions, and drive
 * install/update through the official per-platform release artifacts.
 *
 * Platform flows:
 * - Windows: silent Inno Setup installer (`OllamaSetup.exe /VERYSILENT`),
 *   per-user install under %LOCALAPPDATA%\Programs\Ollama.
 * - macOS: `Ollama-darwin.zip` expanded into /Applications (~/Applications
 *   as fallback), launched via `open`.
 * - Linux: user-owned tarball install under `~/.local/share/ollama-gizmo`
 *   (the official install.sh wants root; this deliberately does not),
 *   with `ollama serve` spawned detached and tracked by a pid file.
 *
 * Pure helpers (version parsing/comparison, asset naming, URLs) are exported
 * for tests; the process-touching flows are thin and defensive.
 */

import { spawn } from "node:child_process";
import { access, mkdir, open, rm, writeFile } from "node:fs/promises";
import { homedir, platform as nodePlatform, tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { JobHandle } from "./jobs.ts";

export type HostPlatform = "windows" | "macos" | "linux" | "unknown";

export function hostPlatform(platform: string = nodePlatform()): HostPlatform {
  if (platform === "win32") return "windows";
  if (platform === "darwin") return "macos";
  if (platform === "linux") return "linux";
  return "unknown";
}

// --- Pure helpers -----------------------------------------------------------

/** First `x.y.z` occurrence in `ollama version is 0.5.7`-style output. */
export function parseOllamaVersion(output: string): string | undefined {
  const match = output.match(/(\d+\.\d+\.\d+(?:\.\d+)?)/);
  return match?.[1];
}

function versionParts(version: string): number[] {
  const stripped = version.replace(/^v/, "");
  return stripped.split(".").map((part) => Number.parseInt(part, 10) || 0);
}

/** True when `candidate` is strictly newer than `current`. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = versionParts(candidate);
  const b = versionParts(current);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    if (left !== right) return left > right;
  }
  return false;
}

/** Release asset filename for the platform, or undefined if unsupported. */
export function releaseAssetName(
  platform: HostPlatform,
  arch: string = process.arch,
): string | undefined {
  switch (platform) {
    case "windows":
      return "OllamaSetup.exe";
    case "macos":
      return "Ollama-darwin.zip";
    case "linux":
      return arch === "arm64" || arch === "arm"
        ? "ollama-linux-arm64.tgz"
        : "ollama-linux-amd64.tgz";
    default:
      return undefined;
  }
}

export function releaseDownloadUrl(version: string, asset: string): string {
  const tag = version.startsWith("v") ? version : `v${version}`;
  return `https://github.com/ollama/ollama/releases/download/${tag}/${asset}`;
}

/** User-owned directory for the Linux tarball install and its serve state. */
export function managedInstallDir(): string {
  return join(homedir(), ".local", "share", "ollama-gizmo");
}

function scratchDir(): string {
  return join(tmpdir(), "ollama-gizmo");
}

// --- Detection --------------------------------------------------------------

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export interface ResolvedBinary {
  path: string;
}

/** Candidate binary locations, most specific first, without a PATH lookup. */
export function binaryCandidates(platform: HostPlatform): string[] {
  switch (platform) {
    case "windows":
      return [
        join(
          process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
          "Programs",
          "Ollama",
          "ollama.exe",
        ),
      ];
    case "macos":
      return [
        "/Applications/Ollama.app/Contents/Resources/ollama",
        join(
          homedir(),
          "Applications",
          "Ollama.app",
          "Contents",
          "Resources",
          "ollama",
        ),
        "/usr/local/bin/ollama",
      ];
    case "linux":
      return [
        join(managedInstallDir(), "bin", "ollama"),
        "/usr/local/bin/ollama",
      ];
    default:
      return [];
  }
}

function runCommand(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`${command} exited with ${code}`));
    });
  });
}

/**
 * Resolve the Ollama binary: known install locations first, then whatever
 * `ollama` resolves to on PATH (bare `ollama --version` succeeding proves a
 * PATH binary exists even though we never learn its absolute path).
 */
export async function resolveOllamaBinary(
  platform: HostPlatform = hostPlatform(),
): Promise<ResolvedBinary | undefined> {
  for (const path of binaryCandidates(platform)) {
    if (await exists(path)) return { path };
  }
  if (platform === "unknown") return undefined;
  try {
    await runCommand(platform === "windows" ? "ollama.exe" : "ollama", [
      "--version",
    ]);
    return { path: "ollama" };
  } catch {
    return undefined;
  }
}

export async function readOllamaVersion(
  binary: ResolvedBinary,
): Promise<string | undefined> {
  try {
    const output = await runCommand(binary.path, ["--version"]);
    return parseOllamaVersion(output);
  } catch {
    return undefined;
  }
}

// --- Version lookup ---------------------------------------------------------

const LATEST_RELEASE_URL =
  "https://api.github.com/repos/ollama/ollama/releases/latest";
const LATEST_TTL_MS = 60 * 60 * 1000;

let latestCache: { version: string; at: number } | undefined;

/** Latest upstream release version; cached for an hour, undefined on failure. */
export async function fetchLatestVersion(
  signal?: AbortSignal,
): Promise<string | undefined> {
  if (latestCache && Date.now() - latestCache.at < LATEST_TTL_MS) {
    return latestCache.version;
  }
  try {
    const response = await fetch(LATEST_RELEASE_URL, {
      signal,
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { tag_name?: string };
    const version = body.tag_name?.replace(/^v/, "");
    if (!version) return undefined;
    latestCache = { version, at: Date.now() };
    return version;
  } catch {
    return undefined;
  }
}

// --- Downloads and process helpers ------------------------------------------

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

async function downloadFile(
  url: string,
  destination: string,
  onProgress: JobHandle["setProgress"],
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(
      `Download failed: ${response.status} ${response.statusText}`,
    );
  }
  if (!response.body) throw new Error("Download returned no response body");
  const total = Number(response.headers.get("content-length") ?? 0);
  let completed = 0;
  const destinationStream = await open(destination, "w");
  try {
    await pipeline(
      Readable.fromWeb(
        response.body as import("node:stream/web").ReadableStream,
      ),
      async function* (source) {
        for await (const chunk of source) {
          completed += (chunk as Buffer).length;
          onProgress({
            completed,
            total: total || undefined,
            message:
              total > 0
                ? `${formatBytes(completed)} of ${formatBytes(total)}`
                : formatBytes(completed),
          });
          yield chunk;
        }
      },
      destinationStream.createWriteStream(),
    );
  } finally {
    await destinationStream.close();
  }
}

function spawnAndWait(command: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? -1));
  });
}

/** Start `ollama serve` detached, logging to `logPath`; returns the pid. */
export async function startDetachedServe(
  binaryPath: string,
  logPath: string,
): Promise<number> {
  const log = await open(logPath, "a");
  try {
    const child = spawn(binaryPath, ["serve"], {
      detached: true,
      stdio: ["ignore", log.fd, log.fd],
      windowsHide: true,
    });
    child.unref();
    return child.pid ?? -1;
  } finally {
    await log.close();
  }
}

async function waitForServer(
  ping: () => Promise<string | null>,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal.aborted) throw new Error("Cancelled");
    if ((await ping()) !== null) return;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error("Ollama server did not come up in time");
}

async function stopManagedServe(): Promise<void> {
  // The pid file records the serve process a previous install started.
  const pidFile = join(managedInstallDir(), "serve.pid");
  const { readFile } = await import("node:fs/promises");
  const raw = await readFile(pidFile, "utf8").catch(() => undefined);
  const pid = raw === undefined ? Number.NaN : Number.parseInt(raw.trim(), 10);
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // already gone
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

// --- Install/update flow ----------------------------------------------------

export interface HostInstallerContext {
  job: JobHandle;
  signal: AbortSignal;
  /** Returns the server version once reachable, null otherwise. */
  ping: () => Promise<string | null>;
}

/**
 * Download and run the platform installer for `version`, then wait for the
 * server to come up. The same flow serves as update: every artifact is the
 * platform's full installer.
 */
export async function installOrUpdate(
  version: string,
  { job, signal, ping }: HostInstallerContext,
): Promise<void> {
  const platform = hostPlatform();
  const asset = releaseAssetName(platform);
  if (!asset) throw new Error(`Unsupported platform: ${platform}`);
  const url = releaseDownloadUrl(version, asset);

  job.setStage("downloading", url);
  if (platform === "windows") {
    const dir = scratchDir();
    await mkdir(dir, { recursive: true });
    const installerPath = join(dir, `OllamaSetup-${version}.exe`);
    await downloadFile(url, installerPath, job.setProgress, signal);
    job.setStage("installing", "Running the Ollama installer");
    const code = await spawnAndWait(installerPath, [
      "/VERYSILENT",
      "/NORESTART",
      "/CLOSEAPPLICATIONS",
      "/RESTARTAPPLICATIONS",
    ]);
    if (code !== 0) throw new Error(`Installer exited with ${code}`);
    await rm(installerPath, { force: true }).catch(() => {});
    await waitAndFallbackServe(platform, job, signal, ping);
    return;
  }

  if (platform === "macos") {
    const dir = scratchDir();
    await mkdir(dir, { recursive: true });
    const zipPath = join(dir, `Ollama-${version}.zip`);
    await downloadFile(url, zipPath, job.setProgress, signal);
    job.setStage("installing", "Expanding Ollama.app");
    const appPath = await expandMacApp(zipPath);
    await rm(zipPath, { force: true }).catch(() => {});
    await spawnAndWait("open", [appPath]);
    await waitAndFallbackServe(platform, job, signal, ping);
    return;
  }

  // linux: user-owned tarball install, then a managed `ollama serve`
  const dir = managedInstallDir();
  await mkdir(dir, { recursive: true });
  const tgzPath = join(dir, asset);
  await downloadFile(url, tgzPath, job.setProgress, signal);
  job.setStage("stopping-old-server");
  await stopManagedServe();
  job.setStage("installing", `Extracting into ${dir}`);
  const extractCode = await spawnAndWait("tar", ["-xzf", tgzPath, "-C", dir]);
  if (extractCode !== 0) throw new Error(`tar exited with ${extractCode}`);
  await rm(tgzPath, { force: true }).catch(() => {});
  job.setStage("starting-server");
  const pid = await startDetachedServe(
    join(dir, "bin", "ollama"),
    join(dir, "serve.log"),
  );
  if (pid > 0) {
    await writeFile(join(dir, "serve.pid"), String(pid), "utf8").catch(
      () => {},
    );
  }
  job.setStage("waiting-for-server");
  await waitForServer(ping, signal, 60_000);
}

async function expandMacApp(zipPath: string): Promise<string> {
  const primary = "/Applications";
  if ((await spawnAndWait("unzip", ["-o", zipPath, "-d", primary])) === 0) {
    return join(primary, "Ollama.app");
  }
  const fallback = join(homedir(), "Applications");
  if ((await spawnAndWait("unzip", ["-o", zipPath, "-d", fallback])) === 0) {
    return join(fallback, "Ollama.app");
  }
  throw new Error("Could not expand Ollama.app");
}

/** Windows/macOS installers usually start the app; serve manually if not. */
async function waitAndFallbackServe(
  platform: HostPlatform,
  job: JobHandle,
  signal: AbortSignal,
  ping: () => Promise<string | null>,
): Promise<void> {
  job.setStage("waiting-for-server");
  await waitForServer(ping, signal, 90_000).catch(async () => {
    const binary = await resolveOllamaBinary(platform);
    if (!binary || binary.path === "ollama")
      throw new Error("Ollama server did not come up in time");
    const dir = scratchDir();
    await mkdir(dir, { recursive: true });
    await startDetachedServe(binary.path, join(dir, "serve.log"));
    await waitForServer(ping, signal, 30_000);
  });
}
