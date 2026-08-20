# ADR-0013: Ship from source; treat packaged builds as unsigned and unreliable

- **Status:** Accepted
- **Date:** 2026-08-20

## Context

`npm run desktop:pack` produces a working `UnifiedSim.exe`, and
`npm run desktop:dist` an NSIS installer. Neither is code-signed, because the
project has no certificate.

Smart App Control evaluates reputation **per binary hash**. That makes unsigned
distribution not merely warned-about but *non-deterministic*: of two builds made
minutes apart on the same machine, the first launched normally and the rebuild
was refused outright with "An Application Control policy has blocked this file".
Same code, same config, different verdict.

Packaging in an npm workspace also hit three problems worth recording:

1. **electron-builder runs its own `npm install`** before packaging. In a
   workspace that targets `apps/desktop` but rewires the **root**
   `node_modules`, pruning devDependencies — including electron-builder's own
   `app-builder-bin` — after which the build fails with `ENOENT` on its own
   binary. It also corrupted `node_modules` mid-run once.
2. **Workspace packages are symlinks** pointing outside the app directory, and
   the packager refuses any source path that resolves outside it
   (`must be under apps/desktop`). Both the dependency walk and an explicit
   `files` mapping hit this.
3. **The signing toolchain contains macOS symlinks.** electron-builder downloads
   a `winCodeSign` bundle with `.dylib` symlinks; creating symlinks on Windows
   requires Developer Mode or elevation, and without it extraction fails and
   aborts the build — even though only the Windows half is ever used.

## Decision

**Running from a checkout (`npm run desktop`) is the supported path.** It uses
the widely distributed `electron.exe`, which has reputation and is not blocked.

Packaging is supported but documented as unsigned, with its failure modes
written down rather than left to be rediscovered:

- `npmRebuild: false` — the step exists to rebuild native modules against
  Electron's ABI, and this app deliberately has none
  ([ADR-0004](0004-flat-json-store-over-sqlite.md)).
- [`scripts/pack-desktop.mjs`](../../scripts/pack-desktop.mjs) stages real
  copies of the workspace packages into `apps/desktop/node_modules/@usim/` for
  the build and removes them afterwards. They are temporary on purpose: left in
  place they would shadow the workspace symlinks, so a rebuilt server would
  appear not to take effect.
- The `winCodeSign` cache must be pre-seeded, or Developer Mode enabled. The
  exact command is in the README.

Signing is tracked as an issue, not solved here.

## Consequences

- Users get a genuine desktop app today without a certificate.
- Installers can be produced for testing, with an honest caveat that they may be
  blocked on the target machine — an accurate warning is more useful than a
  download that fails mysteriously.
- The pack script is repo-specific glue. It is commented with *why*, so it is
  not mistaken for incidental complexity.
- Until signing exists, there is no clean distribution story for non-technical
  users. That is stated rather than papered over.

## Alternatives considered

- **Buy a code-signing certificate.** The real fix. An OV certificate still
  accrues SmartScreen reputation slowly; an EV certificate is immediate and
  costs more. Out of scope for now, and a purchasing decision.
- **Ship unpacked and tell users to run the exe.** Same blocking behaviour, and
  worse ergonomics.
- **Drop packaging entirely.** Loses the ability to test the packaged path,
  which exercises real code — user-data paths, ephemeral ports, asar layout —
  that the dev path does not.
