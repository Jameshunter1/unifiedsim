#!/usr/bin/env node
/**
 * Builds the SimulationCraft container image.
 *
 * Compiles simc from source on Linux, which sidesteps Windows Smart App
 * Control refusing to execute unsigned native binaries. One-time cost of
 * roughly 10-20 minutes; after that the image is cached.
 *
 * Usage:
 *   npm run simc:docker
 *   npm run simc:docker -- --ref <branch|tag>   # pin a simc revision
 *   npm run simc:docker -- --no-cache
 */

import { execFile, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTEXT = path.join(ROOT, 'docker', 'simc');
const IMAGE = process.env.SIMC_DOCKER_IMAGE ?? 'usim/simc:latest';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes('--' + name);
const value = (name) => {
  const i = argv.indexOf('--' + name);
  return i !== -1 ? argv[i + 1] : undefined;
};

async function ensureDaemon() {
  try {
    const { stdout } = await execFileAsync('docker', ['version', '--format', '{{.Server.Version}}'], {
      timeout: 20000,
      windowsHide: true,
    });
    return stdout.trim();
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error('docker is not installed or not on PATH.');
    } else {
      console.error(
        'The Docker daemon is not responding.\n' +
          'Start Docker Desktop and wait for it to report "Engine running", then re-run this.',
      );
    }
    process.exit(1);
  }
}

const serverVersion = await ensureDaemon();

const args = ['build', '-t', IMAGE, '-f', path.join(CONTEXT, 'Dockerfile')];
if (flag('no-cache')) args.push('--no-cache');
const ref = value('ref');
if (ref) args.push('--build-arg', 'SIMC_REF=' + ref);
const jobs = value('jobs');
if (jobs) args.push('--build-arg', 'BUILD_JOBS=' + jobs);
args.push(CONTEXT);

console.log('Building ' + IMAGE);
console.log('  docker engine : ' + serverVersion);
console.log('  simc revision : ' + (ref ?? 'default branch (current retail)'));
console.log('  parallel jobs : ' + (jobs ?? '3 (capped)'));
console.log('');
console.log("  Compiles simc from source; expect 15-30 min. Parallelism is capped because");
console.log("  simc's generated data tables need roughly a gigabyte of RAM each to compile,");
console.log('  and overcommitting kills the Docker VM mid-build.');
console.log('');

const started = Date.now();
const child = spawn('docker', args, { stdio: 'inherit', windowsHide: true });

child.on('error', (err) => {
  console.error('Could not start docker: ' + err.message);
  process.exit(1);
});

child.on('close', async (code) => {
  if (code !== 0) {
    console.error('\nBuild failed (exit ' + code + ').');
    process.exit(code ?? 1);
  }

  const minutes = ((Date.now() - started) / 60000).toFixed(1);
  console.log('\nBuilt ' + IMAGE + ' in ' + minutes + ' min.');

  try {
    const { stdout } = await execFileAsync(
      'docker',
      ['run', '--rm', '--entrypoint', '/bin/sh', IMAGE, '-c', 'cat /BUILD_SOURCE'],
      { timeout: 30000, windowsHide: true },
    );
    console.log('simc source: ' + stdout.trim());
  } catch {
    // Provenance is informational only.
  }

  console.log('\nThe server picks this up automatically. Restart it or hit Refresh in the UI.');
});
