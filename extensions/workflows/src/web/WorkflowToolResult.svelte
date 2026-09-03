<script lang="ts">
	import type { ToolCallView } from './types';

	interface Props {
		tool: ToolCallView;
		projectPath?: string;
		consoleEntries: unknown[];
		errors: unknown[];
	}

	let { tool }: Props = $props();

	interface AgentView {
		index?: number;
		label?: string;
		phase?: string;
		state?: string;
		model?: string;
		startedAt?: number;
		finishedAt?: number;
		error?: string;
		preview?: string;
	}

	interface PhaseView {
		title?: string;
		detail?: string;
	}

	let runId = $derived(stringValue(recordValue(tool.result, 'runId')));
	let name = $derived(stringValue(recordValue(tool.result, 'name')));
	let status = $derived(
		stringValue(recordValue(tool.result, 'status')) ?? tool.statusText,
	);
	let background = $derived(recordValue(tool.result, 'background') === true);
	let currentPhase = $derived(
		stringValue(recordValue(tool.result, 'currentPhase')),
	);
	let error = $derived(stringValue(recordValue(tool.result, 'error')));
	let agents = $derived(
		readArray(tool.result, 'agents').map((agent) => ({
			index: numberValue(recordValue(agent, 'index')),
			label: stringValue(recordValue(agent, 'label')),
			phase: stringValue(recordValue(agent, 'phase')),
			state: stringValue(recordValue(agent, 'state')),
			model: stringValue(recordValue(agent, 'model')),
			error: stringValue(recordValue(agent, 'error')),
			preview: stringValue(recordValue(agent, 'preview')),
		})),
	);
	let phases = $derived(
		readArray(tool.result, 'phases').map((phase) => ({
			title: stringValue(recordValue(phase, 'title')),
			detail: stringValue(recordValue(phase, 'detail')),
		})),
	);
	let result = $derived(recordValue(tool.result, 'result'));
	let done = $derived(agents.filter((agent) => agent.state === 'done').length);
	let failed = $derived(
		agents.filter((agent) => agent.state === 'error').length,
	);
	let resultExpanded = $state(false);

	function resultText(value: unknown): string {
		try {
			return typeof value === 'string'
				? value
				: JSON.stringify(value, null, 2) ?? '';
		} catch {
			return String(value);
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

<div data-ui="workflow-card" data-status={status}>
	<div data-ui="workflow-head">
		<strong>{name ?? runId ?? 'Workflow'}</strong>
		<em data-ui="workflow-status">{status}</em>
	</div>
	{#if tool.status === 'running' && currentPhase}
		<span data-ui="workflow-phase">Phase: {currentPhase}</span>
	{/if}
	{#if phases.length > 0 && (tool.status === 'running' || agents.length > 0)}
		<ol data-ui="workflow-phases">
			{#each phases as phase, index (index)}
				<li data-current={phase.title === currentPhase || undefined}>
					{phase.title}{#if phase.detail}&nbsp;— {phase.detail}{/if}
				</li>
			{/each}
		</ol>
	{/if}
	{#if agents.length > 0}
		<ul data-ui="workflow-agents">
			{#each agents as agent, index (agent.index ?? index)}
				<li data-state={agent.state}>
					<div data-ui="workflow-agent-line">
						<strong>{agent.label ?? `agent-${(agent.index ?? index) + 1}`}</strong>
						<em>{agent.state ?? 'unknown'}</em>
					</div>
					<span data-ui="workflow-agent-meta">
						{[agent.phase, agent.model].filter(Boolean).join(' · ')}
					</span>
					{#if agent.error}
						<span data-ui="workflow-agent-error">{agent.error}</span>
					{/if}
				</li>
			{/each}
		</ul>
		<p data-ui="workflow-progress">
			{done}/{agents.length} agents ok{failed ? `, ${failed} failed` : ''}
		</p>
	{/if}
	{#if error}
		<p data-ui="workflow-fail">{error}</p>
	{/if}
	{#if result !== undefined && result !== '[stored in result.json]'}
		<pre data-expanded={resultExpanded || undefined}>{resultExpanded
			? resultText(result)
			: resultText(result).slice(0, 1_500)}</pre>
		{#if resultText(result).length > 1_500}
			<button
				type="button"
				data-ui="workflow-toggle"
				onclick={() => (resultExpanded = !resultExpanded)}
			>
				{resultExpanded ? 'Show less' : 'Show more'}
			</button>
		{/if}
	{/if}
</div>

<style>
	[data-ui='workflow-card'] {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		min-width: 0;
	}

	[data-ui='workflow-head'] {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
	}

	[data-ui='workflow-head'] strong {
		overflow-wrap: anywhere;
	}

	[data-ui='workflow-status'] {
		font-style: normal;
		font-size: 0.75rem;
		opacity: 0.8;
		margin-left: auto;
		flex-shrink: 0;
	}

	[data-ui='workflow-card'][data-status='completed'] [data-ui='workflow-status'] {
		color: var(--color-success, var(--success, inherit));
	}

	[data-ui='workflow-card'][data-status='running'] [data-ui='workflow-status'] {
		color: var(--color-warning, var(--warning, inherit));
	}

	[data-ui='workflow-card'][data-status='failed'] [data-ui='workflow-status'],
	[data-ui='workflow-card'][data-status='aborted'] [data-ui='workflow-status'] {
		color: var(--color-danger, var(--danger, inherit));
	}

	[data-ui='workflow-phase'] {
		font-size: 0.78rem;
		opacity: 0.7;
	}

	[data-ui='workflow-phases'] {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem 0.8rem;
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: 0.75rem;
		opacity: 0.75;
	}

	[data-ui='workflow-phases'] li[data-current] {
		opacity: 1;
		font-weight: 600;
	}

	[data-ui='workflow-agents'] {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	[data-ui='workflow-agents'] li {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		padding: 0.3rem 0.5rem;
		border: 1px solid color-mix(in srgb, currentColor 10%, transparent);
		border-radius: 0.35rem;
		min-width: 0;
	}

	[data-ui='workflow-agent-line'] {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		min-width: 0;
	}

	[data-ui='workflow-agent-line'] strong {
		font-size: 0.8rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	[data-ui='workflow-agent-line'] em {
		font-style: normal;
		font-size: 0.72rem;
		margin-left: auto;
		flex-shrink: 0;
	}

	li[data-state='done'] em {
		color: var(--color-success, var(--success, inherit));
	}

	li[data-state='running'] em {
		color: var(--color-warning, var(--warning, inherit));
	}

	li[data-state='error'] em {
		color: var(--color-danger, var(--danger, inherit));
	}

	[data-ui='workflow-agent-meta'] {
		font-size: 0.72rem;
		opacity: 0.65;
		overflow-wrap: anywhere;
	}

	[data-ui='workflow-agent-error'] {
		font-size: 0.72rem;
		color: var(--color-danger, var(--danger, inherit));
		overflow-wrap: anywhere;
	}

	[data-ui='workflow-progress'] {
		margin: 0;
		font-size: 0.75rem;
		opacity: 0.65;
	}

	[data-ui='workflow-fail'] {
		margin: 0;
		color: var(--color-danger, var(--danger, inherit));
		font-size: 0.8rem;
		overflow-wrap: anywhere;
	}

	pre {
		margin: 0;
		padding: 0.5rem;
		border-radius: 0.35rem;
		background: color-mix(in srgb, currentColor 6%, transparent);
		font-size: 0.76rem;
		line-height: 1.4;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		max-height: 12rem;
		overflow-y: auto;
	}

	pre[data-expanded] {
		max-height: none;
	}

	[data-ui='workflow-toggle'] {
		align-self: flex-start;
		border: none;
		background: none;
		color: var(--color-accent, var(--accent, inherit));
		cursor: pointer;
		font-size: 0.78rem;
		padding: 0;
	}
</style>
