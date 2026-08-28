<script lang="ts">
	import { Tooltip } from 'bits-ui';
	import type { ConsoleExtensionRuntime } from './console-extension.svelte';
	import ConsolePanel from './ConsolePanel.svelte';

	let { runtime }: { runtime: ConsoleExtensionRuntime } = $props();
</script>

<Tooltip.Provider>
	<ConsolePanel {runtime} />
</Tooltip.Provider>
