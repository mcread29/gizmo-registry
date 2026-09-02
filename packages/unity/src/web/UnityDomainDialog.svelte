<script lang="ts">
  import CompileConfirmationDialog from "./unity/CompileConfirmationDialog.svelte";
  import type { UnityHost, UnitySettings } from "./host";
  let { store, settings }: { store: UnityHost; settings: UnitySettings } =
    $props();
</script>

<CompileConfirmationDialog {store} {settings} />
