import { randomUUID } from "node:crypto";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

export const DECLARATIVE_UI_PROTOCOL = "pi.declarative-ui" as const;
export const DECLARATIVE_UI_VERSION = 1 as const;
export const DECLARATIVE_UI_CAPABILITY = "pi.declarative-ui.v1";

export type DeclarativeTone =
  "default" | "muted" | "info" | "success" | "warning" | "error";

export type DeclarativeBlock =
  | { type: "text"; text: string; tone?: DeclarativeTone }
  | { type: "markdown"; markdown: string }
  | {
      type: "keyValue";
      entries: Array<{ label: string; value: string; tone?: DeclarativeTone }>;
    }
  | {
      type: "list";
      id: string;
      items: Array<{
        id: string;
        label: string;
        detail?: string;
        path?: string;
        tone?: DeclarativeTone;
        disabled?: boolean;
      }>;
      selectedId?: string;
    }
  | {
      type: "table";
      id: string;
      columns: Array<{
        id: string;
        label: string;
        align?: "start" | "center" | "end";
      }>;
      rows: Array<{
        id: string;
        cells: Record<string, string>;
        path?: string;
        tone?: DeclarativeTone;
        disabled?: boolean;
      }>;
      selectedId?: string;
    }
  | {
      type: "progress";
      value: number;
      max: number;
      label?: string;
      tone?: DeclarativeTone;
    }
  | {
      type: "log";
      id?: string;
      lines: Array<{
        text: string;
        tone?: DeclarativeTone;
        timestamp?: number;
      }>;
      truncated?: boolean;
    }
  | { type: "code"; code: string; language?: string; label?: string }
  | { type: "divider" };

export type DeclarativeActionInput =
  | {
      kind: "text" | "multiline";
      label: string;
      placeholder?: string;
      initialValue?: string;
      required?: boolean;
    }
  | {
      kind: "select";
      label: string;
      required?: boolean;
      options: Array<{ value: string; label: string }>;
    };

export type DeclarativeIntentTarget =
  { kind: "path"; path: string } | { kind: "selection"; blockId: string };

export type DeclarativeHostIntent =
  | {
      kind: "openRepositoryFile";
      target: DeclarativeIntentTarget;
      line?: number;
      column?: number;
    }
  | { kind: "openRepositoryDiff"; target: DeclarativeIntentTarget };

export interface DeclarativeAction {
  id: string;
  label: string;
  tone?: "default" | "primary" | "danger";
  disabled?: boolean;
  selection?: { blockId: string; required?: boolean };
  confirm?: { title: string; message: string };
  input?: DeclarativeActionInput;
  intent?: DeclarativeHostIntent;
}

export interface DeclarativeViewUpdate {
  title: string;
  presentation?: "panel" | "modal" | "overlay";
  status?: "idle" | "running" | "success" | "warning" | "error";
  blocks: DeclarativeBlock[];
  actions?: DeclarativeAction[];
}

export interface DeclarativeActionResponse {
  protocol: typeof DECLARATIVE_UI_PROTOCOL;
  version: typeof DECLARATIVE_UI_VERSION;
  requestId: string;
  extensionId: string;
  viewId: string;
  revision: number;
  actionRevision: number;
  token: string;
  actionId: string;
  selection?: { blockId: string; itemId: string };
  value?: string;
  cancelled?: boolean;
}

export interface DeclarativeActionEvent {
  selection?: { blockId: string; itemId: string };
  value?: string;
  cancelled: boolean;
}

type Acknowledgement = {
  protocol: typeof DECLARATIVE_UI_PROTOCOL;
  version: typeof DECLARATIVE_UI_VERSION;
  requestId: string;
  status: "succeeded" | "rejected" | "failed";
  reason?: "stale" | "invalid" | "not-found" | "timeout" | "handler-error";
  message?: string;
};

type Dispatch = {
  response: DeclarativeActionResponse;
  respond: (acknowledgement: Acknowledgement) => void;
};

type Handler = (event: DeclarativeActionEvent) => void | Promise<void>;

const VIEW_MARKER = "PI_DECLARATIVE_UI_V1";
const CLOSE_MARKER = "PI_DECLARATIVE_UI_CLOSE_V1";
const MAX_DECODED_BYTES = 48 * 1024;
const UPDATE_INTERVAL_MS = 250;
const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/;

export function supportsDeclarativeUi(ctx: ExtensionContext) {
  return (
    ctx.mode === "rpc" &&
    process.env.FORKER_UI_PROTOCOL?.split(",").includes(
      DECLARATIVE_UI_CAPABILITY,
    ) === true
  );
}

function assertIdentifier(value: string, label: string) {
  if (!IDENTIFIER.test(value))
    throw new Error(`${label} is not a valid declarative UI identifier`);
}

function encode(value: unknown) {
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json, "utf8") > MAX_DECODED_BYTES) {
    throw new Error("Declarative UI payload exceeds 48 KiB");
  }
  return Buffer.from(json, "utf8").toString("base64url");
}

function actionSignature(actions: DeclarativeAction[]) {
  return JSON.stringify(actions);
}

function isDispatch(value: unknown): value is Dispatch {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Dispatch>;
  return (
    typeof candidate.respond === "function" &&
    !!candidate.response &&
    candidate.response.protocol === DECLARATIVE_UI_PROTOCOL &&
    candidate.response.version === DECLARATIVE_UI_VERSION
  );
}

function acknowledgement(
  response: DeclarativeActionResponse,
  status: Acknowledgement["status"],
  reason?: Acknowledgement["reason"],
  message?: string,
): Acknowledgement {
  return {
    protocol: DECLARATIVE_UI_PROTOCOL,
    version: DECLARATIVE_UI_VERSION,
    requestId: response.requestId,
    status,
    ...(reason ? { reason } : {}),
    ...(message ? { message } : {}),
  };
}

export function createDeclarativeView(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  options: {
    extensionId: string;
    viewId: string;
    presentation?: "panel" | "modal" | "overlay";
  },
) {
  assertIdentifier(options.extensionId, "extensionId");
  assertIdentifier(options.viewId, "viewId");

  const widgetKey = `pi-ui:${options.extensionId}:${options.viewId}`;
  const token = randomUUID();
  const handlers = new Map<string, Handler>();
  let revision = 0;
  let actionRevision = 0;
  let latestActionsSignature = "";
  let current:
    | (DeclarativeViewUpdate & {
        protocol: typeof DECLARATIVE_UI_PROTOCOL;
        version: typeof DECLARATIVE_UI_VERSION;
        extensionId: string;
        viewId: string;
        revision: number;
        actionRevision: number;
        token: string;
        presentation: "panel" | "modal" | "overlay";
        actions: DeclarativeAction[];
      })
    | undefined;
  let queued: DeclarativeViewUpdate | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastPublishedAt = 0;
  let closed = false;

  function publish(update: DeclarativeViewUpdate) {
    if (closed) return;
    const actions = update.actions ?? [];
    const signature = actionSignature(actions);
    revision += 1;
    if (signature !== latestActionsSignature) {
      actionRevision += 1;
      latestActionsSignature = signature;
    }
    current = {
      protocol: DECLARATIVE_UI_PROTOCOL,
      version: DECLARATIVE_UI_VERSION,
      extensionId: options.extensionId,
      viewId: options.viewId,
      revision,
      actionRevision: Math.max(actionRevision, 1),
      token,
      title: update.title,
      presentation: update.presentation ?? options.presentation ?? "panel",
      ...(update.status ? { status: update.status } : {}),
      blocks: update.blocks,
      actions,
    };
    const payload = encode(current);
    ctx.ui.setWidget(widgetKey, [VIEW_MARKER, payload]);
    lastPublishedAt = Date.now();
  }

  function schedule(update: DeclarativeViewUpdate) {
    if (closed) return;
    queued = update;
    const remaining = UPDATE_INTERVAL_MS - (Date.now() - lastPublishedAt);
    if (remaining <= 0 && !timer) {
      const next = queued;
      queued = undefined;
      publish(next);
      return;
    }
    if (timer) return;
    timer = setTimeout(
      () => {
        timer = undefined;
        const next = queued;
        queued = undefined;
        if (next) publish(next);
      },
      Math.max(remaining, 0),
    );
  }

  const unsubscribe = pi.events.on("pi-ui:action", (value) => {
    if (!isDispatch(value)) return;
    const { response, respond } = value;
    if (
      response.extensionId !== options.extensionId ||
      response.viewId !== options.viewId
    )
      return;
    if (!current || closed) {
      respond(
        acknowledgement(
          response,
          "rejected",
          "not-found",
          "The view is closed.",
        ),
      );
      return;
    }
    if (
      response.token !== token ||
      response.actionRevision !== current.actionRevision
    ) {
      respond(
        acknowledgement(
          response,
          "rejected",
          "stale",
          "The view changed before the action arrived.",
        ),
      );
      return;
    }
    const action = current.actions.find(
      (candidate) => candidate.id === response.actionId,
    );
    const handler = handlers.get(response.actionId);
    if (!action || action.disabled || action.intent || !handler) {
      respond(
        acknowledgement(
          response,
          "rejected",
          "not-found",
          "The action is unavailable.",
        ),
      );
      return;
    }
    if (action.selection) {
      if (!response.selection) {
        if (action.selection.required) {
          respond(
            acknowledgement(
              response,
              "rejected",
              "invalid",
              "This action requires a selection.",
            ),
          );
          return;
        }
      } else {
        if (response.selection.blockId !== action.selection.blockId) {
          respond(
            acknowledgement(
              response,
              "rejected",
              "invalid",
              "The selection does not match this action.",
            ),
          );
          return;
        }
        const block = current.blocks.find(
          (candidate) =>
            "id" in candidate && candidate.id === action.selection?.blockId,
        );
        const items =
          block?.type === "list"
            ? block.items
            : block?.type === "table"
              ? block.rows
              : [];
        if (
          !items.some(
            (item) => item.id === response.selection?.itemId && !item.disabled,
          )
        ) {
          respond(
            acknowledgement(
              response,
              "rejected",
              "invalid",
              "The selected item is unavailable.",
            ),
          );
          return;
        }
      }
    }
    if (
      action.input?.required &&
      !response.cancelled &&
      !response.value?.trim()
    ) {
      respond(
        acknowledgement(
          response,
          "rejected",
          "invalid",
          "A value is required.",
        ),
      );
      return;
    }
    if (
      action.input?.kind === "select" &&
      response.value !== undefined &&
      !action.input.options.some((option) => option.value === response.value)
    ) {
      respond(
        acknowledgement(
          response,
          "rejected",
          "invalid",
          "The selected value is unavailable.",
        ),
      );
      return;
    }

    Promise.resolve(
      handler({
        ...(response.selection ? { selection: response.selection } : {}),
        ...(response.value !== undefined ? { value: response.value } : {}),
        cancelled: response.cancelled === true,
      }),
    ).then(
      () => respond(acknowledgement(response, "succeeded")),
      (error: unknown) =>
        respond(
          acknowledgement(
            response,
            "failed",
            "handler-error",
            error instanceof Error ? error.message : String(error),
          ),
        ),
    );
  });

  function close() {
    if (closed) return;
    closed = true;
    if (timer) clearTimeout(timer);
    timer = undefined;
    queued = undefined;
    unsubscribe();
    ctx.ui.setWidget(widgetKey, [
      CLOSE_MARKER,
      encode({
        protocol: DECLARATIVE_UI_PROTOCOL,
        version: DECLARATIVE_UI_VERSION,
        extensionId: options.extensionId,
        viewId: options.viewId,
        token,
        revision: Math.max(revision + 1, 1),
      }),
    ]);
  }

  pi.on("session_shutdown", close);

  return {
    update: schedule,
    onAction(actionId: string, handler: Handler) {
      assertIdentifier(actionId, "actionId");
      handlers.set(actionId, handler);
      return () => handlers.delete(actionId);
    },
    close,
  };
}
