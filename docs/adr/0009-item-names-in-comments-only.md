# ADR-0009: Item names live in comments, never in the item line

- **Status:** Accepted
- **Date:** 2026-08-19

## Context

The SimulationCraft addon export is lossy in a specific way: item **names** and
**item levels** appear only as a comment above each item.

```
# Venom-Cursed Dragonhawk's Plumage (292)
head=,id=277792,bonus_id=12833/41/13696/13662
```

The item line itself carries an empty name. The parser recovers the name and
ilvl from that comment so the UI can show real item names without shipping an
item database — a genuinely useful trick.

The question is what to do on the way back out. Having recovered the name, the
natural move is to emit it: `head=Venom-Cursed Dragonhawk's Plumage,id=277792`.
simc accepts that form.

Two problems. First, it breaks byte-identical round-tripping: text in, text out,
not the same text. That matters because the stored profile is meant to be
exactly what you could paste into simc or Raidbots yourself. Second, item names
can contain commas, and the item line is comma-delimited — so an emitted name
can corrupt the very line it is decorating.

## Decision

`serializeItem()` emits an **empty** name by default, matching the addon
byte-for-byte. The recovered name goes back into the comment line above, where
it came from.

An `includeName` parameter exists for callers that genuinely want it, and is
unused.

A test asserts the round trip on a real export, including an item whose name
contains a comma.

## Consequences

- A profile that goes through parse → serialize is unchanged, so a diff between
  what the addon wrote and what we would run is empty. That is a strong property
  when debugging "why did this sim differ".
- Names remain visible to humans reading the generated profile.
- The name is display metadata, not authoritative — the item id and bonus ids
  are. Making the serialiser drop it enforces that distinction rather than
  merely stating it.

## Alternatives considered

- **Emit the name inline.** Slightly more readable for a human pasting the
  profile elsewhere; breaks round-tripping and risks comma corruption.
- **Escape or strip commas in names.** Solves the corruption and keeps the
  round trip broken.
- **Drop names entirely.** Loses the free item-name lookup the comments provide,
  which would then require an item database to replace.
