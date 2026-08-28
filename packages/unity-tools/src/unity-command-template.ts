export interface UnityCommandTemplateOptions {
  command: string;
  description: string;
  namespace?: string;
  className?: string;
}

export interface UnityCommandTemplate {
  command: string;
  suggestedPath: string;
  source: string;
}

export function unityCommandTemplate(
  options: UnityCommandTemplateOptions,
): UnityCommandTemplate {
  const className = options.className ?? commandClassName(options.command);
  const namespace = options.namespace ?? "Gizmo.Commands";
  const command = csharpString(options.command);
  const description = csharpString(options.description);
  return {
    command: options.command,
    suggestedPath: `Assets/Editor/Gizmo/${className}.cs`,
    source: `using Unity.Pipeline.Commands;

namespace ${namespace}
{
    public static class ${className}
    {
        [CliCommand("${command}", "${description}")]
        public static CommandResult Execute(
            [CliArg("dry_run", "Validate without changing project state.")] bool dryRun = false)
        {
            return new CommandResult
            {
                status = dryRun ? "validated" : "completed",
                dryRun = dryRun,
                message = "Replace this starter implementation with project-specific behavior."
            };
        }

        public sealed class CommandResult
        {
            public string status;
            public bool dryRun;
            public string message;
        }
    }
}
`,
  };
}

function commandClassName(command: string): string {
  const name = command
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part[0]!.toUpperCase()}${part.slice(1)}`)
    .join("");
  return `${name || "Unity"}Command`;
}

function csharpString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
