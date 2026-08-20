# ADR-0007: Electron desktop shell, hosting the server in-process

- **Status:** Accepted
- **Date:** 2026-08-20

## Context

The app should be a desktop application: launched from an icon, with no terminal
to keep open and no browser tab to find. The blueprint nominated Tauri.

Two questions, and they are separate: which shell, and where the server runs.

**Which shell.** The backend is a Node program — an Express API, a job queue, a
file-system watcher, and engines that spawn child processes and parse their
output. Tauri's runtime is Rust; it cannot host that. Using Tauri means shipping
Node as a **sidecar executable** and inventing an IPC protocol between the Rust
shell and the Node sidecar to replace what is currently a function call. On a
machine that enforces Smart App Control, it also means a *second* unsigned
binary to be blocked ([ADR-0011](0011-container-engine-for-blocked-binaries.md)).

Tauri's real advantage is bundle size: roughly 10 MB against Electron's ~190 MB.
That is not the binding constraint next to a ~500 MB SimulationCraft install.

**Where the server runs.** Electron could still spawn the server as a child
process. That needs a port handshake, and it leaks: if the shell dies
abnormally, the child survives holding the port and the data directory.

## Decision

**Electron**, with the server hosted **inside the main process**.

The server was refactored to export `startServer()` instead of booting on
import, so the same code serves `npm run dev` and the desktop app. The main
process sets `USIM_DATA_DIR`/`USIM_WEB_DIST`/`USIM_VENDOR_DIR` **before** the
dynamic `import()`, because the server reads its configuration at module load.

Production binds port 0 — the OS picks a free port — so a running dev server or
a second copy cannot collide. The window then loads `http://127.0.0.1:<port>`,
which makes the renderer same-origin with the API, so the UI's relative `/api`
calls work with no port injection and no custom protocol handler.

The main process is **CommonJS**. Electron 33's ESM main-process loader fails to
preparse Electron's own CJS module (`cjsPreparseModuleExports` throws on
`module.exports`). A dynamic `import()` from CJS reaches the ESM server fine, so
CJS costs nothing here.

Native status is driven by `events.onEvent()`, an in-process subscription added
to the event hub — not by the SSE stream.

## Consequences

- Taskbar progress, tray state and completion notifications keep updating with
  the window closed to the tray, because there is no renderer in the path.
- One process. Quitting cannot orphan a server.
- Data lives in `data/` for a checkout and in the OS user-data directory for an
  installed build, so the two never share a store.
- ~190 MB per install, and Chromium's update cadence to track.
- Packaging is unsigned; see
  [ADR-0013](0013-unsigned-packaging-and-distribution.md).

## Alternatives considered

- **Tauri + Node sidecar.** Smaller bundle, two runtimes, an IPC protocol, and a
  second blockable binary.
- **Electron spawning the server as a child.** Port handshake and orphan risk
  for no benefit; the isolation it buys is not needed for our own code.
- **A tray app that just opens the browser.** Barely a desktop app: no native
  progress, no notifications, and the browser tab is still the UI.
