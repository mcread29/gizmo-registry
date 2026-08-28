<script lang="ts">
	import {
		formatToolResult,
		recordValue,
		stringValue,
	} from '../design/format';

	let { input, result }: { input: unknown; result: unknown } = $props();

	let source = $derived(stringValue(recordValue(input, 'code')) ?? '');
	let phase = $derived(stringValue(recordValue(result, 'phase')) ?? 'execute');
	let commands = $derived(
		stringValue(recordValue(result, 'discoveredCommands')) ?? '0',
	);
	let diagnostics = $derived(readArray(result, 'diagnostics'));
	let logs = $derived(
		readArray(result, 'logs').filter(
			(value): value is string => typeof value === 'string',
		),
	);
	let error = $derived(stringValue(recordValue(result, 'error')));
	let value = $derived(recordValue(result, 'value'));
	let valueText = $derived(formatToolResult(value));

	function readArray(value: unknown, key: string): unknown[] {
		const candidate = recordValue(value, key);
		return Array.isArray(candidate) ? candidate : [];
	}

	function diagnosticValue(value: unknown, key: string): string | undefined {
		return stringValue(recordValue(value, key));
	}
</script>

<div data-ui="tool-metrics">
	<div><span>Phase</span><strong>{phase}</strong></div>
	<div><span>Live commands</span><strong>{commands}</strong></div>
</div>

{#if source}
	<div data-ui="script-section">
		<strong>Source</strong>
		<pre data-ui="structured-result"><code class="language-typescript"
				>{source}</code
			></pre>
	</div>
{/if}

{#if diagnostics.length}
	<div data-ui="script-section">
		<strong>TypeScript diagnostics</strong>
		<ul data-ui="script-diagnostics">
			{#each diagnostics as diagnostic, index (index)}
				<li>
					<code
						>{diagnosticValue(diagnostic, 'line') ?? '1'}:{diagnosticValue(
							diagnostic,
							'column',
						) ?? '1'}</code
					>
					<span
						>{diagnosticValue(diagnostic, 'message') ??
							'Unknown diagnostic'}</span
					>
				</li>
			{/each}
		</ul>
	</div>
{/if}

{#if logs.length}
	<div data-ui="script-section">
		<strong>Progress</strong>
		<pre data-ui="script-logs">{logs.join('\n')}</pre>
	</div>
{/if}

{#if error}<p data-ui="script-error">{error}</p>{/if}

{#if valueText}
	<div data-ui="script-section">
		<strong>Returned value</strong>
		<pre data-ui="structured-result"><code class="language-json"
				>{valueText}</code
			></pre>
	</div>
{/if}
