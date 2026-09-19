# Gizmo Extension Registry

A user-curated Git registry for [Gizmo](https://github.com/) Pi extensions and their paired web UI.

## Layout

Each extension lives under `extensions/<id>/` with an `index.ts` Pi entrypoint, a `pi-extension.ts` implementation, and an optional `src/web/index.ts`. Building emits `extensions/<id>.web.js`. Gizmo directory-links the Pi extension and installs its optional browser bundle as one unit.

Some extensions ship skills only: no web bundle, just a `skills/` directory surfaced through `resources_discover` — `skill-authoring`, `matt-pocock-skills`, and `pstack` are of this kind.

The Unity extension also owns its version-aware documentation tools (`unity_docs_*`), which discover and index documentation lazily for the active Unity workspace.

## Build

```sh
pnpm install
pnpm build
```

Add this repository's Git URL in Gizmo under **Settings → Extensions**, then link the extensions you want.
