import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  getUnityDocsStatus,
  indexUnityDocs,
  readUnityProjectInfo,
  searchUnityDocs,
  targetedCoreDocsPath,
  type UnityCoreStage,
} from "./core.ts";
import {
  getCoreStage,
  pageUrl,
  validateCoreManifest,
  type CorePageSpec,
} from "./core-manifest.ts";

const FETCH_CONCURRENCY = 2;
const REQUEST_TIMEOUT_MS = 30_000;
const STAGE_TIMEOUT_MS = 180_000;
const MAX_REQUEST_ATTEMPTS = 6;
const MANIFEST_SCHEMA_VERSION = 1;

type DownloadedPage = {
  file: string;
  kind: CorePageSpec["kind"];
  topic: string;
  title: string;
  url: string;
  retrievedAt: string;
  sha256: string;
  bytes: number;
};

type StageReport = {
  stage: UnityCoreStage;
  name: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  pagesAdded: number;
  pagesResumed: number;
  pagesSkipped: Array<{ url: string; reason: string }>;
  corpusBytes: number;
  indexBytes: number;
  indexFiles: number;
  indexChunks: number;
  verification: Array<{
    query: string;
    results: Array<{ title: string; sourceUrl?: string; score: number }>;
  }>;
};

function safeFileName(page: CorePageSpec) {
  const prefix = page.kind === "editor-manual" ? "manual" : "api";
  return `${prefix}-${page.slug.replace(/[^a-zA-Z0-9._-]/g, "-")}.html`;
}

function sha256(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

function titleFromHtml(html: string) {
  const value =
    html.match(/<title[^>]*>([^]*?)<\/title>/i)?.[1] ??
    html.match(/<h1[^>]*>([^]*?)<\/h1>/i)?.[1];
  return value
    ?.replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function assertVersionedUnityPage(
  html: string,
  url: string,
  documentationLine: string,
) {
  if (
    !url.startsWith(
      `https://docs.unity3d.com/${documentationLine}/Documentation/`,
    )
  )
    throw new Error(
      `URL escaped the ${documentationLine} documentation line: ${url}`,
    );
  if (
    !html.includes(documentationLine) ||
    !/(Unity Manual|Scripting API)/i.test(html)
  )
    throw new Error(
      `Response does not identify itself as Unity ${documentationLine} documentation: ${url}`,
    );
  if (/page not found|404 - not found/i.test(titleFromHtml(html) ?? ""))
    throw new Error(`Unity returned a not-found page: ${url}`);
  const canonical = html.match(
    /<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i,
  )?.[1];
  if (canonical !== url)
    throw new Error(
      `Unity page canonical URL mismatch for ${url}: ${canonical ?? "missing"}`,
    );
}

function throwIfStopped(signal: AbortSignal | undefined, deadline: number) {
  if (signal?.aborted)
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error("Unity core documentation stage was cancelled.");
  if (Date.now() >= deadline)
    throw new Error(
      `Unity core documentation stage exceeded ${STAGE_TIMEOUT_MS / 1000} seconds; stopped.`,
    );
}

function delay(
  milliseconds: number,
  signal: AbortSignal | undefined,
  deadline: number,
) {
  throwIfStopped(signal, deadline);
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeout);
      reject(
        signal?.reason instanceof Error
          ? signal.reason
          : new Error("Unity core documentation stage was cancelled."),
      );
    };
    const timeout = setTimeout(
      () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      },
      Math.min(milliseconds, Math.max(deadline - Date.now(), 1)),
    );
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  callerSignal: AbortSignal | undefined,
  deadline: number,
) {
  for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt++) {
    throwIfStopped(callerSignal, deadline);
    const remaining = Math.max(
      Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now()),
      1,
    );
    const signal = callerSignal
      ? AbortSignal.any([callerSignal, AbortSignal.timeout(remaining)])
      : AbortSignal.timeout(remaining);
    const response = await fetch(url, {
      ...init,
      signal,
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; null_ctx_pcol targeted Unity documentation indexer/1.0)",
      },
    });
    if (response.status !== 429 || attempt === MAX_REQUEST_ATTEMPTS)
      return response;
    const retryAfter = Number(response.headers.get("retry-after"));
    await delay(
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.min(1000 * 2 ** (attempt - 1), 16_000),
      callerSignal,
      deadline,
    );
  }
  throw new Error(`Request attempts exhausted for ${url}.`);
}

async function validateUrls(
  documentationLine: string,
  pages: CorePageSpec[],
  signal: AbortSignal | undefined,
  deadline: number,
) {
  const failures: Array<{ url: string; reason: string }> = [];
  for (let start = 0; start < pages.length; start += FETCH_CONCURRENCY) {
    throwIfStopped(signal, deadline);
    const batch = pages.slice(start, start + FETCH_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (page) => {
        const url = pageUrl(documentationLine, page);
        try {
          const response = await fetchWithTimeout(
            url,
            { method: "HEAD" },
            signal,
            deadline,
          );
          if (!response.ok) return { url, reason: `HTTP ${response.status}` };
          if (response.url !== url)
            return { url, reason: `redirected to ${response.url}` };
          return undefined;
        } catch (error) {
          return {
            url,
            reason: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );
    failures.push(...results.filter((result) => result !== undefined));
  }
  return failures;
}

async function atomicWrite(path: string, content: string) {
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, path);
}

function processIsRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function lockIsActive(path: string) {
  try {
    const owner = JSON.parse(
      await readFile(join(path, "owner.json"), "utf8"),
    ) as { pid?: number };
    if (typeof owner.pid === "number" && processIsRunning(owner.pid))
      return true;
  } catch {
    try {
      const details = await stat(path);
      if (Date.now() - details.mtimeMs < 60_000) return true;
    } catch {
      return false;
    }
  }
  await rm(path, { recursive: true, force: true });
  return false;
}

async function acquireStageLock(path: string) {
  if (await lockIsActive(path))
    throw new Error(`Documentation stage lock is active: ${path}`);
  try {
    await mkdir(path);
  } catch {
    throw new Error(`Documentation stage lock is active: ${path}`);
  }
  try {
    await atomicWrite(
      join(path, "owner.json"),
      `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`,
    );
  } catch (error) {
    await rm(path, { recursive: true, force: true });
    throw error;
  }
}

async function readResumablePage(
  path: string,
  page: CorePageSpec,
  documentationLine: string,
) {
  try {
    const html = await readFile(path, "utf8");
    assertVersionedUnityPage(
      html,
      pageUrl(documentationLine, page),
      documentationLine,
    );
    const details = await stat(path);
    return {
      file: basename(path),
      kind: page.kind,
      topic: page.topic,
      title: titleFromHtml(html) ?? page.title,
      url: pageUrl(documentationLine, page),
      retrievedAt: details.mtime.toISOString(),
      sha256: sha256(html),
      bytes: details.size,
    } satisfies DownloadedPage;
  } catch {
    return undefined;
  }
}

async function downloadPage(
  stageDir: string,
  page: CorePageSpec,
  documentationLine: string,
  signal: AbortSignal | undefined,
  deadline: number,
) {
  const path = join(stageDir, safeFileName(page));
  const resumed = await readResumablePage(path, page, documentationLine);
  if (resumed) return { page: resumed, resumed: true };
  const url = pageUrl(documentationLine, page);
  const response = await fetchWithTimeout(
    url,
    { method: "GET" },
    signal,
    deadline,
  );
  if (!response.ok || response.url !== url)
    throw new Error(
      `Failed to download ${url}: HTTP ${response.status}${response.url !== url ? `, redirected to ${response.url}` : ""}`,
    );
  const html = await response.text();
  assertVersionedUnityPage(html, url, documentationLine);
  await atomicWrite(path, html);
  return {
    page: {
      file: basename(path),
      kind: page.kind,
      topic: page.topic,
      title: titleFromHtml(html) ?? page.title,
      url,
      retrievedAt: new Date().toISOString(),
      sha256: sha256(html),
      bytes: Buffer.byteLength(html),
    } satisfies DownloadedPage,
    resumed: false,
  };
}

export async function buildCoreStage(
  cwd: string,
  stageNumber: UnityCoreStage,
  options: { signal?: AbortSignal } = {},
): Promise<StageReport> {
  validateCoreManifest();
  const spec = getCoreStage(stageNumber);
  const project = readUnityProjectInfo(cwd);
  if (project.documentationLine !== "6000.3")
    throw new Error(
      `Targeted core manifest requires Unity 6000.3, but this project resolves to ${project.documentationLine}.`,
    );
  const cacheRoot = targetedCoreDocsPath(project);
  await mkdir(cacheRoot, { recursive: true });
  const lockPath = join(cacheRoot, ".core-build.lock");
  await acquireStageLock(lockPath);
  const started = Date.now();
  const deadline = started + STAGE_TIMEOUT_MS;
  const startedAt = new Date(started).toISOString();
  const stageDir = join(cacheRoot, `stage-${stageNumber}`);
  try {
    await rm(join(stageDir, "report.json"), { force: true });
    if (stageNumber > 1) {
      const previousStage = (stageNumber - 1) as UnityCoreStage;
      const previousSpec = getCoreStage(previousStage);
      try {
        const previousManifest = JSON.parse(
          await readFile(
            join(cacheRoot, `stage-${previousStage}`, "manifest.json"),
            "utf8",
          ),
        ) as { stage?: number; pages?: unknown[] };
        const previousReport = JSON.parse(
          await readFile(
            join(cacheRoot, `stage-${previousStage}`, "report.json"),
            "utf8",
          ),
        ) as { stage?: number; verification?: Array<{ results?: unknown[] }> };
        const status = await getUnityDocsStatus(cwd);
        const verified = previousReport.verification;
        if (
          previousManifest.stage !== previousStage ||
          previousManifest.pages?.length !== previousSpec.pages.length ||
          previousReport.stage !== previousStage ||
          verified?.length !== previousSpec.verificationQueries.length ||
          !verified.every(
            (entry) => entry.results && entry.results.length > 0,
          ) ||
          !status.coreStages.some(
            (entry) =>
              entry.stage === previousStage &&
              entry.pages === previousSpec.pages.length,
          )
        )
          throw new Error("incomplete prior stage");
      } catch {
        throw new Error(
          `Stage ${previousStage} must be complete, current, and verified before stage ${stageNumber}.`,
        );
      }
    }

    const failures = await validateUrls(
      project.documentationLine,
      spec.pages,
      options.signal,
      deadline,
    );
    if (failures.length > 0) {
      throw new Error(
        `Stage ${stageNumber} URL validation failed before downloading:\n${failures.map((failure) => `- ${failure.url}: ${failure.reason}`).join("\n")}`,
      );
    }
    await mkdir(stageDir, { recursive: true });
    const downloaded: DownloadedPage[] = [];
    let pagesAdded = 0;
    let pagesResumed = 0;
    for (let start = 0; start < spec.pages.length; start += FETCH_CONCURRENCY) {
      throwIfStopped(options.signal, deadline);
      const results = await Promise.all(
        spec.pages
          .slice(start, start + FETCH_CONCURRENCY)
          .map((page) =>
            downloadPage(
              stageDir,
              page,
              project.documentationLine,
              options.signal,
              deadline,
            ),
          ),
      );
      for (const result of results) {
        downloaded.push(result.page);
        if (result.resumed) pagesResumed++;
        else pagesAdded++;
      }
    }
    const completedAt = new Date().toISOString();
    await atomicWrite(
      join(stageDir, "manifest.json"),
      `${JSON.stringify(
        {
          schemaVersion: MANIFEST_SCHEMA_VERSION,
          stage: stageNumber,
          name: spec.name,
          editorVersion: project.editorVersion,
          documentationLine: project.documentationLine,
          completedAt,
          pages: downloaded,
        },
        null,
        2,
      )}\n`,
    );
    throwIfStopped(options.signal, deadline);
    const indexResult = await indexUnityDocs(cwd, {
      stage: stageNumber,
      signal: options.signal,
    });
    throwIfStopped(options.signal, deadline);
    const status = await getUnityDocsStatus(cwd);
    if (
      !status.coreStages.some(
        (entry) =>
          entry.stage === stageNumber && entry.pages === spec.pages.length,
      )
    )
      throw new Error(
        `Stage ${stageNumber} did not publish the expected ${spec.pages.length} indexed pages.`,
      );
    const verification = [];
    for (const query of spec.verificationQueries) {
      throwIfStopped(options.signal, deadline);
      const results = await searchUnityDocs(cwd, query, {
        stage: stageNumber,
        limit: 4,
        signal: options.signal,
      });
      if (
        results.length === 0 ||
        results.some(
          (result) => result.stage !== stageNumber || !result.sourceUrl,
        )
      )
        throw new Error(
          `Stage ${stageNumber} verification failed for query: ${query}`,
        );
      verification.push({
        query,
        results: results.map((result) => ({
          title: result.title,
          sourceUrl: result.sourceUrl,
          score: result.score,
        })),
      });
      throwIfStopped(options.signal, deadline);
    }
    if (verification.length !== spec.verificationQueries.length)
      throw new Error(`Stage ${stageNumber} verification did not complete.`);
    const indexBytes = (await stat(indexResult.indexPath)).size;
    const report: StageReport = {
      stage: stageNumber,
      name: spec.name,
      startedAt,
      completedAt,
      durationMs: Date.now() - started,
      pagesAdded,
      pagesResumed,
      pagesSkipped: [],
      corpusBytes: downloaded.reduce((sum, page) => sum + page.bytes, 0),
      indexBytes,
      indexFiles: indexResult.files,
      indexChunks: indexResult.chunks,
      verification,
    };
    await atomicWrite(
      join(stageDir, "report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    return report;
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}

async function main() {
  const stage = Number(process.argv[2]) as UnityCoreStage;
  if (![1, 2, 3, 4, 5, 6].includes(stage))
    throw new Error(
      "Usage: node --experimental-strip-types core-corpus.ts <stage 1-6>",
    );
  console.log(
    JSON.stringify(await buildCoreStage(process.cwd(), stage), null, 2),
  );
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
