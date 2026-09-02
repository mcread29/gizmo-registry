<script lang="ts">
  import { Check, ChevronDown } from "@lucide/svelte";
  import { Select } from "bits-ui";

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

  let selected = $derived(options.find((option) => option.value === value));
</script>

<Select.Root type="single" bind:value {onValueChange}>
  <Select.Trigger data-ui="select-trigger" aria-label={label}>
    <span data-ui="select-label">{selected?.label ?? label}</span>
    <ChevronDown size={14} />
  </Select.Trigger>
  <Select.Portal>
    <Select.Content data-ui="select-content" sideOffset={5}>
      <Select.Viewport>
        {#each options as option (option.value)}
          <Select.Item
            data-ui="select-item"
            value={option.value}
            label={option.label}
          >
            {#snippet children({ selected: isSelected })}
              <span>{option.label}</span>
              {#if isSelected}<Check
                  data-ui="select-indicator"
                  size={14}
                />{/if}
            {/snippet}
          </Select.Item>
        {/each}
      </Select.Viewport>
    </Select.Content>
  </Select.Portal>
</Select.Root>
