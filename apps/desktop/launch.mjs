#!/usr/bin/env node
/**
 * Launches the Electron app.
 *
 * Exists because of one environment variable: `ELECTRON_RUN_AS_NODE`. Editors
 * that are themselves Electron apps -- VS Code among them -- export it to their
 * integrated terminals so their helper processes behave as plain Node. Any
 * `electron .` inherited from such a terminal then starts in Node mode, where
 * `require('electron')` resolves to the npm shim (a path string) instead of the
 * API, and the app dies with "Cannot read properties of undefined (reading
 * 'isPackaged')".
 *
 * Stripping the variable here makes the launch behave identically whether it
 * came from a plain shell, an editor terminal, or an npm script.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import electronBinary from 'electron';

const appDir = path.dirname(fileURLToPath(import.meta.url));

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

if (typeof electronBinary !== 'string') {
  console.error('Could not resolve the Electron binary. Try `npm install` again.');
  process.exit(1);
}

const child = spawn(electronBinary, [appDir, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
  windowsHide: false,
});

child.on('error', (err) => {
  console.error('Failed to launch Electron: ' + err.message);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
