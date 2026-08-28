<script lang="ts">
	let {
		children,
		...props
	}: { children?: import('svelte').Snippet; [key: string]: unknown } = $props();
</script>

<button data-ui="button" {...props}>{@render children?.()}</button>
