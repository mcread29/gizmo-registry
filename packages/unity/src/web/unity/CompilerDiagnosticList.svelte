<script lang="ts">
	import {
		compilerDiagnostics,
		editorFileHref,
		type CompilerDiagnostic,
	} from './compiler-diagnostics';

	interface Props {
		errors: unknown[];
		projectPath?: string;
	}

	let { errors, projectPath }: Props = $props();
	let diagnostics = $derived(compilerDiagnostics(errors));

	function locationLabel(diagnostic: CompilerDiagnostic): string {
		return `${diagnostic.file}${diagnostic.line ? `:${diagnostic.line}` : ''}${diagnostic.column ? `:${diagnostic.column}` : ''}`;
	}
</script>

<div data-ui="compiler-errors">
	{#each diagnostics as diagnostic (diagnostic)}
		<div
			data-ui="compiler-error"
			data-severity={diagnostic.severity ?? 'error'}
		>
			{#if editorFileHref(diagnostic, projectPath)}
				<a
					data-ui="compiler-location"
					href={editorFileHref(diagnostic, projectPath)}
					title="Open in editor">{locationLabel(diagnostic)}</a
				>
			{/if}
			<p><code>{diagnostic.code}</code> {diagnostic.message}</p>
		</div>
	{/each}
</div>
