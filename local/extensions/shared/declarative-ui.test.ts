import assert from "node:assert/strict";
import test from "node:test";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  createDeclarativeView,
  DECLARATIVE_UI_CAPABILITY,
  supportsDeclarativeUi,
} from "../../packages/pi-declarative-ui/src/index.ts";

function harness() {
  const widgets: Array<{ key: string; lines: string[] | undefined }> = [];
  const eventHandlers = new Map<string, Set<(value: unknown) => void>>();
  const lifecycleHandlers = new Map<
    string,
    Array<(event: unknown, context: ExtensionContext) => void>
  >();
  const pi = {
    events: {
      emit(channel: string, value: unknown) {
        for (const handler of eventHandlers.get(channel) ?? []) handler(value);
      },
      on(channel: string, handler: (value: unknown) => void) {
        const handlers = eventHandlers.get(channel) ?? new Set();
        handlers.add(handler);
        eventHandlers.set(channel, handlers);
        return () => handlers.delete(handler);
      },
    },
    on(
      channel: string,
      handler: (event: unknown, context: ExtensionContext) => void,
    ) {
      lifecycleHandlers.set(channel, [
        ...(lifecycleHandlers.get(channel) ?? []),
        handler,
      ]);
    },
  } as unknown as ExtensionAPI;
  const ctx = {
    mode: "rpc",
    ui: {
      setWidget(key: string, lines: string[] | undefined) {
        widgets.push({ key, lines });
      },
    },
  } as unknown as ExtensionContext;
  return { pi, ctx, widgets };
}

function decodeWidget(lines: string[] | undefined) {
  assert.ok(lines);
  return JSON.parse(Buffer.from(lines[1], "base64url").toString("utf8"));
}

test("capability detection requires RPC mode and the Forker capability", () => {
  const previous = process.env.FORKER_UI_PROTOCOL;
  process.env.FORKER_UI_PROTOCOL = DECLARATIVE_UI_CAPABILITY;
  const { ctx } = harness();
  assert.equal(supportsDeclarativeUi(ctx), true);
  assert.equal(
    supportsDeclarativeUi({ ...ctx, mode: "tui" } as ExtensionContext),
    false,
  );
  if (previous === undefined) delete process.env.FORKER_UI_PROTOCOL;
  else process.env.FORKER_UI_PROTOCOL = previous;
});

test("publishes versioned views and routes validated actions", async () => {
  const { pi, ctx, widgets } = harness();
  const view = createDeclarativeView(pi, ctx, {
    extensionId: "example.tasks",
    viewId: "dashboard",
  });
  let selected = "";
  view.onAction("inspect", ({ selection }) => {
    selected = selection?.itemId ?? "";
  });
  view.update({
    title: "Tasks",
    blocks: [
      {
        type: "list",
        id: "tasks",
        items: [{ id: "task-1", label: "Task one" }],
      },
    ],
    actions: [
      {
        id: "inspect",
        label: "Inspect",
        selection: { blockId: "tasks", required: true },
      },
    ],
  });

  assert.equal(widgets.length, 1);
  const descriptor = decodeWidget(widgets[0].lines);
  assert.equal(descriptor.revision, 1);
  assert.equal(descriptor.actionRevision, 1);

  const response = {
    protocol: "pi.declarative-ui" as const,
    version: 1 as const,
    requestId: "request-1",
    extensionId: descriptor.extensionId,
    viewId: descriptor.viewId,
    revision: descriptor.revision,
    actionRevision: descriptor.actionRevision,
    token: descriptor.token,
    actionId: "inspect",
    selection: { blockId: "tasks", itemId: "task-1" },
  };
  const acknowledgement = await new Promise<unknown>((resolve) => {
    pi.events.emit("pi-ui:action", { response, respond: resolve });
  });
  assert.equal(selected, "task-1");
  assert.deepEqual(acknowledgement, {
    protocol: "pi.declarative-ui",
    version: 1,
    requestId: "request-1",
    status: "succeeded",
  });

  view.close();
  assert.equal(widgets.at(-1)?.lines?.[0], "PI_DECLARATIVE_UI_CLOSE_V1");
});
