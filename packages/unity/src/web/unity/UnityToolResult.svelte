<script lang="ts">
	import type { ToolCallView } from '../types';
	import { commandName } from './unity-view';
	import UnityScriptResult from './UnityScriptResult.svelte';
	import UnityTestResults from './UnityTestResults.svelte';

	interface Props {
		tool: ToolCallView;
		projectPath?: string;
		consoleEntries: unknown[];
		errors: unknown[];
	}

	let { tool, projectPath, consoleEntries, errors }: Props = $props();

	let instances = $derived(readArray(tool.result, 'instances'));
	let commands = $derived(
		readArray(tool.result, 'commands')
			.map(commandName)
			.filter((name): name is string => name !== undefined),
	);

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
	}
</script>

{#if tool.name === 'unity_status'}
	<div data-ui="tool-metrics">
		<div>
			<span>State</span><strong
				>{stringValue(recordValue(tool.result, 'state')) ??
					tool.statusText}</strong
			>
		</div>
		<div><span>Editors</span><strong>{instances.length}</strong></div>
	</div>
	{#each instances as instance, index (index)}
		<div data-ui="editor-result">
			<strong
				>{stringValue(recordValue(instance, 'projectPath')) ??
					'Connected Editor'}</strong
			>
			<span
				>{stringValue(recordValue(instance, 'version')) ?? 'Unknown version'} · Port
				{stringValue(recordValue(instance, 'port')) ?? '—'}</span
			>
		</div>
	{/each}
{:else if tool.name === 'unity_list_commands'}
	{#if commands.length}
		<div data-ui="tool-command-list">
			{#each commands as command (command)}<code>{command}</code>{/each}
		</div>
	{:else}
		<p data-ui="tool-empty">No registered commands were returned.</p>
	{/if}
{:else if tool.name === 'unity_console'}
	<div data-ui="tool-metrics">
		<div><span>Entries</span><strong>{consoleEntries.length}</strong></div>
		<div>
			<span>Cursor</span><strong
				>{stringValue(recordValue(tool.result, 'cursor')) ?? '—'}</strong
			>
		</div>
	</div>
{:else if tool.name === 'unity_wait_for_compile' || tool.name === 'unity_wait_for_command'}
	<div data-ui="tool-metrics">
		<div>
			<span>State</span><strong
				>{stringValue(recordValue(tool.result, 'state')) ??
					tool.statusText}</strong
			>
		</div>
		<div>
			<span>Diagnostics</span><strong
				>{consoleEntries.length + errors.length}</strong
			>
		</div>
	</div>
{:else if tool.name === 'unity_test'}
	<UnityTestResults result={tool.result} {projectPath} />
{:else if tool.name === 'unity_script'}
	<UnityScriptResult input={tool.input} result={tool.result} />
{/if}
