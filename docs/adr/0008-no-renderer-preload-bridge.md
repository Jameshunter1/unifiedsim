# ADR-0008: The renderer gets no preload bridge

- **Status:** Accepted
- **Date:** 2026-08-20

## Context

The desktop app needs native affordances the web UI cannot provide: an open-file
dialog for importing a profile, a directory picker for installing the WoW addon,
a file picker for the SavedVariables path, "open data folder", and an in-app
SimulationCraft download.

The reflex is a `preload.js` exposing `window.usim.*` over `contextBridge`, with
the renderer calling into it. That is the documented Electron pattern.

It has a cost that is easy to miss: once the UI calls `window.usim.pickFile()`,
the UI only runs inside Electron. The browser path — which is how the app is
developed and how a user on another machine can reach the same server — starts
throwing on undefined.

## Decision

No preload script. `contextIsolation: true`, `nodeIntegration: false`,
`sandbox: true`, and no bridge at all.

Every native action is a **menu or tray item in the main process**. When one
needs to change app state, the main process calls the app's own HTTP API over
loopback — the same API the renderer uses. Importing a file is:

```
File → Import…  →  dialog.showOpenDialog()  →  POST /api/profiles
                →  server emits profile:created  →  SSE  →  renderer updates
```

The renderer learns about the change through the stream it already listens to.
There is no IPC channel, and no message type to keep in sync on both sides.

## Consequences

- The UI is a plain web page. It runs identically in Electron and in a browser,
  and `npm run dev` remains a first-class way to work on it.
- The renderer's attack surface is a normal sandboxed page with no privileged
  bridge.
- Native actions are discoverable in menus, which is where desktop users look.
- Actions that would genuinely belong on an in-page control — a "Download
  SimulationCraft" button next to the engine banner — currently live only in the
  Tools menu. Acceptable; if that changes, the fix is an API endpoint the
  renderer can call, not a bridge.

## Alternatives considered

- **`contextBridge` preload.** The standard pattern. Costs the browser path and
  adds a two-sided protocol.
- **`nodeIntegration: true`.** Straightforwardly unsafe, and would still couple
  the UI to Electron.
