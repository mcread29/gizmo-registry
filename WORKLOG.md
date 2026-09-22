# Work log

## 2026-09-22 — Subagents view: filter and cost total

- Summary adds a Cost entry (sum of every subagent's cost).
- New `filter` select action (All / Running / Finished) narrows the list; the summary counts still cover every subagent.

## 2026-09-22 — Richer subagents panel, settings-driven tiers, git fixes

- The Subagents panel now shows what a subagent actually is: model,
  thinking level, tier and ladder, turns, tool calls, tokens, cost, session
  file, the full prompt, and a structured transcript (thinking, text, tool
  calls, tool results). Clicking a row opens it. Snapshots and thread files
  carry the new fields; old files still read.
- Subagent tiers can be set in Gizmo's Settings → Extensions → Subagents as
  three `model` fields (base, mid, strong, each with a thinking level). The
  Pi side reads them from `extension-settings.json` ahead of `tiers.json`,
  so `/subagents tiers` still works where no setting exists.
- Git declares a `commitMessageModel` setting and the Changes view gained a
  "Suggest message" action that drafts a commit message through the host's
  `complete()` helper and pre-fills the commit box.
- The `git_status` tool failed with "stdout maxBuffer length exceeded" on
  any working tree whose diff passed 4 MB, although only 60 KB ever reached
  the model. Diffs are now read through a capped reader that stops git at
  the limit and marks the output truncated; per-file diffs get the same
  treatment.
- The status and the commit-context diff leave out `.gizmo/memory`, where
  Gizmo keeps the workspace journal, its digests and facts. Those files
  change on every turn and were swamping the Changes view and the
  `git_status` tool with the agent's own notes. Pathspecs are literal in
  the service, so the diffs are scoped to the files the status kept rather
  than excluded by pattern.
- Unity's Pi-side tool context passes an empty settings bag, matching the
  contract's new required `settings` field.

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
