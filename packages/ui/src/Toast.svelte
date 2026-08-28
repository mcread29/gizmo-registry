<script lang="ts">
	import {
		CheckCircle2,
		CircleAlert,
		Info,
		TriangleAlert,
		X,
	} from '@lucide/svelte';
	import type { ToastQueue } from './toasts.svelte';
	import Button from './Button.svelte';

	let { queue }: { queue: ToastQueue } = $props();
</script>

<!--
	The region stays mounted whether or not it holds anything: screen readers
	announce nodes added to a live region they are already observing, and miss
	regions that appear alongside their content.
-->
<div data-ui="toast-region" aria-live="polite" aria-atomic="false">
	{#each queue.items as toast (toast.id)}
		<div
			data-ui="toast"
			data-tone={toast.tone}
			role={toast.tone === 'danger' ? 'alert' : 'status'}
		>
			<span data-ui="toast-icon">
				{#if toast.tone === 'success'}
					<CheckCircle2 size={18} />
				{:else if toast.tone === 'info'}
					<Info size={18} />
				{:else if toast.tone === 'warning'}
					<TriangleAlert size={18} />
				{:else}
					<CircleAlert size={18} />
				{/if}
			</span>
			<span>{toast.message}</span>
			<Button
				variant="ghost"
				size="icon"
				aria-label="Dismiss notification"
				onclick={() => queue.dismiss(toast.id)}
			>
				<X size={15} />
			</Button>
		</div>
	{/each}
</div>
