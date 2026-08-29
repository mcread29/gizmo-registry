<script lang="ts">
	import {
		Check,
		ChevronDown,
		ChevronRight,
		Copy,
		FileCode2,
		Folder,
		GitBranch,
		GitCommit,
		Minus,
		Plus,
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
		stageFile(path: string): Promise<void>;
		unstageFile(path: string): Promise<void>;
	}

	let { store, projectPath, stageFile, unstageFile }: Props = $props();

	let agentFiles = $derived(threadChanges(store.messages));
	let agentFilesByPath = $derived(
		new Map(agentFiles.map((file) => [normalize(file.file), file])),
	);
	let statuses = $derived(store.gitStatus?.files ?? []);
	let statusByPath = $derived(
		new Map(statuses.map((status) => [normalize(status.path), status])),
	);
	let files = $derived(filesFor(statuses));
	const collapsedFolders = new SvelteSet<string>();
	const collapsedGroups = new SvelteSet<string>();
	const expanded = new SvelteSet<string>();
	let groups = $derived.by(() =>
		[
			{
				id: 'unstaged',
				label: 'Unstaged Changes',
				statuses: statuses.filter(unstaged),
			},
			{
				id: 'staged',
				label: 'Staged Changes',
				statuses: statuses.filter(staged),
			},
		]
			.filter((group) => group.statuses.length > 0)
			.map((group) => ({
				...group,
				rows: changeTreeRows(
					changeTree(filesFor(group.statuses), projectPath),
					new Set(
						[...collapsedFolders]
							.filter((key) => key.startsWith(`${group.id}:`))
							.map((key) => key.slice(group.id.length + 1)),
					),
				),
			})),
	);
	let reverting = $state<string>();
	let updatingStage = $state<string>();
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

	function filesFor(groupStatuses: GitFileStatus[]) {
		return groupStatuses.map((status) => {
			const authored = agentFilesByPath.get(normalize(status.path));
			return authored
				? { ...authored, file: status.path }
				: { file: status.path, changes: [], added: 0, removed: 0 };
		});
	}

	function groupKey(group: string, path: string) {
		return `${group}:${path}`;
	}

	function toggle(group: string, file: string) {
		const key = groupKey(group, file);
		if (!expanded.delete(key)) expanded.add(key);
	}

	function toggleFolder(group: string, path: string) {
		const key = groupKey(group, path);
		if (!collapsedFolders.delete(key)) collapsedFolders.add(key);
	}

	function toggleGroup(group: string) {
		if (!collapsedGroups.delete(group)) collapsedGroups.add(group);
	}

	async function updateStage(group: string, file: string) {
		const key = groupKey(group, file);
		updatingStage = key;
		try {
			if (group === 'staged') await unstageFile(file);
			else await stageFile(file);
		} catch (error) {
			toasts.show(
				error instanceof Error ? error.message : String(error),
				'danger',
			);
		} finally {
			updatingStage = undefined;
		}
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

	function code(status: GitFileStatus, group: string) {
		return group === 'staged' ? status.index : status.workingTree;
	}

	function label(status: GitFileStatus, group: string) {
		const value = code(status, group);
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

	function unstaged(status: GitFileStatus) {
		return status.workingTree !== ' ';
	}
</script>

<div data-ui="git-summary">
	<div data-ui="git-title">
		<strong
			>{store.gitLoading && !store.gitStatus
				? 'Loading Git status…'
				: !store.gitStatus
					? 'Git status unavailable'
					: store.gitStatus.clean
						? 'Clean'
						: `${store.gitStatus.files.length} change${store.gitStatus.files.length === 1 ? '' : 's'}`}</strong
		>
		{#if store.gitStatus}
			<span data-ui="git-branch"
				><GitBranch size={11} />{store.gitStatus.branch}</span
			>
		{/if}
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
		{#each groups as group (group.id)}
			<button
				type="button"
				data-ui="change-folder"
				data-group={group.id}
				data-group-header={group.id === 'staged' || undefined}
				style="--depth:0"
				aria-expanded={!collapsedGroups.has(group.id)}
				onclick={() => toggleGroup(group.id)}
			>
				{#if collapsedGroups.has(group.id)}<ChevronRight
						size={12}
					/>{:else}<ChevronDown size={12} />{/if}
				<Folder size={14} />
				<strong>{group.label} ({group.statuses.length})</strong>
			</button>
			{#if !collapsedGroups.has(group.id)}
				{#each group.rows as row (row.node.path)}
					{#if row.node.kind === 'folder'}
						<button
							type="button"
							data-ui="change-folder"
							data-group={group.id}
							style={`--depth:${row.depth + 1}`}
							aria-expanded={!collapsedFolders.has(
								groupKey(group.id, row.node.path),
							)}
							onclick={() => toggleFolder(group.id, row.node.path)}
						>
							{#if collapsedFolders.has(groupKey(group.id, row.node.path))}<ChevronRight
									size={12}
								/>{:else}<ChevronDown size={12} />{/if}
							<Folder size={14} />
							<strong>{row.node.name}</strong>
						</button>
					{:else}
						{@const entry = row.node.entry}
						{@const authored = agentFilesByPath.get(normalize(entry.file))}
						{@const status = statusByPath.get(normalize(entry.file))}
						{@const key = groupKey(group.id, entry.file)}
						<section
							data-ui="change-file"
							data-group={group.id}
							data-expanded={expanded.has(key) || undefined}
							style={`--depth:${row.depth + 1}`}
						>
							<button
								type="button"
								data-ui="change-header"
								data-expandable={Boolean(authored) || undefined}
								aria-expanded={authored ? expanded.has(key) : undefined}
								onclick={() => authored && toggle(group.id, entry.file)}
							>
								<span data-ui="change-tree-spacer"></span>
								<FileCode2 size={14} />
								<span title={entry.file}>{row.node.name}</span>
								{#if authored}
									<small data-kind="added">+{entry.added}</small>
									<small data-kind="removed">−{entry.removed}</small>
								{:else if status}
									<small
										data-ui="change-status"
										data-status={code(status, group.id)}
										title={label(status, group.id)}
										>{code(status, group.id)}</small
									>
								{/if}
							</button>
							<div data-ui="change-actions">
								<Button
									variant="ghost"
									size="sm"
									disabled={updatingStage === key}
									onclick={() => updateStage(group.id, entry.file)}
								>
									{#if group.id === 'staged'}<Minus size={13} />{:else}<Plus
											size={13}
										/>{/if}
									{updatingStage === key
										? group.id === 'staged'
											? 'Unstaging…'
											: 'Staging…'
										: group.id === 'staged'
											? 'Unstage file'
											: 'Stage file'}
								</Button>
							</div>
							{#if authored && expanded.has(key)}
								{#each authored.changes as change (change.toolCallId)}
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
															revert(
																entry.file,
																change.toolCallId,
																change.patch,
															)}
														><Undo2 size={13} />
														{reverting === change.toolCallId
															? 'Reverting…'
															: 'Revert'}</Button
													>
												{/snippet}
											</Tooltip>
										</div>
									</div>
								{/each}
							{/if}
						</section>
					{/if}
				{/each}
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
