import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A tooltip that a keyboard can reach.
 *
 * `title` was not enough: it cannot hold structure, cannot be styled, and takes
 * about a second to appear. This opens on hover *and* on focus, so every hint is
 * reachable by tabbing, and it is positioned against the viewport so it never
 * clips at an edge.
 *
 * The content is descriptive, never essential -- anything a user must read to
 * operate the control belongs in a visible label.
 */
export function Tooltip({
  content,
  children,
  placement = 'top',
  delay = 120,
}: {
  content: ReactNode;
  children: ReactNode;
  placement?: 'top' | 'right';
  delay?: number;
}) {
  const id = useId();
  const wrapRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const show = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), delay);
  }, [delay]);

  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    setOpen(false);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Escape closes it, matching every other transient layer.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, hide]);

  // Measure after paint so the bubble's real size is known before placing it.
  useLayoutEffect(() => {
    if (!open || !wrapRef.current || !bubbleRef.current) return;
    const anchor = wrapRef.current.getBoundingClientRect();
    const bubble = bubbleRef.current.getBoundingClientRect();
    const margin = 8;

    let left =
      placement === 'right' ? anchor.right + margin : anchor.left + anchor.width / 2 - bubble.width / 2;
    let top = placement === 'right' ? anchor.top + anchor.height / 2 - bubble.height / 2 : anchor.top - bubble.height - margin;

    // Keep it on screen; flip below rather than clipping off the top.
    left = Math.max(margin, Math.min(left, window.innerWidth - bubble.width - margin));
    if (top < margin) top = anchor.bottom + margin;
    if (top + bubble.height > window.innerHeight - margin) {
      top = Math.max(margin, anchor.top - bubble.height - margin);
    }

    setPos({ left, top });
  }, [open, placement]);

  return (
    <span
      ref={wrapRef}
      className="tt-wrap"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocusCapture={show}
      onBlurCapture={hide}
      aria-describedby={open ? id : undefined}
    >
      {children}
      {open && (
        <div
          ref={bubbleRef}
          id={id}
          role="tooltip"
          className="tt"
          style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, visibility: pos ? 'visible' : 'hidden' }}
        >
          {content}
        </div>
      )}
    </span>
  );
}

/** A small circled "i" that exists only to carry a tooltip. */
export function Hint({ content }: { content: ReactNode }) {
  return (
    <Tooltip content={content}>
      <button type="button" className="hint" aria-label="What is this?">
        i
      </button>
    </Tooltip>
  );
}
