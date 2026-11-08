import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';

// This is the private, previously verified Linux Xvfb setup; it does not alter the host X server.
export async function startDisplay(root) {
  const tools = path.join(root, '.companion-data/tooling/desktop');
  const bin = path.join(tools, 'libraries/usr/bin');
  const env = { ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    LD_LIBRARY_PATH: [path.join(tools, 'libraries/usr/lib/x86_64-linux-gnu'),
      path.join(root, '.companion-data/tooling/browser/libraries/usr/lib/x86_64-linux-gnu'),
      process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'),
    FONTCONFIG_FILE: path.join(root, '.companion-data/tooling/browser/fonts.conf'),
    GSETTINGS_SCHEMA_DIR: path.join(tools, 'libraries/usr/share/glib-2.0/schemas'),
    XDG_DATA_DIRS: `${path.join(tools, 'libraries/usr/share')}:/usr/local/share:/usr/share`,
    GSETTINGS_BACKEND: 'memory',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(path.join(bin, 'proot'), [
    '-b', `${path.join(bin, 'xkbcomp')}:/usr/bin/xkbcomp`, path.join(bin, 'Xvfb'),
    '-displayfd', '3', '-screen', '0', '1440x1000x24', '-nolisten', 'tcp', '-ac',
    '-xkbdir', path.join(tools, 'libraries/usr/share/X11/xkb'),
  ], { env, detached: true, stdio: ['ignore', 'ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (data) => { stderr = (stderr + data).slice(-4000); });
  const exit = once(child, 'exit');
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    await exit;
  };
  let timer;
  try {
    const number = await Promise.race([
      new Promise((resolve, reject) => {
        let text = '';
        child.stdio[3].on('data', (data) => {
          text += data;
          if (text.includes('\n')) {
            const value = text.trim();
            if (!/^\d+$/.test(value)) reject(new Error('Invalid Xvfb display number'));
            else resolve(value);
          }
        });
        child.once('error', reject);
        child.once('exit', () => reject(new Error(`Xvfb exited before readiness: ${stderr}`)));
      }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Xvfb readiness timeout')), 10000); }),
    ]);
    return { env: { ...env, DISPLAY: `:${number}` }, stop };
  } catch (error) {
    await stop();
    throw error;
  } finally { clearTimeout(timer); }
}
