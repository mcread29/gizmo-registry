# Gizmo Extension Registry

A curated Git registry of Pi extensions with optional Gizmo views, commands,
settings, status items, and tool cards. UI contributions are typed data rendered
by Gizmo; extensions ship no browser code and need no build step.

## Install and develop

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
```

Gizmo follows the `v1` branch for extension API major 1 and checks
`gizmoApiVersion` in `gizmo.registry.json`. Link extensions under
**Settings → Extensions**. Updates install server dependencies and reload linked
extensions. The host supplies `@gizmo/extension-api` at runtime.

For development, the API dependency currently links to a sibling Gizmo checkout
at `../gizmo/packages/extension-api`. Publishing the API and replacing this local
link with a pinned package version remain prerequisites for a standalone release.

## Layout

Each extension lives under `extensions/<id>/`. Its `index.ts` default-exports
a Pi entrypoint and optionally exports `gizmoExtension`, built with
`defineExtension` from `@gizmo/extension-api`. Views send blocks and actions;
Gizmo owns rendering, selection, inputs, and confirmation dialogs.

Skills-only entries include `skill-authoring`, `matt-pocock-skills`, and `pstack`.
Their bundled scripts use their own test runners; registry Vitest excludes
`extensions/*/skills/**`.

Unity also owns version-aware `unity_docs_*` tools, indexing documentation lazily
for the active workspace. The Activity entry currently contributes no UI because
the API does not expose the host's tool activity stream.
