#!/usr/bin/env bash
#
# Builds SimulationCraft to WebAssembly.
#
# Prerequisites: emsdk activated in this shell (`source emsdk/emsdk_env.sh`)
# and the simc source checked out into engine-wasm/simc-src.
#
# This has NOT been run to completion in this repo. Treat it as the starting
# point for the port, not a turnkey build: expect to iterate on which simc
# modules link and which can be excluded.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="${HERE}/simc-src"
BUILD="${HERE}/build"
DIST="${HERE}/dist"

if ! command -v emcc >/dev/null 2>&1; then
  echo "emcc not on PATH. Run: source /path/to/emsdk/emsdk_env.sh" >&2
  exit 1
fi

if [ ! -d "${SRC}/engine" ]; then
  echo "simc source not found at ${SRC}." >&2
  echo "Run: git clone --depth 1 https://github.com/simulationcraft/simc.git ${SRC}" >&2
  exit 1
fi

mkdir -p "${BUILD}" "${DIST}"

# Keep our entry point beside simc's own sources so relative includes resolve.
cp "${HERE}/sc_wasm.cpp" "${SRC}/engine/sc_wasm.cpp"

# SC_NO_NETWORKING  : no libcurl in the browser; armory imports go through the
#                     server tier instead.
# SC_NO_THREADING   : parallelism is one module instance per Web Worker, so the
#                     internal thread pool (and SharedArrayBuffer with it) is
#                     not needed.
# BUILD_GUI=OFF     : Qt has no place here.
emcmake cmake -S "${SRC}" -B "${BUILD}" \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_GUI=OFF \
  -DSC_NO_NETWORKING=ON \
  -DSC_NO_THREADING=ON \
  -DCMAKE_CXX_FLAGS="-O3 -flto -fno-exceptions=0 -DSC_WASM=1"

emmake cmake --build "${BUILD}" -j "$(nproc 2>/dev/null || sysctl -n hw.ncpu)"

# Link the engine objects into a module.
#
# MODULARIZE + EXPORT_ES6 give one factory per Worker instead of a global, which
# is what the worker pool needs. ALLOW_MEMORY_GROWTH because a sim's peak
# footprint depends on the profile, and INITIAL_MEMORY is a guess.
emcc "${BUILD}"/CMakeFiles/**/sc_wasm.cpp.o \
  $(find "${BUILD}" -name '*.a' -print) \
  -O3 -flto \
  -o "${DIST}/simc.js" \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s EXPORT_NAME=createSimc \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s INITIAL_MEMORY=268435456 \
  -s STACK_SIZE=8388608 \
  -s FILESYSTEM=1 \
  -s EXPORTED_FUNCTIONS='["_sc_run_simulation","_sc_free","_sc_version","_malloc","_free"]' \
  -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","UTF8ToString","stringToNewUTF8"]' \
  -s ENVIRONMENT=web,worker \
  --closure 0

echo
echo "Built:"
ls -lh "${DIST}"
echo
echo "Check the gzipped size -- that is what users actually download:"
gzip -c "${DIST}/simc.wasm" | wc -c | awk '{printf "  %.1f MB gzipped\n", $1/1048576}'
