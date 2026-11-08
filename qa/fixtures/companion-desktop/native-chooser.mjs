import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const exec = promisify(execFile);

// Only the owned Xvfb display and a uniquely identified Electron dialog may receive input.
export async function completeNativeChooser({ root, env, electronPid, ownerXid, destination, capture }) {
  assert.match(env.DISPLAY ?? '', /^:\d+$/);
  assert.ok(Number.isSafeInteger(electronPid) && electronPid > 1);
  assert.match(ownerXid, /^0x[0-9a-f]+$/i);
  if (destination !== null) {
    assert.ok(path.isAbsolute(destination));
    assert.equal(path.dirname(destination), path.resolve(env.HOME), 'destination must be in isolated chooser HOME');
  }
  const tool = path.join(root, '.companion-data/tooling/desktop/libraries/usr/bin/xdotool');
  const run = async (...args) => (await exec(tool, args, { env, timeout: 5000, maxBuffer: 8192 })).stdout.trim();
  const deadline = Date.now() + 15000;
  let selected;
  let visible = [];
  let searchError = null;
  while (Date.now() < deadline) {
    let ids;
    try { ids = (await run('search', '--onlyvisible', '--pid', String(electronPid))).split('\n').filter(Boolean); }
    catch (error) {
      if (error.code !== 1 || String(error.stderr ?? '').trim() !== '') throw error;
      ids = [];
    }
    try {
      const all = (await run('search', '--onlyvisible', '--name', '.')).split('\n').filter(Boolean);
      visible = await Promise.all(all.map(async (id) => ({ id,
        pid: await run('getwindowpid', id).catch(() => 'unavailable'),
        title: await run('getwindowname', id).catch(() => 'unavailable'),
      })));
    } catch (error) {
      visible = [];
      searchError = { code: error.code ?? null, stderr: String(error.stderr ?? '').slice(0, 500) };
      if (error.code !== 1 || searchError.stderr.trim() !== '') throw error;
    }
    const matches = [];
    for (const id of ids) {
      const pid = await run('getwindowpid', id);
      const title = await run('getwindowname', id);
      if (pid !== String(electronPid) || title !== 'Save File') continue;
      const xprop = path.join(root, '.companion-data/tooling/desktop/libraries/usr/bin/xprop');
      const properties = (await exec(xprop, ['-id', id, '_NET_WM_PID', 'WM_CLASS', 'WM_TRANSIENT_FOR'],
        { env, timeout: 5000, maxBuffer: 8192 })).stdout;
      const transient = /WM_TRANSIENT_FOR\(WINDOW\): window id # (0x[0-9a-f]+)/i.exec(properties)?.[1];
      if (transient && BigInt(transient) === BigInt(ownerXid) &&
          properties.includes(`_NET_WM_PID(CARDINAL) = ${electronPid}`)) matches.push({ id, title });
    }
    if (matches.length > 1) throw new Error('Ambiguous native save dialogs');
    if (matches.length === 1) { selected = matches[0]; break; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!selected) throw new Error(`No uniquely identified Electron native save dialog; visible=${JSON.stringify(visible)}; searchError=${JSON.stringify(searchError)}; electronPid=${electronPid}`);
  await run('windowfocus', '--sync', selected.id);
  const focus = await run('getwindowfocus');
  assert.equal(focus, selected.id, 'native save dialog did not receive focus');
  await capture?.('before-input');
  if (destination === null) await run('key', '--clearmodifiers', 'Escape');
  else {
    await run('key', '--clearmodifiers', 'ctrl+l');
    await run('key', '--clearmodifiers', 'ctrl+a');
    await run('type', '--clearmodifiers', '--', path.basename(destination));
    await capture?.('path-entered');
    // The observed GTK dialog has a visible Save button at its lower right.
    const geometry = await run('getwindowgeometry', '--shell', selected.id);
    const width = Number(/^WIDTH=(\d+)$/m.exec(geometry)?.[1]);
    const height = Number(/^HEIGHT=(\d+)$/m.exec(geometry)?.[1]);
    assert.ok(width >= 200 && height >= 100, 'invalid verified chooser geometry');
    assert.equal(await run('getwindowpid', selected.id), String(electronPid));
    assert.equal(await run('getwindowname', selected.id), selected.title);
    await run('mousemove', '--window', selected.id, String(width - 50), String(height - 23));
    await run('click', '1');
    await capture?.('after-save-click');
  }
  return { dialogTitle: selected.title, ownerPidMatched: true,
    action: destination === null ? 'escape-sent' : 'save-input-sent' };
}
