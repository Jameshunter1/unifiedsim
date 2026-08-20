# Contributing

## Getting set up

```bash
npm install
npm run simc:fetch      # or point SIMC_PATH at an existing simc
npm run desktop         # builds everything and opens the app
```

For UI work, `npm run dev` gives Vite HMR on <http://127.0.0.1:5273> with the
API on `:8730`. The desktop app detects a running dev server and loads it, so
you can keep the app open and still get hot reload.

Requires Node 22+.

## Layout

| Path | |
|---|---|
| `packages/simc-profile` | Parser / serialiser for the SimC addon export format |
| `apps/server` | Express API, job queue, engine interface, SavedVariables watcher |
| `apps/web` | React UI — a plain web page, no Electron APIs |
| `apps/desktop` | Electron shell: hosts the server, tray, menus, native flows |
| `addon/UnifiedSim` | The in-game Lua addon |
| `docker/simc` | Linux simc image, built from source |
| `engine-wasm` | Browser engine scaffold |
| `docs/adr` | Architecture Decision Records |

## Before you open a PR

```bash
npm run typecheck
npm test
npm run build
```

All three must pass. There is no linter; match the surrounding style.

## Things that will get a PR sent back

**The UI must not import Electron APIs.** `apps/web` is a plain web page that
runs in a browser and in the shell, identically. Native actions belong in the
main process as menu or tray items acting on the HTTP API —
[ADR-0008](docs/adr/0008-no-renderer-preload-bridge.md).

**Engine availability must be probed by executing, not by checking a path.** A
present-but-unrunnable binary that advertises itself as working is the exact bug
[ADR-0003](docs/adr/0003-probe-engines-by-executing-them.md) exists to prevent.

**No request handler may spawn a process.** libuv spawns synchronously on the
event loop; a slow spawn freezes the whole server. Use the background probe
cache.

**New backends implement `SimEngine` and change nothing outside `engines/`.**
If a backend needs changes elsewhere, the interface is wrong — say so in the PR
rather than routing around it.

**Serialiser changes must keep the round trip byte-identical.** There is a test.
See [ADR-0009](docs/adr/0009-item-names-in-comments-only.md) for why.

## Writing an ADR

Add one when a decision is expensive to reverse, contradicts the original
blueprint, or would look like an oversight to the next reader. Copy the shape of
an existing file, take the next number, and add a row to
[`docs/adr/README.md`](docs/adr/README.md).

ADRs are immutable once accepted. Changing a decision means a new ADR that
supersedes the old one, not an edit.

## Working on the addon

`npm run addon:link` junctions `addon/UnifiedSim` into your AddOns folder, so
repo edits are live after a `/reload`. The desktop app's
**Tools → Install WoW addon…** does the same with a folder picker.

Lua changes cannot be tested by CI and are easy to get subtly wrong. Two rules
learned the hard way:

- **Wrap every Blizzard API call in `pcall`.** These APIs move between
  expansions; an addon that errors mid-serialisation produces no export at all,
  where one that skips a field still produces a profile that sims.
- **Key on IDs, never on localised strings.** Spec IDs, race *file* tokens and
  SkillLine IDs are locale-independent; `UnitRace()`'s first return is not. Note
  that Undead's file token is `Scourge`, so lowercasing is not sufficient
  either.

And read [ADR-0012](docs/adr/0012-addon-snapshot-quality-scoring.md) before
touching snapshot timing. There is a failure mode there where every function is
individually correct and the artifact on disk is still garbage.

## Commit messages

Imperative mood, explain *why* in the body when it is not obvious. If the answer
is long, it is probably an ADR.
