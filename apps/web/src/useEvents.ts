import { useEffect, useRef } from 'react';

import type { ServerEvent } from './api.ts';

/**
 * Subscribes to the server's event stream.
 *
 * The handler is kept in a ref so a re-render never tears down and rebuilds the
 * EventSource -- reconnecting on every state change would drop progress events
 * mid-run.
 */
export function useEvents(onEvent: (event: ServerEvent) => void): void {
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    const source = new EventSource('/api/events');

    source.onmessage = (message) => {
      try {
        handler.current(JSON.parse(message.data) as ServerEvent);
      } catch {
        // A malformed frame is not worth tearing the stream down for.
      }
    };

    // EventSource reconnects on its own; log once rather than per retry.
    let warned = false;
    source.onerror = () => {
      if (!warned) {
        warned = true;
        console.warn('Event stream dropped; the browser will retry.');
      }
    };

    return () => source.close();
  }, []);
}
