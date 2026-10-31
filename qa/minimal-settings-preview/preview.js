/*
 * 预览的本地状态：一份草稿 + 一次渲染。
 * 控件一律用原生 input/select，值只写在这份 state 里，不碰本机存储、不发请求。
 */
/* global document */
(function () {
  'use strict';

  var FIGURE_LABEL = { minimal: '简约', round: '圆头' };
  var PALETTE_LABEL = { morning: '晨蓝', lavender: '雪青', pine: '松墨', orange: '柿橙' };
  var SIZE_LABEL = { small: '小巧', normal: '适中', large: '放大' };
  var SIZE_PX = { small: 92, normal: 120, large: 152 };
  var PET_ART = { minimal: 'assets/pet-minimal.svg', round: 'assets/pet-round.svg' };
  /* 模型名占位只是这一屏的示例文字，来源是各家公开列表里常见的写法。 */
  var MODEL_HINT = {
    deepseek: 'deepseek-chat',
    qwen: 'qwen-plus',
    kimi: 'moonshot-v1-8k',
    glm: 'glm-4-plus',
    openai: 'gpt-4o-mini',
    anthropic: 'claude-sonnet-4-5',
    gemini: 'gemini-2.5-flash',
  };

  var state = {
    petName: '小蓝',
    provider: 'deepseek',
    model: '',
    key: '',
    reasoningEffort: 'default',
    figure: 'minimal',
    palette: 'morning',
    size: 'normal',
    visible: true,
    alwaysOnTop: true,
    draggable: true,
    reducedMotion: false,
    paused: false,
    voiceEnabled: true,
    engine: 'local',
    afterSpeech: 'manual',
    page: 'start',
  };

  document.querySelectorAll('[data-pref]').forEach(function (el) {
    var pref = el.dataset.pref;
    if (Object.prototype.hasOwnProperty.call(state, pref)) return;
    if (el.type === 'radio' && !el.checked) return;
    state[pref] =
      el.type === 'checkbox'
        ? el.checked
        : el.type === 'range' || el.type === 'number'
          ? Number(el.value)
          : el.value;
  });

  var navs = document.querySelectorAll('[data-nav]');
  var pages = document.querySelectorAll('.page');

  function controls(pref) {
    return document.querySelectorAll('[data-pref="' + pref + '"]');
  }

  /* 每次改动都从 state 回写到所有同名控件：同一项设置出现两次也只有一份值。 */
  function syncControls() {
    document.querySelectorAll('[data-pref]').forEach(function (el) {
      var value = state[el.dataset.pref];
      if (el.type === 'checkbox') el.checked = Boolean(value);
      else if (el.type === 'radio') el.checked = el.value === value;
      else if (el.value !== value) el.value = value;
    });
  }

  var themeFields = {
    themePaper: '--ground',
    themePaper2: '--surface-quiet',
    themeSheet: '--surface',
    themeInk: '--ink',
    themeLine: '--line',
    themeAccent: '--blue',
  };
  var customTheme = false;
  var presetThemes = {
    'jade-dawn': {
      themePaper: '#eff1ee',
      themePaper2: '#e7eae6',
      themeSheet: '#ffffff',
      themeInk: '#24372a',
      themeLine: '#d0d9d1',
      themeAccent: '#34836b',
    },
    'clay-ember': {
      themePaper: '#f4efea',
      themePaper2: '#eee5dc',
      themeSheet: '#ffffff',
      themeInk: '#49362c',
      themeLine: '#dfd2c8',
      themeAccent: '#ae7255',
    },
  };

  function render() {
    document.body.style.colorScheme =
      state.themeMode === 'system' ? 'light dark' : state.themeMode || 'light';
    document.body.dataset.theme = state.themeMode || 'light';
    document.getElementById('interface-theme-state').textContent = {
      light: '浅色',
      dark: '深色',
      system: '跟随系统',
    }[state.themeMode || 'system'];
    Object.keys(themeFields).forEach(function (key) {
      if (customTheme) document.body.style.setProperty(themeFields[key], state[key]);
      else document.body.style.removeProperty(themeFields[key]);
    });
    var px = SIZE_PX[state.size];
    document.querySelectorAll('[data-stage]').forEach(function (stage) {
      stage.dataset.palette = state.palette;
      stage.dataset.hidden = state.visible ? 'false' : 'true';
      stage.querySelectorAll('[data-pet-art]').forEach(function (art) {
        art.src = PET_ART[state.figure];
        art.width = px;
        art.height = px;
      });
    });

    setText('figure', FIGURE_LABEL[state.figure]);
    setText('palette', PALETTE_LABEL[state.palette]);
    setText('size', SIZE_LABEL[state.size]);
    setText('voiceEnabledText', state.voiceEnabled ? '开着' : '关着');
    setText('visibleText', state.visible ? '桌面显示中' : '桌面已隐藏');
    setText(
      'railSummary',
      state.petName +
        ' · ' +
        FIGURE_LABEL[state.figure] +
        ' · ' +
        PALETTE_LABEL[state.palette] +
        ' · ' +
        SIZE_LABEL[state.size],
    );

    document.querySelectorAll('[data-count-for]').forEach(function (el) {
      var length = String(state[el.dataset.countFor] || '').length;
      el.textContent = length + (el.dataset.countMax ? ' / ' + el.dataset.countMax : '');
    });

    var model = controls('model')[0];
    model.placeholder = '例如 ' + MODEL_HINT[state.provider];

    document.body.dataset.motion = state.reducedMotion ? 'off' : 'on';
    showPage(state.page);
  }

  function setText(key, value) {
    var selector = key === 'railSummary' ? '#rail-summary' : '[data-show="' + key + '"]';
    document.querySelectorAll(selector).forEach(function (el) {
      el.textContent = value;
    });
  }

  function showPage(id) {
    pages.forEach(function (page) {
      var name = page.dataset.page;
      page.hidden = name !== id;
    });
    navs.forEach(function (nav) {
      if (nav.dataset.nav === id) nav.setAttribute('aria-current', 'page');
      else nav.removeAttribute('aria-current');
    });
  }

  navs.forEach(function (nav) {
    nav.setAttribute('aria-label', nav.textContent.trim());
    nav.title = nav.textContent.trim();
    nav.addEventListener('click', function () {
      state.page = nav.dataset.nav;
      render();
      document.getElementById('settings-content').scrollTop = 0;
    });
  });

  document.querySelectorAll('[data-goto]').forEach(function (button) {
    button.addEventListener('click', function () {
      state.page = button.dataset.goto;
      render();
      document.getElementById('settings-content').scrollTop = 0;
    });
  });

  document.addEventListener('change', function (event) {
    var el = event.target;
    if (!el.dataset || !el.dataset.pref) return;
    var pref = el.dataset.pref;
    if (pref === 'themeScheme' && el.checked) {
      var palette = presetThemes[el.value];
      customTheme = !!palette;
      if (palette) Object.assign(state, palette);
    }
    if (el.type === 'color') customTheme = true;
    state[pref] =
      el.type === 'checkbox'
        ? el.checked
        : el.type === 'range' || el.type === 'number'
          ? Number(el.value)
          : el.value;
    syncControls();
    render();
  });

  document.addEventListener('input', function (event) {
    var el = event.target;
    if (!el.dataset || !el.dataset.pref) return;
    if (
      ['text', 'password', 'search', 'number', 'range', 'textarea', 'color'].indexOf(el.type) !== -1
    ) {
      if (el.type === 'color') customTheme = true;
      state[el.dataset.pref] =
        el.type === 'range' || el.type === 'number' ? Number(el.value) : el.value;
      render();
    }
  });

  /* Key 的显示/隐藏只改这一屏的 input type，不写日志、不留副本。 */
  var keyInput = document.getElementById('api-key-input');
  var keyToggle = document.getElementById('api-key-toggle');
  keyToggle.addEventListener('click', function () {
    var shown = keyInput.type === 'text';
    keyInput.type = shown ? 'password' : 'text';
    keyToggle.setAttribute('aria-pressed', shown ? 'false' : 'true');
    keyToggle.setAttribute('aria-label', shown ? '显示 Key' : '隐藏 Key');
    keyInput.focus();
  });

  document.addEventListener('submit', function (event) {
    if (event.target.method !== 'dialog') event.preventDefault();
  });

  document.addEventListener('click', function (event) {
    var target = event.target.closest(
      '[data-open-dialog], [data-close-dialog], [data-preview-action], [data-confirm]',
    );
    if (!target) return;
    if (target.dataset.previewAction === 'theme-reset') {
      Object.keys(themeFields).forEach(function (key) {
        state[key] = controls(key)[0].defaultValue;
      });
      customTheme = false;
      render();
    }
    if (target.dataset.confirm) {
      document.getElementById('preview-confirm-title').textContent = target.textContent.trim();
      var card = target.closest('.card');
      document.getElementById('preview-confirm-item').textContent =
        target.dataset.confirmItem || card.querySelector('.card__title').textContent;
      document.getElementById('preview-confirm-dialog').showModal();
    } else if (target.dataset.openDialog)
      document.getElementById(target.dataset.openDialog).showModal();
    else if (target.hasAttribute('data-close-dialog')) target.closest('dialog').close();
    else {
      var badge = document.getElementById('preview-badge');
      badge.textContent = '预览模式';
      badge.setAttribute('role', 'status');
    }
  });

  document.querySelectorAll('[data-preview-visibility]').forEach(function (button) {
    button.addEventListener('click', function () {
      state.visible = button.dataset.previewVisibility === 'true';
      syncControls();
      render();
    });
  });
  document.querySelectorAll('button[data-preview-pose]').forEach(function (button) {
    button.addEventListener('click', function () {
      document.getElementById('pet-stage').dataset.previewPose = button.dataset.previewPose;
      document.querySelectorAll('button[data-preview-pose]').forEach(function (item) {
        item.setAttribute('aria-pressed', String(item === button));
      });
    });
  });
  document.getElementById('preview-scene-theme').addEventListener('click', function () {
    var stage = document.getElementById('pet-stage');
    var dark = stage.dataset.sceneDark !== 'true';
    stage.dataset.sceneDark = String(dark);
    this.setAttribute('aria-pressed', String(dark));
  });

  ['fetch-models-button', 'test-connection-button'].forEach(function (id) {
    document.getElementById(id).addEventListener('click', function () {
      document.getElementById('model-action-status').textContent = '预览模式';
    });
  });

  syncControls();
  render();
})();
