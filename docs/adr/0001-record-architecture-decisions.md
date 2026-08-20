# ADR-0001: Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-08-20

## Context

This project was built from a supplied architecture blueprint. Several parts of
that blueprint turned out to be wrong in ways that only became visible while
implementing them, and several deliberate departures were made from it. Without
a record, the next person to read the code sees only the outcome — and the most
likely reaction to an unexplained departure is to "fix" it back.

A specific example: the bridge is a Node `fs.watch` watcher rather than the
specified Rust/Tauri agent. That looks like a shortcut. It is not, and the
reasoning is worth exactly one page.

## Decision

Record every architecturally significant decision as a numbered Markdown file in
`docs/adr/`, using Context / Decision / Consequences / Alternatives considered.

A decision is significant if it is expensive to reverse, if it contradicts the
original blueprint, or if a reasonable engineer would otherwise assume it was an
oversight.

ADRs are immutable once accepted. A changed decision gets a new ADR that
supersedes the old one, and the old one is marked `Superseded by ADR-NNNN`
rather than edited. The history of *why* is the point.

## Consequences

- Design discussion has a home that is not a commit message or a code comment.
- `ARCHITECTURE.md` stays a current-state overview and links here for rationale,
  rather than growing into an undated pile of justifications.
- Small cost per decision, paid once.

## Alternatives considered

- **Comments in the code.** Good for local "why is this line like this", poor
  for cross-cutting choices like the engine interface. Kept for the former.
- **A wiki.** Drifts from the code, is not reviewed with it, and is not present
  in a clone.
- **Nothing.** The default. It is why the original blueprint's mistakes were
  repeated in the first place.
