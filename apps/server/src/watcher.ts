import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, watch, type FSWatcher } from 'node:fs';
import path from 'node:path';

import { parseProfile } from '@usim/simc-profile';

import { config } from './config.js';
import { importProfile } from './routes/profiles.js';
import { extractSimcExports } from './savedVariables.js';

const ADDON_SAVED_VARS = 'UnifiedSim.lua';

/** WoW install roots worth probing when WOW_SAVEDVARS is not set. */
function installRoots(): string[] {
  const roots: string[] = [];
  if (process.platform === 'win32') {
    const pf = process.env.ProgramFiles ?? 'C:\\Program Files';
    const pfx86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
    roots.push(
      path.join(pfx86, 'World of Warcraft'),
      path.join(pf, 'World of Warcraft'),
      'C:\\World of Warcraft',
      'C:\\Games\\World of Warcraft',
      'D:\\World of Warcraft',
      'D:\\Games\\World of Warcraft',
      'E:\\World of Warcraft',
    );
  } else if (process.platform === 'darwin') {
    roots.push('/Applications/World of Warcraft');
  }
  return roots;
}

export interface DiscoveredTarget {
  /** Full path to UnifiedSim.lua, whether or not it exists yet. */
  file: string;
  /** Its SavedVariables directory, which does exist. */
  dir: string;
  exists: boolean;
}

/**
 * Finds `_retail_/WTF/Account/<ACCOUNT>/SavedVariables/UnifiedSim.lua`.
 *
 * Returns the directory too, and reports targets whose file does not exist
 * yet: on a fresh install the addon has never run, so there is nothing to
 * watch until the player logs in once. Watching the directory covers that.
 *
 * Only the account level is enumerated -- the rest of the path is fixed, so
 * this never walks the multi-gigabyte game directory.
 */
export function discoverSavedVariables(): DiscoveredTarget | undefined {
  const candidates: DiscoveredTarget[] = [];

  for (const root of installRoots()) {
    const accountsDir = path.join(root, '_retail_', 'WTF', 'Account');
    if (!existsSync(accountsDir)) continue;

    let accounts: string[];
    try {
      accounts = readdirSync(accountsDir);
    } catch {
      continue;
    }

    for (const account of accounts) {
      const dir = path.join(accountsDir, account, 'SavedVariables');
      if (!existsSync(dir)) continue;
      const file = path.join(dir, ADDON_SAVED_VARS);
      candidates.push({ file, dir, exists: existsSync(file) });
    }
  }

  // Prefer an account that already has data over one that does not.
  return candidates.find((c) => c.exists) ?? candidates[0];
}

class SavedVariablesWatcher {
  private watcher: FSWatcher | undefined;
  private dirWatcher: FSWatcher | undefined;
  private timer: NodeJS.Timeout | undefined;
  private lastHash: string | undefined;
  private watchedPath: string | undefined;
  /** Runtime override from `repoint`, which outranks the configured path. */
  private override: string | undefined;

  get path(): string | undefined {
    return this.watchedPath;
  }

  get active(): boolean {
    return Boolean(this.watcher);
  }

  /**
   * Re-points the watcher at a different file without restarting the process.
   *
   * The desktop app offers a native file picker for the SavedVariables path, so
   * a wrong or undiscoverable location is fixable in the UI rather than by
   * editing .env and restarting.
   */
  repoint(file: string): { watching: boolean; path?: string; reason?: string; awaitingFirstExport?: boolean } {
    this.stop();
    this.lastHash = undefined;
    return this.start(file);
  }

  start(overridePath?: string): { watching: boolean; path?: string; reason?: string; awaitingFirstExport?: boolean } {
    if (overridePath) this.override = overridePath;
    if (!config.watch.enabled) {
      return { watching: false, reason: 'Disabled via WOW_WATCH_ENABLED=false.' };
    }

    const override = this.override ?? config.watch.savedVariables;
    const target: DiscoveredTarget | undefined = override
      ? { file: override, dir: path.dirname(override), exists: existsSync(override) }
      : discoverSavedVariables();

    if (!target) {
      return {
        watching: false,
        reason:
          'No World of Warcraft SavedVariables folder found. Install the addon ' +
          '(npm run addon:link), or set WOW_SAVEDVARS in .env to the full path of UnifiedSim.lua.',
      };
    }

    this.watchedPath = target.file;

    if (target.exists) {
      // Seed the hash so an unchanged file at boot is not re-imported.
      this.lastHash = this.hashOf(target.file);
      try {
        // fs.watch uses ReadDirectoryChangesW on Windows and inotify on Linux,
        // which is the same OS mechanism a native agent would register.
        this.watcher = watch(target.file, { persistent: false }, () => this.schedule());
      } catch (err) {
        return { watching: false, reason: 'Could not watch ' + target.file + ': ' + (err as Error).message };
      }
      console.log('[watch] SavedVariables: ' + target.file);
      return { watching: true, path: target.file };
    }

    // The addon has never run, so the file does not exist. Watch the directory
    // and switch to the file the moment it appears -- otherwise the very first
    // /usim sync, the one that matters most, would be missed.
    if (!existsSync(target.dir)) {
      return { watching: false, reason: 'SavedVariables folder does not exist: ' + target.dir };
    }

    try {
      this.dirWatcher = watch(target.dir, { persistent: false }, (_event, filename) => {
        if (filename && filename.toString() !== ADDON_SAVED_VARS) return;
        if (!existsSync(target.file)) return;
        console.log('[watch] ' + ADDON_SAVED_VARS + ' appeared; switching to file watch');
        this.dirWatcher?.close();
        this.dirWatcher = undefined;
        try {
          this.watcher = watch(target.file, { persistent: false }, () => this.schedule());
        } catch (err) {
          console.error('[watch] could not watch the new file', err);
        }
        this.schedule();
      });
    } catch (err) {
      return { watching: false, reason: 'Could not watch ' + target.dir + ': ' + (err as Error).message };
    }

    console.log('[watch] waiting for ' + target.file);
    return {
      watching: true,
      path: target.file,
      awaitingFirstExport: true,
    };
  }

  private hashOf(file: string): string | undefined {
    try {
      return createHash('sha1').update(readFileSync(file)).digest('hex');
    } catch {
      return undefined;
    }
  }

  /**
   * The client writes the file in one burst; fs.watch reports several events
   * for it. Wait for quiet, then check whether the contents actually changed.
   */
  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.ingest(), 400);
  }

  private ingest(): void {
    const target = this.watchedPath;
    if (!target) return;

    let size = 0;
    try {
      size = statSync(target).size;
    } catch {
      return;
    }
    if (size === 0) return;

    const hash = this.hashOf(target);
    if (!hash || hash === this.lastHash) return;
    this.lastHash = hash;

    let lua: string;
    try {
      lua = readFileSync(target, 'utf8');
    } catch (err) {
      console.error('[watch] could not read SavedVariables', err);
      return;
    }

    const exports = extractSimcExports(lua);
    if (!exports.length) {
      console.warn('[watch] file changed but contained no simc export');
      return;
    }

    for (const raw of exports) {
      // An export with no equipped gear cannot be simulated, and auto-import
      // has no user to ask. The client produces these whenever it serialises
      // while player data is unavailable, so silently accepting them fills the
      // profile list with unusable entries that all look legitimate.
      const parsed = parseProfile(raw);
      const equipped = Object.values(parsed.equipped).filter((item) => item?.id).length;
      if (equipped === 0) {
        console.warn(
          '[watch] ignored an export with no equipped gear' +
            (parsed.name ? ' for ' + parsed.name : '') +
            '. Run /usim sync in game while logged in.',
        );
        continue;
      }

      const { profile, created } = importProfile(raw, 'addon');
      if (created) console.log('[watch] imported ' + profile.label + ' (' + equipped + ' slots)');
    }
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.watcher?.close();
    this.dirWatcher?.close();
    this.watcher = undefined;
    this.dirWatcher = undefined;
  }
}

export const savedVariablesWatcher = new SavedVariablesWatcher();
