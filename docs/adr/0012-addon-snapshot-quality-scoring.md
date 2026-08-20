# ADR-0012: Snapshots are scored, and a worse one never replaces a better one

- **Status:** Accepted
- **Date:** 2026-08-20

## Context

The in-game addon snapshots the character into `SavedVariables` on login, after
gear or talent changes settle, on `/usim sync`, and on `PLAYER_LOGOUT`.

The logout snapshot was a bug, and an instructive one. WoW buffers
SavedVariables in memory and serialises them to disk **after** `PLAYER_LOGOUT` —
but by the time that event fires the client has already torn down player state:

- `GetSpecialization()` returns `0`
- `C_ClassTalents.GetActiveConfigID()` is unavailable
- every `GetInventoryItemLink()` returns `nil`

So the logout snapshot produced a profile with no spec, no talents and no gear —
and because it was the **last** write before serialisation, it always won. Every
exported file on disk was reliably useless.

Nothing in the code looked wrong. Each function was individually correct and
individually guarded with `pcall`. The addon even recorded accurate notes
("Unknown specialisation id 0", "Could not read the active talent loadout") —
into the same file it had just ruined. The failure was only visible from the
artifact, which is why it survived until the desktop app displayed three empty
profiles side by side.

## Decision

Every snapshot is scored on completeness: `+4` for a `spec=` line, `+4` for a
`talents=` line, `+1` per equipped item. A snapshot whose score is **lower** than
the stored one is discarded rather than written. The score is persisted
alongside the profile so the comparison survives a session.

`GetSpecializationInfo` returning `0` is treated as unknown rather than looked
up in the spec table, since `0` is what the client returns both while loading
and while tearing down.

Defence in depth on the server: the watcher refuses to auto-import an export
with **no equipped gear**, logging why. Such a profile cannot be simulated, and
an automatic import has no user to ask.

## Consequences

- The logout snapshot is kept and is now useful: it captures last-second changes
  when player state is still readable, and is discarded when it is not.
- The guard is general. Any future teardown-adjacent event gets the same
  protection without a new special case.
- A genuinely naked character cannot be auto-imported. Correct: it cannot be
  simulated either. Manual paste still accepts anything.
- Scoring is a heuristic, not a validity proof. It compares snapshots of the
  same character; it does not judge correctness.

## Alternatives considered

- **Remove the logout snapshot.** Fixes this instance and leaves the general
  hazard — any event firing during teardown would reintroduce it.
- **Check `UnitLevel() > 0` or similar as a liveness gate.** Guesses at one
  symptom of teardown rather than measuring the thing actually cared about.
- **Validate only on the server.** The bad snapshot would still overwrite the
  good one on disk, so the user's exported file would stay broken even though
  the app ignored it.
