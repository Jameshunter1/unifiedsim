# ADR-0006: The bridge is Node `fs.watch`, not a Rust/Tauri agent

- **Status:** Accepted
- **Date:** 2026-08-19

## Context

The original blueprint specifies a native desktop agent, written in Rust with
Tauri, whose job is to register OS file-system watchers
(`ReadDirectoryChangesW` on Windows, `inotify` on Linux, `kqueue` on macOS) on
the WoW `SavedVariables` directory and relay changes over a local WebSocket.

The stated benefit is bypassing the WoW Lua sandbox's lack of network access.
That constraint is real: the in-game addon genuinely cannot make HTTP requests,
so the only way out is the file the client writes at `/reload` or logout.

But the mechanism proposed to read that file is the same mechanism Node already
uses. `fs.watch` **is** `ReadDirectoryChangesW` on Windows and `inotify` on
Linux — Node is a thin wrapper over libuv, which is a thin wrapper over those
APIs. A Rust process would call the identical kernel interfaces.

## Decision

The watcher lives in the Node server
([`apps/server/src/watcher.ts`](../../apps/server/src/watcher.ts)). No separate
process, no second language, no IPC.

The blueprint's sub-100 ms latency target is explicitly **not** pursued. The
watcher debounces for 400 ms, because the client emits several change events per
flush and importing a half-written file is worse than importing 400 ms later.
The real latency floor is the `/reload` the player must perform anyway, which
takes seconds. The debounce is free.

Content is hashed before import, so an unchanged file at boot does not
re-import, and a touch without a change is ignored.

## Consequences

- One process, one language, one build. The bridge is ~200 lines rather than a
  crate with its own toolchain and release artifact.
- Verified end to end: a clean boot does not re-import, and a simulated
  `/usim sync` is imported within about half a second.
- No standalone agent for users who want the bridge without the app. Nobody has
  asked, and [ADR-0007](0007-electron-shell-hosting-server.md) makes the app
  itself the always-running process.

## Alternatives considered

- **Tauri/Rust agent, as specified.** Identical kernel calls, plus a language,
  a toolchain, an IPC protocol, and a second unsigned binary on a machine
  enforcing Smart App Control.
- **Polling the file's mtime.** Works, but either burns wakeups or adds latency,
  and gains nothing over an API that already exists.
- **A `chokidar` dependency.** Solves cross-platform edge cases this app does
  not have; it watches one known file, not a tree.
