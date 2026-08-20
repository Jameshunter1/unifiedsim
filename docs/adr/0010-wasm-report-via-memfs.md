# ADR-0010: The WASM wrapper reads its report from MEMFS, not an internal API

- **Status:** Accepted
- **Date:** 2026-08-19
- **Applies to:** `engine-wasm/` (scaffold; no `.wasm` built yet)

## Context

The blueprint's Emscripten entry point was:

```cpp
sim_t* sim = new sim_t();
sim->parse_options(profile_str);
sim->execute();
std::string json_output = sim->generate_json_report();
```

Neither `parse_options(std::string)` nor `generate_json_report()` exists on
`sim_t`. The real flow, as `sc_main.cpp` uses it, is:

```
option_db_t::parse_text()  →  sim_control_t  →  sim_t::setup()
                           →  sim_t::execute()  →  report::print_suite()
```

Reports are written by the report layer to whatever output paths the options
named. There is a JSON writer, but its signature lives in report internals that
move between releases — and this is a fork of a large C++ project that ships a
new build every game patch. Every internal symbol depended on is a merge
conflict scheduled for the next patch.

## Decision

The wrapper appends a `json2=` option pointing at a path in Emscripten's
in-memory filesystem, lets simc write the report exactly as it does natively,
then reads the file back and returns it as a heap string.

That leaves the wrapper standing on three stable public symbols:
`option_db_t::parse_text`, `sim_t::setup`, and `report::print_suite`.

Two related choices in the same file:

- **`threads=1` is pinned.** Parallelism comes from one module instance per Web
  Worker, not simc's thread pool. simc's threading needs pthreads, which needs
  `SharedArrayBuffer`, which needs `Cross-Origin-Opener-Policy` and
  `Cross-Origin-Embedder-Policy` on every response — a deployment constraint
  that also breaks embedding third-party resources.
- **`sc_run_simulation` takes a seed.** Splitting 10,000 iterations across
  8 workers only yields a valid aggregate if each worker seeds differently.
  Otherwise you get eight copies of the same fight and a standard error that is
  confidently wrong.

## Consequences

- The wrapper should survive simc upgrades that reshuffle report internals.
- One extra write and read through MEMFS per simulation. Irrelevant next to the
  simulation itself.
- Aggregating worker results is now the caller's problem, and the error term
  does not average — variance must be pooled. The formula is written down in
  [`engine-wasm/README.md`](../../engine-wasm/README.md) precisely because
  averaging `mean_std_dev` looks right and understates error by about √N.

## Alternatives considered

- **Call the JSON report function directly.** One less indirection, pinned to
  internals that change.
- **Return simc's own text report and parse it.** Strictly worse: the text
  format is for humans and changes more freely than the JSON schema.
