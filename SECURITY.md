# Security policy

## Reporting

Report vulnerabilities through
[GitHub's private advisory form](https://github.com/Jameshunter1/unifiedsim/security/advisories/new).
Please do not open a public issue for anything exploitable.

This is a hobby project with no SLA. Expect acknowledgement within a week.

## What this app does by design

Two behaviours look alarming and are intentional. Knowing which is which saves
everyone time.

**It downloads and executes a third-party binary.** `npm run simc:fetch` and the
desktop app's **Tools → Download SimulationCraft** fetch a ~120 MB executable
from `downloads.simulationcraft.org` and run it. That download is over **plain
HTTP** (upstream's TLS certificate does not match the host) and upstream
publishes **no checksums or signatures**. The user is prompted with both facts
and the sha256 of what arrived is recorded in `vendor/simc/PROVENANCE.json`.

This is a genuine weakness in the supply chain, it is tracked in
[#4](https://github.com/Jameshunter1/unifiedsim/issues/4), and it is not a
finding — it is the current state, documented. Reports that improve it are very
welcome; reports that restate it are not news.

**It reads a file the game writes and parses it.** The bridge watches
`UnifiedSim.lua` in your WoW `SavedVariables` folder. Parsing is a targeted
string scan, not a Lua interpreter, and nothing from that file is ever executed.

## In scope

- Anything that lets a malicious **profile**, **SavedVariables file** or **API
  request** execute code, read files outside the data directory, or escape the
  intended sandbox.
- The server binds `127.0.0.1` only. Anything that exposes it beyond loopback,
  or that lets a web page in a browser reach it and act as the user, is in
  scope — note CORS is currently permissive, which is worth scrutiny.
- Renderer escapes: the UI runs with `contextIsolation: true`,
  `nodeIntegration: false`, `sandbox: true` and **no preload bridge**
  ([ADR-0008](docs/adr/0008-no-renderer-preload-bridge.md)). Anything reaching
  Node from page content is in scope.
- Path traversal in run report serving, addon installation, or profile import.

## Out of scope

- Simulation accuracy or game modelling — that is
  [SimulationCraft](https://github.com/simulationcraft/simc) upstream.
- Unsigned builds being blocked by Smart App Control or SmartScreen. Known,
  tracked in [#1](https://github.com/Jameshunter1/unifiedsim/issues/1).
- Vulnerabilities in `simc` itself. Report those upstream.
- Anything requiring an attacker who already has local code execution as your
  user — at that point they can edit the data directory directly.

## Supported versions

`main` only. There are no maintained release branches.
