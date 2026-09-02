<script lang="ts">
	import { FolderOpen } from '@lucide/svelte';
	import Button from '../design/Button.svelte';
	import type { UnityHost } from '../host';
	import CompilerDiagnosticList from './CompilerDiagnosticList.svelte';
	import UnityTestResults from './UnityTestResults.svelte';
	import { readEditorValue, type UnityView } from './unity-view';

	interface Props {
		view: UnityView;
		store: UnityHost;
		onOpenProject: () => void;
	}

	let { view, store, onOpenProject }: Props = $props();
</script>

<div data-ui="inspector-stack">
	<section data-ui="inspector-card">
		<div data-ui="card-label">Runtime</div>
		<dl>
			<div>
				<dt>State</dt>
				<dd>
					<span
						data-ui="status-dot"
						data-status={view.status?.state === 'connected'
							? 'online'
							: 'disconnected'}
					></span>{view.state}
				</dd>
			</div>
			<div>
				<dt>Version</dt>
				<dd>{view.version ?? '—'}</dd>
			</div>
			<div>
				<dt>Pipeline</dt>
				<dd>{view.status?.state === 'connected' ? 'Connected' : '—'}</dd>
			</div>
			<div>
				<dt>Lifecycle</dt>
				<dd>{view.lifecycle.label}</dd>
			</div>
		</dl>
	</section>

	{#if view.lifecycle.errors.length}
		<section data-ui="inspector-card" data-state="error">
			<div data-ui="card-label">Compiler errors</div>
			<CompilerDiagnosticList
				errors={view.lifecycle.errors}
				projectPath={view.projectPath}
			/>
		</section>
	{/if}

	{#if view.lifecycle.pendingPaths.length}
		<section data-ui="inspector-card" data-state="pending">
			<div data-ui="card-label">Pending compilation</div>
			<div data-ui="pending-paths">
				{#each view.lifecycle.pendingPaths as path (path)}<code>{path}</code
					>{/each}
			</div>
		</section>
	{/if}

	{#if view.consoleDiagnostics.length}
		<section data-ui="inspector-card">
			<div data-ui="card-label">Console diagnostics</div>
			<CompilerDiagnosticList
				errors={view.consoleDiagnostics}
				projectPath={view.projectPath}
			/>
		</section>
	{/if}

	{#if view.testResult !== undefined}
		<section data-ui="inspector-card">
			<div data-ui="card-label">Latest tests</div>
			<UnityTestResults
				result={view.testResult}
				projectPath={view.projectPath}
			/>
		</section>
	{/if}

	<section data-ui="inspector-card">
		<div data-ui="card-label">Connection</div>
		{#if view.editor}
			<dl>
				<div>
					<dt>Project</dt>
					<dd>{view.projectPath ?? '—'}</dd>
				</div>
				<div>
					<dt>Port</dt>
					<dd>{readEditorValue(view.editor, ['port']) ?? '—'}</dd>
				</div>
				<div>
					<dt>Process</dt>
					<dd>{readEditorValue(view.editor, ['pid', 'processId']) ?? '—'}</dd>
				</div>
			</dl>
		{:else}
			<p data-ui="inspector-message">
				{store.projectServiceErrors.unity ??
					view.status?.errors[0]?.message ??
					'The selected project Editor is not open.'}
			</p>
			{#if view.selectedProject}
				<Button
					variant="primary"
					size="sm"
					disabled={store.projectOpening.unity}
					onclick={onOpenProject}
					><FolderOpen size={14} />{store.projectOpening.unity
						? 'Opening Editor…'
						: 'Open Editor'}</Button
				>
			{/if}
		{/if}
	</section>
</div>
