# Setup guide

Everything beyond the three-line quick start: getting an engine, wiring the
in-game addon, and tuning defaults.

## Getting a SimulationCraft engine

The app needs a `simc` binary. Four routes, in order of least effort:

| Route | How | Notes |
|---|---|---|
| Fetch script | `npm run simc:fetch` | Downloads ~120 MB into `vendor/simc` |
| In-app | **Tools → Download SimulationCraft…** | Same download, no checkout needed |
| Container | `npm run simc:docker` | Builds simc from source on Linux (~10–20 min once) |
| Your own | set `SIMC_PATH` in `.env` | Any existing simc install; common locations are auto-probed |

### Know before you download

`downloads.simulationcraft.org` serves over **plain HTTP** (its TLS certificate
does not match the host) and publishes **no checksums**. Both fetch routes say
so before downloading and record the sha256 of what arrived in
`vendor/simc/PROVENANCE.json`, so a changed artifact behind the same filename is
detectable — but the download itself cannot be authenticated. The container
route builds from a pinned upstream source revision instead, which is the
stronger provenance story ([#4](https://github.com/Jameshunter1/unifiedsim/issues/4)).

### If Windows refuses to run simc

SimulationCraft nightlies are unsigned. With **Smart App Control** enforced,
Windows may refuse them — and because reputation is evaluated per binary hash,
two builds of the same version can get different verdicts. Check your state:

```powershell
Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy' -Name VerifiedAndReputablePolicyState
# 0 = off   1 = enforced   2 = evaluation
```

The app probes engines by *executing* them, so a blocked binary shows up in the
UI as a named diagnosis rather than a mystery failure. Smart App Control has no
per-app exception list and turning it off is **permanent**, so the supported
answer is the container: `npm run simc:docker`. The server prefers a native
binary when one runs and falls back to the container automatically.

## The in-game addon

```bash
npm run addon:link      # junctions addon/UnifiedSim into your AddOns folder
```

or **Tools → Install WoW addon…** in the app. Then, in game:

| Command | What it does |
|---|---|
| `/usim sync` | Snapshot, then reload the UI so it reaches disk immediately |
| `/usim save` | Snapshot only; written at your next reload or logout |
| `/usim copy` | Show the profile text to copy by hand |

`/usim sync` reloads on purpose: WoW buffers SavedVariables in memory and only
serialises them on a graceful logout, a character switch, or `ReloadUI()`. The
app watches the file and imports within about half a second of the flush.

Snapshots are scored on completeness and a worse one never replaces a better
one — the client tears down player state before `PLAYER_LOGOUT`, and without
that guard the logout snapshot (empty) would overwrite a good one every
session ([ADR-0012](adr/0012-addon-snapshot-quality-scoring.md)). The watcher
also refuses to auto-import an export with no equipped gear.

If auto-discovery finds the wrong WoW install (or none), point it at the file
with **Tools → Choose SavedVariables file…**.

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
| `PORT` | `8730` | Dev server port; the packaged app picks a free one |

`SIM_CONCURRENCY` stays at 1 deliberately: simc saturates every core it is
given, so parallel jobs make each other slower
([ADR-0014](adr/0014-serial-sim-execution-by-default.md)).

## What a batch means

Selecting variants queues one sim per variant:

- **Talent loadouts** — every loadout in the export, including saved ones.
- **Gear swaps** — bag alternates grouped by slot; each slot's **Compare**
  button sims every wearable alternate against what is equipped.

Any gear batch automatically includes the equipped set as its reference — a
swap on its own produces one number with nothing to compare against. Item level
is never used as a ranking proxy: on the reference profile, a 263 trinket beat
the equipped 289 by +3.97%, which is the whole reason the app simulates instead
of sorting.

Item tooltips get their stats from simc itself (bonus IDs resolved with the
same client data it sims with) — no item database, no API key. simc is also the
authority on wearability: armour of the wrong class is struck through and
excluded rather than failing the run.
