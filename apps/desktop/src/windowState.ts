import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { BrowserWindow, Rectangle } from 'electron';
import { screen } from 'electron';

export interface WindowState extends Partial<Rectangle> {
  maximized?: boolean;
}

const DEFAULTS: WindowState = { width: 1320, height: 900 };

/**
 * Remembers window geometry between launches.
 *
 * Restoring blindly is not enough: a window saved on a second monitor that is
 * no longer attached would be restored off-screen and appear not to open at
 * all, so the saved rectangle is checked against the current displays.
 */
export class WindowStateKeeper {
  private state: WindowState;
  private readonly file: string;
  private saveTimer: NodeJS.Timeout | undefined;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, 'window-state.json');
    this.state = this.load();
  }

  private load(): WindowState {
    if (!existsSync(this.file)) return { ...DEFAULTS };
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as WindowState;
      return { ...DEFAULTS, ...parsed };
    } catch {
      return { ...DEFAULTS };
    }
  }

  /** True when the saved rectangle still overlaps a connected display. */
  private isVisible(state: WindowState): boolean {
    if (state.x === undefined || state.y === undefined) return false;
    return screen.getAllDisplays().some((display) => {
      const b = display.bounds;
      return (
        state.x! >= b.x - 32 &&
        state.y! >= b.y - 32 &&
        state.x! < b.x + b.width &&
        state.y! < b.y + b.height
      );
    });
  }

  get options(): WindowState {
    const usable = this.isVisible(this.state);
    return {
      width: this.state.width ?? DEFAULTS.width,
      height: this.state.height ?? DEFAULTS.height,
      ...(usable ? { x: this.state.x, y: this.state.y } : {}),
      maximized: this.state.maximized,
    };
  }

  /** Persists on move/resize, debounced -- dragging fires continuously. */
  track(window: BrowserWindow): void {
    const capture = () => {
      if (window.isDestroyed()) return;
      if (!window.isMaximized() && !window.isMinimized() && !window.isFullScreen()) {
        const bounds = window.getBounds();
        this.state = { ...this.state, ...bounds };
      }
      this.state.maximized = window.isMaximized();
      this.scheduleSave();
    };

    window.on('resize', capture);
    window.on('move', capture);
    window.on('maximize', capture);
    window.on('unmaximize', capture);
    window.on('close', () => {
      capture();
      this.flush();
    });
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 400);
  }

  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    try {
      const tmp = this.file + '.tmp';
      writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8');
      renameSync(tmp, this.file);
    } catch {
      // Losing window geometry is not worth surfacing to the user.
    }
  }
}
