/**
 * 侧栏底部的宽度回归：真实 Chromium 测量 rail/footer/run/name 的 client/scroll。
 * 只测 CSS 布局，不注入应用状态。
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

/* global document, getComputedStyle */

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const exe = path.join(
  root,
  '.companion-data/tooling/browser/chromium-156/chrome-headless-shell-linux64/chrome-headless-shell',
);
const { chromium } = await import('@playwright/test');
const { build } = await import('esbuild');

const outDir = await mkdtemp(path.join(tmpdir(), 'rail-probe-'));
await build({
  stdin: {
    contents: `import '${root}/apps/desktop/src/renderer/console/minimal-ui/foundation.css';`,
    loader: 'ts',
    resolveDir: root,
  },
  bundle: true,
  outdir: outDir,
  entryNames: 'bundle',
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
});
const css = await readFile(path.join(outDir, 'bundle.css'), 'utf8').catch(() => '');

const page_html = (
  name,
  w,
) => `<!doctype html><html data-console-style="minimal"><head><meta charset="utf-8">
<style>${css}</style>
<style>
  body { margin: 0; }
  /* 与真实外壳同形：grid 决定侧栏宽度，rail 自己滚动。 */
  .body { display: grid; grid-template-columns: ${w < 980 ? 68 : 225}px 1fr; height: 100vh; }
  .rail { background: #eee; }
  .nav { display: flex; flex-direction: column; gap: 8px; }
  .nav__item { width: 44px; height: 44px; background: #ccc; }
</style></head><body>
<div class="body">
  <div class="rail">
    <nav class="nav"><div class="nav__item"></div><div class="nav__item"></div></nav>
    <div class="rail__foot">
      <div class="pb-run">
        <span class="pb-run__state" data-state="ok">已连接</span>
        <span class="row__value pb-run__name" title="${name}">${name}</span>
        <button class="btn btn--small pb-run__button" aria-label="刷新连接状态" title="刷新连接状态">
          <span class="pb-run__icon">⟳</span><span class="pb-run__label">刷新连接</span>
        </button>
      </div>
    </div>
  </div>
  <div></div>
</div></body></html>`;

const server = (await import('node:http')).createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const w = Number(u.searchParams.get('w') ?? 880);
  const name = u.searchParams.get('name') ?? '阿蓝';
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(page_html(name, w));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({
  executablePath: exe,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const results = [];
async function check(label, w, name, expectNoOverflow) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 600 } });
  const p = await ctx.newPage();
  await p.goto(`${origin}/?w=${w}&name=${encodeURIComponent(name)}`);
  await p.waitForSelector('.rail');
  const m = await p.evaluate(() => {
    const pick = (sel) => {
      const n = document.querySelector(sel);
      if (!n) return null;
      const cs = getComputedStyle(n);
      return {
        client: n.clientWidth,
        scroll: n.scrollWidth,
        to: cs.textOverflow,
        ox: cs.overflowX,
        min: cs.minWidth,
        max: cs.maxWidth,
      };
    };
    return {
      rail: pick('.rail'),
      foot: pick('.rail__foot'),
      run: pick('.pb-run'),
      name: pick('.pb-run__name'),
      title: document.querySelector('.pb-run__name')?.getAttribute('title'),
    };
  });
  await ctx.close();
  results.push({ label, w, nameLen: [...name].length, ...m });
  if (expectNoOverflow) {
    assert.ok(
      m.rail.scroll <= m.rail.client + 1,
      `${label}: rail 不能横向溢出 (${m.rail.scroll} > ${m.rail.client})`,
    );
    assert.ok(m.foot.scroll <= m.foot.client + 1, `${label}: footer 不能溢出`);
    assert.equal(m.name.to, 'ellipsis', `${label}: name 必须有真正 ellipsis`);
    assert.equal(m.title, name, `${label}: 完整名字要留在 title`);
  }
}

await check('narrow-normal', 880, '阿蓝', true);
await check('narrow-long12', 880, '一二三四五六七八九十十一', true);
await check('narrow-long80', 880, '名'.repeat(80), true);
await check('wide-normal', 1100, '阿蓝', true);
await check('wide-long80', 1100, '名'.repeat(80), true);

await browser.close();
server.close();
for (const r of results) console.log(JSON.stringify(r));
console.log('rail probe passed');
