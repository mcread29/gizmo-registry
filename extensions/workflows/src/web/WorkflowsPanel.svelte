<script lang="ts">
	import {
		WorkflowsRuntime,
		type AgentRecordView,
		type RunSummary,
	} from './workflows-runtime.svelte';

	let { runtime }: { runtime: WorkflowsRuntime } = $props();

	function elapsed(
		startedAt: number | undefined,
		finishedAt: number | undefined,
	): string {
		if (!startedAt) return '—';
		const totalSeconds = Math.max(
			0,
			Math.round(((finishedAt ?? Date.now()) - startedAt) / 1000),
		);
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		return minutes > 0
			? `${minutes}m${seconds.toString().padStart(2, '0')}s`
			: `${seconds}s`;
	}

	function usageText(agent: AgentRecordView): string {
		const usage = agent.usage;
		if (!usage) return '';
		const parts: string[] = [];
		if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? 's' : ''}`);
		if (usage.input) parts.push(`${compact(usage.input)} in`);
		if (usage.output) parts.push(`${compact(usage.output)} out`);
		if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
		return parts.join(' · ');
	}

	function compact(count: number): string {
		if (count < 1000) return count.toString();
		if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
		return `${(count / 1_000_000).toFixed(1)}M`;
	}

	function resultText(value: unknown): string {
		try {
			return typeof value === 'string'
				? value
				: JSON.stringify(value, null, 2) ?? '';
		} catch {
			return String(value);
		}
	}

	let run = $derived(runtime.selectedRun);
	let selectedAgent = $derived(
		run?.agents.find((agent) => agent.index === runtime.selectedAgentIndex),
	);
	let resultExpanded = $state(false);
</script>

<div data-ui="workflows-panel">
	{#if runtime.selectedRunId && run}
		<button
			type="button"
			data-ui="workflows-back"
			onclick={() => runtime.closeRun()}
		>
			← All runs
		</button>

		<div data-ui="workflows-run-head">
			<strong>{run.name ?? run.runId}</strong>
			<span>
				{run.status}{run.background ? ' · background' : ''} ·
				{run.agents.filter((agent) => agent.state === 'done').length}/
				{run.agents.length} agents · {elapsed(run.startedAt, run.finishedAt)}
			</span>
		</div>
		{#if run.description}
			<p data-ui="workflows-description">{run.description}</p>
		{/if}
		{#if run.error}
			<p data-ui="workflows-error">{run.error}</p>
		{/if}

		{#if runtime.selectedAgentIndex !== undefined && selectedAgent}
			<button
				type="button"
				data-ui="workflows-back"
				onclick={() => runtime.closeAgent()}
			>
				← {run.name ?? run.runId}
			</button>
			<div data-ui="workflows-agent-head">
				<strong>{selectedAgent.label ?? `agent-${selectedAgent.index}`}</strong>
				<span>
					{[
						selectedAgent.phase,
						selectedAgent.state,
						selectedAgent.model,
						elapsed(selectedAgent.startedAt, selectedAgent.finishedAt),
					]
						.filter(Boolean)
						.join(' · ')}
				</span>
			</div>
			{#if selectedAgent.error}
				<p data-ui="workflows-error">{selectedAgent.error}</p>
			{/if}
			{#if runtime.transcript.length > 0}
				<div data-ui="workflows-transcript">
					{#each runtime.transcript as entry, index (index)}
						<div
							data-role={entry.role}
							data-error={entry.isError || undefined}
						>
							<span data-ui="transcript-role"
								>{entry.role}{entry.name ? ` (${entry.name})` : ''}</span
							>
							<pre>{entry.text}</pre>
						</div>
					{/each}
				</div>
			{:else}
				<p data-ui="workflows-pending">No transcript recorded.</p>
			{/if}
		{:else}
			<ul data-ui="workflows-agents">
				{#each run.agents as agent (agent.index)}
					<li data-state={agent.state}>
						<button
							type="button"
							onclick={() => void runtime.openAgent(agent.index)}
						>
							<div data-ui="workflows-agent-line">
								<strong>{agent.label ?? `agent-${agent.index}`}</strong>
								<em>{agent.state ?? 'unknown'}</em>
							</div>
							<span data-ui="workflows-agent-meta">
								{[
									agent.phase,
									agent.model,
									elapsed(agent.startedAt, agent.finishedAt),
									usageText(agent),
								]
									.filter(Boolean)
									.join(' · ')}
							</span>
							{#if agent.preview && agent.state === 'running'}
								<span data-ui="workflows-agent-preview">{agent.preview}</span>
							{/if}
							{#if agent.error}
								<span data-ui="workflows-agent-error">{agent.error}</span>
							{/if}
						</button>
					</li>
				{/each}
			</ul>
			{#if run.result !== undefined}
				<div data-ui="workflows-result">
					<strong>Result</strong>
					<pre data-expanded={resultExpanded || undefined}>{resultExpanded
						? resultText(run.result)
						: resultText(run.result).slice(0, 2_000)}</pre>
					{#if resultText(run.result).length > 2_000}
						<button
							type="button"
							data-ui="workflows-toggle"
							onclick={() => (resultExpanded = !resultExpanded)}
						>
							{resultExpanded ? 'Show less' : 'Show more'}
						</button>
					{/if}
				</div>
			{/if}
		{/if}
	{:else if runtime.selectedRunId}
		<button
			type="button"
			data-ui="workflows-back"
			onclick={() => runtime.closeRun()}
		>
			← All runs
		</button>
		<p data-ui="workflows-pending">
			{runtime.runError ?? 'Loading run…'}
		</p>
	{:else}
		<div data-ui="tool-metrics">
			<div><span>Running</span><strong>{runtime.runningCount}</strong></div>
			<div><span>Total runs</span><strong>{runtime.runs.length}</strong></div>
			<div>
				<span>Failed agents</span><strong>{runtime.failedCount}</strong>
			</div>
		</div>
		<button
			type="button"
			data-ui="workflows-refresh"
			disabled={runtime.loading}
			onclick={() => void runtime.refresh()}
		>
			{runtime.loading ? 'Loading…' : 'Refresh'}
		</button>
		{#if runtime.error}
			<p data-ui="workflows-error">{runtime.error}</p>
		{:else if runtime.runs.length === 0}
			<div data-ui="empty-state">
				<strong>No workflow runs</strong>
				<span>Workflow runs from this session appear here.</span>
			</div>
		{:else}
			<ul data-ui="workflows-runs">
				{#each runtime.runs as entry (entry.runId)}
					<li data-status={entry.status}>
						<button
							type="button"
							onclick={() => void runtime.openRun(entry.runId)}
						>
							<div data-ui="workflows-agent-line">
								<strong>{entry.name ?? entry.runId}</strong>
								<em>{entry.status ?? 'unknown'}</em>
							</div>
							<span data-ui="workflows-agent-meta">
								{[
									`${entry.agentsSettled}/${entry.agentsTotal} agents`,
									entry.currentPhase,
									elapsed(entry.startedAt, entry.finishedAt),
									entry.background ? 'background' : '',
								]
									.filter(Boolean)
									.join(' · ')}
							</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</div>

<style>
	[data-ui='workflows-panel'] {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-height: 0;
		flex: 1;
	}

	[data-ui='workflows-back'],
	[data-ui='workflows-refresh'] {
		align-self: flex-start;
		border: none;
		background: none;
		color: var(--color-accent, var(--accent, inherit));
		cursor: pointer;
		font-size: 0.78rem;
		padding: 0;
	}

	[data-ui='workflows-refresh']:disabled {
		opacity: 0.5;
		cursor: default;
	}

	[data-ui='workflows-run-head'],
	[data-ui='workflows-agent-head'] {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}

	[data-ui='workflows-run-head'] span,
	[data-ui='workflows-agent-head'] span {
		font-size: 0.75rem;
		opacity: 0.65;
	}

	[data-ui='workflows-description'] {
		margin: 0;
		font-size: 0.8rem;
		opacity: 0.8;
	}

	[data-ui='workflows-error'] {
		margin: 0;
		color: var(--color-danger, var(--danger, inherit));
		font-size: 0.8rem;
	}

	[data-ui='workflows-pending'] {
		margin: 0;
		opacity: 0.65;
		font-size: 0.8rem;
	}

	[data-ui='workflows-runs'],
	[data-ui='workflows-agents'] {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin: 0;
		padding: 0;
		list-style: none;
		overflow-y: auto;
		min-height: 0;
	}

	[data-ui='workflows-runs'] > li,
	[data-ui='workflows-agents'] > li {
		border: 1px solid color-mix(in srgb, currentColor 12%, transparent);
		border-radius: 0.45rem;
		overflow: hidden;
	}

	[data-ui='workflows-runs'] > li[data-status='failed'],
	[data-ui='workflows-runs'] > li[data-status='aborted'],
	[data-ui='workflows-agents'] > li[data-state='error'] {
		border-color: color-mix(in srgb, var(--color-danger, #d55) 45%, transparent);
	}

	[data-ui='workflows-runs'] > li > button,
	[data-ui='workflows-agents'] > li > button {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		width: 100%;
		border: none;
		background: none;
		color: inherit;
		text-align: left;
		cursor: pointer;
		padding: 0.5rem 0.65rem;
		font: inherit;
	}

	[data-ui='workflows-agent-line'] {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		min-width: 0;
	}

	[data-ui='workflows-agent-line'] strong {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.84rem;
	}

	[data-ui='workflows-agent-line'] em {
		font-style: normal;
		font-size: 0.75rem;
		margin-left: auto;
		flex-shrink: 0;
	}

	li[data-status='running'] em,
	li[data-state='running'] em {
		color: var(--color-warning, var(--warning, inherit));
	}

	li[data-status='completed'] em,
	li[data-state='done'] em {
		color: var(--color-success, var(--success, inherit));
	}

	li[data-status='failed'] em,
	li[data-status='aborted'] em,
	li[data-state='error'] em {
		color: var(--color-danger, var(--danger, inherit));
	}

	[data-ui='workflows-agent-meta'],
	[data-ui='workflows-agent-preview'] {
		font-size: 0.75rem;
		opacity: 0.65;
		overflow-wrap: anywhere;
	}

	[data-ui='workflows-agent-preview'] {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	[data-ui='workflows-agent-error'] {
		font-size: 0.75rem;
		color: var(--color-danger, var(--danger, inherit));
		overflow-wrap: anywhere;
	}

	[data-ui='workflows-transcript'] {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		overflow-y: auto;
		min-height: 0;
	}

	[data-ui='transcript-role'] {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		opacity: 0.55;
	}

	[data-ui='workflows-transcript'] pre {
		margin: 0.1rem 0 0;
		padding: 0.45rem;
		border-radius: 0.35rem;
		background: color-mix(in srgb, currentColor 6%, transparent);
		font-size: 0.74rem;
		line-height: 1.4;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		max-height: 10rem;
		overflow-y: auto;
	}

	[data-ui='workflows-transcript'] > div[data-error] pre {
		color: var(--color-danger, var(--danger, inherit));
	}

	[data-ui='workflows-result'] {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	[data-ui='workflows-result'] pre {
		margin: 0;
		padding: 0.5rem;
		border-radius: 0.35rem;
		background: color-mix(in srgb, currentColor 6%, transparent);
		font-size: 0.76rem;
		line-height: 1.4;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		max-height: 14rem;
		overflow-y: auto;
	}

	[data-ui='workflows-result'] pre[data-expanded] {
		max-height: none;
	}

	[data-ui='workflows-toggle'] {
		align-self: flex-start;
		border: none;
		background: none;
		color: var(--color-accent, var(--accent, inherit));
		cursor: pointer;
		font-size: 0.78rem;
		padding: 0;
	}

	[data-ui='empty-state'] {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.2rem;
		padding: 2rem 1rem;
		opacity: 0.6;
		font-size: 0.85rem;
	}
</style>
