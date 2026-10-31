/*
  生成 gallery-data.js：把来源包的实际字节读成经典脚本，file:// 打开时不会被 fetch JSON 的 CORS 挡住。
  用法：node qa/website-style-previews/build-preview.mjs

  来源包 qa/website-style-previews/source-manifest.json + sources/ 由父维护，这一份只读。
  每一族的演示配方取自那一族自己的原件标记：换的只有文案、表单名与重复实例的 id，
  材质、层级、类名与动画仍由原件那一份 CSS 说话；原件里没有的角色就写明没有，不替它编一件。
*/
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const SITE_UI = join(ROOT, 'apps', 'desktop', 'src', 'renderer', 'console', 'site-ui');
const MANIFEST = join(HERE, 'source-manifest.json');
const LF = String.fromCharCode(10);

function digestHex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** 字节必须与 manifest 记的那一条一致；不一致就是包坏了，直接停在这里。 */
function readSource(path, sha256, label) {
  const text = readFileSync(path, 'utf8');
  const actual = digestHex(text);
  if (actual !== sha256)
    throw new Error('字节与 manifest 不符：' + label + '（' + actual + ' 不等于 ' + sha256 + '）');
  return text;
}

function extractStyleText(raw) {
  const out = [];
  let cursor = 0;
  for (;;) {
    const start = raw.indexOf('<style', cursor);
    if (start < 0) break;
    const open = raw.indexOf('>', start);
    const close = raw.indexOf('</style>', open);
    if (open < 0 || close < 0) break;
    out.push(raw.slice(open + 1, close));
    cursor = close + 8;
  }
  return out.join(LF);
}

function sliceBetween(raw, startMarker, stopMarker) {
  const start = raw.indexOf(startMarker);
  if (start < 0) throw new Error('原件里找不到那一段标记：' + startMarker);
  const stop = raw.indexOf(stopMarker, start);
  return stop < 0 ? raw.slice(start) : raw.slice(start, stop);
}

function markupIds(markup) {
  const ids = [];
  const pattern = /id="([^"]+)"/g;
  let match;
  while ((match = pattern.exec(markup)) !== null) ids.push(match[1]);
  return ids;
}

/**
 * 演示里同一件要摆好几格（三个供应商位、两颗按钮）。上游有几件用 id 选样式，
 * 重复实例就换成带前缀的 id，CSS 里对应那一条同步改成前缀匹配：
 * 只动选择器的写法，声明里的数值一个不动；带 # 的颜色值不在这些 id 里，不会被牵连。
 */
function prefixIds(css, ids) {
  let out = css;
  const rewritten = [];
  for (const id of ids) {
    if (out.indexOf('#' + id) < 0) continue;
    out = out.split('#' + id).join('[id^="' + id + '"]');
    rewritten.push(id);
  }
  return { css: out, rewritten: rewritten };
}

/** 基准那一组：接好的 CSS 与产品里正在跑的那一份同字节，配方与站点组件的标记一一对应。 */
const BASELINE_PARTS = {
  panel:
    '<section class="su-panel"><header class="su-panel__head"><h2 class="su-panel__title">@text@</h2><div class="su-panel__aside">@aside@</div></header><p class="su-panel__note">@note@</p><div class="su-panel__body">@body@</div></section>',
  tile: '<button type="button" class="su-tile" data-selected="@selected@"><span class="su-tile__head"><span class="su-tile__mark" aria-hidden="true">@icon@</span><span class="su-tile__name">@text@</span></span><span class="su-tile__note">@note@</span></button>',
  input:
    '<label class="su-field"><span class="su-field__label">@text@</span><input class="su-input" type="@type@" placeholder="@placeholder@" value="@value@"><span class="su-field__hint">@note@</span></label>',
  switch:
    '<label class="su-switch-row"><span class="su-switch"><input class="su-toggle" type="checkbox" name="@uid@" @checked@><span class="su-slider" aria-hidden="true"></span></span><span class="su-switch__name">@text@</span><span class="su-switch__hint">@note@</span></label>',
  choice:
    '<fieldset class="su-choice-field"><legend class="su-choice-field__legend">@text@</legend><div class="su-choice">@body@</div></fieldset>',
  choiceOption:
    '<label class="su-choice__option"><input class="su-choice__input" type="radio" name="@uid@" value="@value@" @checked@><span class="su-choice__btn"><span class="su-choice__span">@text@</span></span></label>',
  button: '<button type="button" class="su-button @variant@" @disabled@>@text@</button>',
  status:
    '<span class="su-status" data-tone="@tone@"><span class="su-status__lamp" aria-hidden="true"></span><span class="su-status__text">@text@</span></span>',
  notice:
    '<div class="su-notice" data-tone="@tone@"><div class="su-notice__body">@text@</div><div class="su-notice__action">@action@</div></div>',
  fold: '<details class="su-fold" @open@><summary class="su-fold__summary"><span class="su-fold__label">@text@</span><span class="su-fold__chevron" aria-hidden="true"></span></summary><div class="su-fold__body">@body@</div></details>',
};

/**
 * 四族新增的演示配方：三段标记（段落 / 输入 / 按钮）取自那一族自己的原件文件。
 * extensionCss 只补一件来源里没有的东西：选中那一格——用该族自己 hover 那一句材质，界面上逐条写明。
 */
const RECIPES = {
  'soft-relief': {
    canvas: 'light',
    panel:
      '<div class="hero"><div class="container"><form action="" class="form"><div class="logo">@text@</div><div class="demo-stack">@body@<p class="forgotten">@note@</p></div></form></div></div>',
    input:
      '<input type="@type@" name="@uid@-field" id="@uid@-field" class="input" placeholder="@placeholder@" value="@value@">',
    button:
      '<div class="input btn @tileClass@" @selectedAttr@ role="button" tabindex="0">@text@</div>',
    tile: '<div class="input btn @tileClass@" @selectedAttr@ role="button" tabindex="0">@text@</div>',
    note: '<p class="forgotten">@text@</p>',
    extensionCss:
      '.demo-tile[data-selected="true"]{box-shadow:inset -3px -3px 5px rgba(255,255,255,.78),inset 3px 3px 5px rgba(209,209,209,.705)}',
    extensionNote:
      '选中那一格：把这一族自己的两条软影翻成内凹，与它 .input 的内凹同一说法。来源里没有选中态。',
  },
  'holo-glass': {
    canvas: 'dark',
    panel:
      '<div id="Container"><form class="form"><div id="login-lable">@text@</div><div class="demo-stack">@body@<div class="demo-note">@note@</div></div></form>@@decor@@</div>',
    input: '<input class="form-content" type="@type@" placeholder="@placeholder@" value="@value@">',
    button: '<button type="button" class="@tileClass@" @selectedAttr@>@text@</button>',
    tile: '<button type="button" class="@tileClass@" @selectedAttr@>@text@</button>',
    note: '<div class="demo-note">@text@</div>',
    extensionCss:
      '.form button.demo-tile[data-selected="true"]{background:linear-gradient(144deg,#9c11ff,#2000ee 50%,#15fff3);box-shadow:0 0 2px 2px #fff}',
    extensionNote:
      '选中那一格：用这一族自己 .form button:hover 那一句渐变与白描边。来源里没有选中态。',
  },
  'space-neon': {
    canvas: 'dark',
    panel:
      '<form class="form"><div class="form-title"><span>@text@</span></div><div class="title-2"><span>@subtext@</span></div><section class="bg-stars"><span class="star"></span><span class="star"></span><span class="star"></span><span class="star"></span></section><div class="demo-stack">@body@<p class="signup-link">@note@</p></div></form>',
    input:
      '<div class="input-container"><input class="input-mail" type="@type@" placeholder="@placeholder@" value="@value@"></div>',
    button:
      '<button type="button" class="submit @tileClass@" @selectedAttr@><span class="sign-text">@text@</span></button>',
    tile: '<button type="button" class="submit @tileClass@" @selectedAttr@><span class="sign-text">@text@</span></button>',
    note: '<p class="signup-link">@text@</p>',
    extensionCss:
      '.submit.demo-tile[data-selected="true"]{border-radius:3.9px;box-shadow:4px 5px 17px -4px #fff}',
    extensionNote: '选中那一格：用这一族自己 .submit:hover 那一句白描边发光。来源里没有选中态。',
  },
  'lavender-line': {
    canvas: 'light',
    panel:
      '<form action="" class="form_main"><p class="heading">@text@</p><div class="demo-stack">@body@<a class="forgotLink" href="#demo">@note@</a></div></form>',
    input:
      '<div class="inputContainer">@@icon@@<input type="@type@" class="inputField" id="@uid@-field" placeholder="@placeholder@" value="@value@"></div>',
    button:
      '<button type="button" id="button-@uid@" class="@tileClass@" @selectedAttr@>@text@</button>',
    tile: '<button type="button" id="button-@uid@" class="@tileClass@" @selectedAttr@>@text@</button>',
    note: '<a class="forgotLink" href="#demo">@text@</a>',
    extensionCss:
      '[id^="button"].demo-tile[data-selected="true"]{background-color:rgb(126,84,255)}',
    extensionNote:
      '选中那一格：用这一族自己 #button:hover 那一句紫。来源里没有选中态；重复的按钮把 id 换成带前缀那一份，CSS 那一条同步改成前缀匹配。',
  },
};

function baselineFamily(family) {
  const kit = JSON.parse(readFileSync(join(SITE_UI, 'source-manifest.json'), 'utf8')).controls;
  const controls = family.sources.map(function (item) {
    const raw = readSource(resolve(HERE, item.file), item.sha256, item.slug);
    return describeSource(item, raw);
  });
  const css =
    readFileSync(join(SITE_UI, 'source-controls.css'), 'utf8') +
    LF +
    readFileSync(join(SITE_UI, 'source-extensions.css'), 'utf8');
  const recipe = {
    panel: BASELINE_PARTS.panel,
    tile: BASELINE_PARTS.tile,
    input: BASELINE_PARTS.input,
    button: BASELINE_PARTS.button,
    note: '<p class="su-panel__note">@text@</p>',
    scope: Object.keys(BASELINE_PARTS),
    extras: {
      switch: BASELINE_PARTS.switch,
      choice: BASELINE_PARTS.choice,
      choiceOption: BASELINE_PARTS.choiceOption,
      status: BASELINE_PARTS.status,
      notice: BASELINE_PARTS.notice,
      fold: BASELINE_PARTS.fold,
    },
    extensionCss: '',
    extensionNote: kit.localExtensions.rule,
    declaredIds: [],
  };
  return {
    id: family.id,
    label: family.label,
    summary: family.summary,
    current: true,
    canvas: 'light',
    author: { name: kit.author, url: kit.authorUrl },
    licence: {
      spdx: kit.license.spdx,
      copyright: kit.license.copyrightLine,
      file: 'sources/LICENSE.md',
    },
    basis: kit.basis,
    scopeClass: 'su-source',
    css: css,
    cssNote:
      '整窗与控件板用的就是产品里正在跑的那一份接好 CSS（site-ui/source-controls.css 与 source-extensions.css）：选择器加了 .su- 命名空间，材质数值按那五件原件。',
    recipe: recipe,
    extensionItems: kit.localExtensions.items,
    controls: controls,
  };
}

function packFamily(family) {
  const recipe = RECIPES[family.id];
  if (!recipe) throw new Error('这一族还没有演示配方：' + family.id);
  if (family.sources.length !== 1) throw new Error('完整表单这一族应当只有一份原件：' + family.id);
  const item = family.sources[0];
  const raw = readSource(resolve(HERE, item.file), item.sha256, item.slug);
  const styleText = extractStyleText(raw);
  const used = prefixIds(styleText, markupIds(raw));
  const pieces = {};
  if (family.id === 'holo-glass') {
    const decor = sliceBetween(raw, '<div id="rays">', '<style>').trimEnd();
    pieces.decor = decor.slice(0, decor.lastIndexOf('</div>'));
  }
  if (family.id === 'lavender-line') {
    pieces.icon =
      raw
        .split('<svg class="inputIcon"')
        .slice(1)
        .map(function (tail) {
          return '<svg class="inputIcon"' + tail.split('</svg>')[0] + '</svg>';
        })[0] || '';
  }
  const resolved = {};
  for (const key of ['panel', 'input', 'button', 'tile', 'note']) {
    resolved[key] = recipe[key]
      .replace('@@decor@@', pieces.decor || '')
      .replace('@@icon@@', pieces.icon || '');
  }
  return {
    id: family.id,
    label: family.label,
    summary: family.summary,
    current: false,
    canvas: recipe.canvas,
    author: { name: family.author, url: 'https://uiverse.io/' + family.author },
    licence: {
      spdx: item.license,
      copyright: 'Copyright (c) 2023 Uiverse.io',
      file: 'sources/LICENSE.md',
    },
    basis: family.summary,
    scopeClass: '',
    css: used.css + LF + recipe.extensionCss,
    cssNote:
      '整窗与控件板用的就是这一份原件自带的 style。' +
      (used.rewritten.length
        ? '其中 ' +
          used.rewritten
            .map(function (id) {
              return '#' + id;
            })
            .join('、') +
          ' 那几条选择器改成前缀匹配（重复实例才需要）；声明数值一个没动。'
        : ''),
    recipe: {
      panel: resolved.panel,
      tile: resolved.tile,
      input: resolved.input,
      button: resolved.button,
      note: resolved.note,
      scope: ['panel', 'input', 'button'].concat(
        item.roles.indexOf('decoration') >= 0 ? ['decoration'] : [],
      ),
      extras: {},
      extensionCss: recipe.extensionCss,
      extensionNote: recipe.extensionNote,
      declaredIds: used.rewritten,
    },
    extensionItems: [
      {
        name: family.label + '：选中那一格',
        file: item.file,
        css: [recipe.extensionCss],
        from: recipe.extensionNote,
      },
    ],
    controls: [describeSource(item, raw)],
  };
}

function describeSource(item, raw) {
  return {
    slug: item.slug,
    author: item.author,
    category: item.category,
    roles: item.roles,
    selectors: item.selectors,
    permalink: item.permalink,
    repositoryFile: item.repositoryFile,
    sourceFile: item.file,
    sha256: item.sha256,
    bytes: item.bytes,
    license: item.license,
    styleText: extractStyleText(raw),
    raw: raw,
  };
}

function buildIcons(icons) {
  const nodes = JSON.parse(readFileSync(resolve(HERE, icons.data), 'utf8'));
  const glyphs = {};
  for (const name of Object.keys(nodes)) {
    const children = nodes[name]
      .map(function (node) {
        const attrs = Object.keys(node[1])
          .map(function (key) {
            return key + '="' + node[1][key] + '"';
          })
          .join(' ');
        return '<' + node[0] + ' ' + attrs + ' />';
      })
      .join('');
    glyphs[name] =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20">' +
      children +
      '</svg>';
  }
  return {
    website: icons.website,
    family: icons.family,
    revision: icons.revision,
    licenses: icons.licenses.map(function (p) {
      return relative(HERE, resolve(HERE, p)).split(String.fromCharCode(92)).join('/');
    }),
    count: Object.keys(glyphs).length,
    glyphs: glyphs,
    note: 'vendored Tabler outline 字形，只给本站的角色示意与供应商位点缀；不是任何一族的候选控件。',
  };
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const current = manifest.families.filter(function (family) {
  return family.current === true;
});
if (current.length !== 1)
  throw new Error('manifest 里 current 那一族应当正好一条，现在 ' + current.length + ' 条');
const added = manifest.families
  .filter(function (family) {
    return family.current !== true;
  })
  .map(packFamily);

const data = {
  meta: {
    generatedAt: new Date().toISOString(),
    builder: 'qa/website-style-previews/build-preview.mjs',
    title: manifest.title,
    scope: manifest.scope,
    websiteAccess: manifest.websiteAccess,
    allowedAdaptations: manifest.allowedAdaptations,
  },
  icons: buildIcons(manifest.icons),
  styles: [baselineFamily(current[0])].concat(added),
};

const banner =
  '/* 生成文件：node qa/website-style-previews/build-preview.mjs —— 字节来自 source-manifest.json 登记的那九份原件，不要手改。 */' +
  LF;
writeFileSync(
  join(HERE, 'gallery-data.js'),
  banner + 'window.PREVIEW_DATA = ' + JSON.stringify(data, null, 1) + ';' + LF,
);

console.log('gallery-data.js 已生成：' + data.styles.length + ' 组');
for (const style of data.styles) {
  console.log(
    '  - ' +
      style.id +
      '（' +
      style.label +
      '）：' +
      style.controls.length +
      ' 份原件，画布 ' +
      style.canvas +
      '，角色 ' +
      style.recipe.scope.join('/') +
      (style.recipe.declaredIds.length ? '，改写过 id ' + style.recipe.declaredIds.join('/') : ''),
  );
}
