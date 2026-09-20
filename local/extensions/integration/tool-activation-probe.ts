import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function toolActivationProbe(pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "rpc") return;
    ctx.ui.setWidget("pi-tool-activation-probe", [
      "PI_TOOL_ACTIVATION_PROBE_V1",
      JSON.stringify({
        active: pi.getActiveTools(),
        available: pi.getAllTools().map((tool) => tool.name),
      }),
    ]);
  });
}
