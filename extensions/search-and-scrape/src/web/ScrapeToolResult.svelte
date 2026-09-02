<script lang="ts">
	interface ToolCallView {
		input?: unknown;
		result?: unknown;
		status?: string;
		statusText?: string;
	}

	interface Props {
		tool: ToolCallView;
		projectPath?: string;
		consoleEntries: unknown[];
		errors: unknown[];
	}

	let { tool }: Props = $props();

	let url = $derived(stringValue(recordValue(tool.input, 'url')));
	let failed = $derived(recordValue(tool.result, 'error') !== undefined);
	let error = $derived(stringValue(recordValue(tool.result, 'error')));
	let preview = $derived(stringValue(recordValue(tool.result, 'markdown_preview')));
	let length = $derived(numberValue(recordValue(tool.result, 'markdown_length')));
	let outputPath = $derived(
		stringValue(recordValue(tool.result, 'full_output_path')),
	);
	let expanded = $state(false);

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

{#if failed}
	<p data-ui="tool-empty" data-error>{error ?? 'Scrape failed.'}</p>
{:else}
	<div data-ui="scrape-result">
		<div data-ui="scrape-meta">
			<a href={url} target="_blank" rel="noreferrer">{url}</a>
			<span>
				{length === undefined
					? tool.statusText
					: `${length.toLocaleString()} chars`}
				{outputPath ? ' · truncated — full page saved to file' : ''}
			</span>
		</div>
		{#if preview}
			<pre
				data-expanded={expanded || undefined}>{expanded
					? preview
					: preview.slice(0, 2_000)}</pre>
			{#if preview.length > 2_000 || expanded}
				<button
					type="button"
					data-ui="scrape-toggle"
					onclick={() => (expanded = !expanded)}
				>
					{expanded ? 'Show less' : 'Show more'}
				</button>
			{/if}
		{:else if tool.status === 'running'}
			<p data-ui="tool-empty">Fetching the page…</p>
		{/if}
	</div>
{/if}

<style>
	[data-ui='scrape-result'] {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		min-width: 0;
	}

	[data-ui='scrape-meta'] {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}

	[data-ui='scrape-meta'] a {
		color: var(--color-accent, var(--accent, inherit));
		text-decoration: none;
		overflow-wrap: anywhere;
	}

	[data-ui='scrape-meta'] a:hover {
		text-decoration: underline;
	}

	[data-ui='scrape-meta'] span {
		font-size: 0.78rem;
		opacity: 0.65;
	}

	pre {
		margin: 0;
		padding: 0.6rem;
		border-radius: 0.4rem;
		background: color-mix(in srgb, currentColor 6%, transparent);
		font-size: 0.8rem;
		line-height: 1.45;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		max-height: 16rem;
		overflow-y: auto;
	}

	pre[data-expanded] {
		max-height: none;
	}

	[data-ui='scrape-toggle'] {
		align-self: flex-start;
		border: none;
		background: none;
		color: var(--color-accent, var(--accent, inherit));
		cursor: pointer;
		font-size: 0.78rem;
		padding: 0;
	}

	[data-ui='tool-empty'][data-error] {
		color: var(--color-danger, var(--danger, inherit));
	}
</style>
