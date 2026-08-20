# engine-wasm — SimulationCraft in the browser

Status: **scaffold, not built.** `sc_wasm.cpp` and `build.sh` are real and
reviewed; no `.wasm` has been produced yet. The server reports the `wasm` engine
as unavailable until one exists, and says why.

## Why this tier exists

Every single-character sim run on a client CPU is a sim you don't pay a cloud
bill for and don't queue behind anyone. The tradeoff is a one-time build cost
and a permanent maintenance cost: this is a fork of a large C++ codebase that
ships a new build every game patch.

## What is genuinely hard here

Be clear-eyed before starting. These are the parts that consume the time:

1. **Build time.** A full Emscripten build of simc is tens of minutes on a fast
   machine, and you will iterate on it more than once.
2. **Binary size.** simc statically links generated spell/item/talent tables. A
   naive `-O3` build lands well above 30 MB. Getting to single-digit megabytes
   means excluding report formatters and moving data tables out of the binary,
   which means touching the generated-data build step — the largest piece of
   work in this directory.
3. **Threads.** `pthreads` in WASM needs `SharedArrayBuffer`, which needs
   `Cross-Origin-Opener-Policy: same-origin` and
   `Cross-Origin-Embedder-Policy: require-corp` on every response. That is a
   deployment constraint, not a code one, and it breaks embedding third-party
   resources. The wrapper therefore pins `threads=1` and expects parallelism
   from **one module instance per Web Worker** — no shared memory, no headers.
4. **Seeding.** Splitting 10,000 iterations across 8 workers only gives a valid
   aggregate if every worker uses a different RNG seed. `sc_run_simulation`
   takes one for exactly this reason. Get it wrong and you get eight copies of
   the same fight and a standard error that is confidently wrong.

## Aggregating worker results

Per-worker mean DPS combines by iteration-weighted mean. The **error does not**
— you cannot average standard errors. Pool the variance:

```
N     = Σ nᵢ
mean  = Σ (nᵢ · meanᵢ) / N
var   = Σ (nᵢ · (varᵢ + meanᵢ²)) / N − mean²
stderr = sqrt(var / N)
```

Use `collected_data.dps.stddev` from each worker's report for `varᵢ = stddevᵢ²`.
Averaging the reported `mean_std_dev` values instead understates the true error
by roughly √(number of workers).

## Build

```bash
# 1. Emscripten toolchain
git clone https://github.com/emscripten-core/emsdk.git
./emsdk/emsdk install latest && ./emsdk/emsdk activate latest
source ./emsdk/emsdk_env.sh

# 2. SimulationCraft source
git clone --depth 1 https://github.com/simulationcraft/simc.git engine-wasm/simc-src

# 3. Build
./engine-wasm/build.sh
```

Output lands in `engine-wasm/dist/` as `simc.js` + `simc.wasm`.

## Wiring it up

Once a build exists, replace the `PlannedEngine` placeholder for `wasm` in
[`apps/server/src/engines/index.ts`](../apps/server/src/engines/index.ts) — or,
better, load it directly in the browser and skip the server round trip
entirely, which is the whole point of this tier. The `SimEngine` interface is
the seam either way.
