import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { registerUnityDocs } from "../../packages/unity/src/server/docs/index.ts";
import { gizmoExtension } from "../../packages/unity/src/server/index.ts";
import { stopPlayModeConfirmation } from "../../packages/unity/src/server/domain/unity-domain.ts";

export { gizmoExtension };


export default function unity(pi: ExtensionAPI) {
  registerUnityDocs(pi);

  let currentContext: ExtensionContext | undefined;

  pi.on("tool_call", (_event, ctx) => {
    currentContext = ctx;
  });

  // In a plain Pi session the confirmation goes through Pi's own UI;
  // under Gizmo the host supplies `confirm` and this is never used.
  const confirm: NonNullable<
    Parameters<NonNullable<typeof gizmoExtension.createTools>>[0]["confirm"]
  > = async (kind, options) => {
    if (kind !== stopPlayModeConfirmation || !currentContext?.hasUI) {
      return false;
    }
    return currentContext.ui.confirm(
      options?.title ?? "Stop Unity Play Mode?",
      options?.message ??
        "Unity must leave Play Mode before scripts can compile.",
      { signal: currentContext.signal },
    );
  };

  // One tool set per workspace, built on first use there.
  //
  // These tools bake their workspace in: the Unity CLI is passed
  // `--project-path`, and the edit/write pair resolves relative paths against
  // it. Building them once against `process.cwd()` -- the directory the agent
  // server happens to have been started in -- pointed every one of them at
  // that directory instead of the project the thread is open on, so the Unity
  // tools and the shell tools reached two different workspaces and relative
  // writes landed in the server's own directory. The docs tools never had this
  // problem because they take `ctx.cwd` per call; this makes the rest agree
  // with them.
  const byWorkspace = new Map<string, ToolDefinition[]>();
  const toolsFor = (cwd: string) => {
    const existing = byWorkspace.get(cwd);
    if (existing) return existing;
    const created =
      gizmoExtension.createTools?.({ workspacePath: cwd, confirm }) ?? [];
    byWorkspace.set(cwd, created);
    return created;
  };

  // Registration still needs concrete definitions, but only their names,
  // descriptions and schemas are read at that point -- none of which depend on
  // the workspace. Execution is what gets routed.
  for (const template of toolsFor(process.cwd())) {
    pi.registerTool({
      ...template,
      execute(toolCallId, params, signal, onUpdate, context) {
        const tool =
          toolsFor(context.cwd).find((each) => each.name === template.name) ??
          template;
        return tool.execute(toolCallId, params, signal, onUpdate, context);
      },
    });
  }

  pi.on("before_agent_start", (event) => {
    const prompt = gizmoExtension.systemPrompt;
    if (!prompt || event.systemPrompt.includes(prompt)) return;
    return { systemPrompt: `${event.systemPrompt}\n\n${prompt}` };
  });
}
