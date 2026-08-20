# ADR-0005: Server-sent events, not WebSockets

- **Status:** Accepted
- **Date:** 2026-08-19

## Context

The UI needs live updates: queue depth, per-run progress, engine log lines, and
run completion. simc rewrites its progress bar continuously, so this is a steady
stream while a batch runs.

Every message flows server → client. The client never pushes: it starts runs and
cancels them over ordinary HTTP requests, because those need a response and an
error path anyway.

## Decision

Server-sent events at `GET /api/events`, with a comment-frame keepalive every
20 seconds so idle proxies and browsers do not drop the stream.

Progress updates are throttled before they reach the stream — at most one per
run per 500 ms unless the percentage changed — so a redrawing progress bar does
not flood the socket or the store.

## Consequences

- The browser reconnects on its own. There is no heartbeat protocol, no
  reconnect/backoff logic, and no library to keep current.
- It is plain HTTP: it works through the Vite dev proxy, needs no protocol
  upgrade, and is readable with `curl`.
- Text only, one direction. Both are fine here; if the app ever needs binary
  frames or client push, this decision is wrong and should be revisited.
- SSE over HTTP/1.1 counts against the per-origin connection limit. Irrelevant
  for a single-tab local app.

## Alternatives considered

- **WebSockets.** Bidirectional and binary-capable, neither of which is needed,
  in exchange for owning reconnection and liveness.
- **Polling.** Simplest, but progress at any useful resolution means polling
  several times a second, and the log pane would be lossy by construction.

## Note

The desktop shell does **not** consume this stream to drive native status. It
hosts the server in-process and subscribes directly via `events.onEvent()` —
see [ADR-0007](0007-electron-shell-hosting-server.md). SSE remains the transport
for the renderer, and for any browser pointed at the same server.
