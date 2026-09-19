# Work log

## 2026-09-19 — Extension UI as data, API major 1

- Ported registry extensions to host-rendered views and tool cards. Removed
  browser entrypoints, bundles, manifests, shared web packages, and build scripts.
  The Activity entry has no view until a host activity data source exists.
- Added Git Changes and Unity editor/console views. Git selections use stable
  path identities across polling; reverting handles new staged files, rejects
  absent paths, and treats filenames literally rather than as Git pathspecs.
  Search and scrape cards now use the host's web-link blocks.
- Regenerated the dependency lockfile for frozen installs. Registry tests exclude
  bundled skills that use their own Bun runner, and Windows Ollama discovery uses
  Windows paths even when exercised by tests on Linux. Vitest uses one worker.
- Rewrote the README around installation without a build. The API development
  dependency still uses a sibling Gizmo checkout pending package publication;
  Gizmo supplies its own API to extensions at runtime.
- Validation: frozen install and `pnpm check` pass; `pnpm test` passes all
  174 tests across 46 files. An isolated Gizmo host linked the real Git extension,
  opened its Changes view, and exercised stage/revert through the WebSocket API.
- The `v1` branch is created from this migration commit on `main`; no remote push
  or installer work is part of this change.
