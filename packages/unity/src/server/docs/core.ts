import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CORE_STAGES, pageUrl } from "./core-manifest.ts";

// Schema 2 remains readable by already-running Pi sessions; core metadata columns are additive.
const INDEX_SCHEMA_VERSION = "2";
const CORE_MANIFEST_SCHEMA_VERSION = 1;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const CHUNK_LINES = 90;
const CHUNK_OVERLAP = 15;
const SUPPORTED_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".txt",
  ".html",
  ".htm",
]);
const PACKAGE_DOC_DIRS = ["Documentation~", "Documentation", "Docs~", "Docs"];
const PACKAGE_RELEASE_FILES =
  /^(change(log)?|release[-_. ]?notes?|version[-_. ]?notes?)(\..+)?$/i;

export type UnityDocKind =
  | "project"
  | "package"
  | "package-changelog"
  | "moremountains-topdown"
  | "moremountains-feel"
  | "editor-manual"
  | "editor-api";

export type UnityProjectInfo = {
  editorVersion: string;
  documentationLine: string;
  packages: Map<string, { version: string; source: string; hash?: string }>;
};

export type UnityCoreStage = 1 | 2 | 3 | 4 | 5 | 6;

export type UnityDocRoot = {
  path: string;
  kind: UnityDocKind;
  version: string;
  packageName?: string;
  stage?: UnityCoreStage;
  topic?: string;
  sourceUrl?: string;
  retrievedAt?: string;
  documentationLine?: string;
};

type IndexedFile = UnityDocRoot & {
  filePath: string;
  size: number;
  mtimeMs: number;
};

type Chunk = {
  title: string;
  body: string;
  lineStart: number;
  lineEnd: number;
};

type IndexProgress = {
  phase: "discovering" | "indexing" | "complete";
  processedFiles: number;
  totalFiles: number;
  indexedFiles: number;
  skippedFiles: number;
  removedFiles: number;
};

export type UnityDocsStatus = {
  project: UnityProjectInfo;
  indexPath: string;
  indexedFiles: number;
  indexedChunks: number;
  lastIndexedAt?: string;
  fingerprintMatches: boolean;
  roots: UnityDocRoot[];
  coreStages: Array<{ stage: UnityCoreStage; pages: number }>;
  offlineEditorDocsFound: boolean;
  offlineEditorDocsExpectedAt: string;
  offlineEditorDocsUrl: string;
};

export type UnityDocsSearchResult = {
  path: string;
  displayPath: string;
  title: string;
  excerpt: string;
  kind: UnityDocKind;
  packageName?: string;
  version: string;
  lineStart: number;
  lineEnd: number;
  score: number;
  stage?: UnityCoreStage;
  topic?: string;
  sourceUrl?: string;
  documentationLine?: string;
  retrievedAt?: string;
};

function parseJsonFile(path: string) {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`Expected a JSON object in ${path}.`);
  return value as Record<string, unknown>;
}

function getString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function expandHome(path: string) {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

export function readUnityProjectInfo(cwd: string): UnityProjectInfo {
  const versionPath = join(cwd, "ProjectSettings", "ProjectVersion.txt");
  const lockPath = join(cwd, "Packages", "packages-lock.json");
  const versionText = readFileSync(versionPath, "utf8");
  const editorVersion = versionText
    .match(/^m_EditorVersion:\s*(.+)$/m)?.[1]
    ?.trim();
  if (!editorVersion)
    throw new Error(
      `Could not read the Unity Editor version from ${versionPath}.`,
    );
  const documentationLine = editorVersion.match(/^(\d+\.\d+)/)?.[1];
  if (!documentationLine)
    throw new Error(
      `Could not derive a documentation line from Unity version ${editorVersion}.`,
    );

  const lock = parseJsonFile(lockPath);
  const dependencies = lock.dependencies;
  if (
    typeof dependencies !== "object" ||
    dependencies === null ||
    Array.isArray(dependencies)
  ) {
    throw new Error(`Expected a dependencies object in ${lockPath}.`);
  }

  const packages = new Map<
    string,
    { version: string; source: string; hash?: string }
  >();
  for (const [name, rawEntry] of Object.entries(dependencies)) {
    if (
      typeof rawEntry !== "object" ||
      rawEntry === null ||
      Array.isArray(rawEntry)
    )
      continue;
    const entry = rawEntry as Record<string, unknown>;
    const version = getString(entry.version);
    if (!version) continue;
    packages.set(name, {
      version,
      source: getString(entry.source) ?? "unknown",
      hash: getString(entry.hash),
    });
  }

  return { editorVersion, documentationLine, packages };
}

function normalizeEditorDocsRoot(candidate: string) {
  const expanded = resolve(expandHome(candidate));
  const nested = join(expanded, "Documentation", "en");
  if (
    existsSync(join(nested, "Manual")) ||
    existsSync(join(nested, "ScriptReference"))
  )
    return nested;
  const languageNested = join(expanded, "en");
  if (
    existsSync(join(languageNested, "Manual")) ||
    existsSync(join(languageNested, "ScriptReference"))
  )
    return languageNested;
  if (
    existsSync(join(expanded, "Manual")) ||
    existsSync(join(expanded, "ScriptReference"))
  )
    return expanded;
  return undefined;
}

export function expectedOfflineDocsPath(info: UnityProjectInfo) {
  return join(
    configRoot(),
    "cache",
    "unity-docs",
    "core",
    info.documentationLine,
  );
}

export function offlineDocsUrl(info: UnityProjectInfo) {
  return `https://docs.unity3d.com/${info.documentationLine}/Documentation/`;
}

async function readPackageIdentity(packageRoot: string) {
  try {
    const raw: unknown = JSON.parse(
      await readFile(join(packageRoot, "package.json"), "utf8"),
    );
    if (typeof raw !== "object" || raw === null || Array.isArray(raw))
      return undefined;
    const record = raw as Record<string, unknown>;
    const name = getString(record.name);
    const version = getString(record.version);
    return name && version ? { name, version } : undefined;
  } catch {
    return undefined;
  }
}

function packageMatchesResolution(
  packageDirName: string,
  packageVersion: string,
  resolved: { version: string; source: string; hash?: string },
) {
  if (resolved.source === "git")
    return Boolean(
      resolved.hash && packageDirName.includes(resolved.hash.slice(0, 12)),
    );
  if (resolved.source === "embedded" || resolved.version.startsWith("file:"))
    return true;
  return packageVersion === resolved.version;
}

async function addPackageDocRoots(
  roots: UnityDocRoot[],
  packageRoot: string,
  packageDirName: string,
  info: UnityProjectInfo,
) {
  const identity = await readPackageIdentity(packageRoot);
  if (!identity) return;
  const resolvedPackage = info.packages.get(identity.name);
  if (
    !resolvedPackage ||
    !packageMatchesResolution(packageDirName, identity.version, resolvedPackage)
  )
    return;
  const version = resolvedPackage.hash
    ? `${identity.version} (${resolvedPackage.hash.slice(0, 12)})`
    : identity.version;
  for (const docDir of PACKAGE_DOC_DIRS) {
    const path = join(packageRoot, docDir);
    if (!existsSync(path)) continue;
    roots.push({ path, kind: "package", packageName: identity.name, version });
  }
  for (const entry of await readdir(packageRoot, { withFileTypes: true })) {
    if (
      !entry.isFile() ||
      !PACKAGE_RELEASE_FILES.test(entry.name) ||
      !SUPPORTED_EXTENSIONS.has(extname(entry.name).toLowerCase())
    )
      continue;
    roots.push({
      path: join(packageRoot, entry.name),
      kind: "package-changelog",
      packageName: identity.name,
      version,
    });
  }
}

export async function discoverUnityDocRoots(
  cwd: string,
  info = readUnityProjectInfo(cwd),
) {
  const roots: UnityDocRoot[] = [
    {
      path: join(cwd, "docs"),
      kind: "project",
      version: "working tree (current)",
    },
  ];
  const moreMountainsRoots: UnityDocRoot[] = [
    {
      path: join(cwd, "Assets", "ThirdParty", "TopDownEngine", "readme.txt"),
      kind: "moremountains-topdown",
      packageName: "TopDown Engine",
      version: "4.5",
    },
    {
      path: join(cwd, "Assets", "Feel", "readme.txt"),
      kind: "moremountains-feel",
      packageName: "Feel",
      version: "5.9.1",
    },
  ];
  roots.push(...moreMountainsRoots.filter((root) => existsSync(root.path)));
  const packageCache = join(cwd, "Library", "PackageCache");
  if (existsSync(packageCache)) {
    for (const entry of await readdir(packageCache, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      await addPackageDocRoots(
        roots,
        join(packageCache, entry.name),
        entry.name,
        info,
      );
    }
  }

  const embeddedPackages = join(cwd, "Packages");
  for (const entry of await readdir(embeddedPackages, {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory()) continue;
    await addPackageDocRoots(
      roots,
      join(embeddedPackages, entry.name),
      entry.name,
      info,
    );
  }

  roots.push(...readTargetedCoreRoots(info));

  const unique = new Map(
    roots.map((root) => [
      resolve(root.path),
      { ...root, path: resolve(root.path) },
    ]),
  );
  return [...unique.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}

function configRoot() {
  return process.env.PI_CODING_AGENT_DIR
    ? resolve(expandHome(process.env.PI_CODING_AGENT_DIR))
    : join(homedir(), ".pi", "agent");
}

export function targetedCoreDocsPath(info: UnityProjectInfo) {
  return join(
    configRoot(),
    "cache",
    "unity-docs",
    "core",
    info.documentationLine,
  );
}

type CoreStageManifest = {
  schemaVersion: number;
  stage: UnityCoreStage;
  editorVersion: string;
  documentationLine: string;
  pages: Array<{
    file: string;
    kind: "editor-manual" | "editor-api";
    topic: string;
    title: string;
    url: string;
    retrievedAt: string;
    sha256: string;
    bytes: number;
  }>;
};

function readTargetedCoreRoots(info: UnityProjectInfo) {
  const cacheRoot = targetedCoreDocsPath(info);
  if (!existsSync(cacheRoot)) return [];
  const roots: UnityDocRoot[] = [];
  const allowedPages = new Map(
    CORE_STAGES.flatMap((stage) =>
      stage.pages.map(
        (page) =>
          [
            pageUrl(info.documentationLine, page),
            { stage: stage.stage, kind: page.kind, topic: page.topic },
          ] as const,
      ),
    ),
  );
  const seenUrls = new Set<string>();
  const seenHashes = new Set<string>();
  for (let stage = 1; stage <= 6; stage++) {
    const manifestPath = join(cacheRoot, `stage-${stage}`, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    try {
      const manifest = parseJsonFile(
        manifestPath,
      ) as unknown as CoreStageManifest;
      const expectedPages = CORE_STAGES.find(
        (candidate) => candidate.stage === stage,
      )?.pages.length;
      if (
        manifest.schemaVersion !== CORE_MANIFEST_SCHEMA_VERSION ||
        manifest.stage !== stage ||
        manifest.editorVersion !== info.editorVersion ||
        manifest.documentationLine !== info.documentationLine ||
        !Array.isArray(manifest.pages) ||
        manifest.pages.length !== expectedPages
      )
        continue;
      const stageRoots: UnityDocRoot[] = [];
      for (const page of manifest.pages) {
        if (
          !page ||
          typeof page.file !== "string" ||
          typeof page.topic !== "string" ||
          typeof page.title !== "string" ||
          typeof page.url !== "string" ||
          typeof page.retrievedAt !== "string" ||
          typeof page.sha256 !== "string" ||
          typeof page.bytes !== "number"
        )
          throw new Error("Invalid core page metadata.");
        if (page.kind !== "editor-manual" && page.kind !== "editor-api")
          throw new Error("Invalid core page kind.");
        const allowed = allowedPages.get(page.url);
        if (
          !allowed ||
          allowed.stage !== stage ||
          allowed.kind !== page.kind ||
          allowed.topic !== page.topic
        )
          throw new Error("Core page is not in the static allowlist.");
        const section =
          page.kind === "editor-manual" ? "Manual" : "ScriptReference";
        const urlPrefix = `https://docs.unity3d.com/${info.documentationLine}/Documentation/${section}/`;
        if (
          !page.url.startsWith(urlPrefix) ||
          !page.url.endsWith(".html") ||
          seenUrls.has(page.url)
        )
          throw new Error("Invalid or duplicate core page URL.");
        const slug = page.url.slice(urlPrefix.length, -".html".length);
        const expectedFile = `${page.kind === "editor-manual" ? "manual" : "api"}-${slug.replace(/[^a-zA-Z0-9._-]/g, "-")}.html`;
        if (page.file !== expectedFile)
          throw new Error("Core page filename does not match its URL.");
        const path = resolve(dirname(manifestPath), page.file);
        if (
          !path.startsWith(`${resolve(dirname(manifestPath))}/`) ||
          !existsSync(path)
        )
          throw new Error(
            "Core page file is missing or outside its stage directory.",
          );
        const content = readFileSync(path);
        const hash = createHash("sha256").update(content).digest("hex");
        if (
          content.byteLength !== page.bytes ||
          hash !== page.sha256 ||
          seenHashes.has(hash)
        )
          throw new Error("Core page integrity check failed.");
        const html = content.toString("utf8");
        const canonical = html.match(
          /<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i,
        )?.[1];
        if (canonical !== page.url)
          throw new Error(
            "Core page canonical URL does not match its metadata.",
          );
        seenUrls.add(page.url);
        seenHashes.add(hash);
        stageRoots.push({
          path,
          kind: page.kind,
          version: info.documentationLine,
          stage: stage as UnityCoreStage,
          topic: page.topic,
          sourceUrl: page.url,
          retrievedAt: page.retrievedAt,
          documentationLine: manifest.documentationLine,
        });
      }
      if (stageRoots.length !== expectedPages)
        throw new Error("Core stage is incomplete.");
      roots.push(...stageRoots);
    } catch {
      // Ignore incomplete or corrupt stage manifests. The staged downloader can resume them.
    }
  }
  return roots;
}

export function unityDocsIndexPath(cwd: string) {
  const projectKey = createHash("sha256")
    .update(resolve(cwd))
    .digest("hex")
    .slice(0, 16);
  return join(configRoot(), "cache", "unity-docs", `${projectKey}.sqlite`);
}

function openIndex(cwd: string) {
  const path = unityDocsIndexPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
		PRAGMA journal_mode = WAL;
		PRAGMA synchronous = NORMAL;
		PRAGMA busy_timeout = 5000;
		CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
		CREATE TABLE IF NOT EXISTS files (
			path TEXT PRIMARY KEY,
			size INTEGER NOT NULL,
			mtime_ms REAL NOT NULL,
			kind TEXT NOT NULL,
			package_name TEXT,
			version TEXT NOT NULL,
			title TEXT NOT NULL,
			stage INTEGER,
			topic TEXT,
			source_url TEXT,
			documentation_line TEXT,
			retrieved_at TEXT
		);
		CREATE VIRTUAL TABLE IF NOT EXISTS chunks USING fts5(
			path UNINDEXED,
			title,
			body,
			kind UNINDEXED,
			package_name UNINDEXED,
			version UNINDEXED,
			line_start UNINDEXED,
			line_end UNINDEXED,
			tokenize = 'unicode61 remove_diacritics 2'
		);
	`);
  const columns = new Set(
    (
      db.prepare("PRAGMA table_info(files)").all() as Array<
        Record<string, unknown>
      >
    ).map((row) => textValue(row.name)),
  );
  for (const [name, type] of [
    ["stage", "INTEGER"],
    ["topic", "TEXT"],
    ["source_url", "TEXT"],
    ["documentation_line", "TEXT"],
    ["retrieved_at", "TEXT"],
  ] as const) {
    if (!columns.has(name))
      db.exec(`ALTER TABLE files ADD COLUMN ${name} ${type}`);
  }
  // Core metadata is an additive migration. Never discard an existing local corpus solely
  // because another already-running Pi session wrote an older schema marker.
  db.prepare(
    "INSERT OR REPLACE INTO metadata(key, value) VALUES ('schema_version', ?)",
  ).run(INDEX_SCHEMA_VERSION);
  return { db, path };
}

function computeFingerprint(
  cwd: string,
  info: UnityProjectInfo,
  roots: UnityDocRoot[],
  files: IndexedFile[],
) {
  const hash = createHash("sha256");
  hash.update(info.editorVersion);
  for (const path of [
    join(cwd, "Packages", "packages-lock.json"),
    join(cwd, "ProjectSettings", "ProjectVersion.txt"),
  ])
    hash.update(readFileSync(path));
  for (const root of roots)
    hash.update(
      `${root.path}\0${root.kind}\0${root.packageName ?? ""}\0${root.version}\0${root.stage ?? ""}\0${root.topic ?? ""}\0${root.sourceUrl ?? ""}\0${root.retrievedAt ?? ""}\0`,
    );
  for (const file of [...files].sort((left, right) =>
    left.filePath.localeCompare(right.filePath),
  )) {
    hash.update(`${file.filePath}\0${file.size}\0${file.mtimeMs}\0`);
  }
  return hash.digest("hex");
}

async function collectRootFiles(root: UnityDocRoot) {
  const files: IndexedFile[] = [];
  try {
    const rootStat = await stat(root.path);
    if (rootStat.isFile()) {
      if (SUPPORTED_EXTENSIONS.has(extname(root.path).toLowerCase()))
        files.push({
          ...root,
          filePath: resolve(root.path),
          size: rootStat.size,
          mtimeMs: rootStat.mtimeMs,
        });
      return files;
    }
  } catch {
    return files;
  }
  const pending = [root.path];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (
        entry.name.startsWith(".") ||
        entry.name === "images" ||
        entry.name === "Images"
      )
        continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(path);
        continue;
      }
      if (
        !entry.isFile() ||
        !SUPPORTED_EXTENSIONS.has(extname(entry.name).toLowerCase())
      )
        continue;
      if (
        root.kind === "project" &&
        extname(entry.name).toLowerCase() !== ".md"
      )
        continue;
      try {
        const fileStat = await stat(path);
        files.push({
          ...root,
          filePath: resolve(path),
          size: fileStat.size,
          mtimeMs: fileStat.mtimeMs,
        });
      } catch {
        // Ignore files that disappear during package refresh.
      }
    }
  }
  return files;
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&#(\d+);/g, (_match, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

export function htmlToText(html: string) {
  return decodeHtmlEntities(html)
    .replace(/<!--[^]*?-->/g, " ")
    .replace(/<(script|style|nav|footer|svg)\b[^>]*>[^]*?<\/\1>/gi, " ")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(
      /<\/(p|div|section|article|h[1-6]|li|tr|pre|code|table|ul|ol)>/gi,
      "\n",
    )
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function titleFromContent(raw: string, path: string, isHtml: boolean) {
  if (isHtml) {
    const title =
      raw.match(/<title[^>]*>([^]*?)<\/title>/i)?.[1] ??
      raw.match(/<h1[^>]*>([^]*?)<\/h1>/i)?.[1];
    if (title) return htmlToText(title).trim();
  }
  const markdownTitle = raw.match(/^\s*#\s+(.+)$/m)?.[1]?.trim();
  return markdownTitle || basename(path, extname(path));
}

function chunkContent(content: string, baseTitle: string, isHtml: boolean) {
  const lines = content.split(/\r?\n/);
  const chunks: Chunk[] = [];
  let currentHeading = baseTitle;
  for (
    let start = 0;
    start < lines.length;
    start += CHUNK_LINES - CHUNK_OVERLAP
  ) {
    const end = Math.min(lines.length, start + CHUNK_LINES);
    const chunkLines = lines.slice(start, end);
    if (!isHtml) {
      for (const line of chunkLines) {
        const heading = line.match(/^#{1,6}\s+(.+)$/)?.[1]?.trim();
        if (heading) currentHeading = heading;
      }
    }
    const body = chunkLines.join("\n").trim();
    if (body.length >= 40)
      chunks.push({
        title: currentHeading,
        body,
        lineStart: start + 1,
        lineEnd: end,
      });
    if (end === lines.length) break;
  }
  return chunks;
}

async function parseDocument(file: IndexedFile) {
  if (file.size > MAX_FILE_BYTES) return undefined;
  const raw = await readFile(file.filePath, "utf8");
  const isHtml = extname(file.filePath).toLowerCase().startsWith(".htm");
  const title = titleFromContent(raw, file.filePath, isHtml);
  const content = isHtml ? htmlToText(raw) : raw;
  return { title, chunks: chunkContent(content, title, isHtml) };
}

function numberValue(value: unknown) {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function textValue(value: unknown) {
  return typeof value === "string" ? value : String(value ?? "");
}

export async function indexUnityDocs(
  cwd: string,
  options: {
    force?: boolean;
    stage?: UnityCoreStage;
    signal?: AbortSignal;
    onProgress?: (progress: IndexProgress) => void;
  } = {},
) {
  const info = readUnityProjectInfo(cwd);
  const allRoots = await discoverUnityDocRoots(cwd, info);
  const roots = options.stage
    ? allRoots.filter((root) => root.stage === options.stage)
    : allRoots;
  options.onProgress?.({
    phase: "discovering",
    processedFiles: 0,
    totalFiles: 0,
    indexedFiles: 0,
    skippedFiles: 0,
    removedFiles: 0,
  });
  const discovered = (await Promise.all(roots.map(collectRootFiles))).flat();
  const currentPaths = new Set(discovered.map((file) => file.filePath));
  const { db, path } = openIndex(cwd);
  let indexedFiles = 0;
  let skippedFiles = 0;
  let removedFiles = 0;
  const failedCoreFiles: string[] = [];
  try {
    if (options.force && options.stage) {
      db.prepare(
        "DELETE FROM chunks WHERE path IN (SELECT path FROM files WHERE stage = ?)",
      ).run(options.stage);
      db.prepare("DELETE FROM files WHERE stage = ?").run(options.stage);
    } else if (options.force) db.exec("DELETE FROM chunks; DELETE FROM files;");
    const existingRows = db
      .prepare(
        options.stage
          ? "SELECT path, size, mtime_ms FROM files WHERE stage = ?"
          : "SELECT path, size, mtime_ms FROM files",
      )
      .all(...(options.stage ? [options.stage] : [])) as Array<
      Record<string, unknown>
    >;
    const existing = new Map(
      existingRows.map((row) => [
        textValue(row.path),
        { size: numberValue(row.size), mtimeMs: numberValue(row.mtime_ms) },
      ]),
    );
    const deleteChunks = db.prepare("DELETE FROM chunks WHERE path = ?");
    const deleteFile = db.prepare("DELETE FROM files WHERE path = ?");
    const insertFile = db.prepare(
      "INSERT OR REPLACE INTO files(path, size, mtime_ms, kind, package_name, version, title, stage, topic, source_url, documentation_line, retrieved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const insertChunk = db.prepare(
      "INSERT INTO chunks(path, title, body, kind, package_name, version, line_start, line_end) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );

    db.exec("BEGIN IMMEDIATE");
    try {
      for (const oldPath of existing.keys()) {
        if (currentPaths.has(oldPath)) continue;
        deleteChunks.run(oldPath);
        deleteFile.run(oldPath);
        removedFiles++;
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    const changed: IndexedFile[] = [];
    for (const file of discovered) {
      const old = existing.get(file.filePath);
      if (
        !options.force &&
        old &&
        old.size === file.size &&
        old.mtimeMs === file.mtimeMs
      )
        skippedFiles++;
      else changed.push(file);
    }

    const unchangedFiles = skippedFiles;
    const batchSize = 64;
    for (
      let batchStart = 0;
      batchStart < changed.length;
      batchStart += batchSize
    ) {
      if (options.signal?.aborted)
        throw new Error("Unity documentation indexing was cancelled.");
      const batch = changed.slice(batchStart, batchStart + batchSize);
      const parsedBatch = await Promise.all(
        batch.map(async (file) => {
          try {
            return { file, parsed: await parseDocument(file) };
          } catch {
            return { file, parsed: undefined };
          }
        }),
      );
      if (options.signal?.aborted)
        throw new Error("Unity documentation indexing was cancelled.");

      db.exec("BEGIN IMMEDIATE");
      try {
        for (const { file, parsed } of parsedBatch) {
          if (!parsed || parsed.chunks.length === 0) {
            deleteChunks.run(file.filePath);
            deleteFile.run(file.filePath);
            if (file.stage) failedCoreFiles.push(file.filePath);
            skippedFiles++;
            continue;
          }
          deleteChunks.run(file.filePath);
          insertFile.run(
            file.filePath,
            file.size,
            file.mtimeMs,
            file.kind,
            file.packageName ?? null,
            file.version,
            parsed.title,
            file.stage ?? null,
            file.topic ?? null,
            file.sourceUrl ?? null,
            file.documentationLine ?? null,
            file.retrievedAt ?? null,
          );
          for (const chunk of parsed.chunks) {
            insertChunk.run(
              file.filePath,
              chunk.title,
              chunk.body,
              file.kind,
              file.packageName ?? null,
              file.version,
              chunk.lineStart,
              chunk.lineEnd,
            );
          }
          indexedFiles++;
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }

      const processedFiles = Math.min(
        discovered.length,
        unchangedFiles + batchStart + batch.length,
      );
      options.onProgress?.({
        phase: "indexing",
        processedFiles,
        totalFiles: discovered.length,
        indexedFiles,
        skippedFiles,
        removedFiles,
      });
    }

    if (failedCoreFiles.length > 0)
      throw new Error(
        `Failed to parse ${failedCoreFiles.length} targeted Unity core page(s):\n${failedCoreFiles.join("\n")}`,
      );

    if (options.stage) {
      const fingerprint = computeFingerprint(cwd, info, roots, discovered);
      db.prepare(
        "INSERT OR REPLACE INTO metadata(key, value) VALUES (?, ?)",
      ).run(`stage_${options.stage}_fingerprint`, fingerprint);
    } else {
      const fingerprint = computeFingerprint(cwd, info, allRoots, discovered);
      db.prepare(
        "INSERT OR REPLACE INTO metadata(key, value) VALUES ('fingerprint', ?)",
      ).run(fingerprint);
      for (let stage = 1; stage <= 6; stage++) {
        const stageRoots = allRoots.filter((root) => root.stage === stage);
        const stageFiles = discovered.filter((file) => file.stage === stage);
        if (stageRoots.length > 0)
          db.prepare(
            "INSERT OR REPLACE INTO metadata(key, value) VALUES (?, ?)",
          ).run(
            `stage_${stage}_fingerprint`,
            computeFingerprint(cwd, info, stageRoots, stageFiles),
          );
      }
    }
    db.prepare("INSERT OR REPLACE INTO metadata(key, value) VALUES (?, ?)").run(
      options.stage ? `stage_${options.stage}_indexed_at` : "last_indexed_at",
      new Date().toISOString(),
    );
    const counts = db
      .prepare(
        "SELECT (SELECT count(*) FROM files) AS files, (SELECT count(*) FROM chunks) AS chunks",
      )
      .get() as Record<string, unknown>;
    const progress = {
      phase: "complete" as const,
      processedFiles: discovered.length,
      totalFiles: discovered.length,
      indexedFiles,
      skippedFiles,
      removedFiles,
    };
    options.onProgress?.(progress);
    return {
      indexPath: path,
      roots,
      files: numberValue(counts.files),
      chunks: numberValue(counts.chunks),
      ...progress,
    };
  } finally {
    db.close();
  }
}

export async function getUnityDocsStatus(
  cwd: string,
): Promise<UnityDocsStatus> {
  const project = readUnityProjectInfo(cwd);
  const roots = await discoverUnityDocRoots(cwd, project);
  const discovered = (await Promise.all(roots.map(collectRootFiles))).flat();
  const { db, path } = openIndex(cwd);
  try {
    const counts = db
      .prepare(
        "SELECT (SELECT count(*) FROM files) AS files, (SELECT count(*) FROM chunks) AS chunks",
      )
      .get() as Record<string, unknown>;
    const fingerprint = db
      .prepare("SELECT value FROM metadata WHERE key = 'fingerprint'")
      .get() as Record<string, unknown> | undefined;
    const lastIndexed = db
      .prepare("SELECT value FROM metadata WHERE key = 'last_indexed_at'")
      .get() as Record<string, unknown> | undefined;
    const coreStageRows = db
      .prepare(
        "SELECT stage, count(*) AS pages FROM files WHERE stage IS NOT NULL GROUP BY stage ORDER BY stage",
      )
      .all() as Array<Record<string, unknown>>;
    const validCoreStages = coreStageRows.flatMap((row) => {
      const stage = numberValue(row.stage) as UnityCoreStage;
      const stageRoots = roots.filter((root) => root.stage === stage);
      const stageFiles = discovered.filter((file) => file.stage === stage);
      const stored = db
        .prepare("SELECT value FROM metadata WHERE key = ?")
        .get(`stage_${stage}_fingerprint`) as
        Record<string, unknown> | undefined;
      return stageRoots.length > 0 &&
        numberValue(row.pages) === stageFiles.length &&
        textValue(stored?.value) ===
          computeFingerprint(cwd, project, stageRoots, stageFiles)
        ? [{ stage, pages: numberValue(row.pages) }]
        : [];
    });
    return {
      project,
      indexPath: path,
      indexedFiles: numberValue(counts.files),
      indexedChunks: numberValue(counts.chunks),
      lastIndexedAt: lastIndexed ? textValue(lastIndexed.value) : undefined,
      fingerprintMatches:
        textValue(fingerprint?.value) ===
        computeFingerprint(cwd, project, roots, discovered),
      roots,
      coreStages: validCoreStages,
      offlineEditorDocsFound: roots.some(
        (root) => root.kind === "editor-manual" || root.kind === "editor-api",
      ),
      offlineEditorDocsExpectedAt: expectedOfflineDocsPath(project),
      offlineEditorDocsUrl: offlineDocsUrl(project),
    };
  } finally {
    db.close();
  }
}

function ftsQuery(query: string) {
  const tokens =
    query
      .match(/[\p{L}\p{N}_]+/gu)
      ?.filter((token) => token.length > 1)
      .slice(0, 12) ?? [];
  if (tokens.length === 0)
    throw new Error(
      "Search query must contain at least one letter, number, or underscore.",
    );
  const quoted = tokens.map((token) => `"${token.replaceAll('"', '""')}"`);
  return quoted.length > 1
    ? `"${tokens.join(" ").replaceAll('"', '""')}" OR ${quoted.join(" OR ")}`
    : quoted[0];
}

function displayPath(cwd: string, path: string) {
  const projectRelative = relative(cwd, path);
  return projectRelative &&
    !projectRelative.startsWith("..") &&
    !isAbsolute(projectRelative)
    ? projectRelative
    : path;
}

export async function searchUnityDocs(
  cwd: string,
  query: string,
  options: {
    limit?: number;
    packageName?: string;
    kind?: UnityDocKind;
    stage?: UnityCoreStage;
    signal?: AbortSignal;
  } = {},
) {
  if (options.signal?.aborted)
    throw new Error("Unity documentation search was cancelled.");
  let status = await getUnityDocsStatus(cwd);
  if (options.stage) {
    if (!status.coreStages.some((entry) => entry.stage === options.stage)) {
      await indexUnityDocs(cwd, {
        stage: options.stage,
        signal: options.signal,
      });
      status = await getUnityDocsStatus(cwd);
    }
  } else if (status.indexedChunks === 0 || !status.fingerprintMatches) {
    await indexUnityDocs(cwd, { signal: options.signal });
    status = await getUnityDocsStatus(cwd);
  }
  if (options.signal?.aborted)
    throw new Error("Unity documentation search was cancelled.");
  const { db } = openIndex(cwd);
  try {
    const clauses = ["chunks MATCH ?"];
    const parameters: Array<string | number> = [ftsQuery(query)];
    if (options.packageName) {
      clauses.push("chunks.package_name = ?");
      parameters.push(options.packageName);
    }
    if (options.kind) {
      clauses.push("chunks.kind = ?");
      parameters.push(options.kind);
    }
    if (options.stage) {
      clauses.push("files.stage = ?");
      parameters.push(options.stage);
    }
    parameters.push(Math.min(Math.max(options.limit ?? 8, 1), 20));
    const rows = db
      .prepare(
        `
			SELECT chunks.path, chunks.title, snippet(chunks, 2, '[', ']', ' … ', 48) AS excerpt,
				chunks.kind, chunks.package_name, chunks.version, chunks.line_start, chunks.line_end,
				files.stage, files.topic, files.source_url, files.documentation_line, files.retrieved_at,
				bm25(chunks, 0.0, 4.0, 1.0) AS score
			FROM chunks JOIN files ON files.path = chunks.path
			WHERE ${clauses.join(" AND ")}
			ORDER BY score
			LIMIT ?
		`,
      )
      .all(...parameters) as Array<Record<string, unknown>>;
    return rows.map((row): UnityDocsSearchResult => {
      const path = textValue(row.path);
      const packageName = textValue(row.package_name) || undefined;
      return {
        path,
        displayPath: displayPath(cwd, path),
        title: textValue(row.title),
        excerpt: textValue(row.excerpt),
        kind: textValue(row.kind) as UnityDocKind,
        packageName,
        version: textValue(row.version),
        lineStart: numberValue(row.line_start),
        lineEnd: numberValue(row.line_end),
        score: numberValue(row.score),
        stage: numberValue(row.stage)
          ? (numberValue(row.stage) as UnityCoreStage)
          : undefined,
        topic: textValue(row.topic) || undefined,
        sourceUrl: textValue(row.source_url) || undefined,
        documentationLine: textValue(row.documentation_line) || undefined,
        retrievedAt: textValue(row.retrieved_at) || undefined,
      };
    });
  } finally {
    db.close();
  }
}

export async function readIndexedUnityDoc(
  cwd: string,
  requestedPath: string,
  offset = 1,
  limit = 200,
) {
  const path = resolve(
    cwd,
    requestedPath.startsWith("@") ? requestedPath.slice(1) : requestedPath,
  );
  const { db } = openIndex(cwd);
  try {
    const indexed = db
      .prepare(
        "SELECT path, kind, package_name, version, title, stage, topic, source_url, documentation_line, retrieved_at FROM files WHERE path = ?",
      )
      .get(path) as Record<string, unknown> | undefined;
    if (!indexed)
      throw new Error(
        "unity_docs_read only reads files already present in the version-matched Unity documentation index. Search or index first, then use an exact returned path.",
      );
    const raw = await readFile(path, "utf8");
    const text = extname(path).toLowerCase().startsWith(".htm")
      ? htmlToText(raw)
      : raw;
    const lines = text.split(/\r?\n/);
    const start = Math.min(Math.max(offset, 1), Math.max(lines.length, 1));
    const boundedLimit = Math.min(Math.max(limit, 1), 400);
    return {
      path,
      displayPath: displayPath(cwd, path),
      kind: textValue(indexed.kind) as UnityDocKind,
      packageName: textValue(indexed.package_name) || undefined,
      version: textValue(indexed.version),
      title: textValue(indexed.title),
      stage: numberValue(indexed.stage)
        ? (numberValue(indexed.stage) as UnityCoreStage)
        : undefined,
      topic: textValue(indexed.topic) || undefined,
      sourceUrl: textValue(indexed.source_url) || undefined,
      documentationLine: textValue(indexed.documentation_line) || undefined,
      retrievedAt: textValue(indexed.retrieved_at) || undefined,
      offset: start,
      lineCount: lines.length,
      content: lines
        .slice(start - 1, start - 1 + boundedLimit)
        .map((line, index) => `${start + index}: ${line}`)
        .join("\n"),
    };
  } finally {
    db.close();
  }
}
