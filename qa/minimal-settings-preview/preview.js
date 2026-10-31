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
  var PENDING = {
    persona: '人设',
    conversation: '对话',
    plugins: '扩展',
    permissions: '权限与数据',
    about: '关于',
  };

  var state = {
    petName: '小蓝',
    provider: 'deepseek',
    model: '',
    key: '',
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
    maxSeconds: 30,
    page: 'start',
  };

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

  function render() {
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
    setText('maxSeconds', state.maxSeconds + ' 秒');
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
    var pending = PENDING[id] !== undefined;
    pages.forEach(function (page) {
      var name = page.dataset.page;
      var on = pending ? name === 'pending' : name === id;
      page.hidden = !on;
      if (on && pending) setText('pageTitle', PENDING[id]);
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
    state[pref] =
      el.type === 'checkbox' ? el.checked : el.type === 'range' ? Number(el.value) : el.value;
    syncControls();
    render();
  });

  document.addEventListener('input', function (event) {
    var el = event.target;
    if (!el.dataset || !el.dataset.pref) return;
    if (el.type === 'text' || el.type === 'password' || el.type === 'range') {
      state[el.dataset.pref] = el.type === 'range' ? Number(el.value) : el.value;
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

  syncControls();
  render();
})();
