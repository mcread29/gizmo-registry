<script lang="ts">
  import type { UnityHost } from "../host";
  import EditorPanel from "./EditorPanel.svelte";
  import type { UnityView } from "./unity-view";
  import "./unity.css";

  let {
    view,
    store,
    onOpenProject,
  }: {
    view: UnityView;
    store: UnityHost;
    onOpenProject: () => void;
  } = $props();
</script>

<div data-ui="unity-status-panel">
  <EditorPanel {view} {store} {onOpenProject} />
</div>
