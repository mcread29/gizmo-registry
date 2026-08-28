<script lang="ts">
	import {
		createVirtualizer,
		observeElementRect,
	} from '@tanstack/svelte-virtual';
	import { CircleCheck, CircleDashed, CircleX, Terminal } from '@lucide/svelte';
	import { get } from 'svelte/store';
	import type { ToolCallView } from '@gizmo/protocol';

	let { view }: { view: { toolActivity: ToolCallView[] } } = $props();
	let viewport = $state<HTMLDivElement | null>(null);
	let keys: Array<string | number> = [];
	let tools = $derived(view.toolActivity);
	const initialViewport = { width: 240, height: 640 };
	const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
		count: 0,
		getScrollElement: () => viewport,
		getItemKey: (index) => keys[index] ?? index,
		estimateSize: () => 40,
		overscan: 5,
		initialRect: initialViewport,
		observeElementRect: (instance, notify) =>
			observeElementRect(instance, (rect) =>
				notify(rect.height > 0 ? rect : initialViewport),
			),
	});
	let virtualItems = $derived($virtualizer.getVirtualItems());

	$effect(() => {
		keys = tools.map((tool) => tool.id);
		get(virtualizer).setOptions({
			count: tools.length,
			getItemKey: (index) => keys[index] ?? index,
		});
	});

	$effect(() => {
		const node = viewport;
		get(virtualizer).setOptions({ getScrollElement: () => node });
	});

	function toolSummary(input: unknown): string | undefined {
		return typeof input === 'string' ? input : undefined;
	}
</script>

{#if tools.length === 0}
	<div data-ui="empty-state">
		<CircleCheck size={22} /><strong>All caught up</strong><span
			>Tool activity will appear here.</span
		>
	</div>
{:else}
	<div data-ui="activity-viewport" bind:this={viewport}>
		<div
			data-ui="activity-list"
			style={`height:${$virtualizer.getTotalSize()}px`}
		>
			{#each virtualItems as row (row.key)}
				{@const tool = tools[row.index]!}
				{@const summary = toolSummary(tool.input) ?? tool.statusText}
				<div
					data-ui="activity-row"
					style={`height:${row.size}px;transform:translateY(${row.start}px)`}
				>
					<div data-ui="activity-item" data-state={tool.status}>
						<Terminal size={13} />
						<span>
							<strong>{tool.name.replaceAll('_', ' ')}</strong>
							<small title={summary}>{summary}</small>
						</span>
						{#if tool.status === 'running'}
							<CircleDashed data-ui="spinner" size={13} />
						{:else if tool.status === 'error'}
							<CircleX size={13} />
						{:else}
							<CircleCheck size={13} />
						{/if}
					</div>
				</div>
			{/each}
		</div>
	</div>
{/if}
