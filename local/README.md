# Local extensions

A verbatim snapshot of the hand-written extensions under `~/.gizmo/extensions`
and `~/.gizmo/extensions-disabled` — the ones Gizmo loads directly rather than
through the registry. `registryReset` never touches them, so nothing else was
keeping a copy: until this was committed they existed only on one machine.

The layout mirrors the data directory exactly, so a file restores by copying it
back to the matching path. These are kept as found: they are not registry
extensions, are not linked through `installed.json`, and are excluded from
`tsconfig.json` (which only includes `extensions/`, `scripts/`) and from Vitest,
because several predate the current extension API and would not compile.

Converting one into a registry extension means moving it to `extensions/<id>/`
with an `index.ts`, adding it to `gizmo.registry.json`, and letting the check and
test suites cover it from there.
