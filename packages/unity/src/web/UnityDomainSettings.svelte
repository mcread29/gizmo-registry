<script lang="ts">
	import type { UnityLayout } from './host';
	import SelectField from './design/SelectField.svelte';
	let { layout }: { layout: UnityLayout } = $props();
</script>

<div data-ui="settings-card">
	<div data-ui="setting-field">
		<div>
			<strong>Unity compilation</strong>
			<span
				>What happens when an agent needs to compile while the Editor is in Play
				Mode.</span
			>
		</div>
		<SelectField
			value={layout.compilePlayModePolicy}
			label="When Play Mode is active"
			options={[
				{ value: 'ask', label: 'Ask' },
				{ value: 'stop', label: 'Stop Play Mode' },
				{ value: 'keep_playing', label: 'Keep playing' },
			]}
			onValueChange={(value) =>
				(layout.compilePlayModePolicy =
					value as UnityLayout['compilePlayModePolicy'])}
		/>
	</div>
</div>
