# Working in this repository

## Branches and commits

Nearly all development happens on one machine, so the registry does not use
remote feature branches or pull requests.

- Day-to-day work lives on a local **scratch branch**. Commit there only when
  asked; never push a scratch branch or open a pull request from it.
- A **release** is a squash of the scratch branch onto `main`: one commit
  with a release-style message, not a merge of the branch history
  (`git merge --squash <branch>` on `main`, then a single commit). The
  `release` branch Gizmo follows is then moved to that commit, and the
  commit is tagged `vMAJOR.MINOR.PATCH` (the registry's own numbering), as
  the Gizmo host's `docs/release.md` describes.
- `main` is therefore a clean history of releases; the scratch branch is
  disposable once squashed.

## Conventions

- Add a `WORKLOG.md` entry (`## YYYY-MM-DD — Title` plus bullets) with every
  substantive change.
- Keep source files under 300 lines, aiming for 250.
- Run `pnpm check` and `pnpm test` once, at the end of a change, plus
  Prettier on the files you touched. Do not re-run the full check after
  every edit; while iterating, run the one extension's tests with
  `pnpm exec vitest run extensions/<name>`.
- The host supplies `@gizmo/extension-api`; during development it links to
  the sibling `../gizmo/packages/extension-api` checkout.
