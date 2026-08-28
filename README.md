# Gizmo Extension Registry

A user-curated Git registry for [Gizmo](https://github.com/) Pi extensions and their paired web UI.

## Layout

Each extension lives under `extensions/<id>/` with a `pi-extension.ts` entry and an optional `src/web/index.ts`. Building emits `extensions/<id>.web.js`, which Gizmo installs alongside the Pi extension as one unit.

## Build

```sh
pnpm install
pnpm build
```

Add this repository's Git URL in Gizmo under **Settings → Extensions**, then link the extensions you want.
