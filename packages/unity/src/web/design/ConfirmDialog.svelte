<script lang="ts">
  import { Dialog } from "bits-ui";
  import Button from "./Button.svelte";

  let {
    open = $bindable(),
    title,
    description,
    confirmLabel,
    cancelLabel,
    onConfirm,
    onCancel,
  }: {
    open: boolean;
    title: string;
    description: string;
    confirmLabel: string;
    cancelLabel: string;
    onConfirm: () => void | Promise<void>;
    onCancel: () => void | Promise<void>;
  } = $props();

  let wasOpen = false;
  let confirming = false;

  $effect(() => {
    if (open) wasOpen = true;
    else if (wasOpen && !confirming) {
      wasOpen = false;
      void onCancel();
    }
  });

  async function confirm() {
    confirming = true;
    await onConfirm();
    wasOpen = false;
    open = false;
    confirming = false;
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Portal>
    <Dialog.Overlay />
    <Dialog.Content data-ui="dialog">
      <div data-ui="dialog-header">
        <div>
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description>{description}</Dialog.Description>
        </div>
      </div>
      <div data-ui="dialog-body">
        <div data-ui="dialog-actions">
          <Button variant="secondary" onclick={() => (open = false)}
            >{cancelLabel}</Button
          >
          <Button variant="primary" onclick={() => void confirm()}
            >{confirmLabel}</Button
          >
        </div>
      </div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
