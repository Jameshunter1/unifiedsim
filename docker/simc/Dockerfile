# SimulationCraft, built from source for Linux.
#
# Exists because Windows Smart App Control refuses to execute unsigned
# binaries, which is every SimulationCraft nightly. A Linux build inside a
# container is not subject to that policy.
#
# Build:  npm run simc:docker
# Run:    docker run --rm -v <workdir>:/work usim/simc <profile.simc> json2=/work/out.json

# ---------------------------------------------------------------- build stage
FROM debian:bookworm-slim AS build

RUN apt-get update && apt-get install -y --no-install-recommends \
      git \
      ca-certificates \
      build-essential \
      cmake \
      ninja-build \
      libcurl4-openssl-dev \
 && rm -rf /var/lib/apt/lists/*

# Defaults to simc's default branch, which tracks current retail. Override to
# pin a specific tag or commit:  --build-arg SIMC_REF=<ref>
ARG SIMC_REF=
ARG SIMC_REPO=https://github.com/simulationcraft/simc.git

WORKDIR /src
RUN if [ -n "$SIMC_REF" ]; then \
      git clone --depth 1 --branch "$SIMC_REF" "$SIMC_REPO" . ; \
    else \
      git clone --depth 1 "$SIMC_REPO" . ; \
    fi \
 && git log -1 --format='%H %cd %s' > /BUILD_SOURCE

# Build parallelism is capped deliberately.
#
# simc's generated DBC tables (item_data.cpp, item_naming.cpp, spell_data.cpp)
# are each tens of megabytes of static arrays, and GCC needs on the order of a
# gigabyte of RAM per translation unit for them. Building at -j$(nproc) on a
# 16-core machine reliably exhausts the Docker VM's memory partway through the
# dbc/ targets and kills the daemon, which surfaces as an opaque
# "rpc error: EOF" rather than an OOM.
#
# Raise it only if the VM has plenty of headroom: --build-arg BUILD_JOBS=8
ARG BUILD_JOBS=3

RUN cmake -S . -B build -G Ninja \
      -DCMAKE_BUILD_TYPE=Release \
      -DBUILD_GUI=OFF \
 && cmake --build build -j "${BUILD_JOBS}"

# The CLI target's output path has moved between simc releases, so locate it
# rather than hardcoding build/simc.
RUN found="$(find /src/build -type f -name simc -perm -u+x | head -n 1)" \
 && test -n "$found" \
 && cp "$found" /usr/local/bin/simc \
 && strip /usr/local/bin/simc \
 && /usr/local/bin/simc 2>&1 | head -n 1 || true

# -------------------------------------------------------------- runtime stage
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      libcurl4 \
      libstdc++6 \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /usr/local/bin/simc /usr/local/bin/simc
COPY --from=build /BUILD_SOURCE /BUILD_SOURCE

WORKDIR /work
ENTRYPOINT ["/usr/local/bin/simc"]
