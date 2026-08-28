<script lang="ts">
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
		onConfirm: () => void;
		onCancel: () => void;
	} = $props();
</script>

{#if open}<div role="dialog" aria-modal="true">
		<h2>{title}</h2>
		<p>{description}</p>
		<button data-ui="button" onclick={onConfirm}>{confirmLabel}</button><button
			data-ui="button"
			onclick={onCancel}>{cancelLabel}</button
		>
	</div>{/if}
