import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateHead } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import {
  getUnityDocsStatus,
  indexUnityDocs,
  readIndexedUnityDoc,
  searchUnityDocs,
  type UnityCoreStage,
  type UnityDocKind,
} from "./core.ts";
import { buildCoreStage } from "./core-corpus.ts";

const SEARCH_KINDS = [
  "project",
  "package",
  "package-changelog",
  "moremountains-topdown",
  "moremountains-feel",
  "editor-manual",
  "editor-api",
] as const;

function sourceLabel(
  kind: UnityDocKind,
  packageName: string | undefined,
  version: string,
) {
  if (kind === "project") return `Current project documentation — ${version}`;
  if (kind === "moremountains-topdown" || kind === "moremountains-feel")
    return `More Mountains ${packageName} ${version} (exact local readme)`;
  if (kind === "package-changelog")
    return `${packageName} ${version} changelog/release notes`;
  if (kind === "package")
    return `${packageName} ${version} installed package documentation`;
  return `Unity ${version} ${kind === "editor-api" ? "Scripting API" : "Manual"}`;
}

function truncateResult(text: string) {
  const result = truncateHead(text, { maxLines: 500, maxBytes: 40 * 1024 });
  return result.truncated
    ? `${result.content}\n\n[Output was truncated to the configured bounds.]`
    : result.content;
}

function formatStatus(status: Awaited<ReturnType<typeof getUnityDocsStatus>>) {
  const packageRoots = status.roots.filter(
    (root) => root.kind === "package" || root.kind === "package-changelog",
  );
  const packageNames = new Set(
    packageRoots.map((root) => root.packageName).filter(Boolean),
  );
  const editorRoots = status.roots.filter((root) => root.kind !== "package");
  return [
    `Unity documentation index for ${status.project.editorVersion}`,
    `Documentation line: ${status.project.documentationLine}`,
    `Resolved packages: ${status.project.packages.size}`,
    `Current project documentation: ${status.roots.filter((root) => root.kind === "project").length} root(s)`,
    `Discovered package documentation/release material: ${packageRoots.length} root(s) across ${packageNames.size} package(s)`,
    `More Mountains documentation: ${status.roots.filter((root) => root.kind.startsWith("moremountains-")).length} exact local version-identifying readme(s)`,
    `Targeted Unity core documentation: ${status.offlineEditorDocsFound ? `${editorRoots.filter((root) => root.kind === "editor-manual" || root.kind === "editor-api").length} page(s) found` : "not found"}`,
    `Completed core stages: ${status.coreStages.length > 0 ? status.coreStages.map((entry) => `${entry.stage} (${entry.pages} pages)`).join(", ") : "none"}`,
    `Indexed: ${status.indexedFiles} file(s), ${status.indexedChunks} chunk(s)`,
    `Index freshness: ${status.fingerprintMatches ? "current" : "indexing required"}`,
    `Last indexed: ${status.lastIndexedAt ?? "never"}`,
    `Index database: ${status.indexPath}`,
    ...(status.offlineEditorDocsFound
      ? []
      : [
          `Expected offline docs: ${status.offlineEditorDocsExpectedAt}`,
          `Official download: ${status.offlineEditorDocsUrl}`,
        ]),
  ].join("\n");
}

function formatSearchResults(
  query: string,
  results: Awaited<ReturnType<typeof searchUnityDocs>>,
) {
  if (results.length === 0)
    return `No version-matched Unity documentation results found for: ${query}`;
  return [
    `Unity documentation search — ${results.length} result(s) for: ${query}`,
    ...results.map((result, index) => {
      const source = sourceLabel(
        result.kind,
        result.packageName,
        result.version,
      );
      return [
        `\n${index + 1}. ${result.title}`,
        `Corpus: ${result.kind}`,
        `Source: ${source}`,
        `Path: ${result.displayPath}`,
        `Lines: ${result.lineStart}-${result.lineEnd}`,
        ...(result.stage
          ? [
              `Core stage: ${result.stage}`,
              `Topic: ${result.topic ?? "unspecified"}`,
              `Source URL: ${result.sourceUrl ?? "unavailable"}`,
              `Retrieved: ${result.retrievedAt ?? "unavailable"}`,
            ]
          : []),
        result.excerpt,
      ].join("\n");
    }),
  ].join("\n");
}

async function runIndex(
  ctx: {
    cwd: string;
    ui: { notify(message: string, type?: "info" | "warning" | "error"): void };
  },
  force = false,
) {
  ctx.ui.notify(
    `Indexing version-matched Unity documentation${force ? " from scratch" : " incrementally"}…`,
    "info",
  );
  const result = await indexUnityDocs(ctx.cwd, { force });
  ctx.ui.notify(
    `Unity docs indexed: ${result.files} files, ${result.chunks} chunks.`,
    "info",
  );
  return result;
}

export function registerUnityDocs(pi: ExtensionAPI) {
  pi.registerTool({
    name: "unity_docs_status",
    label: "Unity Docs Status",
    description:
      "Report the Unity Editor version, exact resolved package versions, discovered local documentation roots, and version-aware local documentation index status. Read-only.",
    promptSnippet:
      "Inspect exact Unity and package documentation versions before answering Unity API questions.",
    promptGuidelines: [
      "Use unity_docs_status before authoritative Unity documentation work when the project or index version is unknown.",
    ],
    parameters: Type.Object({}, { additionalProperties: false }),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const status = await getUnityDocsStatus(ctx.cwd);
      return {
        content: [{ type: "text" as const, text: formatStatus(status) }],
        details: status,
      };
    },
  });

  pi.registerTool({
    name: "unity_docs_index",
    label: "Unity Docs Index",
    description:
      "Build or incrementally refresh the local FTS5 index from current project docs, exact More Mountains readmes, exact resolved Unity package docs/changelogs, and optional matching offline Editor docs. Writes only to Pi's user cache.",
    promptSnippet:
      "Index exact installed Unity package docs and matching offline Editor docs locally.",
    promptGuidelines: [
      "Use unity_docs_index when unity_docs_status reports an empty or stale index; do not index unrelated package-cache versions.",
    ],
    parameters: Type.Object(
      {
        force: Type.Optional(
          Type.Boolean({
            description:
              "Rebuild the complete index instead of updating changed files.",
          }),
        ),
      },
      { additionalProperties: false },
    ),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const result = await indexUnityDocs(ctx.cwd, {
        force: params.force ?? false,
        signal,
        onProgress(progress) {
          onUpdate?.({
            content: [
              {
                type: "text" as const,
                text:
                  progress.phase === "discovering"
                    ? "Discovering version-matched Unity documentation…"
                    : `Indexing Unity docs: ${progress.processedFiles}/${progress.totalFiles} files…`,
              },
            ],
            details: undefined,
          });
        },
      });
      const text = `Unity documentation index updated.\nFiles: ${result.files}\nChunks: ${result.chunks}\nChanged files indexed: ${result.indexedFiles}\nUnchanged/skipped: ${result.skippedFiles}\nRemoved stale files: ${result.removedFiles}\nDatabase: ${result.indexPath}`;
      return { content: [{ type: "text" as const, text }], details: result };
    },
  });

  pi.registerTool({
    name: "unity_docs_core_stage",
    label: "Unity Docs Core Stage",
    description:
      "Validate, download, incrementally index, and verify one bounded stage of the official Unity 6000.3 core documentation corpus. Stages are independently resumable and stored outside the repository.",
    promptSnippet:
      "Build one targeted, version-correct Unity core documentation stage after the previous stage is verified.",
    parameters: Type.Object(
      {
        stage: Type.Integer({
          minimum: 1,
          maximum: 6,
          description: "Core documentation stage to build.",
        }),
      },
      { additionalProperties: false },
    ),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      if (signal?.aborted)
        throw new Error("Unity core documentation stage was cancelled.");
      onUpdate?.({
        content: [
          {
            type: "text" as const,
            text: `Validating Unity 6000.3 core stage ${params.stage} URLs before download…`,
          },
        ],
        details: undefined,
      });
      const report = await buildCoreStage(
        ctx.cwd,
        params.stage as UnityCoreStage,
        { signal },
      );
      return {
        content: [
          {
            type: "text" as const,
            text: truncateResult(JSON.stringify(report, null, 2)),
          },
        ],
        details: report,
      };
    },
  });

  pi.registerTool({
    name: "unity_docs_search",
    label: "Unity Docs Search",
    description:
      "Search current project docs, exact installed package docs/changelogs, exact local More Mountains readmes, and optional matching offline Editor docs with FTS5/BM25. Results include corpus, identity, version, path, and lines.",
    promptSnippet:
      "Search authoritative, version-matched local Unity documentation with source provenance.",
    promptGuidelines: [
      "Prefer unity_docs_search over generic web search for Unity APIs, package behavior, configuration, and migration questions.",
      "Treat unity_docs_search hits as evidence only after checking their reported Editor or package version, and use unity_docs_read for the complete relevant section.",
    ],
    parameters: Type.Object(
      {
        query: Type.String({
          description: "API symbol, error, feature, or concept to search for.",
        }),
        limit: Type.Optional(
          Type.Integer({
            minimum: 1,
            maximum: 20,
            description: "Maximum results. Defaults to 8.",
          }),
        ),
        packageName: Type.Optional(
          Type.String({
            description:
              "Optional exact resolved package name, such as com.unity.inputsystem.",
          }),
        ),
        kind: Type.Optional(
          StringEnum(SEARCH_KINDS, { description: "Optional source filter." }),
        ),
        stage: Type.Optional(
          Type.Integer({
            minimum: 1,
            maximum: 6,
            description: "Optional targeted Unity core stage filter.",
          }),
        ),
      },
      { additionalProperties: false },
    ),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      if (signal?.aborted)
        throw new Error("Unity documentation search was cancelled.");
      onUpdate?.({
        content: [
          {
            type: "text" as const,
            text: "Searching version-matched Unity documentation…",
          },
        ],
        details: undefined,
      });
      const results = await searchUnityDocs(ctx.cwd, params.query, {
        limit: params.limit,
        packageName: params.packageName,
        kind: params.kind as UnityDocKind | undefined,
        stage: params.stage as UnityCoreStage | undefined,
        signal,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: truncateResult(formatSearchResults(params.query, results)),
          },
        ],
        details: { query: params.query, results },
      };
    },
  });

  pi.registerTool({
    name: "unity_docs_read",
    label: "Unity Docs Read",
    description:
      "Read a bounded section from an exact file returned by unity_docs_search. Refuses arbitrary files that are not in the version-matched Unity documentation index.",
    promptSnippet:
      "Read an exact indexed Unity documentation section with source/version metadata.",
    parameters: Type.Object(
      {
        path: Type.String({
          description: "Exact source path returned by unity_docs_search.",
        }),
        offset: Type.Optional(
          Type.Integer({
            minimum: 1,
            description: "First text line. Defaults to 1.",
          }),
        ),
        limit: Type.Optional(
          Type.Integer({
            minimum: 1,
            maximum: 400,
            description: "Maximum lines. Defaults to 200.",
          }),
        ),
      },
      { additionalProperties: false },
    ),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (signal?.aborted)
        throw new Error("Unity documentation read was cancelled.");
      const result = await readIndexedUnityDoc(
        ctx.cwd,
        params.path,
        params.offset,
        params.limit,
      );
      const source = sourceLabel(
        result.kind,
        result.packageName,
        result.version,
      );
      const coreMetadata = result.stage
        ? `\nCore stage: ${result.stage}\nTopic: ${result.topic ?? "unspecified"}\nSource URL: ${result.sourceUrl ?? "unavailable"}\nDocumentation line: ${result.documentationLine ?? result.version}\nRetrieved: ${result.retrievedAt ?? "unavailable"}`
        : "";
      const text = `${result.title}\nCorpus: ${result.kind}\nSource: ${source}\nPath: ${result.displayPath}${coreMetadata}\nLines ${result.offset}-${Math.min(result.offset + (params.limit ?? 200) - 1, result.lineCount)} of ${result.lineCount}\n\n${result.content}`;
      return {
        content: [{ type: "text" as const, text: truncateResult(text) }],
        details: result,
      };
    },
  });

  pi.registerCommand("unity-docs-status", {
    description: "Show Unity documentation corpus and index status",
    handler: async (_args, ctx) => {
      ctx.ui.notify(formatStatus(await getUnityDocsStatus(ctx.cwd)), "info");
    },
  });

  pi.registerCommand("unity-docs-index", {
    description:
      "Incrementally index exact installed Unity documentation; pass --force to rebuild",
    handler: async (args, ctx) => {
      await runIndex(ctx, args.trim() === "--force");
    },
  });

  pi.registerCommand("unity-docs-core-stage", {
    description: "Build one targeted Unity 6000.3 core stage (1-6)",
    handler: async (args, ctx) => {
      const stage = Number(args.trim()) as UnityCoreStage;
      if (![1, 2, 3, 4, 5, 6].includes(stage))
        throw new Error("Usage: /unity-docs-core-stage <1-6>");
      ctx.ui.notify(
        `Building targeted Unity core documentation stage ${stage}…`,
        "info",
      );
      const report = await buildCoreStage(ctx.cwd, stage);
      ctx.ui.notify(
        `Stage ${stage} complete: ${report.pagesAdded} added, ${report.pagesResumed} resumed, ${report.indexChunks} total chunks.`,
        "info",
      );
    },
  });
}
