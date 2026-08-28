<script lang="ts">
	let {
		label,
		value = $bindable(),
		options,
		onValueChange,
	}: {
		label: string;
		value: string;
		options: readonly { value: string; label: string }[];
		onValueChange?: (value: string) => void;
	} = $props();
</script>

<label
	>{label}<select bind:value onchange={() => onValueChange?.(value)}
		>{#each options as option}<option value={option.value}
				>{option.label}</option
			>{/each}</select
	></label
>
