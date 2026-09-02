<script lang="ts">
  import type { UnitySettings } from "./host";
  import SelectField from "./design/SelectField.svelte";
  let { settings }: { settings: UnitySettings } = $props();
  let compilePlayModePolicy = $derived(
    parseCompilePolicy(settings.get("compilePlayModePolicy")),
  );

  function parseCompilePolicy(value: unknown) {
    return value === "stop" || value === "keep_playing" ? value : "ask";
  }
</script>

<div data-ui="settings-card">
  <div data-ui="setting-field">
    <div>
      <strong>Unity compilation</strong>
      <span
        >What happens when an agent needs to compile while the Editor is in Play
        Mode.</span
      >
    </div>
    <SelectField
      value={compilePlayModePolicy}
      label="When Play Mode is active"
      options={[
        { value: "ask", label: "Ask" },
        { value: "stop", label: "Stop Play Mode" },
        { value: "keep_playing", label: "Keep playing" },
      ]}
      onValueChange={(value) =>
        settings.set("compilePlayModePolicy", parseCompilePolicy(value))}
    />
  </div>
</div>
