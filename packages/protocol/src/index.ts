import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

/**
 * v26: project services are registered per extension id. `project.status`,
 * `project.open`, and `project.watch` identify both the workspace and the
 * owning extension, and status payloads are opaque extension-owned data —
 * core no longer describes any extension's process shape. v25 project
 * requests (no extensionId) are still accepted for one migration window.
 */
export const protocolVersion = 26 as const;

const sessionTitleLimit = 48;

export function sessionTitle(input: string): string {
  const title = input.trim();
  if (!title) return "New session";
  return title.length > sessionTitleLimit
    ? `${title.slice(0, sessionTitleLimit - 1)}…`
    : title;
}

export const agentToolPolicy = {
  tools: ["read", "edit", "write", "git_status"],
  approvals: false,
  extensions: false,
} as const;

/** Pi's built-in tools. Availability is governed by Pi's `defaultTools` setting. */
export const builtInAgentTools = [
  "read",
  "bash",
  "powershell",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
] as const;

/**
 * Gizmo seeds this on first read so a fresh install keeps the no-shell
 * default instead of Pi's every-built-in default. Checking every box
 * reproduces Pi's default, so seeding loses nothing.
 */
export const seededToolPolicy = ["read", "edit", "write"] as const;

/**
 * Which built-in tools a session starts with. Global comes from Pi's
 * `defaultTools` setting; a workspace may override it through project
 * settings. Extension and SDK custom tools are always enabled and are not
 * part of this policy.
 */
export const toolPolicySchema = Type.Object(
  {
    builtIn: Type.Array(Type.String()),
    /** Global setting; null means Pi's default (every built-in enabled). */
    global: Type.Union([Type.Array(Type.String()), Type.Null()]),
    /** Project override from `.pi/settings.json`; null means none. */
    project: Type.Union([Type.Array(Type.String()), Type.Null()]),
    /** What a new thread in this workspace actually starts with. */
    effective: Type.Array(Type.String()),
    /** Whether a project override applies (Pi's project-trust rules). */
    projectApplied: Type.Boolean(),
  },
  { additionalProperties: false },
);

export type ToolPolicy = Static<typeof toolPolicySchema>;

export interface AgentIdentity {
  name: string;
  version: string;
  capabilities: readonly string[];
}

const envelope = {
  protocolVersion: Type.Literal(protocolVersion),
  requestId: Type.String({ minLength: 1 }),
};

/**
 * v25 compatibility: project.status/project.open/project.watch requests from
 * a v25 client carry no extensionId and are stamped with version 25. Accepted
 * only for the migration window; remove together with the v25 request
 * variants below.
 */
const v25Envelope = {
  protocolVersion: Type.Literal(25),
  requestId: Type.String({ minLength: 1 }),
};

const eventEnvelope = {
  protocolVersion: Type.Literal(protocolVersion),
  eventId: Type.Integer({ minimum: 1 }),
  sessionId: Type.String({ minLength: 1 }),
};

const responseEnvelope = {
  protocolVersion: Type.Literal(protocolVersion),
  requestId: Type.String({ minLength: 1 }),
};

export const workspaceProfileExtensionSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 64 }),
    root: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type WorkspaceIntegration = Static<
  typeof workspaceProfileExtensionSchema
>;

export const sessionOptionsSchema = Type.Object(
  {
    cwd: Type.Optional(Type.String({ minLength: 1 })),
    integrations: Type.Optional(Type.Array(workspaceProfileExtensionSchema)),
    domainId: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  },
  { additionalProperties: false },
);

export type SessionOptions = Static<typeof sessionOptionsSchema>;

export const toolCallViewSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
    status: Type.Union([
      Type.Literal("running"),
      Type.Literal("complete"),
      Type.Literal("error"),
    ]),
    statusText: Type.String(),
    /** Arguments the agent called the tool with. */
    input: Type.Optional(Type.Unknown()),
    result: Type.Optional(Type.Unknown()),
  },
  { additionalProperties: false },
);

export type ToolCallView = Static<typeof toolCallViewSchema>;

export const conversationAttachmentSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1, maxLength: 255 }),
    mimeType: Type.String({ minLength: 1, maxLength: 127 }),
    size: Type.Integer({ minimum: 0 }),
    /** Base64 image bytes, present when the attachment can be previewed. */
    data: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export type ConversationAttachment = Static<
  typeof conversationAttachmentSchema
>;

export const conversationMessageSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    role: Type.Union([Type.Literal("user"), Type.Literal("assistant")]),
    content: Type.String(),
    /** Model reasoning, when the provider exposes it in readable form. */
    reasoning: Type.Optional(Type.String()),
    /**
     * The provider withheld the reasoning and returned only an opaque
     * payload, so there is nothing to show even though the model did think.
     */
    reasoningRedacted: Type.Optional(Type.Boolean()),
    createdAt: Type.Integer({ minimum: 0 }),
    complete: Type.Boolean(),
    tools: Type.Array(toolCallViewSchema),
    attachments: Type.Optional(Type.Array(conversationAttachmentSchema)),
  },
  { additionalProperties: false },
);

export type ConversationMessage = Static<typeof conversationMessageSchema>;

export const sessionUsageSchema = Type.Object(
  {
    input: Type.Integer({ minimum: 0 }),
    output: Type.Integer({ minimum: 0 }),
    cacheRead: Type.Integer({ minimum: 0 }),
    cacheWrite: Type.Integer({ minimum: 0 }),
    /** Everything the next request has to re-send, in tokens. */
    contextUsed: Type.Integer({ minimum: 0 }),
    /** The model's limit, when it reports one. */
    contextWindow: Type.Optional(Type.Integer({ minimum: 1 })),
    /** Cost of the thread so far, in US dollars. */
    cost: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export type SessionUsage = Static<typeof sessionUsageSchema>;

export const compactionPolicySchema = Type.Object(
  {
    enabled: Type.Boolean(),
    fillPercent: Type.Integer({ minimum: 10, maximum: 95 }),
    retainPercent: Type.Integer({ minimum: 5, maximum: 90 }),
  },
  { additionalProperties: false },
);

export type CompactionPolicy = Static<typeof compactionPolicySchema>;

export const agentAttachmentSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 255 }),
    mimeType: Type.String({ minLength: 1, maxLength: 127 }),
    /** Base64-encoded file bytes. */
    data: Type.String({ minLength: 1, maxLength: 14_000_000 }),
  },
  { additionalProperties: false },
);

export type AgentAttachment = Static<typeof agentAttachmentSchema>;

export const sessionTreeEntrySchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    parentId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    kind: Type.Union([
      Type.Literal("user"),
      Type.Literal("assistant"),
      Type.Literal("tool"),
      Type.Literal("compaction"),
      Type.Literal("branch-summary"),
      Type.Literal("model-change"),
      Type.Literal("thinking-change"),
      Type.Literal("other"),
    ]),
    /** One line for the row. */
    summary: Type.String(),
    /** Full text, for copying. */
    detail: Type.Optional(Type.String()),
    label: Type.Optional(Type.String()),
    createdAt: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export type SessionTreeEntry = Static<typeof sessionTreeEntrySchema>;

export const sessionTreeSchema = Type.Object(
  {
    entries: Type.Array(sessionTreeEntrySchema),
    /** Where the next message will be appended. Null before any entry. */
    leafId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  },
  { additionalProperties: false },
);

export type SessionTree = Static<typeof sessionTreeSchema>;

export const agentSessionSummarySchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    title: Type.String({ minLength: 1 }),
    workspacePath: Type.Optional(Type.String({ minLength: 1 })),
    domainId: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    integrations: Type.Optional(
      Type.Array(
        Type.Object(
          {
            id: Type.String({ minLength: 1, maxLength: 64 }),
            root: Type.String({ minLength: 1 }),
          },
          { additionalProperties: false },
        ),
      ),
    ),
    /** @deprecated Read old session catalogs only. */
    projectPath: Type.Optional(Type.String({ minLength: 1 })),
    createdAt: Type.Integer({ minimum: 0 }),
    lastActiveAt: Type.Integer({ minimum: 0 }),
    messageCount: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export type AgentSessionSummary = Static<typeof agentSessionSummarySchema>;

export const sessionCatalogSchema = Type.Object(
  {
    sessions: Type.Array(agentSessionSummarySchema),
    lastSessionId: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

export type SessionCatalog = Static<typeof sessionCatalogSchema>;

export const sessionSnapshotSchema = Type.Object(
  {
    session: agentSessionSummarySchema,
    messages: Type.Array(conversationMessageSchema),
  },
  { additionalProperties: false },
);

export type SessionSnapshot = Static<typeof sessionSnapshotSchema>;

export const agentModelOptionSchema = Type.Object(
  {
    provider: Type.String({ minLength: 1 }),
    id: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
    reasoning: Type.Boolean(),
  },
  { additionalProperties: false },
);

export type AgentModelOption = Static<typeof agentModelOptionSchema>;

export const agentModelCatalogSchema = Type.Object(
  {
    current: Type.Optional(
      Type.Object(
        {
          provider: Type.String({ minLength: 1 }),
          id: Type.String({ minLength: 1 }),
          thinkingLevel: Type.String({ minLength: 1 }),
        },
        { additionalProperties: false },
      ),
    ),
    models: Type.Array(agentModelOptionSchema),
    thinkingLevels: Type.Array(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

export type AgentModelCatalog = Static<typeof agentModelCatalogSchema>;

export const projectSkillSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 200 }),
    enabled: Type.Boolean(),
  },
  { additionalProperties: false },
);

/** One extension enablement override; absent entries inherit the global state. */
const extensionOverrideSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 255 }),
    enabled: Type.Boolean(),
  },
  { additionalProperties: false },
);

/**
 * Project-scoped configuration: only the departures from the global settings
 * live here. Every section is optional, and an empty file means the project
 * inherits everything global — Gizmo extensions, Pi extensions, skills, and
 * the global built-in tool policy.
 */
export const projectConfigSchema = Type.Object(
  {
    version: Type.Literal(1),
    gizmoExtensions: Type.Optional(Type.Array(extensionOverrideSchema)),
    piExtensions: Type.Optional(Type.Array(extensionOverrideSchema)),
    /** Overrides of each skill's global enablement. */
    skills: Type.Optional(Type.Array(projectSkillSchema)),
  },
  { additionalProperties: false },
);

export type ProjectConfig = Static<typeof projectConfigSchema>;
export type ExtensionOverride = Static<typeof extensionOverrideSchema>;

export const storedProjectSchema = Type.Object(
  {
    title: Type.String({ minLength: 1 }),
    path: Type.String({ minLength: 1 }),
    /** Gizmo extensions effectively enabled for new sessions. */
    integrations: Type.Array(workspaceProfileExtensionSchema),
    /** Skill overrides in effect; absent rows follow the global setting. */
    skills: Type.Optional(Type.Array(projectSkillSchema)),
    addedAt: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export type StoredProject = Static<typeof storedProjectSchema>;
export type ProjectSkill = Static<typeof projectSkillSchema>;

export const projectDomainsSchema = Type.Object(
  {
    domains: Type.Array(
      Type.Object(
        {
          id: Type.String({ minLength: 1, maxLength: 64 }),
          name: Type.String({ minLength: 1, maxLength: 64 }),
          root: Type.String({ minLength: 1 }),
        },
        { additionalProperties: false },
      ),
    ),
    /** The project's stored overrides, if any. */
    config: Type.Optional(projectConfigSchema),
  },
  { additionalProperties: false },
);

export type ProjectDomains = Static<typeof projectDomainsSchema>;

export const resourceScopeSchema = Type.Union([
  Type.Literal("global"),
  Type.Literal("project"),
]);

export type ResourceScope = Static<typeof resourceScopeSchema>;

/**
 * A skill Gizmo knows about. Discovery is global-first: every skill found on
 * disk is installed globally, and enablement is decided separately so a new
 * skill never starts influencing sessions on its own.
 */
export const skillResourceSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 200 }),
    name: Type.String({ minLength: 1, maxLength: 200 }),
    description: Type.String({ maxLength: 2000 }),
    scope: resourceScopeSchema,
    path: Type.String({ minLength: 1 }),
    source: Type.String({ minLength: 1 }),
    /** True when Gizmo can safely edit this Markdown file in place. */
    editable: Type.Optional(Type.Boolean()),
    installed: Type.Boolean(),
    enabledGlobally: Type.Boolean(),
    /** Effective state for the workspace the catalog was requested for. */
    enabled: Type.Boolean(),
    /** Present when the workspace overrides the global enablement. */
    override: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export type SkillResource = Static<typeof skillResourceSchema>;

export const piExtensionResourceSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 255 }),
    name: Type.String({ minLength: 1, maxLength: 255 }),
    path: Type.String({ minLength: 1 }),
    enabled: Type.Boolean(),
    kind: Type.Union([Type.Literal("file"), Type.Literal("directory")]),
  },
  { additionalProperties: false },
);

export type PiExtensionResource = Static<typeof piExtensionResourceSchema>;

export const skillFileSchema = Type.Object(
  {
    path: Type.String({ minLength: 1 }),
    content: Type.String({ maxLength: 1_000_000 }),
  },
  { additionalProperties: false },
);

export type SkillFile = Static<typeof skillFileSchema>;

/** Read-only companion resources: AGENTS.md files and prompt templates. */
export const agentResourceSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 400 }),
    name: Type.String({ minLength: 1, maxLength: 200 }),
    description: Type.Optional(Type.String({ maxLength: 2000 })),
    scope: resourceScopeSchema,
    path: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type AgentResource = Static<typeof agentResourceSchema>;

export const resourceCatalogSchema = Type.Object(
  {
    /** Absolute path of the workspace the effective state was resolved for. */
    workspacePath: Type.Optional(Type.String({ minLength: 1 })),
    skills: Type.Array(skillResourceSchema),
    agentsFiles: Type.Array(agentResourceSchema),
    prompts: Type.Array(agentResourceSchema),
    extensions: Type.Optional(Type.Array(piExtensionResourceSchema)),
    /** Installed Gizmo extensions with their global enablement. */
    gizmoExtensions: Type.Optional(
      Type.Array(
        Type.Object(
          {
            id: Type.String({ minLength: 1, maxLength: 64 }),
            name: Type.String({ minLength: 1, maxLength: 64 }),
            enabled: Type.Boolean(),
          },
          { additionalProperties: false },
        ),
      ),
    ),
    diagnostics: Type.Array(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

export type ResourceCatalog = Static<typeof resourceCatalogSchema>;

export const workspaceDirectoryListingSchema = Type.Object(
  {
    path: Type.String({ minLength: 1 }),
    parent: Type.Optional(Type.String({ minLength: 1 })),
    directories: Type.Array(
      Type.Object(
        {
          name: Type.String({ minLength: 1 }),
          path: Type.String({ minLength: 1 }),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export type WorkspaceDirectoryListing = Static<
  typeof workspaceDirectoryListingSchema
>;

export const extensionOperationSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 128 }),
    mutates: Type.Boolean(),
    requiresConfirmation: Type.Boolean(),
  },
  { additionalProperties: false },
);

export type ExtensionOperation = Static<typeof extensionOperationSchema>;

export const extensionDescriptorSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 128 }),
    name: Type.String({ minLength: 1, maxLength: 128 }),
    version: Type.String({ minLength: 1, maxLength: 64 }),
    apiVersion: Type.Integer({ minimum: 1 }),
    capabilities: Type.Array(Type.String({ minLength: 1, maxLength: 128 })),
    operations: Type.Array(extensionOperationSchema),
  },
  { additionalProperties: false },
);

export type ExtensionDescriptor = Static<typeof extensionDescriptorSchema>;

export const extensionsSchema = Type.Object(
  {
    extensions: Type.Array(extensionDescriptorSchema),
  },
  { additionalProperties: false },
);

export type Extensions = Static<typeof extensionsSchema>;

/**
 * One runtime-loadable web extension bundle. `code` is a standalone ES module
 * exporting `gizmoWebExtension`; the app imports it through a real runtime
 * `import()` of a blob URL, which its own bundler never had to resolve.
 */
export const webExtensionBundleSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 128 }),
    code: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type WebExtensionBundle = Static<typeof webExtensionBundleSchema>;

export const webExtensionBundlesSchema = Type.Object(
  {
    bundles: Type.Array(webExtensionBundleSchema),
    /** Extensions that declared a web bundle Gizmo could not load. */
    diagnostics: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);

export type WebExtensionBundles = Static<typeof webExtensionBundlesSchema>;

export const fileRevertResultSchema = Type.Object(
  {
    file: Type.String({ minLength: 1 }),
    reverted: Type.Boolean(),
    reason: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export type FileRevertResult = Static<typeof fileRevertResultSchema>;

export const gitFileStatusSchema = Type.Object(
  {
    path: Type.String({ minLength: 1 }),
    originalPath: Type.Optional(Type.String({ minLength: 1 })),
    index: Type.String({ minLength: 1, maxLength: 1 }),
    workingTree: Type.String({ minLength: 1, maxLength: 1 }),
  },
  { additionalProperties: false },
);

export type GitFileStatus = Static<typeof gitFileStatusSchema>;

export const gitStatusSchema = Type.Object(
  {
    rootPath: Type.String({ minLength: 1 }),
    branch: Type.String({ minLength: 1 }),
    clean: Type.Boolean(),
    files: Type.Array(gitFileStatusSchema),
  },
  { additionalProperties: false },
);

export type GitStatus = Static<typeof gitStatusSchema>;

export const gitCommitResultSchema = Type.Object(
  {
    rootPath: Type.String({ minLength: 1 }),
    commit: Type.String({ minLength: 1 }),
    message: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type GitCommitResult = Static<typeof gitCommitResultSchema>;

export const providerStatusSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
    authenticated: Type.Boolean(),
    source: Type.Optional(Type.String({ minLength: 1 })),
    credentialType: Type.Optional(
      Type.Union([Type.Literal("api_key"), Type.Literal("oauth")]),
    ),
    supportsApiKey: Type.Boolean(),
    supportsOAuth: Type.Boolean(),
    modelCount: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export type ProviderStatus = Static<typeof providerStatusSchema>;

export const composerCommandSchema = Type.Object(
  {
    name: Type.String({ minLength: 1 }),
    description: Type.Optional(Type.String()),
    source: Type.Union([
      Type.Literal("extension"),
      Type.Literal("prompt"),
      Type.Literal("skill"),
    ]),
  },
  { additionalProperties: false },
);

export type ComposerCommand = Static<typeof composerCommandSchema>;

export const extensionUiRequestSchema = Type.Union([
  Type.Object(
    {
      method: Type.Literal("select"),
      title: Type.String({ maxLength: 500 }),
      options: Type.Array(Type.String({ maxLength: 2_000 }), {
        minItems: 0,
        maxItems: 500,
      }),
      timeout: Type.Optional(Type.Integer({ minimum: 1 })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      method: Type.Literal("confirm"),
      title: Type.String({ maxLength: 500 }),
      message: Type.String({ maxLength: 10_000 }),
      timeout: Type.Optional(Type.Integer({ minimum: 1 })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      method: Type.Literal("input"),
      title: Type.String({ maxLength: 500 }),
      placeholder: Type.Optional(Type.String({ maxLength: 2_000 })),
      timeout: Type.Optional(Type.Integer({ minimum: 1 })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      method: Type.Literal("editor"),
      title: Type.String({ maxLength: 500 }),
      prefill: Type.Optional(Type.String({ maxLength: 100_000 })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      method: Type.Literal("notify"),
      message: Type.String({ maxLength: 10_000 }),
      notificationType: Type.Union([
        Type.Literal("info"),
        Type.Literal("warning"),
        Type.Literal("error"),
      ]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      method: Type.Literal("setStatus"),
      key: Type.String({ minLength: 1, maxLength: 200 }),
      text: Type.Union([Type.String({ maxLength: 2_000 }), Type.Null()]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      method: Type.Literal("setWorkingMessage"),
      message: Type.Union([Type.String({ maxLength: 2_000 }), Type.Null()]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      method: Type.Literal("setWorkingVisible"),
      visible: Type.Boolean(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      method: Type.Literal("setWorkingIndicator"),
      frames: Type.Union([
        Type.Array(Type.String({ maxLength: 200 }), { maxItems: 100 }),
        Type.Null(),
      ]),
      intervalMs: Type.Optional(Type.Integer({ minimum: 16, maximum: 60_000 })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      method: Type.Literal("setWidget"),
      key: Type.String({ minLength: 1, maxLength: 200 }),
      lines: Type.Union([
        Type.Array(Type.String({ maxLength: 5_000 }), { maxItems: 200 }),
        Type.Null(),
      ]),
      placement: Type.Union([
        Type.Literal("aboveEditor"),
        Type.Literal("belowEditor"),
      ]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      method: Type.Literal("setTitle"),
      title: Type.String({ maxLength: 1_000 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      method: Type.Literal("setEditorText"),
      text: Type.String({ maxLength: 100_000 }),
    },
    { additionalProperties: false },
  ),
]);

export type ExtensionUiRequest = Static<typeof extensionUiRequestSchema>;

export const extensionUiResponseSchema = Type.Union([
  Type.Object(
    { kind: Type.Literal("value"), value: Type.String({ maxLength: 100_000 }) },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal("confirmed"), confirmed: Type.Boolean() },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal("cancelled") },
    { additionalProperties: false },
  ),
]);

export type ExtensionUiResponse = Static<typeof extensionUiResponseSchema>;

export const registryCatalogEntrySchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
    description: Type.Optional(Type.String()),
    linked: Type.Boolean(),
    /** Present when the extension is linked into the Pi extensions dir. */
    entry: Type.Optional(Type.String({ minLength: 1 })),
    web: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

export type RegistryCatalogEntry = Static<typeof registryCatalogEntrySchema>;

export const registryInfoSchema = Type.Object(
  {
    name: Type.String({ minLength: 1 }),
    url: Type.String({ minLength: 1 }),
    commit: Type.Optional(Type.String()),
    addedAt: Type.Integer({ minimum: 0 }),
    extensions: Type.Array(registryCatalogEntrySchema),
  },
  { additionalProperties: false },
);

export type RegistryInfo = Static<typeof registryInfoSchema>;

export const registryStatusSchema = Type.Object(
  {
    home: Type.String({ minLength: 1 }),
    registries: Type.Array(registryInfoSchema),
  },
  { additionalProperties: false },
);

export type RegistryStatus = Static<typeof registryStatusSchema>;

export function parseRegistryStatus(input: unknown): RegistryStatus {
  if (!Value.Check(registryStatusSchema, input)) {
    throw new ProtocolValidationError("response", input);
  }
  return input;
}

export const agentRequestSchema = Type.Union([
  Type.Object(
    { ...envelope, type: Type.Literal("providers.list") },
    { additionalProperties: false },
  ),
  Type.Object(
    { ...envelope, type: Type.Literal("providers.import-pi-auth") },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("attachment.read"),
      sessionId: Type.String({ minLength: 1 }),
      attachmentId: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("attachment.reveal"),
      sessionId: Type.String({ minLength: 1 }),
      attachmentId: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("session.list"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("session.create"),
      options: sessionOptionsSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("session.resume"),
      sessionId: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("session.rename"),
      sessionId: Type.String({ minLength: 1 }),
      title: Type.String({ minLength: 1, maxLength: 200 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("session.prompt"),
      sessionId: Type.String({ minLength: 1 }),
      text: Type.String({ minLength: 1 }),
      compaction: Type.Optional(compactionPolicySchema),
      attachments: Type.Optional(
        Type.Array(agentAttachmentSchema, { maxItems: 8 }),
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("session.commands"),
      sessionId: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("session.compact"),
      sessionId: Type.String({ minLength: 1 }),
      compaction: compactionPolicySchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("session.reload"),
      sessionId: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("session.steer"),
      sessionId: Type.String({ minLength: 1 }),
      text: Type.String({ minLength: 1 }),
      attachments: Type.Optional(
        Type.Array(agentAttachmentSchema, { maxItems: 8 }),
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("session.abort"),
      sessionId: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("confirmation.resolve"),
      sessionId: Type.String({ minLength: 1 }),
      confirmationId: Type.String({ minLength: 1 }),
      accepted: Type.Boolean(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("session.tree"),
      sessionId: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("session.branch"),
      sessionId: Type.String({ minLength: 1 }),
      /** Null rewinds past the first entry, to re-run the opening prompt. */
      entryId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("session.label"),
      sessionId: Type.String({ minLength: 1 }),
      entryId: Type.String({ minLength: 1 }),
      /** Omitted clears the label. */
      label: Type.Optional(Type.String({ maxLength: 120 })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("session.delete"),
      sessionId: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("extension.ui.respond"),
      sessionId: Type.String({ minLength: 1 }),
      runtimeId: Type.String({ minLength: 1 }),
      uiRequestId: Type.String({ minLength: 1 }),
      response: extensionUiResponseSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("model.catalog"),
      sessionId: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("model.select"),
      sessionId: Type.String({ minLength: 1 }),
      provider: Type.String({ minLength: 1 }),
      modelId: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("thinking.select"),
      sessionId: Type.String({ minLength: 1 }),
      level: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("project.list"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("project.detect"),
      projectPath: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("project.browse"),
      path: Type.Optional(Type.String({ minLength: 1 })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("project.search"),
      query: Type.String(),
      root: Type.Optional(Type.String({ minLength: 1 })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("project.add"),
      projectPath: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("project.gizmo-extension.set"),
      projectPath: Type.String({ minLength: 1 }),
      extensionId: Type.String({ minLength: 1, maxLength: 64 }),
      /** Null clears the override so the global setting applies again. */
      enabled: Type.Union([Type.Boolean(), Type.Null()]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("project.pi-extension.set"),
      projectPath: Type.String({ minLength: 1 }),
      extensionId: Type.String({ minLength: 1, maxLength: 255 }),
      /** Null clears the override so the global setting applies again. */
      enabled: Type.Union([Type.Boolean(), Type.Null()]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("project.remove"),
      projectPath: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("project.status"),
      projectPath: Type.String({ minLength: 1 }),
      extensionId: Type.String({ minLength: 1, maxLength: 128 }),
    },
    { additionalProperties: false },
  ),
  /** v25 compatibility: no extensionId, first-available service routing. */
  Type.Object(
    {
      ...v25Envelope,
      type: Type.Literal("project.status"),
      projectPath: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("project.watch"),
      sessionId: Type.String({ minLength: 1 }),
      projectPath: Type.String({ minLength: 1 }),
      extensionId: Type.String({ minLength: 1, maxLength: 128 }),
    },
    { additionalProperties: false },
  ),
  /** v25 compatibility: no extensionId, first-available service routing. */
  Type.Object(
    {
      ...v25Envelope,
      type: Type.Literal("project.watch"),
      sessionId: Type.String({ minLength: 1 }),
      projectPath: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("project.open"),
      projectPath: Type.String({ minLength: 1 }),
      extensionId: Type.String({ minLength: 1, maxLength: 128 }),
    },
    { additionalProperties: false },
  ),
  /** v25 compatibility: no extensionId, first-available service routing. */
  Type.Object(
    {
      ...v25Envelope,
      type: Type.Literal("project.open"),
      projectPath: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("project.extensions"),
      projectPath: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("extensions.web"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("project.extension.invoke"),
      projectPath: Type.String({ minLength: 1 }),
      extensionId: Type.String({ minLength: 1, maxLength: 128 }),
      operation: Type.String({ minLength: 1, maxLength: 128 }),
      input: Type.Optional(Type.Unknown()),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("resources.list"),
      /** Omitted lists global state only. */
      workspacePath: Type.Optional(Type.String({ minLength: 1 })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("resources.skill.global"),
      skillId: Type.String({ minLength: 1, maxLength: 200 }),
      installed: Type.Optional(Type.Boolean()),
      enabled: Type.Optional(Type.Boolean()),
      workspacePath: Type.Optional(Type.String({ minLength: 1 })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("resources.skill.read"),
      path: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("resources.skill.write"),
      path: Type.String({ minLength: 1 }),
      content: Type.String({ maxLength: 1_000_000 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("resources.gizmo-extension.global"),
      gizmoExtensionId: Type.String({ minLength: 1, maxLength: 64 }),
      enabled: Type.Boolean(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("resources.extension.global"),
      extensionId: Type.String({ minLength: 1, maxLength: 255 }),
      enabled: Type.Boolean(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("resources.skill.project"),
      workspacePath: Type.String({ minLength: 1 }),
      skillId: Type.String({ minLength: 1, maxLength: 200 }),
      /** Null clears the override so the global setting applies again. */
      enabled: Type.Union([Type.Boolean(), Type.Null()]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("registry.status"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("registry.add"),
      url: Type.String({ minLength: 1, maxLength: 2_000 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("registry.update"),
      registry: Type.String({ minLength: 1, maxLength: 200 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("registry.remove"),
      registry: Type.String({ minLength: 1, maxLength: 200 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("registry.link"),
      registry: Type.String({ minLength: 1, maxLength: 200 }),
      id: Type.String({ minLength: 1, maxLength: 200 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("registry.unlink"),
      registry: Type.String({ minLength: 1, maxLength: 200 }),
      id: Type.String({ minLength: 1, maxLength: 200 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("tools.policy.get"),
      /** Omitted resolves the default workspace (server cwd). */
      workspacePath: Type.Optional(Type.String({ minLength: 1 })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("tools.policy.global.set"),
      tools: Type.Array(Type.String()),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("tools.policy.project.set"),
      workspacePath: Type.String({ minLength: 1 }),
      /** Null clears the override so the global setting applies again. */
      tools: Type.Union([Type.Array(Type.String()), Type.Null()]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("git.commit-message"),
      sessionId: Type.String({ minLength: 1 }),
      projectPath: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...envelope,
      type: Type.Literal("file.revert"),
      projectPath: Type.String({ minLength: 1 }),
      file: Type.String({ minLength: 1 }),
      patch: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
]);

export type AgentRequest = Static<typeof agentRequestSchema>;

export const agentResponseSchema = Type.Union([
  Type.Object(
    {
      ...responseEnvelope,
      type: Type.Literal("response.success"),
      sessionId: Type.Optional(Type.String({ minLength: 1 })),
      result: Type.Optional(Type.Unknown()),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...responseEnvelope,
      type: Type.Literal("response.error"),
      code: Type.String({ minLength: 1 }),
      message: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
]);

export type AgentResponse = Static<typeof agentResponseSchema>;

export const sessionStateSchema = Type.Union([
  Type.Literal("idle"),
  Type.Literal("streaming"),
  Type.Literal("error"),
]);

export type SessionState = Static<typeof sessionStateSchema>;

export const agentEventSchema = Type.Union([
  Type.Object(
    {
      ...eventEnvelope,
      type: Type.Literal("session.created"),
      title: Type.String(),
      domains: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
      tools: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
      model: Type.Optional(
        Type.Object(
          {
            provider: Type.String({ minLength: 1 }),
            id: Type.String({ minLength: 1 }),
            thinkingLevel: Type.String({ minLength: 1 }),
          },
          { additionalProperties: false },
        ),
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...eventEnvelope,
      type: Type.Literal("session.state"),
      state: sessionStateSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...eventEnvelope,
      type: Type.Literal("session.compaction"),
      active: Type.Boolean(),
      reason: Type.Union([
        Type.Literal("manual"),
        Type.Literal("threshold"),
        Type.Literal("overflow"),
      ]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...eventEnvelope,
      type: Type.Literal("confirmation.requested"),
      confirmationId: Type.String({ minLength: 1 }),
      kind: Type.Literal("stop_play_mode_for_compile"),
      projectPath: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...eventEnvelope,
      type: Type.Literal("extension.ui.requested"),
      runtimeId: Type.String({ minLength: 1 }),
      uiRequestId: Type.String({ minLength: 1 }),
      request: extensionUiRequestSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...eventEnvelope,
      type: Type.Literal("extension.ui.cancelled"),
      runtimeId: Type.String({ minLength: 1 }),
      uiRequestId: Type.String({ minLength: 1 }),
      reason: Type.Union([
        Type.Literal("timeout"),
        Type.Literal("signal"),
        Type.Literal("runtime"),
        Type.Literal("abort"),
      ]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...eventEnvelope,
      type: Type.Literal("extension.ui.runtime.cleared"),
      runtimeId: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...eventEnvelope,
      type: Type.Literal("project.status.changed"),
      projectPath: Type.String({ minLength: 1 }),
      /** Which extension's project service produced this status. */
      extensionId: Type.String({ minLength: 1, maxLength: 128 }),
      /** Opaque extension-owned payload; consumers validate their own shape. */
      status: Type.Unknown(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...eventEnvelope,
      type: Type.Literal("project.extensions.changed"),
      projectPath: Type.String({ minLength: 1 }),
      extensions: Type.Array(extensionDescriptorSchema),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...eventEnvelope,
      type: Type.Literal("message.started"),
      messageId: Type.String({ minLength: 1 }),
      role: Type.Union([Type.Literal("user"), Type.Literal("assistant")]),
      createdAt: Type.Integer({ minimum: 0 }),
      attachments: Type.Optional(Type.Array(conversationAttachmentSchema)),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...eventEnvelope,
      type: Type.Literal("message.delta"),
      messageId: Type.String({ minLength: 1 }),
      delta: Type.String(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...eventEnvelope,
      type: Type.Literal("session.usage"),
      usage: sessionUsageSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...eventEnvelope,
      type: Type.Literal("message.reasoning"),
      messageId: Type.String({ minLength: 1 }),
      delta: Type.String(),
      redacted: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...eventEnvelope,
      type: Type.Literal("message.completed"),
      messageId: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...eventEnvelope,
      type: Type.Literal("tool.started"),
      messageId: Type.String({ minLength: 1 }),
      toolCallId: Type.String({ minLength: 1 }),
      toolName: Type.String({ minLength: 1 }),
      input: Type.Unknown(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...eventEnvelope,
      type: Type.Literal("tool.updated"),
      toolCallId: Type.String({ minLength: 1 }),
      message: Type.String(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...eventEnvelope,
      type: Type.Literal("tool.completed"),
      toolCallId: Type.String({ minLength: 1 }),
      result: Type.Unknown(),
      isError: Type.Boolean(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...eventEnvelope,
      type: Type.Literal("error"),
      code: Type.String({ minLength: 1 }),
      message: Type.String({ minLength: 1 }),
      requestId: Type.Optional(Type.String({ minLength: 1 })),
    },
    { additionalProperties: false },
  ),
]);

export type AgentEvent = Static<typeof agentEventSchema>;

export class ProtocolValidationError extends Error {
  constructor(kind: "request" | "response" | "event", input: unknown) {
    super(`Invalid agent protocol ${kind}`);
    this.name = "ProtocolValidationError";
    this.cause = input;
  }
}

export function parseAgentRequest(input: unknown): AgentRequest {
  if (!Value.Check(agentRequestSchema, input)) {
    throw new ProtocolValidationError("request", input);
  }
  return input;
}

export function parseAgentResponse(input: unknown): AgentResponse {
  if (!Value.Check(agentResponseSchema, input)) {
    throw new ProtocolValidationError("response", input);
  }
  return input;
}

export function parseAgentEvent(input: unknown): AgentEvent {
  if (!Value.Check(agentEventSchema, input)) {
    throw new ProtocolValidationError("event", input);
  }
  return input;
}

export function parseStoredProjects(input: unknown): StoredProject[] {
  const schema = Type.Array(storedProjectSchema);
  if (!Value.Check(schema, input)) {
    throw new ProtocolValidationError("response", input);
  }
  return input;
}

export function parseProviderStatuses(input: unknown): ProviderStatus[] {
  const schema = Type.Array(providerStatusSchema);
  if (!Value.Check(schema, input)) {
    throw new ProtocolValidationError("response", input);
  }
  return input;
}

export function parseProjectDomains(input: unknown): ProjectDomains {
  if (!Value.Check(projectDomainsSchema, input)) {
    throw new ProtocolValidationError("response", input);
  }
  return input;
}

export function parseProjectConfig(input: unknown): ProjectConfig {
  if (!Value.Check(projectConfigSchema, input)) {
    throw new ProtocolValidationError("response", input);
  }
  return input;
}

export function parseWorkspaceDirectoryListing(
  input: unknown,
): WorkspaceDirectoryListing {
  if (!Value.Check(workspaceDirectoryListingSchema, input)) {
    throw new ProtocolValidationError("response", input);
  }
  return input;
}

export function parseSessionCatalog(input: unknown): SessionCatalog {
  if (!Value.Check(sessionCatalogSchema, input)) {
    throw new ProtocolValidationError("response", input);
  }
  return input;
}

export function parseSessionTree(input: unknown): SessionTree {
  if (!Value.Check(sessionTreeSchema, input)) {
    throw new ProtocolValidationError("response", input);
  }
  return input;
}

export function parseSessionSnapshot(input: unknown): SessionSnapshot {
  if (!Value.Check(sessionSnapshotSchema, input)) {
    throw new ProtocolValidationError("response", input);
  }
  return input;
}

export function parseComposerCommands(input: unknown): ComposerCommand[] {
  const schema = Type.Array(composerCommandSchema);
  if (!Value.Check(schema, input)) {
    throw new ProtocolValidationError("response", input);
  }
  return input;
}

export function parseAgentModelCatalog(input: unknown): AgentModelCatalog {
  if (!Value.Check(agentModelCatalogSchema, input)) {
    throw new ProtocolValidationError("response", input);
  }
  return input;
}

export function parseExtensions(input: unknown): Extensions {
  if (!Value.Check(extensionsSchema, input)) {
    throw new ProtocolValidationError("response", input);
  }
  return input;
}

export function parseWebExtensionBundles(input: unknown): WebExtensionBundles {
  if (!Value.Check(webExtensionBundlesSchema, input)) {
    throw new ProtocolValidationError("response", input);
  }
  return input;
}

export function parseFileRevertResult(input: unknown): FileRevertResult {
  if (!Value.Check(fileRevertResultSchema, input)) {
    throw new ProtocolValidationError("response", input);
  }
  return input;
}

export function parseGitStatus(input: unknown): GitStatus {
  if (!Value.Check(gitStatusSchema, input)) {
    throw new ProtocolValidationError("response", input);
  }
  return input;
}

export function parseGitCommitResult(input: unknown): GitCommitResult {
  if (!Value.Check(gitCommitResultSchema, input)) {
    throw new ProtocolValidationError("response", input);
  }
  return input;
}

export function parseResourceCatalog(input: unknown): ResourceCatalog {
  if (!Value.Check(resourceCatalogSchema, input)) {
    throw new ProtocolValidationError("response", input);
  }
  return input;
}

export function parseToolPolicy(input: unknown): ToolPolicy {
  if (!Value.Check(toolPolicySchema, input)) {
    throw new ProtocolValidationError("response", input);
  }
  return input;
}
