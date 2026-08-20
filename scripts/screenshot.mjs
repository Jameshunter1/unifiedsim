#!/usr/bin/env node
/**
 * Screenshots the running UI.
 *
 * Chrome's `--screenshot` flag captures at the `load` event, which for a SPA is
 * before React has mounted and fetched anything -- you get the empty shell. And
 * `--virtual-time-budget` never completes here because the app holds an SSE
 * connection open, so the page is never "idle".
 *
 * So drive Chrome over the DevTools Protocol instead: navigate, wait a fixed
 * settle period, then capture. Uses Node's built-in WebSocket, no dependencies.
 *
 * Usage:
 *   node scripts/screenshot.mjs <out.png> [url] [--settle 3000] [--width 1340]
 *                               [--height 1500] [--dark|--light] [--full]
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes('--' + n);
const val = (n, d) => {
  const i = argv.indexOf('--' + n);
  return i !== -1 ? argv[i + 1] : d;
};
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && !['dark', 'light', 'full'].includes(argv[i - 1].slice(2))));

const out = positional[0];
const url = positional[1] ?? 'http://localhost:8730/';
if (!out) {
  console.error('usage: node scripts/screenshot.mjs <out.png> [url] [--settle ms] [--dark] [--full]');
  process.exit(1);
}

const settle = Number.parseInt(val('settle', '3500'), 10);
const width = Number.parseInt(val('width', '1340'), 10);
const height = Number.parseInt(val('height', '1500'), 10);
const port = Number.parseInt(val('port', '9333'), 10);

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean);
  return candidates.find((c) => existsSync(c));
}

const chrome = findChrome();
if (!chrome) {
  console.error('No Chrome or Edge found. Set CHROME_PATH.');
  process.exit(1);
}

const profileDir = path.join(os.tmpdir(), 'usim-shot-' + port);
rmSync(profileDir, { recursive: true, force: true });
mkdirSync(profileDir, { recursive: true });

const child = spawn(
  chrome,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + profileDir,
    '--window-size=' + width + ',' + height,
    'about:blank',
  ],
  { stdio: 'ignore', windowsHide: true },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Chrome takes a moment to open the debugging port. */
async function debuggerTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch('http://127.0.0.1:' + port + '/json/list');
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      // port not open yet
    }
    await sleep(250);
  }
  throw new Error('Chrome never opened its debugging port on ' + port);
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    if (msg.error) entry.reject(new Error(msg.error.message));
    else entry.resolve(msg.result);
  });

  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('CDP socket failed')), { once: true });
  });

  return {
    ready,
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close: () => ws.close(),
  };
}

try {
  const client = cdp(await debuggerTarget());
  await client.ready;

  await client.send('Page.enable');
  if (flag('dark') || flag('light')) {
    await client.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: flag('dark') ? 'dark' : 'light' }],
    });
  }

  await client.send('Page.navigate', { url });
  // Fixed settle rather than a load/idle signal: the app opens an SSE stream,
  // so it is never network-idle, and `load` fires before React has fetched.
  await sleep(settle);

  const { data } = await client.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: flag('full'),
  });

  writeFileSync(out, Buffer.from(data, 'base64'));
  client.close();
  console.log('wrote ' + out);
} finally {
  child.kill();
  // Chrome still holds handles in its profile dir for a moment after kill; on
  // Windows that surfaces as EPERM. The temp dir is disposable, so a failed
  // cleanup must not fail the screenshot.
  try {
    await sleep(300);
    rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // left behind in the OS temp dir; harmless
  }
}
