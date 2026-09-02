<script lang="ts">
	import type { ToolCallView } from './types';

	interface Props {
		tool: ToolCallView;
		projectPath?: string;
		consoleEntries: unknown[];
		errors: unknown[];
	}

	let { tool }: Props = $props();

	interface ResultEntry {
		id?: string;
		title?: string;
		status?: string;
		output?: string;
	}

	interface ListEntry {
		id?: string;
		title?: string;
		status?: string;
		model?: string;
		elapsed?: string;
		cwd?: string;
	}

	let spawnId = $derived(stringValue(recordValue(tool.result, 'id')));
	let spawnTitle = $derived(stringValue(recordValue(tool.result, 'title')));
	let spawnModel = $derived(stringValue(recordValue(tool.result, 'model')));
	let spawnCwd = $derived(stringValue(recordValue(tool.result, 'cwd')));
	let waitResults = $derived(readEntries('results'));
	let listResults = $derived(readListEntries('subagents'));
	let checkId = $derived(stringValue(recordValue(tool.result, 'id')));
	let checkTitle = $derived(stringValue(recordValue(tool.result, 'title')));
	let checkStatus = $derived(stringValue(recordValue(tool.result, 'status')));
	let checkTurns = $derived(numberValue(recordValue(tool.result, 'turns')));
	let checkOutput = $derived(stringValue(recordValue(tool.result, 'output')));
	let checkError = $derived(stringValue(recordValue(tool.result, 'error')));

	function readEntries(key: string): ResultEntry[] {
		return readArray(tool.result, key).map((entry) => ({
			id: stringValue(recordValue(entry, 'id')),
			title: stringValue(recordValue(entry, 'title')),
			status: stringValue(recordValue(entry, 'status')),
			output: stringValue(recordValue(entry, 'output')),
		}));
	}

	function readListEntries(key: string): ListEntry[] {
		return readArray(tool.result, key).map((entry) => ({
			id: stringValue(recordValue(entry, 'id')),
			title: stringValue(recordValue(entry, 'title')),
			status: stringValue(recordValue(entry, 'status')),
			model: stringValue(recordValue(entry, 'model')),
			elapsed: stringValue(recordValue(entry, 'elapsed')),
			cwd: stringValue(recordValue(entry, 'cwd')),
		}));
	}

	function readArray(value: unknown, key: string): unknown[] {
		const candidate = recordValue(value, key);
		return Array.isArray(candidate) ? candidate : [];
	}

	function recordValue(value: unknown, key: string): unknown | undefined {
		if (!value || typeof value !== 'object') return;
		return (value as Record<string, unknown>)[key];
	}

	function stringValue(value: unknown): string | undefined {
		if (typeof value === 'string' || typeof value === 'number') {
			return String(value);
		}
		return undefined;
	}

	function numberValue(value: unknown): number | undefined {
		return typeof value === 'number' && Number.isFinite(value)
			? value
			: undefined;
	}
</script>

{#if tool.name === 'subagent_spawn'}
	<div data-ui="tool-metrics">
		<div><span>Subagent</span><strong>{spawnId ?? '…'}</strong></div>
		<div><span>Model</span><strong>{spawnModel ?? '—'}</strong></div>
	</div>
	{#if spawnTitle}
		<div data-ui="subagent-card">
			<strong>{spawnTitle}</strong>
			{#if spawnCwd}<span>{spawnCwd}</span>{/if}
		</div>
	{/if}
{:else if tool.name === 'subagent_wait' || tool.name === 'subagent_cancel'}
	{#if waitResults.length === 0}
		<p data-ui="tool-empty">No subagents matched.</p>
	{:else}
		<ul data-ui="subagent-results">
			{#each waitResults as entry, index (entry.id ?? index)}
				<li data-status={entry.status}>
					<div data-ui="subagent-result-head">
						<code>{entry.id}</code>
						<strong>{entry.title}</strong>
						<em>{entry.status ?? 'unknown'}</em>
					</div>
					{#if tool.name === 'subagent_wait' && entry.output}
						<pre>{entry.output}</pre>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
{:else if tool.name === 'subagent_check'}
	<div data-ui="tool-metrics">
		<div><span>Subagent</span><strong>{checkId ?? '—'}</strong></div>
		<div><span>Status</span><strong>{checkStatus ?? '—'}</strong></div>
		<div><span>Turns</span><strong>{checkTurns ?? '—'}</strong></div>
	</div>
	{#if checkTitle}
		<div data-ui="subagent-card"><strong>{checkTitle}</strong></div>
	{/if}
	{#if checkError}
		<p data-ui="subagent-fail">{checkError}</p>
	{/if}
	{#if checkOutput}
		<pre>{checkOutput}</pre>
	{/if}
{:else if tool.name === 'subagent_list'}
	{#if listResults.length === 0}
		<p data-ui="tool-empty">No subagents.</p>
	{:else}
		<ul data-ui="subagent-results">
			{#each listResults as entry, index (entry.id ?? index)}
				<li data-status={entry.status}>
					<div data-ui="subagent-result-head">
						<code>{entry.id}</code>
						<strong>{entry.title}</strong>
						<em>{entry.status ?? 'unknown'}</em>
					</div>
					<span data-ui="subagent-list-meta">
						{[
							entry.model,
							entry.elapsed,
							entry.cwd,
						]
							.filter(Boolean)
							.join(' · ')}
					</span>
				</li>
			{/each}
		</ul>
	{/if}
{:else}
	<pre>{JSON.stringify(tool.result, null, 2)}</pre>
{/if}

<style>
	[data-ui='subagent-card'] {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		padding: 0.45rem 0.6rem;
		border: 1px solid color-mix(in srgb, currentColor 12%, transparent);
		border-radius: 0.4rem;
		font-size: 0.82rem;
	}

	[data-ui='subagent-card'] span {
		font-size: 0.75rem;
		opacity: 0.65;
		overflow-wrap: anywhere;
	}

	[data-ui='subagent-results'] {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	[data-ui='subagent-results'] > li {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		padding: 0.45rem 0.6rem;
		border: 1px solid color-mix(in srgb, currentColor 12%, transparent);
		border-radius: 0.4rem;
		min-width: 0;
	}

	[data-ui='subagent-results'] > li[data-status='error'] {
		border-color: color-mix(in srgb, var(--color-danger, #d55) 45%, transparent);
	}

	[data-ui='subagent-result-head'] {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		min-width: 0;
	}

	[data-ui='subagent-result-head'] code {
		font-size: 0.75rem;
		opacity: 0.7;
		flex-shrink: 0;
	}

	[data-ui='subagent-result-head'] strong {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.82rem;
	}

	[data-ui='subagent-result-head'] em {
		font-style: normal;
		font-size: 0.75rem;
		opacity: 0.8;
		margin-left: auto;
		flex-shrink: 0;
	}

	li[data-status='done'] em {
		color: var(--color-success, var(--success, inherit));
	}

	li[data-status='error'] em {
		color: var(--color-danger, var(--danger, inherit));
	}

	li[data-status='running'] em {
		color: var(--color-warning, var(--warning, inherit));
	}

	[data-ui='subagent-list-meta'] {
		font-size: 0.75rem;
		opacity: 0.65;
		overflow-wrap: anywhere;
	}

	pre {
		margin: 0;
		padding: 0.5rem;
		border-radius: 0.35rem;
		background: color-mix(in srgb, currentColor 6%, transparent);
		font-size: 0.75rem;
		line-height: 1.4;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		max-height: 14rem;
		overflow-y: auto;
	}

	[data-ui='subagent-fail'] {
		margin: 0;
		color: var(--color-danger, var(--danger, inherit));
		font-size: 0.8rem;
	}

	[data-ui='tool-empty'] {
		opacity: 0.65;
	}
</style>
