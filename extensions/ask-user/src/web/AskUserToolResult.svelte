<script lang="ts">
	interface ToolCallView {
		input?: unknown;
		result?: unknown;
	}

	interface Props {
		tool: ToolCallView;
		projectPath?: string;
		consoleEntries: unknown[];
		errors: unknown[];
	}

	let { tool }: Props = $props();

	let question = $derived(
		stringValue(recordValue(tool.input, 'question')) ?? '',
	);
	let options = $derived(
		readArray(tool.input, 'options')
			.map((option) => stringValue(recordValue(option, 'label')))
			.filter((label): label is string => Boolean(label)),
	);
	let answer = $derived(stringValue(recordValue(tool.result, 'answer')));
	let dismissed = $derived(recordValue(tool.result, 'cancelled') === true);
	let wasCustom = $derived(recordValue(tool.result, 'wasCustom') === true);
	let index = $derived(Number(recordValue(tool.result, 'index')) || 0);

	function readArray(value: unknown, key: string): unknown[] {
		const candidate = recordValue(value, key);
		return Array.isArray(candidate) ? candidate : [];
	}

	function recordValue(value: unknown, key: string): unknown | undefined {
		if (!value || typeof value !== 'object') return;
		return (value as Record<string, unknown>)[key];
	}

	function stringValue(value: unknown): string | undefined {
		if (typeof value === 'string' || typeof value === 'number') {
			return String(value);
		}
		return undefined;
	}
</script>

<div data-ui="ask-user-result">
	<p data-ui="ask-user-question">{question}</p>
	<ul data-ui="ask-user-options">
		{#each options as option, i (i)}
			<li
				data-selected={answer === option || index === i + 1 ? true : undefined}
			>
				<span>{i + 1}.</span>
				{option}
			</li>
		{/each}
	</ul>
	{#if dismissed || answer === undefined}
		<p data-ui="ask-user-answer" data-dismissed>Dismissed without an answer</p>
	{:else if wasCustom}
		<p data-ui="ask-user-answer" data-custom>{answer}</p>
	{:else}
		<p data-ui="ask-user-answer">{answer}</p>
	{/if}
</div>
