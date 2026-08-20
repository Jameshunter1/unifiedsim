# Architecture

The target is the tri-tier platform: in-game addon → local bridge → hybrid sim
engine, with a distributed tier for combinatorial work. This document records
what is built, what is deferred, where the original design was wrong, and what
is still unknown.

## Tier status

| Tier | Component | State |
|---|---|---|
| In-game | Lua profile serialiser | **Built.** Untested against a live client. |
| In-game | APL combat overlay | Not started (phase 4). |
| Bridge | SavedVariables watcher | **Built and verified** end to end. |
| Bridge | Tauri/Rust agent | **Deliberately skipped** — see below. |
| Shell | Electron desktop app | **Built.** Hosts the server in-process. |
| Engine | Local SimulationCraft | **Built.** Blocked by OS policy on this machine — see below. |
| Engine | SimulationCraft in Docker | **Built.** The working engine here. |
| Engine | Browser WebAssembly | Scaffold only — `engine-wasm/`. |
| Engine | Distributed workers | Interface slot only. |

## The engine seam

Everything routes through one interface,
[`SimEngine`](apps/server/src/engines/types.ts):

```ts
interface SimEngine {
  status(): Promise<EngineStatus>;
  run(input: EngineRunInput, hooks: EngineHooks): Promise<{ result: SimResult }>;
}
```

The queue, store, event stream and UI only know this shape. Adding the WASM or
distributed tier is implementing it and registering the instance — no changes
anywhere else. Unimplemented tiers are registered as placeholders that report
`available: false` with a reason, so the UI shows the seam honestly rather than
hiding it.

## Corrections to the original design

These were in the source blueprint and would have cost real time.

### `sim_t` has no `parse_options` / `generate_json_report`

The proposed wrapper called `sim->parse_options(str)` and
`sim->generate_json_report()`. Neither exists. The real path is
`option_db_t::parse_text()` → `sim_control_t` → `sim_t::setup()` →
`sim_t::execute()` → `report::print_suite()`.

`engine-wasm/sc_wasm.cpp` therefore appends a `json2=` option pointing at
Emscripten's in-memory filesystem and reads the file back after
`print_suite()`. Three stable public symbols instead of report internals that
move between releases.

### The Lua serialiser emitted a profile simc cannot read

Four separate problems in the proposed `ExportCharacterProfile`:

| Problem | Consequence | Fix |
|---|---|---|
| `spec=` written as the numeric spec ID | `spec=64`, not `spec=frost` | Spec ID → token table (`Data.lua`) |
| `race=` from `UnitRace()`'s first return | Localised display name | Race *file* token → simc token. Undead's file token is `Scourge`, so lowercasing is not enough either |
| Items as `items,id=<slotIndex>,…` | Not a simc slot format | `head=,id=…,bonus_id=…` per slot |
| Talents from `GetConfigInfo().treeText` | No such field | `C_Traits.GenerateImportString(configID)` |

The bonus-ID parse also matters: bonus IDs in an item link are length-prefixed,
and the modifier block sits after them. Reading a fixed offset yields wrong
bonus IDs and therefore a wrong item level.

### Tauri/Rust for the bridge buys nothing yet

The design specified a native agent registering `ReadDirectoryChangesW` on
Windows and `inotify` on Linux. Node's `fs.watch` *is* those APIs. A separate
Rust process and its build toolchain would add a language and a deployment
artifact for identical behaviour.

The watcher lives in the Node server ([`watcher.ts`](apps/server/src/watcher.ts))
and is verified: an unchanged file at boot does not re-import, and a rewrite is
picked up and imported within about half a second.

Tauri earns its place when you want a distributable tray app that runs without
a terminal. That is now built — as Electron, not Tauri.

### Why the desktop shell is Electron, not Tauri

The backend is a Node server: a job queue, a file watcher, and engines that
spawn child processes. Electron hosts that in its own main process. Tauri would
require shipping Node as a sidecar executable, which means a second unsigned
binary on a machine where Smart App Control is enforced, plus an IPC protocol
between the Rust shell and the Node sidecar to replace what is currently a
function call.

Tauri's advantage is bundle size — roughly 10 MB against Electron's ~190 MB.
That is not the binding constraint next to a ~500 MB SimulationCraft install.

The server was refactored to expose `startServer()` rather than booting on
import, so the same code serves `npm run dev` and the desktop app. The renderer
gets **no preload bridge and no Node access**: every native action is a menu or
tray item in the main process, which acts on the app's own HTTP API. The UI
therefore stays a plain web page that still runs in a browser, and native
actions reach the renderer through the existing SSE stream rather than a
bespoke IPC channel.

### Latency below 100 ms was the wrong thing to optimise

The blueprint targets sub-100 ms from disk write to UI. The watcher debounces
for 400 ms on purpose — the client emits several change events per flush, and
importing a half-written file is worse than importing 400 ms later. The real
latency floor is the `/reload` the player has to perform anyway, which is
seconds. Debounce is free.

## Deliberate design choices

**Flat JSON store, not SQLite.** A few thousand rows on one machine. A native
module would add a Windows build step for no benefit. Writes are atomic
(temp + rename), so a crash cannot truncate the store the way the game's own
SavedVariables can.

**SSE, not WebSockets.** The stream is server → client only. SSE reconnects on
its own with no heartbeat protocol to maintain.

**Sim options in the profile text, output paths on the command line.** The
stored profile stays exactly what you could paste into simc or Raidbots
yourself; only machine-specific paths are injected as arguments.

**Item names live in comments, never inline.** Names are recovered from the
comment above each item and re-emitted there. Putting a name back into the item
line breaks byte-identical round-tripping and risks feeding simc a name
containing a comma. A test asserts the round trip.

**`SIM_CONCURRENCY=1` by default.** SimC saturates every core it is given.

## Combinatorial scale

Permutations for an exhaustive gear search:

```
S = T · G · ∏ mᵢ · C(m_ring, 2) · C(m_trinket, 2)
```

Implemented as `permutationCount()` and surfaced in the UI. For the reference
profile: **30** single-change variants against **414,720** exhaustive
permutations. Roughly 8 s per sim on 15 threads puts the exhaustive search near
38 CPU-days — the concrete reason the distributed tier exists, and a number
worth showing a user before they ask for "Top Gear".

The tiering rule follows from it: single sims and small batches on local or
browser engines; anything past a few hundred permutations needs fan-out.

## Open questions

**`slot_high_watermarks` indices are unmapped.** The export carries
`0:292:292/1:263:263/…` for 17 slots. Neither simc's `slot_e` ordering nor WoW's
`INVSLOT` constants reproduce the reference character's item levels, and one
slot is missing entirely (trinket2, the only 302 in the set, appears nowhere).
Both numbers in each triple are equal for all but two entries, which argues
against a plain current/max reading.

The parser keeps raw indices and leaves the slot label `undefined` rather than
guessing. Resolving it needs two exports from the same character with one known
slot changed. Until then an upgrade planner built on this field would be
silently wrong, which is why one is not built.

**The local engine is blocked on this machine.** Smart App Control is enforced
(`VerifiedAndReputablePolicyState = 1`) and SimulationCraft nightlies are
unsigned, so Windows refuses to execute `vendor/simc/simc.exe`. The binary
downloaded and extracted correctly; it simply cannot run.

This is why `locateSimc()` probes by *executing* the binary rather than by
checking that the file exists. A file-existence check would advertise a working
engine and fail at the first sim with an opaque `EPERM`. The probe turns that
into a named diagnosis at startup.

The fix went in behind the existing seam: `docker-simc` builds simc from source
on Linux, where the policy does not apply. Nothing outside
`engines/` changed to add it — which is the seam earning its keep. Engine
selection is now `resolveDefaultEngine()`, which walks a preference order and
returns the first tier that reports itself genuinely runnable, so the same
install works whether or not the native binary is permitted.

Report parsing and progress scraping live in `engines/simcReport.ts`, shared by
both simc-backed engines rather than duplicated.

**The ability breakdown covered 37% of the player's damage.** Fixed, and worth
recording alongside the addon bug below because it failed the same way: every
individual number was real and the chart looked entirely reasonable. simc's
stats tree is recursive, and abilities dealing damage through child spells
report nothing in `actual_amount`. The chart omitted the largest damage source
outright and ranked a mid-tier ability first. Only adding the shares up and
comparing them to the player's own DPS revealed it. Shares now sum to 1 by
construction, with a test on the invariant, and stored results are repaired on
boot. See [ADR-0015](docs/adr/0015-ability-breakdown-uses-compound-amount.md).

**The addon's logout snapshot destroyed every export.** Now fixed, and worth
recording because the failure was invisible from the code alone. The addon
snapshotted on `PLAYER_LOGOUT`, but the client has already torn down player
state by then: `GetSpecialization()` returns 0 and every
`GetInventoryItemLink()` returns nil. Since SavedVariables are serialised
*after* that event, the empty snapshot was the last write and always won — so
the file on disk was reliably useless while every individual function looked
correct. Snapshots now carry a completeness score and a worse one cannot
replace a better one, and the watcher refuses to auto-import an export with no
equipped gear.

**The addon is otherwise untested in game.** Every Blizzard API call is wrapped in
`pcall` and degrades to a note rather than an error, and the field mappings are
keyed on locale-independent IDs. But no line of it has executed against a real
client, and 12.x API surfaces may have moved. Treat the first `/usim sync` as
the real test — the copy-paste path works regardless.

**Crafted item fidelity.** The addon does not yet emit `crafted_stats`,
`crafting_quality` or `content_tuning`; the modifier-type constants that encode
them are undocumented. It stores each item's full raw item string in
SavedVariables instead, so the bridge can recover those fields later without an
addon update. The server-side parser already reads all three from the official
SimC addon's exports.

## Phase order from here

1. **Verify the addon in game.** Cheapest, and it unblocks the automated loop.
2. **Resolve the watermark mapping**, then build the upgrade planner on it.
3. **WASM engine** — the largest single piece of work, mostly binary size and
   the generated data tables. See `engine-wasm/README.md`.
4. **Distributed tier**, once there is a search big enough to need it.
5. **APL overlay** — independent of everything above; a separate project that
   happens to share the addon.
