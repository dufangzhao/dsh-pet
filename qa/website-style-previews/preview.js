/*
  风格演示台：五族各用自己的那一份 CSS，在 shadow root 里画一件轻量的示例窗口。
  数据只读 window.PREVIEW_DATA（gallery-data.js，由 build-preview.mjs 生成）。
  不接模型/密钥/麦克风/历史/存储，也不写任何状态：点选、按压与输入都只活在这一页里。
*/
/* global window, document */
(function () {
  'use strict';

  var DATA = window.PREVIEW_DATA || null;
  var body = document.body;
  var picker = document.getElementById('style-picker');
  var viewSwitcher = document.getElementById('view-switcher');
  var widthToggle = document.getElementById('width-toggle');
  var stage = document.getElementById('stage');
  var empty = document.getElementById('stage-empty');
  var buildHint = document.getElementById('build-hint');
  var hostWindow = document.getElementById('host-window');
  var gridControls = document.getElementById('grid-controls');
  var gridRaw = document.getElementById('grid-raw');
  var attribution = document.getElementById('attribution');
  var uidSeed = 0;

  /* 只有排版：flex、间距、占宽。材质、颜色、描边、阴影一律由那一族自己的 CSS 说话。 */
  var LAYOUT_CSS = [
    ':host { display: block; }',
    '/* 中性展示层：只给画布留边、把那一族自己的固定宽卡片推到中间；卡片宽度一像素不改。 */',
    '.demo-layer { padding: 24px; }',
    '.demo-layer > * { margin-inline: auto; }',
    '.demo-stack { display: flex; flex-direction: column; gap: 10px; align-items: stretch; }',
    '/* 原件的输入多是固定宽（星空那件 250px）：一格一行，输入跟着格宽走，不并排挤压。 */',
    '.demo-fields { display: flex; flex-direction: column; gap: 10px; }',
    '.demo-cell { min-width: 0; max-width: 100%; }',
    '.demo-cell input { max-width: 100%; box-sizing: border-box; }',
    '/* 同排的选择格按格数等分：窄的那族（全息）三格才排得整齐。 */',
    '.demo-row { display: flex; flex-wrap: wrap; gap: 10px; align-items: stretch; }',
    '.demo-row > .demo-cell { flex: 1 1 0; }',
    '.demo-hint { margin: 0; font-size: 12px; }',
  ].join('');

  /* 示例文案：桌宠设置的样子。全是演示内容，不代表任何真实连接、保存或回执。 */
  var SAMPLE = {
    title: '组合示意 · 桌宠外观',
    subtext: 'DEMO',
    aside: '仅示意',
    panelNote: '示例内容，只在这一页生效。',
    tiles: [
      { text: '小猫', note: '默认形象' },
      { text: '柴犬', note: '示例第二格' },
      { text: '企鹅', note: '示例第三格' },
    ],
    nameField: { label: '名字', type: 'text', placeholder: '给宠物起个名字', note: '可直接键入。' },
    secondField: {
      label: '唤醒词',
      type: 'password',
      placeholder: '可聚焦、可输入',
      note: '密码类型示意。',
    },
    switches: [
      { text: '跟随鼠标', note: '示例开关，本地一勾' },
      { text: '显示气泡', note: '示例开关，不接任何服务' },
    ],
    choice: { text: '尺寸', options: ['小', '中', '大'] },
    buttons: [
      { text: '试一试', variant: 'su-button--primary' },
      { text: '取消', variant: 'su-button--quiet' },
    ],
    status: { tone: 'neutral', text: '状态点示例' },
    notice: { tone: 'warn', text: '提示条示例：文案与色档都在这一族的材质里。', action: '知道了' },
    fold: { text: '高级（示例）', note: '折叠里再放一格输入。' },
  };

  function nextUid() {
    uidSeed += 1;
    return 'p' + uidSeed;
  }

  /* 配方的 @token@ 由这里填；数据里出现没登记的占位就停在这里，不静默留半个空位。 */
  function fill(template, values) {
    return String(template).replace(/@([a-zA-Z]+)@/g, function (all, key) {
      if (!(key in values)) throw new Error('配方缺少这个占位：' + all);
      return values[key];
    });
  }

  function glyph(name) {
    var set = DATA.icons && DATA.icons.glyphs;
    return (set && set[name]) || '';
  }

  function hasExtra(style, role) {
    return !!(style.recipe.extras && style.recipe.extras[role]);
  }

  /* ---------- 一件控件：配方取自数据，标记形状仍是那一族原件的 ---------- */
  function tileMarkup(style, item, selected) {
    return fill(style.recipe.tile, {
      text: item.text,
      note: item.note || '',
      icon: glyph('robot'),
      selected: selected ? 'true' : 'false',
      selectedAttr: selected ? 'data-selected="true"' : 'data-selected="false"',
      tileClass: 'demo-tile',
      uid: nextUid(),
    });
  }

  function inputMarkup(style, field) {
    return fill(style.recipe.input, {
      text: field.label,
      type: field.type || 'text',
      placeholder: field.placeholder || '',
      value: field.value || '',
      note: field.note || '',
      uid: nextUid(),
    });
  }

  function buttonMarkup(style, item) {
    return fill(style.recipe.button, {
      text: item.text,
      variant: style.current ? item.variant || '' : '',
      disabled: item.disabled ? 'disabled' : '',
      tileClass: '',
      selectedAttr: '',
      uid: nextUid(),
    });
  }

  function noteMarkup(style, words) {
    return fill(style.recipe.note, { text: words });
  }

  function extraMarkup(style, role, values) {
    return hasExtra(style, role) ? fill(style.recipe.extras[role], values) : '';
  }

  function panelMarkup(style, inner, note) {
    return fill(style.recipe.panel, {
      text: SAMPLE.title,
      subtext: SAMPLE.subtext,
      aside: SAMPLE.aside,
      note: note || SAMPLE.panelNote,
      body: inner,
    });
  }

  function tilesRow(style) {
    return (
      '<div class="demo-row">' +
      SAMPLE.tiles
        .map(function (item, i) {
          return '<div class="demo-cell">' + tileMarkup(style, item, i === 0) + '</div>';
        })
        .join('') +
      '</div>'
    );
  }

  function fieldsRow(style) {
    return (
      '<div class="demo-fields">' +
      '<div class="demo-cell">' +
      inputMarkup(style, SAMPLE.nameField) +
      '</div>' +
      '<div class="demo-cell">' +
      inputMarkup(style, SAMPLE.secondField) +
      '</div>' +
      '</div>'
    );
  }

  function buttonsRow(style) {
    return (
      '<div class="demo-row">' +
      SAMPLE.buttons
        .map(function (item) {
          return buttonMarkup(style, item);
        })
        .join('') +
      '</div>'
    );
  }

  function switchesRow(style) {
    if (!hasExtra(style, 'switch')) return '';
    return (
      '<div class="demo-row">' +
      SAMPLE.switches
        .map(function (row) {
          return extraMarkup(style, 'switch', {
            text: row.text,
            note: row.note,
            uid: nextUid(),
            checked: '',
          });
        })
        .join('') +
      '</div>'
    );
  }

  function choiceField(style, uid) {
    if (!hasExtra(style, 'choice')) return '';
    return extraMarkup(style, 'choice', {
      text: SAMPLE.choice.text,
      body: SAMPLE.choice.options
        .map(function (label, i) {
          return extraMarkup(style, 'choiceOption', {
            text: label,
            value: 'opt' + i,
            uid: uid,
            checked: i === 1 ? 'checked' : '',
          });
        })
        .join(''),
    });
  }

  function statusBlock(style) {
    if (!hasExtra(style, 'status')) return '';
    return (
      '<div class="demo-row">' +
      extraMarkup(style, 'status', { tone: SAMPLE.status.tone, text: SAMPLE.status.text }) +
      '</div>' +
      extraMarkup(style, 'notice', {
        tone: SAMPLE.notice.tone,
        text: SAMPLE.notice.text,
        action: SAMPLE.notice.action,
      }) +
      extraMarkup(style, 'fold', {
        open: '',
        text: SAMPLE.fold.text,
        note: SAMPLE.fold.note,
        body: inputMarkup(style, {
          label: SAMPLE.nameField.label,
          type: 'text',
          placeholder: SAMPLE.nameField.placeholder,
          note: SAMPLE.fold.note,
        }),
      })
    );
  }

  function windowInner(style) {
    var parts = [
      tilesRow(style),
      fieldsRow(style),
      switchesRow(style),
      choiceField(style, 'size-' + style.id),
    ];
    parts.push(buttonsRow(style));
    if (statusBlock(style)) parts.push(statusBlock(style));
    return parts.filter(Boolean).join('');
  }

  /* ---------- 挂载：一件一 shadow root，用那一族自己的 CSS ---------- */
  /* neutral：这一层是我们摆的（组合示意／控件板）。原件视图不带展示层类，字节照原样进 shadow root。 */
  function mount(host, style, inner, neutral) {
    var root = host.shadowRoot || host.attachShadow({ mode: 'open' });
    var css = document.createElement('style');
    css.textContent = style.css + (neutral ? LAYOUT_CSS : '');
    var layer = document.createElement('div');
    layer.className = neutral ? style.scopeClass + ' demo-layer' : style.scopeClass;
    layer.innerHTML = inner;
    root.replaceChildren(css, layer);
    bindLocalState(layer);
    return root;
  }

  function frame(style) {
    var item = document.createElement('div');
    item.className = 'raw-item';
    var head = document.createElement('div');
    head.className = 'raw-item__head';
    var title = document.createElement('span');
    title.className = 'raw-item__title';
    head.append(title);
    var meta = document.createElement('p');
    meta.className = 'raw-item__meta';
    var stage = document.createElement('div');
    stage.className = 'raw-item__stage' + (style.canvas === 'dark' ? ' raw-item__stage--dark' : '');
    var host = document.createElement('div');
    stage.append(host);
    item.append(head, meta, stage);
    return { item: item, title: title, meta: meta, host: host };
  }

  function renderWindow(style) {
    hostWindow.classList.toggle('host--dark', style.canvas === 'dark');
    mount(hostWindow, style, panelMarkup(style, windowInner(style)), true);
  }

  function sourceForRole(style, role) {
    for (var i = 0; i < style.controls.length; i++) {
      if (style.controls[i].roles.indexOf(role) >= 0) return style.controls[i];
    }
    return style.controls.length === 1 ? style.controls[0] : null;
  }

  function sourceMeta(source) {
    if (!source) return '来源里没有这一件；按同一材质延伸，见下方说明。';
    return (
      '来源 ' +
      source.slug +
      ' · ' +
      source.sourceFile +
      ' · 选择器 ' +
      Object.keys(source.selectors)
        .map(function (key) {
          return key + '→' + source.selectors[key];
        })
        .join('、')
    );
  }

  var CELL_BUILDERS = {
    panel: function (style) {
      return panelMarkup(style, '<p class="demo-hint">' + SAMPLE.fold.note + '</p>');
    },
    tile: function (style) {
      return tilesRow(style);
    },
    input: function (style) {
      return inputMarkup(style, SAMPLE.nameField);
    },
    button: function (style) {
      return buttonsRow(style);
    },
    switch: function (style) {
      return switchesRow(style);
    },
    choice: function (style) {
      return choiceField(style, 'ctrl-' + style.id);
    },
    status: function (style) {
      return extraMarkup(style, 'status', { tone: SAMPLE.status.tone, text: SAMPLE.status.text });
    },
    notice: function (style) {
      return extraMarkup(style, 'notice', {
        tone: SAMPLE.notice.tone,
        text: SAMPLE.notice.text,
        action: SAMPLE.notice.action,
      });
    },
    fold: function (style) {
      return extraMarkup(style, 'fold', {
        open: 'open',
        text: SAMPLE.fold.text,
        note: SAMPLE.fold.note,
        body: noteMarkup(style, SAMPLE.fold.note),
      });
    },
  };

  var CELL_TITLES = {
    panel: '面板／组合骨架',
    tile: '选择格',
    input: '输入框',
    button: '按钮',
    switch: '开关',
    choice: '选项组',
    status: '状态点',
    notice: '提示条',
    fold: '折叠块',
  };

  function renderControls(style) {
    gridControls.textContent = '';
    /* choiceOption 是 choice 那一横条里的格子，单独摆没有意义；note 只是面板里那句说明。 */
    var roles = style.recipe.scope.filter(function (role) {
      return role !== 'note' && role !== 'choiceOption';
    });
    roles.forEach(function (role) {
      var built = frame(style);
      built.title.textContent = (CELL_TITLES[role] || role) + '（' + role + '）';
      built.meta.textContent = sourceMeta(sourceForRole(style, role));
      gridControls.append(built.item);
      mount(built.host, style, CELL_BUILDERS[role](style), true);
    });
  }

  function renderRaw(style) {
    gridRaw.textContent = '';
    style.controls.forEach(function (source) {
      var built = frame(style);
      built.title.textContent = source.slug + ' · ' + source.category;
      built.meta.textContent =
        source.author +
        ' · 角色 ' +
        source.roles.join('/') +
        ' · ' +
        source.bytes +
        ' 字节 · sha256 ' +
        source.sha256.slice(0, 12) +
        '… · ' +
        source.permalink;
      var details = document.createElement('details');
      var summary = document.createElement('summary');
      summary.textContent = '逐字原件（未改动的那一份）';
      var pre = document.createElement('pre');
      pre.textContent = source.raw;
      details.append(summary, pre);
      gridRaw.append(built.item, details);
      mount(built.host, style, source.raw, false);
    });
  }

  /* ---------- 本地状态：只有点选、按压与输入；不落盘、不外发 ---------- */
  function bindLocalState(root) {
    root.addEventListener('submit', function (event) {
      event.preventDefault();
    });
    root.addEventListener('click', function (event) {
      var link = event.target.closest && event.target.closest('a');
      if (link) event.preventDefault();
      var tile = event.target.closest && event.target.closest('[data-selected]');
      if (!tile) return;
      var group = tile.closest('.demo-row, .demo-stack, form') || root;
      Array.prototype.forEach.call(group.querySelectorAll('[data-selected]'), function (one) {
        one.setAttribute('data-selected', one === tile ? 'true' : 'false');
      });
    });
    root.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      var tile = event.target.closest && event.target.closest('[role="button"][data-selected]');
      if (!tile) return;
      event.preventDefault();
      tile.click();
    });
  }

  /* ---------- 页脚署名：一行看得见作者与原件，技术明细默认折起 ---------- */
  function renderFooter(style) {
    var links = style.controls
      .map(function (source) {
        return '<a href="' + source.permalink + '">' + source.repositoryFile + '</a>';
      })
      .join(' ');
    var detail = [];
    detail.push('<li>' + style.cssNote + '</li>');
    if (style.recipe.extensionNote)
      detail.push('<li>本地延伸：' + style.recipe.extensionNote + '</li>');
    (style.extensionItems || []).forEach(function (item) {
      detail.push('<li>' + item.name + ' ← ' + item.file + '</li>');
    });
    style.controls.forEach(function (source) {
      detail.push(
        '<li>' +
          source.slug +
          '：角色 ' +
          source.roles.join('/') +
          '，选择器 ' +
          Object.keys(source.selectors)
            .map(function (key) {
              return key + '→' + source.selectors[key];
            })
            .join('、') +
          '，' +
          source.bytes +
          ' 字节，sha256 ' +
          source.sha256.slice(0, 12) +
          '…</li>',
      );
    });
    detail.push(
      '<li>字形：' +
        DATA.icons.family +
        ' ' +
        DATA.icons.count +
        ' 枚（<a href="' +
        DATA.icons.website +
        '">' +
        DATA.icons.website +
        '</a>）</li>',
    );
    detail.push('<li>取源：' + DATA.meta.websiteAccess + '</li>');
    detail.push('<li>允许的改动：' + DATA.meta.allowedAdaptations.join('；') + '</li>');
    detail.push('<li>生成：' + DATA.meta.builder + ' · ' + DATA.meta.generatedAt + '</li>');
    attribution.innerHTML =
      '<h2>' +
      style.label +
      '（' +
      style.id +
      '）— ' +
      style.summary +
      '</h2>' +
      '<p><a href="' +
      style.author.url +
      '">' +
      style.author.name +
      '</a> · ' +
      style.licence.spdx +
      '（' +
      style.licence.file +
      '）· ' +
      (style.current ? '当前方案对照' : '新增一组') +
      ' · 原件 ' +
      links +
      '</p>' +
      '<details><summary>来源与适配明细</summary><ul>' +
      detail.join('') +
      '</ul></details>';
  }

  /* ---------- 切换 ---------- */
  function press(group, attr, value) {
    Array.prototype.forEach.call(group.querySelectorAll('[' + attr + ']'), function (button) {
      button.setAttribute('aria-pressed', button.getAttribute(attr) === value ? 'true' : 'false');
    });
  }

  function showView(view) {
    body.setAttribute('data-view', view);
    press(viewSwitcher, 'data-view', view);
    Array.prototype.forEach.call(stage.querySelectorAll('[data-panel]'), function (section) {
      section.hidden = section.getAttribute('data-panel') !== view;
    });
  }

  function showWidth(width) {
    body.setAttribute('data-width', width);
    press(widthToggle, 'data-width', width);
  }

  function show(styleId) {
    var style = DATA.styles.filter(function (one) {
      return one.id === styleId;
    })[0];
    if (!style) return;
    body.setAttribute('data-style', styleId);
    press(picker, 'data-style', styleId);
    empty.hidden = true;
    buildHint.hidden = true;
    renderWindow(style);
    renderControls(style);
    renderRaw(style);
    renderFooter(style);
    showView(body.getAttribute('data-view') || 'window');
  }

  function build() {
    if (!DATA || !DATA.styles || !DATA.styles.length) {
      empty.hidden = false;
      return;
    }
    picker.innerHTML = DATA.styles
      .map(function (style) {
        return (
          '<button type="button" data-style="' +
          style.id +
          '">' +
          style.label +
          '<em>' +
          (style.current ? '当前' : '新增') +
          '</em></button>'
        );
      })
      .join(' ');
    picker.addEventListener('click', function (event) {
      var button = event.target.closest('button[data-style]');
      if (button) show(button.getAttribute('data-style'));
    });
    viewSwitcher.addEventListener('click', function (event) {
      var button = event.target.closest('button[data-view]');
      if (button) showView(button.getAttribute('data-view'));
    });
    widthToggle.addEventListener('click', function (event) {
      var button = event.target.closest('button[data-width]');
      if (button) showWidth(button.getAttribute('data-width'));
    });
    showWidth(body.getAttribute('data-width') || 'wide');
    /* 默认落在新增那一族：本轮要看的就是新几套；当前方案仍可选作对照。 */
    show(DATA.styles[1] ? DATA.styles[1].id : DATA.styles[0].id);
  }

  document.addEventListener('click', function (event) {
    var href = event.target.getAttribute && event.target.getAttribute('href');
    if (href && href.charAt(0) === '#') event.preventDefault();
  });

  build();
})();
