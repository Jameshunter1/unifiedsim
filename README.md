# UnifiedSim

[![CI](https://github.com/Jameshunter1/unifiedsim/actions/workflows/ci.yml/badge.svg)](https://github.com/Jameshunter1/unifiedsim/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A local-first World of Warcraft simulation runner: import a character, sim gear
and talent variations against SimulationCraft, and track DPS over time.

Built around the tri-tier design in [ARCHITECTURE.md](ARCHITECTURE.md) — in-game
addon, local bridge, pluggable sim engine. What runs today is the local spine;
the WebAssembly and distributed tiers are scaffolded behind the same interface
and report themselves unavailable until built.

```
                        ┌──────────── Electron desktop app ────────────┐
WoW client ──/usim sync──▶ SavedVariables.lua                          │
                        │         │  fs.watch (ReadDirectoryChangesW)  │
                        │         ▼                                    │
                        │  Node server ──▶ job queue ──▶ SimEngine     │
                        │         │                  ├── local-simc  ✅ │
                        │  SSE    │                  ├── docker-simc ✅ │
                        │         ▼                  ├── wasm     ▫    │
                        │  React UI (charts)         └── cloud    ▫    │
                        └──────────────────────────────────────────────┘
```

The server runs *inside* the desktop app's main process — one process, no port
handshake, no orphaned server if the window dies, and native status (taskbar
progress, tray, notifications) that keeps updating with the window closed.

## Setup

```bash
npm install
npm run simc:fetch      # downloads SimulationCraft into vendor/ -- see the note below
npm run desktop         # builds everything and opens the app
```

That is the whole thing: no terminal to keep open, no browser tab. Paste a
`/simc` export or use **File → Import profile from file…** and hit Run.

Prefer a browser? `npm run dev` still serves the UI on <http://127.0.0.1:5273>
with the API on `:8730`. The renderer is a plain web page with no Electron
bridge, so both paths run identical code.

## Desktop app

| | |
|---|---|
| **Tray** | Live queue state; closing the window while sims run hides to the tray instead of killing the batch |
| **Taskbar** | Progress bar tracks the running batch; the button flashes when it finishes |
| **Notifications** | Batch completion names the winning variant and its DPS |
| **File** | Import a profile from a file or the clipboard; open the data folder |
| **Tools** | Download SimulationCraft, install the WoW addon, pick the SavedVariables file, re-check engines |

State lives in `data/` for a checkout and in the OS user-data directory for an
installed build, so a dev session and an installed copy never share a store.

### Packaging

```bash
npm run desktop:pack    # unpacked app in apps/desktop/release/win-unpacked
npm run desktop:dist    # NSIS installer + portable exe
```

Two things about packaging on Windows, both learned the hard way:

- **Builds are unsigned, and Smart App Control may refuse to launch them.**
  Reputation is evaluated per binary, so this is not consistent — of two builds
  made minutes apart here, one launched and the next was blocked outright.
  Running from a checkout via `npm run desktop` is unaffected, because that uses
  the widely distributed `electron.exe`. Fixing it properly means code signing.
- **The build needs a pre-seeded signing cache.** electron-builder downloads a
  `winCodeSign` bundle containing macOS `.dylib` symlinks, and creating symlinks
  on Windows requires Developer Mode or an elevated shell. Without it the
  extraction fails and the build aborts. Either enable Developer Mode
  (Settings → System → For developers), or extract the archive once yourself
  skipping the darwin tree:

  ```bash
  7za x <cache>/winCodeSign/<n>.7z -o<cache>/winCodeSign/winCodeSign-2.6.0 -x'!darwin'
  ```

`npm run desktop:pack` also stages the workspace packages into
`apps/desktop/node_modules` and removes them afterwards — see
[`scripts/pack-desktop.mjs`](scripts/pack-desktop.mjs) for why that is necessary.

### About `npm run simc:fetch`

It downloads a ~120 MB executable from `downloads.simulationcraft.org`. Two
things worth knowing before you run it:

- Upstream's TLS certificate does not match the host, so the fetch uses plain
  **HTTP**.
- Upstream publishes **no checksums or signatures**.

The script prints both facts, asks for confirmation, and records the sha256 of
what it received in `vendor/simc/PROVENANCE.json` so a later fetch can tell you
if the artifact behind a filename changed. If you would rather not, install
SimulationCraft yourself and point `SIMC_PATH` at it in `.env` — the server also
probes the usual install locations automatically.

### If Windows refuses to run simc

SimulationCraft nightlies are **unsigned**. With **Smart App Control** enforced,
Windows blocks them outright, and the download succeeds while every sim fails.

Check whether that is your situation:

```powershell
Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy' -Name VerifiedAndReputablePolicyState
# 0 = off   1 = enforced   2 = evaluation
```

The server detects this at startup and says so instead of advertising a working
engine, so you will see it in the UI rather than as a mystery failure.

Smart App Control has **no per-app exception list**, and turning it off is
**permanent** — it cannot be re-enabled without reinstalling Windows. So the
supported route is a container:

```bash
npm run simc:docker      # builds simc from source on Linux, ~10-20 min once
```

Linux simc is not subject to the policy. The server prefers a native binary
when one runs and falls back to the container automatically, so nothing else
changes — same UI, same API, same reports.

Other options, if you would rather not use Docker: install a **signed**
SimulationCraft build (the policy allows those), build simc inside WSL and
point `SIMC_PATH` at it, or disable Smart App Control — only if you understand
that is one-way.

## Engines

The server registers several backends behind one `SimEngine` interface and uses
the first that actually works.

| Engine | State | Notes |
|---|---|---|
| `local-simc` | works when the OS permits | Native binary. Fastest — no mount, no container start |
| `docker-simc` | works once the image is built | `npm run simc:docker`. Immune to unsigned-binary blocking |
| `wasm` | scaffold | Browser-side. See `engine-wasm/README.md` |
| `cloud` | interface slot | For searches too large for one machine |

Availability is probed by *executing* the engine, not by checking a file
exists — a present-but-unrunnable binary would otherwise advertise itself as
working and fail on the first sim. The header shows each tier's real state and
the reason when one is unavailable.

## The in-game addon (optional)

```bash
npm run addon:link      # junctions addon/UnifiedSim into your AddOns folder
```

Then in game: enable **UnifiedSim**, and run `/usim sync`.

| Command | What it does |
|---|---|
| `/usim sync` | Snapshot, then reload the UI so it reaches disk immediately |
| `/usim save` | Snapshot only; written out at your next reload or logout |
| `/usim copy` | Show the profile text to copy by hand |

`/usim sync` reloads on purpose. WoW buffers SavedVariables in memory and only
serialises them on a graceful logout, a character switch, or `ReloadUI()` — so
without the reload your snapshot sits in memory and the bridge never sees it.
The server picks the file up within about half a second of the flush.

The addon also snapshots automatically on login, on logout, and a couple of
seconds after gear or talent changes settle — but those only reach disk on the
next flush.

A snapshot is scored on how complete it is (spec, talents, item count) and a
worse one never replaces a better one. That guard matters at logout: the client
has already torn player state down by then, so the export would come out with
no spec, no talents and no gear — and since the logout snapshot is the last
write before the file is serialised, without the guard *every* exported profile
would be the empty one. The server independently refuses to auto-import an
export with no equipped gear, since it could not be simulated anyway.

## Configuration

Copy `.env.example` to `.env`. Everything has a working default.

| Variable | Default | Notes |
|---|---|---|
| `SIMC_PATH` | auto-detected | Explicit path to the simc executable |
| `SIMC_ITERATIONS` | `10000` | Ceiling; `target_error` usually stops earlier |
| `SIMC_TARGET_ERROR` | `0.2` | Convergence target, in percent |
| `SIMC_FIGHT_STYLE` | `Patchwerk` | |
| `SIMC_THREADS` | cores − 1 | Threads per sim |
| `SIM_CONCURRENCY` | `1` | Parallel jobs — see below |
| `WOW_SAVEDVARS` | auto-detected | Full path to `UnifiedSim.lua` |
| `PORT` | `8730` | |

`SIM_CONCURRENCY` defaults to 1 deliberately. SimC saturates every core it is
given, so running two jobs at once mostly makes both slower. Raise it only if
you also lower `SIMC_THREADS`.

## What the batch runner gives you

Selecting variants builds one sim per variant and queues them together:

- **Talent loadouts** — every loadout in your export, including the saved ones
  the addon writes out commented. Answers "is my M+ build actually better on
  this fight?"
- **Gear swaps** — every item in your bags that could go in an equipped slot.
  Rings and trinkets are tried in both positions, because the export only ever
  lists an alternate against the first one.

Results rank by DPS with the simulation's own error bars, and each variant shows
its delta against the baseline. Item level is *not* used to filter candidates: a
lower-ilvl trinket with the right effect routinely beats a higher-ilvl one.

The UI also reports the size of the exhaustive search the batch samples from.
For the profile this was built against that is 414,720 permutations versus 30
single-change variants — which is the honest reason a "Top Gear" feature needs
more than one machine, and why the engine interface has a distributed slot.

## Documentation

| | |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | How the system fits together today, and what is still unknown |
| [docs/adr/](docs/adr/README.md) | Why it is built this way — 14 decision records |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Setup, the rules a PR is held to, and how to work on the addon |
| [engine-wasm/README.md](engine-wasm/README.md) | What porting simc to WebAssembly actually involves |

Four decisions depart from the original design brief — the bridge, the desktop
shell, the WASM entry point and the addon's snapshot timing. Each has an ADR
explaining why, so they are not mistaken for oversights and quietly reverted.

## Layout

| Path | |
|---|---|
| `packages/simc-profile` | Parser / serialiser for the SimC addon export format (40 tests) |
| `apps/server` | Express API, job queue, engine interface, SavedVariables watcher (21 tests) |
| `apps/web` | React UI (also runs standalone in a browser) |
| `apps/desktop` | Electron shell: hosts the server, tray, menus, native install flows |
| `addon/UnifiedSim` | The in-game addon |
| `docker/simc` | Linux simc image, built from source |
| `engine-wasm` | Browser engine scaffold — see its README |
| `fixtures` | Real export used by the tests |

## Development

```bash
npm test            # profile parser tests
npm run typecheck   # all workspaces
npm run build       # all workspaces
```

The server needs `@usim/simc-profile` built at least once
(`npm run build --workspace=@usim/simc-profile`); `npm run build` does that
first.
