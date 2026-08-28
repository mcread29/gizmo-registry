<script lang="ts">
	import {
		Check,
		ChevronDown,
		ChevronRight,
		Copy,
		FileCode2,
		Folder,
		FileDiff,
		GitCommit,
		RefreshCw,
		Undo2,
	} from '@lucide/svelte';
	import type { GitFileStatus } from '@gizmo/protocol';
	import { SvelteSet } from 'svelte/reactivity';
	import type { GitHostStore } from './host';
	import {
		Button,
		Dialog,
		Tooltip,
		toasts,
		DiffView,
		sourceHref,
	} from '@gizmo/ui';
	import { changeTree, changeTreeRows } from './change-tree';
	import { threadChanges } from './thread-changes';

	interface Props {
		store: GitHostStore;
		projectPath?: string;
	}

	let { store, projectPath }: Props = $props();

	let agentFiles = $derived(threadChanges(store.messages));
	let agentFilesByPath = $derived(
		new Map(agentFiles.map((file) => [normalize(file.file), file])),
	);
	let statuses = $derived(store.gitStatus?.files ?? []);
	let statusByPath = $derived(
		new Map(statuses.map((status) => [normalize(status.path), status])),
	);
	let files = $derived(
		statuses.map((status) => {
			const authored = agentFilesByPath.get(normalize(status.path));
			return authored
				? { ...authored, file: status.path }
				: { file: status.path, changes: [], added: 0, removed: 0 };
		}),
	);
	let collapsedFolders = $state(new Set<string>());
	let rows = $derived.by(() => {
		const groups = [
			{ name: 'Unstaged', files: files.filter((file) => {
				const status = statusByPath.get(normalize(file.file));
				return !status || !staged(status);
			}) },
			{ name: 'Staged', files: files.filter((file) => {
				const status = statusByPath.get(normalize(file.file));
				return status ? staged(status) : false;
			}) },
		];
		return groups.flatMap((group) => {
			if (!group.files.length) return [];
			const tree = changeTree(group.files, projectPath);
			return [{ node: { kind: 'folder' as const, name: group.name, path: `__${group.name}`, children: tree }, depth: 0 }];
		}).flatMap((row) => changeTreeRows([row.node], collapsedFolders));
	});
	const expanded = new SvelteSet<string>();
	const diffs = $state(new Map<string, string>());
	const loadingDiffs = new SvelteSet<string>();
	let reverting = $state<string>();
	let commitDialogOpen = $state(false);
	let commitMessage = $state('');
	let generatingMessage = $state(false);

	$effect(() => {
		projectPath;
		void store
			.refreshGitStatus()
			.catch((error) =>
				toasts.show(
					error instanceof Error ? error.message : String(error),
					'danger',
				),
			);
	});

	async function toggle(file: string) {
		if (expanded.has(file)) {
			expanded.delete(file);
			return;
		}
		expanded.add(file);
		if (diffs.has(file) || loadingDiffs.has(file)) return;
		loadingDiffs.add(file);
		try {
			const result = (await store.invokeProjectExtension(projectPath!, 'git', 'diff', { file })) as { diff?: string };
			diffs.set(file, result.diff ?? '');
		} finally {
			loadingDiffs.delete(file);
		}
	}

	function nodeGroup(node: import('./change-tree').ChangeTreeNode) {
		if (node.kind === 'file') {
			const status = statusByPath.get(normalize(node.entry.file));
			return status && staged(status) ? 'staged' : 'unstaged';
		}
		return node.path.startsWith('__')
			? node.name.toLowerCase()
			: node.children.some((child) => nodeGroup(child) === 'unstaged')
				? 'unstaged'
				: 'staged';
	}

	function toggleFolder(path: string) {
		const next = new Set(collapsedFolders);
		if (!next.delete(path)) next.add(path);
		collapsedFolders = next;
	}

	async function copyPatch(patch: string) {
		if (!navigator.clipboard) return;
		await navigator.clipboard.writeText(patch);
		toasts.show('Patch copied');
	}

	async function revert(file: string, toolCallId: string, patch: string) {
		reverting = toolCallId;
		try {
			await store.revertFile(file, patch);
			toasts.show(`Reverted the change to ${file}`);
		} catch (error) {
			toasts.show(
				error instanceof Error ? error.message : String(error),
				'danger',
			);
		} finally {
			reverting = undefined;
		}
	}

	async function prepareCommit() {
		generatingMessage = true;
		try {
			commitMessage = await store.generateCommitMessage();
			commitDialogOpen = true;
		} catch (error) {
			toasts.show(
				error instanceof Error ? error.message : String(error),
				'danger',
			);
		} finally {
			generatingMessage = false;
		}
	}

	async function refreshGitStatus() {
		try {
			await store.refreshGitStatus();
		} catch (error) {
			toasts.show(
				error instanceof Error ? error.message : String(error),
				'danger',
			);
		}
	}

	async function commitAll() {
		try {
			const result = await store.commitAll(commitMessage);
			commitDialogOpen = false;
			toasts.show(`Committed ${result.commit.slice(0, 7)}`);
		} catch (error) {
			toasts.show(
				error instanceof Error ? error.message : String(error),
				'danger',
			);
		}
	}

	function normalize(path: string) {
		const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '');
		const workspace = projectPath?.replaceAll('\\', '/').replace(/\/$/, '');
		return workspace && normalized.startsWith(`${workspace}/`)
			? normalized.slice(workspace.length + 1)
			: normalized;
	}

	function code(status: GitFileStatus) {
		return status.workingTree !== ' ' ? status.workingTree : status.index;
	}

	function label(status: GitFileStatus) {
		const value = code(status);
		if (status.index === '?' && status.workingTree === '?') return 'Untracked';
		return (
			{
				A: 'Added',
				C: 'Copied',
				D: 'Deleted',
				M: 'Modified',
				R: 'Renamed',
				U: 'Conflict',
			}[value] ?? 'Changed'
		);
	}

	function staged(status: GitFileStatus) {
		return status.index !== ' ' && status.index !== '?';
	}
</script>

<div data-ui="git-summary">
	<div>
		<strong
			>{store.gitLoading && !store.gitStatus
				? 'Loading Git status…'
				: !store.gitStatus
					? 'Git status unavailable'
					: store.gitStatus.clean
						? 'Working tree clean'
						: 'Working tree'}</strong
		>
		{#if store.gitStatus}<span>{store.gitStatus.branch}</span>{/if}
	</div>
	<div data-ui="git-actions">
		<Button
			variant="ghost"
			size="icon"
			aria-label="Refresh Git status"
			disabled={store.gitLoading}
			onclick={refreshGitStatus}
			><RefreshCw
				size={14}
				class={store.gitLoading ? 'spinning' : undefined}
			/></Button
		>
		<Button
			size="sm"
			disabled={!store.gitStatus ||
				store.gitStatus.clean ||
				generatingMessage ||
				store.gitCommitting}
			onclick={prepareCommit}
			><GitCommit size={14} />{generatingMessage
				? 'Writing message…'
				: 'Commit all'}</Button
		>
	</div>
</div>

{#if store.gitLoading && !store.gitStatus}
	<!-- Claiming a clean tree before Git answers is a false statement. -->
	<div data-ui="change-skeleton" aria-label="Loading repository changes">
		{#each [0, 1, 2, 3] as row (row)}
			<div data-ui="skeleton" data-shape="line"></div>
		{/each}
	</div>
{:else if files.length === 0}
	<div data-ui="empty-state">
		<Check size={22} /><strong>No file changes</strong><span
			>The repository working tree is clean.</span
		>
	</div>
{:else}
	<div data-ui="change-summary">
		<span>{files.length} changed file{files.length === 1 ? '' : 's'}</span>
		<span>{statuses.filter(staged).length} staged</span>
	</div>
	<div data-ui="change-list">
		{#each rows as row, index (index)}
			{#if row.node.kind === 'folder'}
				<button
					type="button"
					data-ui="change-folder"
					data-group={nodeGroup(row.node)}
					data-group-header={row.node.path.startsWith('__') || undefined}
					style={`--depth:${row.depth}`}
					aria-expanded={!collapsedFolders.has(row.node.path)}
					onclick={() => toggleFolder(row.node.path)}
				>
					{#if collapsedFolders.has(row.node.path)}<ChevronRight
							size={12}
						/>{:else}<ChevronDown size={12} />{/if}
					{#if row.node.path.startsWith('__')}
						{#if row.node.name === 'Staged'}<GitCommit size={14} />{:else}<FileDiff
							size={14}
						/>{/if}
					{:else}<Folder size={14} />{/if}
					<strong>{row.node.name}</strong>
				</button>
			{:else}
				{@const entry = row.node.entry}
				{@const authored = agentFilesByPath.get(normalize(entry.file))}
				{@const status = statusByPath.get(normalize(entry.file))}
				<section
					data-ui="change-file"
					data-group={nodeGroup(row.node)}
					data-expanded={expanded.has(entry.file) || undefined}
					style={`--depth:${row.depth}`}
				>
					<button
						type="button"
						data-ui="change-header"
						data-expandable={true}
						aria-expanded={expanded.has(entry.file)}
						onclick={() => void toggle(entry.file)}
					>
						<span data-ui="change-tree-spacer"></span>
						{#if status && staged(status)}<GitCommit size={14} />{:else}<FileDiff
							size={14}
						/>{/if}
						<span title={entry.file}>{row.node.name}</span>
						{#if authored}
							<small data-kind="added">+{entry.added}</small>
							<small data-kind="removed">−{entry.removed}</small>
						{:else if status}
							{#if staged(status)}<small data-ui="change-stage" title="Staged"
									>S</small
								>{/if}
							<small
								data-ui="change-status"
								data-status={code(status)}
								title={label(status)}>{code(status)}</small
							>
						{/if}
					</button>
					{#if expanded.has(entry.file)}
						{@const patch = diffs.get(entry.file) ?? authored?.changes[0]?.patch ?? ''}
						{#if loadingDiffs.has(entry.file)}
							<div data-ui="change-body">Loading diff…</div>
						{:else}
							{@const change = { toolCallId: `git-${entry.file}`, patch, status: 'complete' as const }}
							<div data-ui="change-body">
								<DiffView
									diff={change.patch}
									file={entry.file}
									{projectPath}
									showFileName={false}
									wrap
								/>
								<div data-ui="change-actions">
									{#if sourceHref(entry.file, projectPath)}
										<a
											data-ui="change-link"
											href={sourceHref(entry.file, projectPath)}>Open</a
										>
									{/if}
									<Button
										variant="ghost"
										size="sm"
										onclick={() => copyPatch(change.patch)}
										><Copy size={13} /> Copy</Button
									>
									<Tooltip
										text="Restores the file to its state before this edit"
									>
										{#snippet children(props)}
											<Button
												{...props}
												variant="ghost"
												size="sm"
												disabled={change.status !== 'complete' ||
													reverting === change.toolCallId}
												onclick={() =>
													revert(entry.file, change.toolCallId, change.patch)}
												><Undo2 size={13} />
												{reverting === change.toolCallId
													? 'Reverting…'
													: 'Revert'}</Button
											>
										{/snippet}
									</Tooltip>
								</div>
							</div>
						{/if}
					{/if}
				</section>
			{/if}
		{/each}
	</div>
{/if}

<Dialog
	bind:open={commitDialogOpen}
	title="Commit all changes"
	description="Pi generated this message. Edit it if needed, then stage and commit every change in the repository."
>
	<label data-ui="commit-message-field">
		<span>Commit message</span>
		<textarea bind:value={commitMessage} rows="6"></textarea>
	</label>
	<div data-ui="dialog-actions">
		<Button variant="ghost" onclick={() => (commitDialogOpen = false)}
			>Cancel</Button
		>
		<Button
			disabled={!commitMessage.trim() || store.gitCommitting}
			onclick={commitAll}
			><GitCommit size={14} />{store.gitCommitting
				? 'Committing…'
				: 'Commit all'}</Button
		>
	</div>
</Dialog>
