<script lang="ts">
	import {
		SubagentsRuntime,
		type SubagentEntry,
		type ThreadView,
	} from './subagents-runtime.svelte';

	let { runtime }: { runtime: SubagentsRuntime } = $props();

	let expandedId = $state<string>();

	function toggle(sub: SubagentEntry) {
		if (expandedId === sub.key) {
			expandedId = undefined;
			runtime.closeThread(sub.key);
			return;
		}
		if (expandedId) runtime.closeThread(expandedId);
		expandedId = sub.key;
		runtime.openThread(sub.key);
	}

	function threadFor(sub: SubagentEntry): ThreadView | undefined {
		return runtime.threads[sub.key];
	}

	function elapsed(sub: SubagentEntry): string {
		const end = sub.settledAt ?? Date.now();
		const totalSeconds = Math.max(0, Math.round((end - sub.startedAt) / 1000));
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		return minutes > 0
			? `${minutes}m${seconds.toString().padStart(2, '0')}s`
			: `${seconds}s`;
	}

	function shortPath(cwd: string): string {
		return cwd.replace(/\\/g, '/').replace(/\/$/, '');
	}
</script>

<div data-ui="subagents-panel">
	<div data-ui="subagents-totals">
		<span data-tone="running"
			><i></i>Running <strong>{runtime.runningCount}</strong></span
		>
		<span data-tone="done"><i></i>Done <strong>{runtime.doneCount}</strong></span>
		<span data-tone="error"
			><i></i>Failed <strong>{runtime.failedCount}</strong></span
		>
	</div>

	<button
		type="button"
		data-ui="subagents-refresh"
		disabled={runtime.loading}
		onclick={() => void runtime.refresh(true)}
	>
		{runtime.loading ? 'Loading…' : 'Refresh'}
	</button>

	{#if runtime.error}
		<p data-ui="subagents-error">{runtime.error}</p>
	{:else if runtime.subagents.length === 0}
		<div data-ui="empty-state">
			<strong>No subagents</strong>
			<span>Spawned subagents appear here while the agent works.</span>
		</div>
	{:else}
		<ul data-ui="subagents-list">
			{#each runtime.subagents as sub (sub.key)}
				<li data-status={sub.status} data-selected={expandedId === sub.key || undefined}>
					<button type="button" onclick={() => toggle(sub)}>
						<span data-ui="subagent-title">
							<code>{sub.id}</code>
							<strong>{sub.title}</strong>
						</span>
						<span data-ui="subagent-meta">
							<em>{sub.status}</em>
							{#if sub.context}<span>{sub.context}</span>{/if}
							<span>{elapsed(sub)}</span>
						</span>
					</button>
					{#if expandedId === sub.key}
						<div data-ui="subagent-detail">
							<dl>
								{#if sub.model}<div><dt>Model</dt><dd>{sub.model}</dd></div>{/if}
								<div>
									<dt>Working directory</dt>
									<dd>{shortPath(sub.cwd)}</dd>
								</div>
								{#if sub.promptPreview}
									<div><dt>Prompt</dt><dd>{sub.promptPreview}</dd></div>{/if}
							</dl>
							{#if sub.error}
								<p data-ui="subagent-error">{sub.error}</p>
							{/if}
							{#if sub.outputPreview}
								<pre>{sub.outputPreview}</pre>
							{:else if sub.status === 'running'}
								<p data-ui="subagent-pending">No output yet.</p>
							{/if}

							<section data-ui="subagent-thread">
								<h3>Thread</h3>
								{#if threadFor(sub)?.error}
									<p data-ui="subagent-error">{threadFor(sub)?.error}</p>
								{:else if threadFor(sub)?.messages.length}
									<ol>
										{#each threadFor(sub)?.messages ?? [] as message, index (index)}
											<li data-role={message.role}>
												<span data-ui="thread-role">{message.role}</span>
												<pre>{message.text}</pre>
											</li>
										{/each}
									</ol>
								{:else if threadFor(sub)?.loading}
									<p data-ui="subagent-pending">Loading transcript…</p>
								{:else}
									<p data-ui="subagent-pending">
										No transcript recorded yet.
									</p>
								{/if}
							</section>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	[data-ui='subagents-panel'] {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-height: 0;
		flex: 1;
	}

	[data-ui='subagents-totals'] {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		font-size: 0.72rem;
		color: var(--color-text-muted, var(--text-muted, inherit));
	}

	[data-ui='subagents-totals'] span {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		white-space: nowrap;
	}

	[data-ui='subagents-totals'] i {
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 999px;
		background: currentColor;
		opacity: 0.45;
	}

	[data-ui='subagents-totals'] [data-tone='running'] i {
		color: var(--color-warning, var(--warning, inherit));
		opacity: 1;
	}

	[data-ui='subagents-totals'] [data-tone='done'] i {
		color: var(--color-success, var(--success, inherit));
		opacity: 1;
	}

	[data-ui='subagents-totals'] [data-tone='error'] i {
		color: var(--color-danger, var(--danger, inherit));
		opacity: 1;
	}

	[data-ui='subagents-totals'] strong {
		font-weight: 600;
		color: var(--color-text, inherit);
	}

	[data-ui='subagents-refresh'] {
		align-self: flex-start;
		border: none;
		background: none;
		color: var(--color-accent, var(--accent, inherit));
		cursor: pointer;
		font-size: 0.78rem;
		padding: 0;
	}

	[data-ui='subagents-refresh']:disabled {
		opacity: 0.5;
		cursor: default;
	}

	[data-ui='subagents-error'] {
		margin: 0;
		color: var(--color-danger, var(--danger, inherit));
		font-size: 0.8rem;
	}

	[data-ui='subagents-list'] {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin: 0;
		padding: 0;
		list-style: none;
		overflow-y: auto;
		min-height: 0;
	}

	[data-ui='subagents-list'] > li {
		border: 1px solid color-mix(in srgb, currentColor 12%, transparent);
		border-radius: 0.45rem;
		overflow: hidden;
	}

	[data-ui='subagents-list'] > li[data-status='error'] {
		border-color: color-mix(in srgb, var(--color-danger, #d55) 45%, transparent);
	}

	[data-ui='subagents-list'] > li > button {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		width: 100%;
		border: none;
		background: none;
		color: inherit;
		text-align: left;
		cursor: pointer;
		padding: 0.5rem 0.65rem;
		font: inherit;
	}

	[data-ui='subagent-title'] {
		display: flex;
		align-items: baseline;
		gap: 0.45rem;
		min-width: 0;
	}

	[data-ui='subagent-title'] code {
		font-size: 0.75rem;
		opacity: 0.7;
	}

	[data-ui='subagent-title'] strong {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	[data-ui='subagent-meta'] {
		display: flex;
		gap: 0.6rem;
		font-size: 0.75rem;
		opacity: 0.7;
	}

	[data-ui='subagent-meta'] em {
		font-style: normal;
		font-weight: 600;
	}

	li[data-status='running'] [data-ui='subagent-meta'] em {
		color: var(--color-warning, var(--warning, inherit));
	}

	li[data-status='done'] [data-ui='subagent-meta'] em {
		color: var(--color-success, var(--success, inherit));
	}

	li[data-status='error'] [data-ui='subagent-meta'] em {
		color: var(--color-danger, var(--danger, inherit));
	}

	[data-ui='subagent-detail'] {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 0 0.65rem 0.6rem;
		font-size: 0.8rem;
	}

	[data-ui='subagent-detail'] dl {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	[data-ui='subagent-detail'] dl > div {
		display: flex;
		gap: 0.5rem;
	}

	[data-ui='subagent-detail'] dt {
		opacity: 0.6;
		flex-shrink: 0;
	}

	[data-ui='subagent-detail'] dd {
		margin: 0;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	[data-ui='subagent-error'] {
		margin: 0;
		color: var(--color-danger, var(--danger, inherit));
	}

	[data-ui='subagent-detail'] pre {
		margin: 0;
		padding: 0.5rem;
		border-radius: 0.35rem;
		background: color-mix(in srgb, currentColor 6%, transparent);
		font-size: 0.75rem;
		line-height: 1.4;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		max-height: 12rem;
		overflow-y: auto;
	}

	[data-ui='subagent-pending'] {
		margin: 0;
		opacity: 0.6;
	}

	[data-ui='subagent-thread'] {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		min-width: 0;
	}

	[data-ui='subagent-thread'] h3 {
		margin: 0;
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		opacity: 0.6;
	}

	[data-ui='subagent-thread'] ol {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		margin: 0;
		padding: 0;
		list-style: none;
		max-height: 18rem;
		overflow-y: auto;
	}

	[data-ui='subagent-thread'] li {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.35rem 0.45rem;
		border-radius: 0.35rem;
		background: color-mix(in srgb, currentColor 5%, transparent);
		min-width: 0;
	}

	[data-ui='thread-role'] {
		font-size: 0.68rem;
		font-family: var(--font-mono, monospace);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		opacity: 0.55;
	}

	[data-ui='subagent-thread'] li[data-role='assistant'] [data-ui='thread-role'] {
		opacity: 0.8;
	}

	[data-ui='subagent-thread'] pre {
		margin: 0;
		font-size: 0.72rem;
		line-height: 1.45;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
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
