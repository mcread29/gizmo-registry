<script lang="ts">
	import { editorFileHref } from './compiler-diagnostics';

	interface Props {
		result: unknown;
		projectPath?: string;
	}

	let { result, projectPath }: Props = $props();
	let summary = $derived(record(record(result)?.summary));
	let tests = $derived(array(record(result)?.tests).filter(isRecord));

	function location(test: Record<string, unknown>) {
		if (typeof test.file !== 'string') return;
		return editorFileHref(
			{
				code: 'UNITY_TEST_FAILURE',
				message: string(test.message) ?? string(test.name) ?? 'Test failure',
				file: test.file,
				...(number(test.line) ? { line: number(test.line) } : {}),
				...(number(test.column) ? { column: number(test.column) } : {}),
			},
			projectPath,
		);
	}

	function locationLabel(test: Record<string, unknown>) {
		return `${test.file}${number(test.line) ? `:${number(test.line)}` : ''}${number(test.column) ? `:${number(test.column)}` : ''}`;
	}

	function record(value: unknown): Record<string, unknown> | undefined {
		return value !== null && typeof value === 'object'
			? (value as Record<string, unknown>)
			: undefined;
	}

	function isRecord(value: unknown): value is Record<string, unknown> {
		return value !== null && typeof value === 'object';
	}

	function array(value: unknown): unknown[] {
		return Array.isArray(value) ? value : [];
	}

	function string(value: unknown): string | undefined {
		return typeof value === 'string' && value ? value : undefined;
	}

	function number(value: unknown): number | undefined {
		return typeof value === 'number' && Number.isFinite(value)
			? value
			: undefined;
	}
</script>

<div
	data-ui="test-report"
	data-state={string(record(result)?.state) ?? 'unknown'}
>
	<div data-ui="test-summary">
		<div>
			<span>Passed</span><strong>{number(summary?.passed) ?? 0}</strong>
		</div>
		<div>
			<span>Failed</span><strong>{number(summary?.failed) ?? 0}</strong>
		</div>
		<div><span>Total</span><strong>{number(summary?.total) ?? 0}</strong></div>
	</div>
	{#if tests.length}
		<div data-ui="test-results">
			{#each tests as test (test)}
				<div
					data-ui="test-result"
					data-state={(string(test.status) ?? 'unknown').toLowerCase()}
				>
					<div>
						<strong>{string(test.name) ?? 'Unnamed test'}</strong>
						<span>{string(test.status) ?? 'Unknown'}</span>
					</div>
					{#if location(test)}
						<a data-ui="compiler-location" href={location(test)}
							>{locationLabel(test)}</a
						>
					{/if}
					{#if string(test.message)}<p>{string(test.message)}</p>{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
