<script lang="ts">
	import { sourceHref } from './source-href';
	import { diffStat, parseDiff } from './diff';

	interface Props {
		diff: string;
		/** Enables per-line jumps into the editor. */
		file?: string;
		projectPath?: string;
		/** Off where the surrounding UI already names the file. */
		showFileName?: boolean;
		/** Wraps long lines instead of scrolling, for narrow panels. */
		wrap?: boolean;
	}

	let {
		diff,
		file,
		projectPath,
		showFileName = true,
		wrap = false,
	}: Props = $props();

	// The `--- a/x +++ b/x` preamble is noise wherever the file is named already.
	let lines = $derived(
		parseDiff(diff).filter((line) => showFileName || line.kind !== 'file'),
	);
	let stat = $derived(diffStat(lines));
	let fileHref = $derived(sourceHref(file, projectPath));
</script>

<div data-ui="diff" data-wrap={wrap}>
	{#if showFileName}
		<div data-ui="diff-summary">
			{#if file}
				{#if fileHref}
					<a data-ui="diff-file" href={fileHref} title={`Open ${file}`}
						>{file}</a
					>
				{:else}
					<span data-ui="diff-file" title={file}>{file}</span>
				{/if}
			{/if}
			<span data-kind="added">+{stat.added}</span>
			<span data-kind="removed">−{stat.removed}</span>
		</div>
	{/if}
	<div data-ui="diff-body">
		{#each lines as line, index (index)}
			<div data-ui="diff-line" data-kind={line.kind}>
				<span data-ui="diff-gutter">{line.oldLine ?? ''}</span>
				{#if file && line.newLine}
					<a
						data-ui="diff-gutter"
						href={sourceHref(file, projectPath, line.newLine)}
						title={`Open at line ${line.newLine}`}>{line.newLine}</a
					>
				{:else}
					<span data-ui="diff-gutter">{line.newLine ?? ''}</span>
				{/if}
				<span data-ui="diff-text"
					>{#if line.segments}{#each line.segments as segment, part (part)}<span
								data-changed={segment.changed || undefined}>{segment.text}</span
							>{/each}{:else}{line.text || ' '}{/if}</span
				>
			</div>
		{/each}
	</div>
</div>
