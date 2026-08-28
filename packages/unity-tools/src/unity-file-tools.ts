import {
  createEditToolDefinition,
  createWriteToolDefinition,
  defineTool,
} from "@earendil-works/pi-coding-agent";
import {
  affectsUnityCompilation,
  UnityCompilationTracker,
} from "./unity-compilation-tracker";

export function createUnityTrackedFileTools(
  cwd: string,
  tracker: UnityCompilationTracker,
) {
  const edit = createEditToolDefinition(cwd);
  const write = createWriteToolDefinition(cwd);
  return [
    defineTool({
      name: edit.name,
      label: edit.label,
      description: edit.description,
      promptSnippet: edit.promptSnippet,
      promptGuidelines: edit.promptGuidelines,
      parameters: edit.parameters,
      async execute(toolCallId, params, signal, onUpdate, context) {
        const result = await edit.execute(
          toolCallId,
          params,
          signal,
          onUpdate,
          context,
        );
        if (!affectsUnityCompilation(params.path)) return result;
        return {
          ...result,
          details: {
            ...result.details,
            compilationPending: true,
            compilationPaths: tracker.mark(params.path),
          },
        };
      },
    }),
    defineTool({
      name: write.name,
      label: write.label,
      description: write.description,
      promptSnippet: write.promptSnippet,
      promptGuidelines: write.promptGuidelines,
      parameters: write.parameters,
      async execute(toolCallId, params, signal, onUpdate, context) {
        const result = await write.execute(
          toolCallId,
          params,
          signal,
          onUpdate,
          context,
        );
        if (!affectsUnityCompilation(params.path)) return result;
        return {
          ...result,
          details: {
            compilationPending: true,
            compilationPaths: tracker.mark(params.path),
          },
        };
      },
    }),
  ];
}
