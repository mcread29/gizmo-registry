<script lang="ts">
	import { Tooltip } from 'bits-ui';
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	let {
		text,
		children,
	}: { text: string; children: Snippet<[HTMLButtonAttributes]> } = $props();
</script>

<!--
	No provider here on purpose: the app mounts a single Tooltip.Provider so that
	moving between neighbouring controls skips the open delay instead of
	restarting it for every button.
-->
<Tooltip.Root>
	<Tooltip.Trigger>
		{#snippet child({ props })}{@render children(props)}{/snippet}
	</Tooltip.Trigger>
	<Tooltip.Portal>
		<Tooltip.Content data-ui="tooltip" sideOffset={6}>{text}</Tooltip.Content>
	</Tooltip.Portal>
</Tooltip.Root>
