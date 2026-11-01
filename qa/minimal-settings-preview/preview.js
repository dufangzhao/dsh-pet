/*
 * 预览的本地状态：一份草稿 + 一次渲染。
 * 控件一律用原生 input/select，值只写在这份 state 里，不碰本机存储、不发请求。
 */
/* global document, window */
(function () {
  'use strict';

  var SIZE_LABEL = { small: '小巧', normal: '适中', large: '放大' };
  var SIZE_PX = { small: 92, normal: 120, large: 152 };
  var BUILTIN_PALETTES = [
    { id: 'morning', name: '晨蓝', tone: 'morning' },
    { id: 'lavender', name: '雪青', tone: 'lavender' },
    { id: 'pine', name: '松墨', tone: 'pine' },
    { id: 'orange', name: '柿橙', tone: 'orange' },
  ];
  var BUILTIN_OUTFITS = {
    minimal: {
      name: '简约',
      image: 'assets/pet-minimal.svg',
      palettes: BUILTIN_PALETTES,
      clothing: [],
    },
    round: {
      name: '圆头',
      image: 'assets/pet-round.svg',
      palettes: BUILTIN_PALETTES,
      clothing: [],
    },
  };
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

  var PERSONA_TEMPLATES = {
    default: {
      name: '默认伙伴',
      prompt:
        '# 身份\n你叫{{petName}}，是陪伴{{userName}}的桌面伙伴。\n\n# 相处方式\n用简短、自然的表达交流，先回应用户正在关心的事。用户专注工作时保持克制，不连续打断。\n\n# 个性与表达\n温和、好奇，有自己的偏好。触摸互动可以用动作或表情回应，不必每次说话。\n\n# 做事原则\n按实际可用的能力与用户授权行动。没有把握时说明不确定，操作结果以真实反馈为准。',
    },
    warm: {
      name: '温柔陪伴',
      prompt:
        '# 身份\n你是{{petName}}，陪伴{{userName}}处理日常工作与心事。\n\n# 相处方式\n耐心倾听，回应具体感受。用户需要帮助时先给一个容易开始的小步骤，不替用户下结论。\n\n# 个性与表达\n温柔、细腻，语言平实，不堆砌安慰和夸奖。尊重独处，不催促对方继续聊天。\n\n# 做事原则\n只依据已知信息交流，遵守用户设置的边界。需要操作或访问资料时先确认可用权限。',
    },
    lively: {
      name: '活力伙伴',
      prompt:
        '# 身份\n你叫{{petName}}，是{{userName}}身边轻快的桌面伙伴。\n\n# 相处方式\n交流主动但不过度，优先用一两句清楚的话回应。用户忙碌时等待，不连续发出提醒。\n\n# 个性与表达\n开朗、敏捷，偶尔开小玩笑。互动用短动作和轻松的语气表达，不喧宾夺主。\n\n# 做事原则\n先理解目标再行动，反馈具体结果，不编造进度、权限或完成状态。',
    },
    rational: {
      name: '理性助手',
      prompt:
        '# 身份\n你是{{petName}}，协助{{userName}}梳理思路、安排任务和处理信息。\n\n# 相处方式\n先给结论，再补关键依据。复杂问题拆成少量步骤，只在缺少必要信息时提问。\n\n# 个性与表达\n冷静、坦诚，表达简洁。区分事实、推测和建议，不用夸张语气替代证据。\n\n# 做事原则\n尊重授权与隐私，涉及不可撤回的操作时先确认。说明真实限制并保留用户选择。',
    },
  };

  var state = {
    personaPane: 'habits',
    personaTemplate: 'default',
    personaTemplates: {},
    outfitPacks: Object.assign({}, BUILTIN_OUTFITS),
    clothing: '',
    importSerial: 0,
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

  Object.keys(PERSONA_TEMPLATES).forEach(function (id) {
    state.personaTemplates[id] = Object.assign({}, PERSONA_TEMPLATES[id]);
  });

  function prefValue(pref) {
    if (pref === 'personaPrompt') return state.personaTemplates[state.personaTemplate].prompt;
    if (pref === 'personaTemplateName') return state.personaTemplates[state.personaTemplate].name;
    return state[pref];
  }

  function setPref(pref, value) {
    if (pref === 'personaPrompt') state.personaTemplates[state.personaTemplate].prompt = value;
    else if (pref === 'personaTemplateName')
      state.personaTemplates[state.personaTemplate].name = value;
    else if (pref === 'figure') {
      state.figure = value;
      var outfit = state.outfitPacks[value];
      state.palette = outfit.palettes.length ? outfit.palettes[0].id : '';
      state.clothing = outfit.clothing.length ? outfit.clothing[0].id : '';
      renderOutfitRows();
    } else state[pref] = value;
  }

  document.querySelectorAll('[data-pref]').forEach(function (el) {
    var pref = el.dataset.pref;
    if (pref === 'personaPrompt' || pref === 'personaTemplateName') return;
    if (Object.prototype.hasOwnProperty.call(state, pref)) return;
    if (el.type === 'radio' && !el.checked) return;
    setPref(
      pref,
      el.type === 'checkbox'
        ? el.checked
        : el.type === 'range' || el.type === 'number'
          ? Number(el.value)
          : el.value,
    );
  });

  var navs = document.querySelectorAll('[data-nav]');
  var pages = document.querySelectorAll('.page');

  function controls(pref) {
    return document.querySelectorAll('[data-pref="' + pref + '"]');
  }

  /* 每次改动都从 state 回写到所有同名控件：同一项设置出现两次也只有一份值。 */
  function syncControls() {
    document.querySelectorAll('[data-pref]').forEach(function (el) {
      var value = prefValue(el.dataset.pref);
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

  state.hover = Array.from(
    document.querySelectorAll('[data-pref-group="hover"] input:checked'),
    function (el) {
      return el.value;
    },
  );
  state.personaTemplateSerial = 0;
  state.audioPlaying = false;

  function setDisabled(group, disabled) {
    group.querySelectorAll('input, select, button').forEach(function (el) {
      el.disabled = disabled;
    });
  }

  function renderPersona() {
    document.querySelectorAll('[data-persona-tab]').forEach(function (button) {
      var selected = button.dataset.personaTab === state.personaPane;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    document.querySelectorAll('[data-persona-panel]').forEach(function (panel) {
      panel.hidden = panel.dataset.personaPanel !== state.personaPane;
    });
    document.querySelectorAll('[data-persona-custom]').forEach(function (group) {
      group.hidden = state[group.dataset.personaCustom] !== 'custom';
    });
    document.querySelectorAll('[data-value-for]').forEach(function (output) {
      output.textContent = prefValue(output.dataset.valueFor) + (output.dataset.unit || '');
    });
    document.querySelectorAll('[data-pref-group="hover"] input').forEach(function (input) {
      input.checked = state.hover.indexOf(input.value) !== -1;
      input.disabled = state.hover.length >= 6 && !input.checked;
    });
    var soundOptions = document.getElementById('persona-sound-options');
    soundOptions.hidden = !state.soundEnabled;
    setDisabled(soundOptions, !state.soundEnabled);
    var snoreOptions = document.getElementById('persona-snore-options');
    snoreOptions.hidden = !state.soundEnabled || !state.soundSnore;
    setDisabled(snoreOptions, snoreOptions.hidden);
    var speakingOptions = document.getElementById('persona-speaking-options');
    speakingOptions.hidden = !state.soundEnabled || !state.soundTalk;
    setDisabled(speakingOptions, speakingOptions.hidden);
    var trial = document.querySelector('[data-persona-action="preview-sound"]');
    trial.disabled =
      !state.soundEnabled ||
      !state.soundTalk ||
      state.speakingSound === 'silent' ||
      state.audioPlaying;
    var select = document.getElementById('persona-template-select');
    Object.keys(state.personaTemplates).forEach(function (id) {
      var option = Array.from(select.options).find(function (item) {
        return item.value === id;
      });
      if (!option) {
        option = document.createElement('option');
        option.value = id;
        select.append(option);
      }
      option.textContent = state.personaTemplates[id].name;
    });
    select.value = state.personaTemplate;
  }

  function createPersonaTemplate(copy) {
    state.personaTemplateSerial += 1;
    var id = 'custom-' + state.personaTemplateSerial;
    var current = state.personaTemplates[state.personaTemplate];
    state.personaTemplates[id] = {
      name: copy ? current.name + ' 副本' : '新建模板',
      prompt: copy ? current.prompt : '',
    };
    state.personaTemplate = id;
    renderPersona();
    syncControls();
    render();
    document.getElementById('persona-template-name').focus();
  }

  async function previewSpeakingSound() {
    state.audioPlaying = true;
    renderPersona();
    try {
      var context = new window.AudioContext();
      await context.resume();
      var base = state.speechPitch * (state.speakingSound === 'soft' ? 0.9 : 1);
      var step = 1 / state.speechSpeed;
      var start = context.currentTime + 0.02;
      [1, 1.16, 0.94, 1.08, 0.9].forEach(function (ratio, index) {
        var oscillator = context.createOscillator();
        var gain = context.createGain();
        var at = start + index * step;
        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(base * ratio, at);
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(0.035, at + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + step * 0.8);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(at);
        oscillator.stop(at + step * 0.85);
        if (index === 4)
          oscillator.onended = function () {
            void context.close();
            state.audioPlaying = false;
            renderPersona();
          };
      });
    } catch {
      state.audioPlaying = false;
      document.getElementById('persona-draft-state').textContent = '当前浏览器无法试听';
      renderPersona();
    }
  }

  function render() {
    renderPersona();
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
    var outfit = state.outfitPacks[state.figure];
    var palette = outfit.palettes.find(function (item) {
      return item.id === state.palette;
    });
    var garment = outfit.clothing.find(function (item) {
      return item.id === state.clothing;
    });
    var artSource = palette && palette.image ? palette.image : outfit.image;
    var figureLabel = outfit.name;
    var paletteLabel = palette ? palette.name : '';
    document.querySelectorAll('[data-stage]').forEach(function (stage) {
      stage.dataset.palette = palette && palette.tone ? palette.tone : 'morning';
      stage.dataset.hidden = state.visible ? 'false' : 'true';
      stage.querySelectorAll('[data-pet-art]').forEach(function (art) {
        art.src = artSource;
        art.dataset.artPalette = palette && palette.tone ? palette.tone : 'morning';
        art.width = px;
        art.height = px;
      });
    });
    document.getElementById('appearance-stage').style.setProperty('--pet-preview-size', px + 'px');
    var avatar = document.querySelector('.appearance-avatar');
    var clothing = avatar.querySelector('.appearance-clothing');
    if (garment) {
      if (!clothing) {
        clothing = document.createElement('img');
        clothing.className = 'appearance-clothing';
        clothing.alt = '服装预览';
        avatar.append(clothing);
      }
      clothing.src = garment.image;
    } else if (clothing) clothing.remove();
    document.getElementById('clear-clothing').hidden = !garment;
    setText('figure', figureLabel);
    setText('palette', paletteLabel);
    setText('size', SIZE_LABEL[state.size]);
    setText('voiceEnabledText', state.voiceEnabled ? '开着' : '关着');
    setText('visibleText', state.visible ? '桌面显示中' : '桌面已隐藏');
    setText(
      'railSummary',
      state.petName + ' · ' + figureLabel + ' · ' + paletteLabel + ' · ' + SIZE_LABEL[state.size],
    );

    document.querySelectorAll('[data-count-for]').forEach(function (el) {
      var length = String(prefValue(el.dataset.countFor) || '').length;
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
    var hover = el.closest('[data-pref-group=hover]');
    if (hover) {
      state.hover = Array.from(hover.querySelectorAll('input:checked'), function (input) {
        return input.value;
      });
      renderPersona();
      return;
    }
    if (!el.dataset || !el.dataset.pref) return;
    var pref = el.dataset.pref;
    if (pref === 'themeScheme' && el.checked) {
      var palette = presetThemes[el.value];
      customTheme = !!palette;
      if (palette) Object.assign(state, palette);
    }
    if (el.type === 'color') customTheme = true;
    setPref(
      pref,
      el.type === 'checkbox'
        ? el.checked
        : el.type === 'range' || el.type === 'number'
          ? Number(el.value)
          : el.value,
    );
    if (pref === 'speechPitchLevel' && el.value !== 'custom')
      state.speechPitch = { low: 300, mid: 400, high: 500 }[el.value];
    if (pref === 'speechSpeedLevel' && el.value !== 'custom')
      state.speechSpeed = { low: 10, mid: 13, high: 16 }[el.value];
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
      if (el.dataset.pref === 'speechPitch') state.speechPitchLevel = 'custom';
      if (el.dataset.pref === 'speechSpeed') state.speechSpeedLevel = 'custom';
      setPref(
        el.dataset.pref,
        el.type === 'range' || el.type === 'number' ? Number(el.value) : el.value,
      );
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

  document.querySelectorAll('[data-persona-tab]').forEach(function (button) {
    button.addEventListener('click', function () {
      state.personaPane = button.dataset.personaTab;
      render();
    });
    button.addEventListener('keydown', function (event) {
      var tabs = Array.from(document.querySelectorAll('[data-persona-tab]'));
      var index = tabs.indexOf(button);
      if (event.key === 'ArrowRight') index = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') index = (index + tabs.length - 1) % tabs.length;
      else if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = tabs.length - 1;
      else return;
      event.preventDefault();
      state.personaPane = tabs[index].dataset.personaTab;
      render();
      tabs[index].focus();
    });
  });
  document.querySelectorAll('[data-persona-action]').forEach(function (button) {
    button.addEventListener('click', function () {
      var action = button.dataset.personaAction;
      if (action === 'new' || action === 'copy') {
        createPersonaTemplate(action === 'copy');
        return;
      }
      if (action === 'reset') {
        var original = PERSONA_TEMPLATES[state.personaTemplate];
        state.personaTemplates[state.personaTemplate].prompt = original ? original.prompt : '';
        syncControls();
        render();
      } else if (action === 'preview-sound') {
        void previewSpeakingSound();
        return;
      }
      document.getElementById('persona-draft-state').textContent =
        action === 'save' ? '本次预览草稿已保留' : '本地草稿';
    });
  });

  function assetTile(kind, id, name, image, tone) {
    var label = document.createElement('label');
    label.className = 'asset-tile';
    label.dataset.thumbPalette = tone || 'morning';
    var input = document.createElement('input');
    input.type = 'radio';
    input.name = kind;
    input.dataset.pref = kind;
    input.value = id;
    var art = document.createElement('img');
    art.src = image;
    art.alt = '';
    art.width = 64;
    art.height = 64;
    art.dataset.thumbArt = '';
    var title = document.createElement('span');
    title.textContent = name;
    label.append(input, art, title);
    return label;
  }
  function renderOutfitRows() {
    var outfit = state.outfitPacks[state.figure];
    ['palette', 'clothing'].forEach(function (kind) {
      var list = document.getElementById('appearance-' + kind + '-list');
      var clear = kind === 'clothing' ? document.getElementById('clear-clothing') : null;
      var options = kind === 'palette' ? outfit.palettes : outfit.clothing;
      list.replaceChildren();
      options.forEach(function (item) {
        list.append(assetTile(kind, item.id, item.name, item.image || outfit.image, item.tone));
      });
      if (!options.length)
        for (var i = 0; i < 2; i++) {
          var slot = document.createElement('span');
          slot.className = 'asset-empty';
          slot.dataset.emptySlot = '';
          slot.setAttribute('aria-hidden', 'true');
          list.append(slot);
        }
      if (clear) list.append(clear);
    });
  }
  async function previewImage(source) {
    if (
      typeof source !== 'string' ||
      !/^data:image\/(png|jpeg|webp|gif|svg\+xml)(;base64)?,/.test(source)
    )
      throw new Error('装扮包图片需内嵌在同一份文件中');
    return new Promise(function (resolve, reject) {
      var image = new window.Image();
      image.onload = resolve;
      image.onerror = function () {
        reject(new Error('装扮包中有无法读取的图片'));
      };
      image.src = source;
    });
  }
  async function readOutfit(file) {
    var pack;
    try {
      pack = JSON.parse(await file.text());
    } catch {
      throw new Error('无法读取这个装扮包');
    }
    if (
      !pack ||
      pack.format !== 'desktop-pet-outfit-preview' ||
      pack.version !== 1 ||
      typeof pack.name !== 'string' ||
      !pack.name.trim() ||
      !Array.isArray(pack.palettes) ||
      !Array.isArray(pack.clothing)
    )
      throw new Error('装扮包信息不完整');
    var pictures = [pack.image];
    [pack.palettes, pack.clothing].forEach(function (items) {
      var ids = new Set();
      items.forEach(function (item) {
        if (
          !item ||
          typeof item.id !== 'string' ||
          !item.id ||
          ids.has(item.id) ||
          typeof item.name !== 'string' ||
          !item.name.trim()
        )
          throw new Error('装扮包选项不完整或重复');
        ids.add(item.id);
        pictures.push(item.image);
      });
    });
    await Promise.all(pictures.map(previewImage));
    return {
      name: pack.name.trim(),
      image: pack.image,
      palettes: pack.palettes.map(function (item) {
        return { id: item.id, name: item.name, image: item.image };
      }),
      clothing: pack.clothing.map(function (item) {
        return { id: item.id, name: item.name, image: item.image };
      }),
    };
  }
  var fileInput = document.getElementById('appearance-file-input');
  var importStatus = document.getElementById('appearance-import-status');
  document.getElementById('import-outfit-button').addEventListener('click', function () {
    fileInput.click();
  });
  fileInput.addEventListener('change', async function () {
    var file = fileInput.files[0];
    if (!file) return;
    fileInput.value = '';
    var outfit;
    try {
      outfit = await readOutfit(file);
    } catch (error) {
      importStatus.textContent = error.message;
      importStatus.setAttribute('role', 'alert');
      return;
    }
    state.importSerial += 1;
    var id = 'outfit-' + state.importSerial;
    state.outfitPacks[id] = outfit;
    document
      .getElementById('appearance-figure-list')
      .append(assetTile('figure', id, outfit.name, outfit.image));
    setPref('figure', id);
    syncControls();
    render();
    importStatus.textContent = '本次预览已导入装扮包：' + outfit.name;
    importStatus.setAttribute('role', 'status');
  });
  document.getElementById('clear-clothing').addEventListener('click', function () {
    state.clothing = '';
    syncControls();
    render();
  });
  document.querySelector('[data-appearance-scene]').addEventListener('click', function () {
    var stage = document.getElementById('appearance-stage');
    var dark = stage.dataset.sceneDark !== 'true';
    stage.dataset.sceneDark = String(dark);
    this.setAttribute('aria-pressed', String(dark));
  });
  document.querySelectorAll('[data-appearance-pose]').forEach(function (button) {
    button.addEventListener('click', function () {
      document.getElementById('appearance-stage').dataset.previewPose =
        button.dataset.appearancePose;
      document.querySelectorAll('[data-appearance-pose]').forEach(function (item) {
        item.setAttribute('aria-pressed', String(item === button));
      });
    });
  });

  renderOutfitRows();
  syncControls();
  render();
})();
