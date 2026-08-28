<script lang="ts">
	import { Button } from 'bits-ui';
	import type { Snippet } from 'svelte';

	let {
		children,
		variant = 'secondary',
		size = 'md',
		...rest
	}: Button.RootProps & {
		children?: Snippet;
		variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
		size?: 'sm' | 'md' | 'icon';
	} = $props();
</script>

<Button.Root {...rest} data-ui="button" data-variant={variant} data-size={size}>
	{@render children?.()}
</Button.Root>
