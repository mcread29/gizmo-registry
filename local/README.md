# Local extensions

A verbatim snapshot of the hand-written extensions that used to sit under
`~/.gizmo/extensions` and `~/.gizmo/extensions-disabled`, taken before they were
deleted from the data directory on 2026-09-20. They were never registry
extensions, so `registryReset` never touched them and nothing else kept a copy:
until this was committed they existed only on one machine.

Nearly all of them are Pi TUI-era code that predates the current extension API —
only `agent-journal` exports `gizmoExtension`, and its factory body is empty.
They were removed because they were not inert: `discoverExtensionEntries` in
`apps/agent-server/src/resources/pi-global-resources.ts` lists every `.ts`/`.js`
file and every directory holding an `index.ts`, with no `gizmoExtension` check,
so all of them showed up in the Extensions list and the enabled ones
(`agent-journal`, `model-info`) were handed to Pi and executed.

The layout mirrors the data directory exactly, so a file restores by copying it
back to the matching path. Note that `model-info` imports `../shared/`, which is
kept here for that reason even though it has no `index.ts` and was never listed.

These are kept as found, and are excluded from `tsconfig.json` (which only
includes `extensions/`, `scripts/`) and from Vitest, because several would not
compile against the current API. Converting one into a registry extension means
moving it to `extensions/<id>/` with an `index.ts`, adding it to
`gizmo.registry.json`, and letting the check and test suites cover it there.
