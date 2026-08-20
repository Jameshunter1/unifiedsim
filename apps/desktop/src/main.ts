import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, lstatSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';

import {
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  app,
  dialog,
  nativeImage,
  shell,
  type MenuItemConstructorOptions,
} from 'electron';

import { installSimc, platformSuffix } from './simcInstall.js';
import { WindowStateKeeper } from './windowState.js';

/**
 * This entry point is CommonJS on purpose.
 *
 * Electron's own module is CJS, and its ESM main-process loader fails to
 * preparse it (`cjsPreparseModuleExports` throws on `module.exports`). The
 * server is ESM-only, but a dynamic `import()` from CJS reaches it fine, so CJS
 * here costs nothing and avoids the loader bug entirely.
 */
const HERE = __dirname;
const IS_DEV = !app.isPackaged;

/** Where bundled read-only assets live in each mode. */
const RESOURCES = IS_DEV ? path.join(HERE, '..', 'resources') : process.resourcesPath;
/** Repo root, only meaningful in development. */
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');

/**
 * An installed app must not write inside its own program directory, so state
 * goes to the OS user-data path. In development it stays in the repo, so a dev
 * session and an installed copy never fight over the same store.
 */
const DATA_DIR = IS_DEV ? path.join(REPO_ROOT, 'data') : path.join(app.getPath('userData'), 'data');

/* -------------------------------------------------------------- lifecycle */

// A second launch should surface the running window, not boot a second server
// onto the same data directory.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let serverUrl = '';
let stopServer: (() => Promise<void>) | undefined;
let quitting = false;

const windowState = new WindowStateKeeper(DATA_DIR);

/* ----------------------------------------------------------------- server */

/**
 * Boots the backend inside this process.
 *
 * Environment has to be set before the import: the server reads its config at
 * module load, so a later assignment would be ignored. Port 0 in production
 * asks the OS for a free one, which avoids colliding with a dev server or a
 * second app. Development pins 8730 so Vite's proxy still finds it.
 */
async function startBackend(): Promise<string> {
  process.env.USIM_DATA_DIR = DATA_DIR;
  // An installed app has no npm and no checkout, so the stock "run npm run
  // simc:fetch" advice would be a dead end.
  process.env.USIM_ENGINE_HINT =
    'No SimulationCraft engine installed. Use Tools → Download SimulationCraft, ' +
    'or set SIMC_PATH to an existing simc executable.';

  if (!IS_DEV) {
    process.env.USIM_WEB_DIST = path.join(RESOURCES, 'web');
    process.env.USIM_VENDOR_DIR = path.join(app.getPath('userData'), 'vendor');
    process.env.PORT ??= '0';
  }

  const { startServer } = await import('@usim/server');
  const running = await startServer();
  stopServer = running.close;

  const { events } = await import('@usim/server/events');
  events.onEvent(onServerEvent);

  return running.url;
}

/* ------------------------------------------------------ native status glue */

interface QueueState {
  queued: number;
  running: number;
}

let queueState: QueueState = { queued: 0, running: 0 };
let runProgress = new Map<string, number>();
/** Results accumulated since the queue last went from idle to busy. */
let batchResults: Array<{ label: string; dps: number }> = [];
let wasBusy = false;

function onServerEvent(event: { type: string; [key: string]: unknown }): void {
  switch (event.type) {
    case 'queue': {
      queueState = { queued: Number(event.queued), running: Number(event.running) };
      const busy = queueState.queued + queueState.running > 0;
      if (busy && !wasBusy) batchResults = [];
      if (!busy && wasBusy) announceBatch();
      wasBusy = busy;
      updateNativeStatus();
      break;
    }

    case 'run:progress': {
      runProgress.set(String(event.runId), Number(event.progress));
      updateNativeStatus();
      break;
    }

    case 'run:updated': {
      const run = event.run as { id: string; status: string; variantLabel: string; result?: { dps: number } };
      if (run.status === 'done' && run.result) {
        batchResults.push({ label: run.variantLabel, dps: run.result.dps });
      }
      if (run.status !== 'running' && run.status !== 'queued') runProgress.delete(run.id);
      updateNativeStatus();
      break;
    }

    default:
      break;
  }
}

/**
 * Mirrors queue state onto the taskbar button and the tray.
 *
 * This is the payoff for hosting the server in-process: progress keeps updating
 * with the window closed to the tray, where a renderer-driven approach would
 * have nothing to report.
 */
function updateNativeStatus(): void {
  const busy = queueState.running + queueState.queued;

  if (mainWindow && !mainWindow.isDestroyed()) {
    if (busy === 0) {
      mainWindow.setProgressBar(-1);
    } else {
      const values = [...runProgress.values()];
      const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length / 100 : 0;
      // Indeterminate until the first progress tick, so the bar never sits at
      // a misleading zero while simc is starting up.
      mainWindow.setProgressBar(values.length ? mean : 2);
    }
  }

  if (tray) {
    tray.setToolTip(
      busy === 0
        ? 'UnifiedSim — idle'
        : 'UnifiedSim — ' + queueState.running + ' running, ' + queueState.queued + ' queued',
    );
  }
}

/** Notifies on batch completion, naming the winner. */
function announceBatch(): void {
  if (!batchResults.length || !Notification.isSupported()) return;

  const sorted = [...batchResults].sort((a, b) => b.dps - a.dps);
  const best = sorted[0]!;
  const dps = Math.round(best.dps).toLocaleString();

  const body =
    sorted.length === 1
      ? best.label + ' — ' + dps + ' DPS'
      : 'Best of ' + sorted.length + ': ' + best.label + ' — ' + dps + ' DPS';

  const notification = new Notification({
    title: 'Simulation finished',
    body,
    icon: path.join(RESOURCES, 'icon.png'),
  });
  notification.on('click', () => showWindow());
  notification.show();

  // Only nudge the taskbar if the user is looking elsewhere.
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isFocused()) {
    mainWindow.flashFrame(true);
  }
  batchResults = [];
}

/* ------------------------------------------------------------ API helpers */

async function apiPost(route: string, body: unknown): Promise<Response> {
  return fetch(serverUrl + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Imports profile text through the app's own HTTP API.
 *
 * Going through the API rather than calling the store directly means the
 * `profile:created` event fires exactly as it would for a paste, so the open
 * window refreshes itself with no IPC channel between main and renderer.
 */
async function importProfileText(raw: string, source: string): Promise<void> {
  try {
    const response = await apiPost('/api/profiles', { raw, source });
    if (!response.ok) {
      const detail = (await response.json().catch(() => ({}))) as { error?: string };
      await dialog.showMessageBox({
        type: 'warning',
        message: 'That file is not a SimulationCraft profile.',
        detail: detail.error ?? 'HTTP ' + response.status,
        buttons: ['OK'],
      });
      return;
    }
    showWindow();
  } catch (err) {
    await dialog.showMessageBox({
      type: 'error',
      message: 'Import failed.',
      detail: (err as Error).message,
      buttons: ['OK'],
    });
  }
}

async function importFromFile(): Promise<void> {
  const result = await dialog.showOpenDialog({
    title: 'Import a SimulationCraft profile',
    filters: [
      { name: 'SimulationCraft profile', extensions: ['simc', 'txt'] },
      { name: 'All files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths[0]) return;
  await importProfileText(readFileSync(result.filePaths[0], 'utf8'), 'file');
}

/* --------------------------------------------------------- addon install */

/** Installs the addon into a WoW folder chosen by the user. */
async function installAddon(): Promise<void> {
  const picked = await dialog.showOpenDialog({
    title: 'Select your World of Warcraft folder',
    message: 'Pick the folder that contains _retail_',
    properties: ['openDirectory'],
  });
  if (picked.canceled || !picked.filePaths[0]) return;

  const root = picked.filePaths[0];
  const addonsDir = path.join(root, '_retail_', 'Interface', 'AddOns');

  if (!existsSync(path.join(root, '_retail_'))) {
    await dialog.showMessageBox({
      type: 'warning',
      message: 'That folder has no _retail_ directory.',
      detail: 'Choose the World of Warcraft folder itself, not _retail_ or Interface.',
      buttons: ['OK'],
    });
    return;
  }

  // In a checkout the addon is the repo copy, so a junction keeps edits live.
  // A packaged build carries its own copy under resources.
  const source = IS_DEV
    ? path.join(REPO_ROOT, 'addon', 'UnifiedSim')
    : path.join(RESOURCES, 'addon', 'UnifiedSim');
  const target = path.join(addonsDir, 'UnifiedSim');

  if (!existsSync(source)) {
    await dialog.showMessageBox({
      type: 'error',
      message: 'Addon files are missing from this build.',
      detail: 'Expected them at ' + source,
      buttons: ['OK'],
    });
    return;
  }

  try {
    mkdirSync(addonsDir, { recursive: true });
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });

    let linked = false;
    if (IS_DEV) {
      // A junction keeps repo edits live in game; it needs no admin rights,
      // unlike a plain symlink on Windows.
      try {
        symlinkSync(source, target, process.platform === 'win32' ? 'junction' : 'dir');
        linked = true;
      } catch {
        linked = false;
      }
    }
    if (!linked) cpSync(source, target, { recursive: true });

    const files = readdirSync(target).join(', ');
    const kind = lstatSync(target).isSymbolicLink() ? 'Linked' : 'Copied';

    const answer = await dialog.showMessageBox({
      type: 'info',
      message: kind + ' UnifiedSim into your AddOns folder.',
      detail:
        files +
        '\n\nEnable UnifiedSim in the in-game AddOns list, then run /usim sync. ' +
        'The app watches for the file and imports it automatically.',
      buttons: ['Open folder', 'Done'],
      defaultId: 1,
    });
    if (answer.response === 0) void shell.openPath(target);
  } catch (err) {
    await dialog.showMessageBox({
      type: 'error',
      message: 'Could not install the addon.',
      detail: (err as Error).message,
      buttons: ['OK'],
    });
  }
}

/* ------------------------------------------------------- engine install */

let installing = false;

/**
 * Downloads SimulationCraft into the app's vendor directory.
 *
 * The packaged app cannot tell the user to "run npm run simc:fetch" -- there is
 * no checkout and no npm. Without this the installed app is a shell that can
 * never sim.
 */
async function downloadSimc(): Promise<void> {
  if (installing) {
    await dialog.showMessageBox({ type: 'info', message: 'Already downloading.', buttons: ['OK'] });
    return;
  }

  if (!platformSuffix()) {
    await dialog.showMessageBox({
      type: 'warning',
      message: 'No prebuilt SimulationCraft for this platform.',
      detail: 'Build simc from source and set SIMC_PATH in .env.',
      buttons: ['OK'],
    });
    return;
  }

  const confirmed = await dialog.showMessageBox({
    type: 'warning',
    message: 'Download SimulationCraft (~120 MB)?',
    detail:
      'From downloads.simulationcraft.org.\n\n' +
      'Their TLS certificate does not match the host, so this downloads over plain HTTP, ' +
      'and they publish no checksum or signature. You are trusting the network path as well ' +
      'as the publisher.\n\n' +
      'The sha256 of whatever arrives is recorded in PROVENANCE.json next to the binary.',
    buttons: ['Download', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
  });
  if (confirmed.response !== 0) return;

  installing = true;
  const vendorDir = IS_DEV ? path.join(REPO_ROOT, 'vendor') : path.join(app.getPath('userData'), 'vendor');

  try {
    const result = await installSimc(vendorDir, (progress) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      // Indeterminate during extraction, which reports no percentage.
      mainWindow.setProgressBar(progress.phase === 'extract' ? 2 : (progress.fraction ?? 2));
    });

    mainWindow?.setProgressBar(-1);
    await apiPost('/api/engines/refresh', {}).catch(() => undefined);
    mainWindow?.webContents.reload();

    await dialog.showMessageBox({
      type: 'info',
      message: 'SimulationCraft ' + result.version + ' installed.',
      detail: result.binary + '\n\nsha256 ' + result.sha256,
      buttons: ['OK'],
    });
  } catch (err) {
    mainWindow?.setProgressBar(-1);
    await dialog.showMessageBox({
      type: 'error',
      message: 'Could not install SimulationCraft.',
      detail: (err as Error).message,
      buttons: ['OK'],
    });
  } finally {
    installing = false;
  }
}

/** Points the watcher at a SavedVariables file chosen by the user. */
async function chooseSavedVariables(): Promise<void> {
  const picked = await dialog.showOpenDialog({
    title: 'Select UnifiedSim.lua',
    message: 'WTF / Account / <ACCOUNT> / SavedVariables / UnifiedSim.lua',
    filters: [{ name: 'SavedVariables', extensions: ['lua'] }],
    properties: ['openFile'],
  });
  if (picked.canceled || !picked.filePaths[0]) return;

  try {
    const response = await apiPost('/api/watch', { path: picked.filePaths[0] });
    const body = (await response.json()) as { watch?: { watching: boolean; reason?: string } };
    await dialog.showMessageBox({
      type: body.watch?.watching ? 'info' : 'warning',
      message: body.watch?.watching ? 'Watching that file now.' : 'Could not watch that file.',
      detail: body.watch?.watching
        ? 'Run /usim sync in game and the profile will appear here.'
        : (body.watch?.reason ?? 'Unknown error.'),
      buttons: ['OK'],
    });
  } catch (err) {
    await dialog.showMessageBox({ type: 'error', message: 'Failed.', detail: (err as Error).message, buttons: ['OK'] });
  }
}

/* ------------------------------------------------------------------ menu */

function buildMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: '&File',
      submenu: [
        { label: 'Import profile from file…', accelerator: 'CmdOrCtrl+O', click: () => void importFromFile() },
        {
          label: 'Import profile from clipboard',
          accelerator: 'CmdOrCtrl+Shift+V',
          click: async () => {
            const { clipboard } = await import('electron');
            const text = clipboard.readText();
            if (text.trim()) await importProfileText(text, 'paste');
          },
        },
        { type: 'separator' },
        { label: 'Open data folder', click: () => void shell.openPath(DATA_DIR) },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: '&Edit',
      submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }],
    },
    {
      label: '&View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: '&Tools',
      submenu: [
        { label: 'Download SimulationCraft…', click: () => void downloadSimc() },
        { type: 'separator' },
        { label: 'Install WoW addon…', click: () => void installAddon() },
        { label: 'Choose SavedVariables file…', click: () => void chooseSavedVariables() },
        { type: 'separator' },
        {
          label: 'Re-check engines',
          accelerator: 'CmdOrCtrl+R',
          click: async () => {
            await apiPost('/api/engines/refresh', {}).catch(() => undefined);
            mainWindow?.webContents.reload();
          },
        },
        {
          label: 'Open in browser',
          click: () => void shell.openExternal(serverUrl),
        },
      ],
    },
    {
      label: '&Help',
      submenu: [
        {
          label: 'About UnifiedSim',
          click: async () => {
            await dialog.showMessageBox({
              type: 'info',
              message: 'UnifiedSim ' + app.getVersion(),
              detail:
                'Local SimulationCraft runner for World of Warcraft.\n\n' +
                'Server: ' + serverUrl + '\n' +
                'Data:   ' + DATA_DIR + '\n' +
                'Electron ' + process.versions.electron + ' · Node ' + process.versions.node,
              buttons: ['OK'],
            });
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ------------------------------------------------------------------ tray */

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    void createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.flashFrame(false);
}

function buildTray(): void {
  const icon = nativeImage.createFromPath(path.join(RESOURCES, 'tray.png'));
  if (icon.isEmpty()) return;

  tray = new Tray(icon);
  tray.setToolTip('UnifiedSim — idle');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show UnifiedSim', click: () => showWindow() },
      { label: 'Open data folder', click: () => void shell.openPath(DATA_DIR) },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('click', () => showWindow());
}

/* ---------------------------------------------------------------- window */

async function createWindow(): Promise<void> {
  const state = windowState.options;

  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 940,
    minHeight: 620,
    show: false,
    // Matches the app's own light/dark surfaces so the frame does not flash
    // white before the first paint.
    backgroundColor: '#0d0d0d',
    autoHideMenuBar: false,
    icon: path.join(RESOURCES, process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    title: 'UnifiedSim',
    webPreferences: {
      // The renderer is an ordinary web page served over loopback. It gets no
      // Node access and no preload bridge: every native action is a menu or
      // tray item in this process, which keeps the UI runnable in a plain
      // browser too.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  windowState.track(mainWindow);
  if (state.maximized) mainWindow.maximize();

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // Closing hides to the tray while sims are in flight; otherwise it really
  // closes. Killing a 10-minute batch because someone hit X is not a kindness.
  mainWindow.on('close', (event) => {
    const busy = queueState.running + queueState.queued > 0;
    if (!quitting && busy) {
      event.preventDefault();
      mainWindow?.hide();
      if (tray) {
        tray.displayBalloon?.({
          title: 'Still simulating',
          content: 'UnifiedSim keeps running in the tray. Right-click to quit.',
          iconType: 'info',
        });
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // External links belong in the system browser, never in an app window with
  // no address bar.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(serverUrl) && !url.startsWith(devServerUrl)) {
      event.preventDefault();
      if (/^https?:/.test(url)) void shell.openExternal(url);
    }
  });

  await mainWindow.loadURL(await resolveUiUrl());
}

const devServerUrl = 'http://localhost:5273';

/**
 * Prefers the Vite dev server when one is up, so `npm run dev` still gives HMR
 * inside the app window. Otherwise the in-process server serves the built UI,
 * which means the renderer is same-origin with the API and relative `/api`
 * calls work with no port injection.
 */
async function resolveUiUrl(): Promise<string> {
  if (IS_DEV) {
    try {
      const probe = await fetch(devServerUrl, { signal: AbortSignal.timeout(700) });
      if (probe.ok) {
        console.log('[desktop] using Vite dev server');
        return devServerUrl;
      }
    } catch {
      // Not running; fall through to the built UI.
    }
  }
  return serverUrl;
}

/* ------------------------------------------------------------------ boot */

app.on('second-instance', () => showWindow());

app.on('window-all-closed', () => {
  // On Windows and Linux the tray keeps the app alive during a batch; with no
  // batch running there is nothing left to stay open for.
  if (process.platform !== 'darwin' && queueState.running + queueState.queued === 0) app.quit();
});

app.on('activate', () => showWindow());

app.on('before-quit', async (event) => {
  if (!stopServer || quitting) return;
  quitting = true;
  event.preventDefault();
  windowState.flush();
  try {
    await stopServer();
  } finally {
    app.exit(0);
  }
});

async function boot(): Promise<void> {
  await app.whenReady();

  mkdirSync(DATA_DIR, { recursive: true });
  serverUrl = await startBackend();

  buildMenu();
  buildTray();
  await createWindow();
}

void boot().catch((err: unknown) => {
  // A failure before the window exists has nowhere to render, so use the
  // native error box rather than letting Electron exit silently.
  dialog.showErrorBox('UnifiedSim could not start', (err as Error).stack ?? String(err));
  app.exit(1);
});
