<script lang="ts">
  import type { PendingConfirmation, UnityHost, UnitySettings } from "../host";
  import ConfirmDialog from "../design/ConfirmDialog.svelte";

  interface Props {
    store: UnityHost;
    settings: UnitySettings;
  }

  let { store, settings }: Props = $props();
  let open = $state(false);
  let active = $state<PendingConfirmation>();
  let compilePlayModePolicy = $derived(
    parseCompilePolicy(settings.get("compilePlayModePolicy")),
  );
  const handled = new Set<string>();

  $effect(() => {
    const confirmation = store.pendingConfirmations[0];
    if (
      !confirmation ||
      confirmation.confirmationId === active?.confirmationId ||
      handled.has(confirmation.confirmationId)
    )
      return;
    active = confirmation;
    if (compilePlayModePolicy === "ask") open = true;
    else void answer(compilePlayModePolicy === "stop", false);
  });

  async function answer(accepted: boolean, remember = true) {
    const confirmation = active;
    if (!confirmation) return;
    handled.add(confirmation.confirmationId);
    if (remember) {
      settings.set("compilePlayModePolicy", accepted ? "stop" : "keep_playing");
    }
    active = undefined;
    open = false;
    await store.resolveConfirmation(confirmation, accepted);
  }

  function parseCompilePolicy(value: unknown) {
    return value === "stop" || value === "keep_playing" ? value : "ask";
  }
</script>

<ConfirmDialog
  bind:open
  title="Stop Play Mode to compile?"
  description="Unity must leave Play Mode before the agent can compile scripts."
  confirmLabel="Stop and compile"
  cancelLabel="Keep playing"
  onConfirm={() => answer(true)}
  onCancel={() => answer(false)}
/>
