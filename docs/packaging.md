# Packaging & releases

## Local packaging

```bash
npm run desktop:pack    # unpacked app in apps/desktop/release/win-unpacked
npm run desktop:dist    # platform installers (NSIS + portable / dmg / AppImage)
```

Both run [`scripts/pack-desktop.mjs`](../scripts/pack-desktop.mjs), which does
two things plain `electron-builder` cannot in this repository:

1. **Stages the workspace packages.** `@usim/server` and `@usim/simc-profile`
   are workspace symlinks pointing outside `apps/desktop`, and electron-builder
   refuses any source path that resolves outside the app directory. The script
   copies their built output into `apps/desktop/node_modules/@usim/` for the
   duration of the build and removes it afterwards — deliberately temporary,
   because a leftover copy would shadow the live workspace during development.
2. **Seeds the winCodeSign cache (Windows).** electron-builder downloads a
   signing-tools bundle whose archive contains macOS symlinks; extracting
   symlinks on Windows needs Developer Mode or elevation, so on a stock machine
   the build aborts over files that are never used. The script extracts the
   bundle itself, excluding the darwin tree, using the 7-Zip the app already
   bundles. No manual step, no Developer Mode.

`npmRebuild` is disabled in [`electron-builder.yml`](../apps/desktop/electron-builder.yml):
the rebuild step exists for native modules and this app deliberately has none
([ADR-0004](adr/0004-flat-json-store-over-sqlite.md)) — and in an npm workspace
that step rewires the root `node_modules` and breaks the build.

## The release pipeline

Pushing a tag `vX.Y.Z` runs [`release.yml`](../.github/workflows/release.yml):

```
tag v0.1.0 ──▶ package · windows-latest ──▶ NSIS installer + portable exe ─┐
          ├──▶ package · macos-latest   ──▶ dmg                            ├─▶ GitHub Release
          └──▶ package · ubuntu-latest  ──▶ AppImage                       ┘   + SHA256SUMS.txt
```

- The tag must match `apps/desktop/package.json`'s version, or the build fails
  before doing anything.
- Platform legs are independent (`fail-fast: false`): one failing leg still
  releases what did build, and stays visibly red.
- `workflow_dispatch` runs the build legs without publishing — how a release
  is rehearsed.
- Release notes are generated from commits, prefixed with the signing caveat,
  and every asset is covered by `SHA256SUMS.txt`.

## Signing status

Builds are **not code-signed** — the project has no certificate
([ADR-0013](adr/0013-unsigned-packaging-and-distribution.md), tracked in
[#1](https://github.com/Jameshunter1/unifiedsim/issues/1)). Practical meaning:

- Windows SmartScreen warns on first run of a downloaded installer.
- **Smart App Control**, where enforced, may refuse unsigned binaries outright,
  and its per-binary reputation makes the verdict non-deterministic: of two
  local builds made minutes apart, one launched and the next was blocked.
- Running from a checkout (`npm run desktop`) is unaffected — it uses the
  widely-distributed `electron.exe`.

macOS builds are unsigned and un-notarised: Gatekeeper requires
right-click → Open on first launch.
