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

	interface SearchHit {
		title?: string;
		url?: string;
		content?: string;
	}

	let query = $derived(stringValue(recordValue(tool.input, 'query')));
	let results = $derived(
		readArray(tool.result, 'results').filter(
			(hit): hit is SearchHit =>
				!!hit &&
				typeof hit === 'object' &&
				(typeof recordValue(hit, 'url') === 'string' ||
					typeof recordValue(hit, 'title') === 'string'),
		),
	);
	let failed = $derived(recordValue(tool.result, 'error') !== undefined);
	let error = $derived(stringValue(recordValue(tool.result, 'error')));
	let count = $derived(
		numberValue(recordValue(tool.result, 'number_of_results')) ??
			results.length,
	);
	let baseUrl = $derived(stringValue(recordValue(tool.result, 'searxng_url')));

	function hostname(url: string | undefined): string {
		if (!url) return '';
		try {
			return new URL(url).hostname;
		} catch {
			return url;
		}
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

{#if failed}
	<p data-ui="tool-empty" data-error>{error ?? 'Search failed.'}</p>
{:else if results.length === 0}
	<p data-ui="tool-empty">
		No results{query ? ` for “${query}”` : ''}.{tool.status === 'running'
			? ''
			: ''}
	</p>
{:else}
	<ol data-ui="search-results">
		{#each results as hit, index (hit.url ?? index)}
			{@const url = stringValue(recordValue(hit, 'url'))}
			{@const title =
				stringValue(recordValue(hit, 'title')) ?? url ?? 'Untitled'}
			{@const snippet = stringValue(recordValue(hit, 'content'))}
			<li>
				<a href={url} target="_blank" rel="noreferrer">{title}</a>
				<span data-ui="search-host">{hostname(url)}</span>
				{#if snippet}
					<p>{snippet}</p>
				{/if}
			</li>
		{/each}
	</ol>
	<p data-ui="search-meta">
		{count}
		result{count === 1 ? '' : 's'}{baseUrl
			? ` · ${baseUrl.replace(/^https?:\/\//, '')}`
			: ''}
	</p>
{/if}

<style>
	[data-ui='search-results'] {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	[data-ui='search-results'] li {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
	}

	[data-ui='search-results'] a {
		color: var(--color-accent, var(--accent, inherit));
		font-weight: 500;
		text-decoration: none;
		overflow-wrap: anywhere;
	}

	[data-ui='search-results'] a:hover {
		text-decoration: underline;
	}

	[data-ui='search-host'] {
		color: var(--color-text-muted, var(--muted, inherit));
		font-size: 0.78rem;
	}

	[data-ui='search-results'] p {
		margin: 0;
		font-size: 0.85rem;
		opacity: 0.85;
		overflow-wrap: anywhere;
	}

	[data-ui='search-meta'] {
		margin: 0.4rem 0 0;
		font-size: 0.78rem;
		opacity: 0.65;
	}

	[data-ui='tool-empty'][data-error] {
		color: var(--color-danger, var(--danger, inherit));
	}
</style>
