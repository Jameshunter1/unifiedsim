# Third-party notices

UnifiedSim is [MIT licensed](LICENSE).

## SimulationCraft

This project **runs** SimulationCraft; it does not include, bundle or link it.

SimulationCraft is a separate work licensed under the
[GNU General Public License v3.0](https://github.com/simulationcraft/simc).

- `npm run simc:fetch` downloads a prebuilt binary from
  `downloads.simulationcraft.org` into `vendor/`, which is gitignored.
- `npm run simc:docker` builds simc from upstream source inside a container.
- The desktop app's **Tools -> Download SimulationCraft** does the same as the
  first option.

In every case the binary is obtained by the user at setup time and is never
distributed as part of this repository or its releases. `engine-wasm/` contains
an Emscripten entry point intended to be compiled *against* the simc source
tree; that source is likewise fetched, not vendored. Anyone who redistributes a
build that embeds simc takes on GPL-3.0 obligations for it.

## World of Warcraft

World of Warcraft is a trademark of Blizzard Entertainment, Inc. This project is
an unofficial, unaffiliated tool and is not endorsed by Blizzard Entertainment.
