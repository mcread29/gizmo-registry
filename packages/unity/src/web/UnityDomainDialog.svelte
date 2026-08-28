<script lang="ts">
	import CompileConfirmationDialog from './unity/CompileConfirmationDialog.svelte';
	import type { UnityHost, UnityLayout } from './host';
	let { store, layout }: { store: UnityHost; layout: UnityLayout } = $props();
</script>

<CompileConfirmationDialog {store} {layout} />
