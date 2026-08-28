import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  GitService,
  gizmoExtension,
} from "../../packages/git/src/server/index";

export { gizmoExtension };

const service = new GitService();

/** Registers Git's status tool for normal Pi sessions. */
export default function git(pi: ExtensionAPI) {
  const tool = service.createStatusTool(process.cwd());

  pi.registerTool({
    ...tool,
    async execute(toolCallId, params, signal, _onUpdate, context) {
      return service
        .createStatusTool(context.cwd)
        .execute(toolCallId, params, signal, _onUpdate, context);
    },
  });
}
