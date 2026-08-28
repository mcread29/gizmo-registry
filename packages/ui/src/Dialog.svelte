<script lang="ts">
	import { X } from '@lucide/svelte';
	import { Dialog } from 'bits-ui';
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import Button from './Button.svelte';

	let {
		open = $bindable(false),
		title,
		description,
		trigger,
		children,
		size = 'md',
	}: {
		open?: boolean;
		title: string;
		description?: string;
		trigger?: Snippet<[HTMLButtonAttributes]>;
		children: Snippet;
		size?: 'md' | 'lg';
	} = $props();
</script>

<Dialog.Root bind:open>
	{#if trigger}
		<Dialog.Trigger>
			{#snippet child({ props })}{@render trigger(props)}{/snippet}
		</Dialog.Trigger>
	{/if}
	<Dialog.Portal>
		<Dialog.Overlay />
		<Dialog.Content data-ui="dialog" data-size={size}>
			<div data-ui="dialog-header">
				<div>
					<Dialog.Title>{title}</Dialog.Title>
					{#if description}<Dialog.Description>{description}</Dialog.Description
						>{/if}
				</div>
				<Dialog.Close>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="ghost"
							size="icon"
							aria-label="Close dialog"><X size={17} /></Button
						>
					{/snippet}
				</Dialog.Close>
			</div>
			<div data-ui="dialog-body">{@render children()}</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
