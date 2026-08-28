<script lang="ts">
	import type { InspectorTabContribution, UnityHost } from '../host';
	import EditorPanel from './EditorPanel.svelte';
	import type { UnityView } from './unity-view';

	interface Props {
		view: UnityView;
		store: UnityHost;
		onOpenProject: () => void;
		extensionTabs: InspectorTabContribution[];
		activePanel: string;
		onSelectPanel: (panel: string) => void;
	}

	let {
		view,
		store,
		onOpenProject,
		extensionTabs,
		activePanel,
		onSelectPanel,
	}: Props = $props();
	let extensionTab = $derived(
		extensionTabs.find((tab) => tab.id === activePanel),
	);
</script>

<div data-ui="unity-panel">
	<div data-ui="unity-view-switch" aria-label="Unity view">
		<button
			type="button"
			aria-pressed={activePanel === 'status'}
			onclick={() => onSelectPanel('status')}>Status</button
		>
		{#each extensionTabs as tab (tab.id)}
			<button
				type="button"
				aria-pressed={activePanel === tab.id}
				onclick={() => onSelectPanel(tab.id)}
				>{tab.label}{#if tab.badge}
					<span>{tab.badge}</span>{/if}</button
			>
		{/each}
	</div>
	<div data-ui="unity-subpanel" data-panel={activePanel}>
		{#if activePanel === 'status'}
			<EditorPanel {view} {store} {onOpenProject} />
		{:else if extensionTab}
			{@const Component = extensionTab.component}
			<Component {...extensionTab.props} />
		{/if}
	</div>
</div>
