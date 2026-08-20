/**
 * Inline SVG icons.
 *
 * Hand-drawn rather than an icon font or package: the app runs offline inside
 * Electron, and every icon here is a dozen path commands. They inherit
 * `currentColor` so they theme themselves, and carry no title -- the label
 * beside them names the thing, so a duplicate accessible name would just make
 * screen readers say it twice.
 */

// React 19 no longer declares a global JSX namespace.
import type { JSX } from 'react';

export interface IconProps {
  size?: number;
  className?: string;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 16 16',
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
});

/* ------------------------------------------------------------ gear slots */

const Head = (p: IconProps) => (
  <svg {...base(p.size ?? 16)} className={p.className}>
    <path d="M3.2 9.5V7a4.8 4.8 0 0 1 9.6 0v2.5" />
    <path d="M3.2 9.5h9.6l-1.1 3.2H4.3z" />
    <path d="M6.2 9.5v3.2M9.8 9.5v3.2" />
  </svg>
);

const Neck = (p: IconProps) => (
  <svg {...base(p.size ?? 16)} className={p.className}>
    <path d="M3.5 3.2a6.5 6.5 0 0 0 9 0" />
    <path d="M8 9.7 6.4 7.8h3.2z" />
    <path d="M4.6 4.9A5.6 5.6 0 0 0 8 9.7a5.6 5.6 0 0 0 3.4-4.8" />
  </svg>
);

const Shoulder = (p: IconProps) => (
  <svg {...base(p.size ?? 16)} className={p.className}>
    <path d="M1.6 11.4c0-2.6 1.2-4.3 3-4.3s3 1.7 3 4.3z" />
    <path d="M8.4 11.4c0-2.6 1.2-4.3 3-4.3s3 1.7 3 4.3z" />
  </svg>
);

const Back = (p: IconProps) => (
  <svg {...base(p.size ?? 16)} className={p.className}>
    <path d="M5 2.6h6l2.2 10.8H2.8z" />
    <path d="M8 2.6v10.8" />
  </svg>
);

const Chest = (p: IconProps) => (
  <svg {...base(p.size ?? 16)} className={p.className}>
    <path d="M5.4 2.6 8 4.4l2.6-1.8 3 1.9-1.2 3-1.2-.6v4.5H4.8V6.9l-1.2.6-1.2-3z" />
  </svg>
);

const Wrist = (p: IconProps) => (
  <svg {...base(p.size ?? 16)} className={p.className}>
    <rect x="2.6" y="5.4" width="10.8" height="5.2" rx="1.6" />
    <path d="M6 5.4v5.2M10 5.4v5.2" />
  </svg>
);

const Hands = (p: IconProps) => (
  <svg {...base(p.size ?? 16)} className={p.className}>
    <path d="M4.2 7.2V4.6a1.1 1.1 0 0 1 2.2 0v2.2" />
    <path d="M6.4 6.8V4a1.1 1.1 0 0 1 2.2 0v2.8" />
    <path d="M8.6 6.9V4.8a1.1 1.1 0 0 1 2.2 0v3.4" />
    <path d="M10.8 8.2c0-1.4 2-1.2 2 .2 0 3-1.7 5-4.4 5-2.4 0-4.2-1.6-4.2-4V7.2" />
  </svg>
);

const Waist = (p: IconProps) => (
  <svg {...base(p.size ?? 16)} className={p.className}>
    <rect x="1.6" y="6" width="12.8" height="4" rx="1" />
    <rect x="6.2" y="5.2" width="3.6" height="5.6" rx="0.8" />
  </svg>
);

const Legs = (p: IconProps) => (
  <svg {...base(p.size ?? 16)} className={p.className}>
    <path d="M4 2.6h8v3l-1 7.8H8.8L8 7.6l-.8 5.8H5z" />
  </svg>
);

const Feet = (p: IconProps) => (
  <svg {...base(p.size ?? 16)} className={p.className}>
    <path d="M4.4 2.8h3.4v4.4c0 1.6 1 2.2 2.6 2.8 1.4.5 2.2 1 2.2 2.2v1H4.4z" />
  </svg>
);

const Finger = (p: IconProps) => (
  <svg {...base(p.size ?? 16)} className={p.className}>
    <circle cx="8" cy="9.6" r="4" />
    <path d="M6.4 5.2 8 2.4l1.6 2.8" />
  </svg>
);

const Trinket = (p: IconProps) => (
  <svg {...base(p.size ?? 16)} className={p.className}>
    <path d="M8 2.2 13.4 8 8 13.8 2.6 8z" />
    <path d="M5.3 8h5.4" />
  </svg>
);

const MainHand = (p: IconProps) => (
  <svg {...base(p.size ?? 16)} className={p.className}>
    <path d="M11.6 2.2 5.4 8.4" />
    <path d="M13.6 1.4 9.8 2.2l4 4 .8-3.8z" />
    <path d="M3 10.8 5.2 13M2.2 12.6 4.4 10.4" />
    <path d="m6.2 7.6 2.2 2.2-3 3-2.2-2.2z" />
  </svg>
);

const OffHand = (p: IconProps) => (
  <svg {...base(p.size ?? 16)} className={p.className}>
    <path d="M8 1.8 13 3.4v4.2c0 3.2-2.2 5.4-5 6.6-2.8-1.2-5-3.4-5-6.6V3.4z" />
  </svg>
);

/** simc slot token to its glyph. Rings and trinkets share one per pair. */
export const SLOT_ICONS: Record<string, (p: IconProps) => JSX.Element> = {
  head: Head,
  neck: Neck,
  shoulder: Shoulder,
  back: Back,
  chest: Chest,
  wrist: Wrist,
  hands: Hands,
  waist: Waist,
  legs: Legs,
  feet: Feet,
  finger1: Finger,
  finger2: Finger,
  trinket1: Trinket,
  trinket2: Trinket,
  main_hand: MainHand,
  off_hand: OffHand,
};

export function SlotIcon({ slot, size = 16, className }: { slot: string } & IconProps) {
  const Glyph = SLOT_ICONS[slot];
  if (!Glyph) return null;
  return <Glyph size={size} className={className} />;
}

/* -------------------------------------------------------------- actions */

export const IconPlay = (p: IconProps) => (
  <svg {...base(p.size ?? 16)} className={p.className}>
    <path d="M4.6 2.8 13 8l-8.4 5.2z" fill="currentColor" strokeWidth={1.2} />
  </svg>
);

export const IconStop = (p: IconProps) => (
  <svg {...base(p.size ?? 16)} className={p.className}>
    <rect x="4" y="4" width="8" height="8" rx="1.2" fill="currentColor" strokeWidth={1.2} />
  </svg>
);

export const IconTrash = (p: IconProps) => (
  <svg {...base(p.size ?? 16)} className={p.className}>
    <path d="M2.8 4.2h10.4M6.4 4.2V2.8h3.2v1.4" />
    <path d="M4.2 4.2 5 13.2h6l.8-9" />
    <path d="M6.8 6.6v4.2M9.2 6.6v4.2" />
  </svg>
);

export const IconImport = (p: IconProps) => (
  <svg {...base(p.size ?? 16)} className={p.className}>
    <path d="M8 1.8v7.6" />
    <path d="M5 6.6 8 9.6l3-3" />
    <path d="M2.6 11v2.2h10.8V11" />
  </svg>
);

export const IconSearch = (p: IconProps) => (
  <svg {...base(p.size ?? 16)} className={p.className}>
    <circle cx="7" cy="7" r="4.2" />
    <path d="m10.2 10.2 3.2 3.2" />
  </svg>
);

export const IconInfo = (p: IconProps) => (
  <svg {...base(p.size ?? 16)} className={p.className}>
    <circle cx="8" cy="8" r="6.2" />
    <path d="M8 7.2v4M8 4.9v.1" />
  </svg>
);

export const IconExternal = (p: IconProps) => (
  <svg {...base(p.size ?? 16)} className={p.className}>
    <path d="M9.4 2.6h4v4" />
    <path d="M13.4 2.6 7.6 8.4" />
    <path d="M11.6 9.4v3.4a.8.8 0 0 1-.8.8H3.4a.8.8 0 0 1-.8-.8V5.4a.8.8 0 0 1 .8-.8h3.4" />
  </svg>
);

export const IconChevron = (p: IconProps & { open?: boolean }) => (
  <svg
    {...base(p.size ?? 16)}
    className={p.className}
    style={{ transform: p.open ? 'rotate(90deg)' : undefined, transition: 'transform .12s ease' }}
  >
    <path d="m6 3.6 4.4 4.4L6 12.4" />
  </svg>
);

export const IconSort = (p: IconProps & { dir?: 'asc' | 'desc' | null }) => (
  <svg {...base(p.size ?? 16)} className={p.className}>
    <path d="m4.4 6.4 2.2-2.4 2.2 2.4" opacity={p.dir === 'asc' ? 1 : 0.32} />
    <path d="m4.4 9.6 2.2 2.4 2.2-2.4" opacity={p.dir === 'desc' ? 1 : 0.32} />
  </svg>
);

export const IconCheck = (p: IconProps) => (
  <svg {...base(p.size ?? 16)} className={p.className}>
    <path d="m3 8.4 3.2 3.2L13 4.8" />
  </svg>
);
