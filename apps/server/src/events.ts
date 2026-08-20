import type { Response } from 'express';

import type { SimRun, StoredProfile } from './store.js';

export type ServerEvent =
  | { type: 'run:created'; run: SimRun }
  | { type: 'run:progress'; runId: string; progress: number; message?: string }
  | { type: 'run:log'; runId: string; line: string }
  | { type: 'run:updated'; run: SimRun }
  | { type: 'profile:created'; profile: StoredProfile; source: string }
  | { type: 'queue'; queued: number; running: number }
  | { type: 'hello'; now: string };

interface Client {
  id: number;
  res: Response;
}

/**
 * Server-sent events hub.
 *
 * SSE rather than WebSockets: the stream is strictly server to client, and SSE
 * reconnects on its own without a heartbeat protocol to maintain.
 */
class EventHub {
  private clients: Client[] = [];
  private nextId = 1;
  private keepAlive: NodeJS.Timeout | undefined;
  private listeners = new Set<(event: ServerEvent) => void>();

  subscribe(res: Response): () => void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Without this, a proxy in front of the dev server may buffer the stream.
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();

    const client: Client = { id: this.nextId++, res };
    this.clients.push(client);
    this.send(client, { type: 'hello', now: new Date().toISOString() });
    this.ensureKeepAlive();

    return () => {
      this.clients = this.clients.filter((c) => c.id !== client.id);
      if (!this.clients.length && this.keepAlive) {
        clearInterval(this.keepAlive);
        this.keepAlive = undefined;
      }
    };
  }

  /** Comment frames stop idle proxies and browsers from dropping the stream. */
  private ensureKeepAlive(): void {
    if (this.keepAlive) return;
    this.keepAlive = setInterval(() => {
      for (const client of this.clients) client.res.write(': ping\n\n');
    }, 20000);
    this.keepAlive.unref();
  }

  private send(client: Client, event: ServerEvent): void {
    client.res.write('data: ' + JSON.stringify(event) + '\n\n');
  }

  /**
   * Subscribes an in-process listener.
   *
   * The desktop shell hosts this server inside its own main process, so it can
   * observe run state directly instead of opening an SSE connection back to
   * itself. That matters when the window is hidden or closed to the tray: there
   * is no renderer to relay through, but tray state and notifications still
   * need to update.
   */
  onEvent(listener: (event: ServerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: ServerEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        // A misbehaving local listener must not break the SSE fan-out below.
        console.error('[events] listener threw', err);
      }
    }

    for (const client of this.clients) {
      try {
        this.send(client, event);
      } catch {
        // A dead socket is cleaned up by its own close handler.
      }
    }
  }

  get clientCount(): number {
    return this.clients.length;
  }
}

export const events = new EventHub();
