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

  var VOICE_ENGINES = {
    funasr: {
      kind: 'local',
      model: 'SenseVoiceSmall INT8',
      languages: '中文、英语、日语、韩语、粤语',
      size: '228 MB',
    },
    whisper: {
      kind: 'local',
      model: 'Whisper small INT8',
      languages: '约100种语言',
      size: '358 MB',
    },
    system: { kind: 'system' },
    api: { kind: 'api' },
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
    builtinSpeechEnabled: true,
    voicePluginEnabled: true,
    voiceEnabled: true,
    voiceEngine: 'funasr',
    voiceDownloads: {
      funasr: { phase: 'absent', progress: 0 },
      whisper: { phase: 'absent', progress: 0 },
    },
    voiceApiUrl: '',
    voiceApiModel: '',
    voiceApiKey: '',
    voiceMicrophone: 'default',
    voiceHotkey: 'AltLeft',
    voiceServiceRunning: false,
    voiceRecording: false,
    voicePressedAt: null,
    voiceRecordStartedAt: 0,
    voiceRecordMessage: '未录音',
    page: 'start',
    conversationDraft: '',
    conversationPending: false,
    conversationEarlier: false,
    conversationSerial: 3,
    conversationRecords: [
      {
        id: 'int-1',
        kind: 'user',
        text: '今天也一起待着吧',
        via: 'console',
        at: Date.now() - 120000,
      },
      {
        id: 'int-2',
        kind: 'pet',
        text: '好呀，我就在这儿。',
        via: 'console',
        at: Date.now() - 60000,
      },
      { id: 'int-3', kind: 'interaction', text: '你轻触了小蓝一下', via: 'bubble', at: Date.now() },
    ],
    pluginSearch: '',
    pluginFilter: 'all',
    modelReplyEnabled: true,
    modelReplyInstalled: true,
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
  var speechPreviewAudio = null;

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
    setDisabled(speakingOptions, speakingOptions.hidden || !state.builtinSpeechEnabled);
    var manager = document.getElementById('manage-speech-plugins');
    manager.disabled = false;
    manager.hidden = state.builtinSpeechEnabled;
    var trial = document.querySelector('[data-persona-action="preview-sound"]');
    controls('speakingSound')[0].disabled = speakingOptions.hidden || !state.builtinSpeechEnabled;
    controls('speakingSound')[0]
      .querySelectorAll('option')
      .forEach(function (option) {
        option.disabled = !state.builtinSpeechEnabled;
      });
    document.getElementById('speech-provider-state').textContent = state.builtinSpeechEnabled
      ? ''
      : '内置说话插件已停用';
    document.getElementById('speech-plugin-state').textContent = state.builtinSpeechEnabled
      ? '已启用'
      : '已停用';
    document.getElementById('speech-plugin-toggle').textContent = state.builtinSpeechEnabled
      ? '停用'
      : '启用';
    document
      .getElementById('speech-plugin-toggle')
      .setAttribute('aria-pressed', String(state.builtinSpeechEnabled));
    trial.disabled =
      !state.builtinSpeechEnabled || !state.soundEnabled || !state.soundTalk || state.audioPlaying;
    var speak = document.getElementById('bubble-speak');
    speak.disabled = !state.builtinSpeechEnabled || !state.soundEnabled || !state.soundTalk;
    speak.textContent = state.audioPlaying ? '停止声音' : '试听说话声';
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

  function stopSpeakingPreview() {
    var active = speechPreviewAudio;
    speechPreviewAudio = null;
    state.audioPlaying = false;
    if (active) void active.close();
    renderPersona();
  }

  async function previewSpeakingSound() {
    state.audioPlaying = true;
    renderPersona();
    try {
      var context = new window.AudioContext();
      speechPreviewAudio = context;
      await context.resume();
      if (speechPreviewAudio !== context) return;
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
            if (speechPreviewAudio !== context) return;
            speechPreviewAudio = null;
            void context.close();
            state.audioPlaying = false;
            renderPersona();
          };
      });
    } catch {
      if (context && speechPreviewAudio !== context) return;
      speechPreviewAudio = null;
      state.audioPlaying = false;
      document.getElementById('persona-draft-state').textContent = '当前浏览器无法试听';
      renderPersona();
    }
  }

  var VOICE_HOLD_MS = 250;
  var voiceTimer = null;
  var voiceDownloadTimers = {};
  var pendingVoiceKey = null;
  function voiceKeyLabel(code) {
    var names = {
      AltLeft: '左 Alt',
      AltRight: '右 Alt',
      ControlLeft: '左 Ctrl',
      ControlRight: '右 Ctrl',
      ShiftLeft: '左 Shift',
      ShiftRight: '右 Shift',
      MetaLeft: '左 Win',
      MetaRight: '右 Win',
      Space: '空格',
    };
    return names[code] || code.replace(/^Key/, '').replace(/^Digit/, '');
  }
  function updateVoiceTime() {
    var seconds = state.voiceRecording
      ? Math.floor((window.performance.now() - state.voiceRecordStartedAt) / 1000)
      : 0;
    document.getElementById('voice-record-time').textContent =
      Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
  }
  function renderVoice() {
    var engine = VOICE_ENGINES[state.voiceEngine];
    document.querySelectorAll('[data-voice-panel]').forEach(function (panel) {
      panel.hidden = panel.dataset.voicePanel !== engine.kind;
    });
    if (engine.kind === 'local') {
      var model = state.voiceDownloads[state.voiceEngine];
      document.getElementById('voice-model-name').textContent = engine.model;
      document.getElementById('voice-model-languages').textContent = engine.languages;
      document.getElementById('voice-model-size').textContent = engine.size;
      document.getElementById('voice-model-state').textContent = {
        absent: '未下载',
        working: '下载预览 ' + model.progress + '%',
        ready: '已下载（预览）',
        error: '下载失败',
      }[model.phase];
      var download = document.getElementById('voice-model-download');
      download.hidden = model.phase === 'ready';
      download.disabled = model.phase === 'working';
      download.textContent = model.phase === 'error' ? '重试' : '下载';
      var progress = document.getElementById('voice-model-progress');
      progress.hidden = model.phase !== 'working';
      progress.value = model.progress;
    }
    var available =
      engine.kind !== 'local' || state.voiceDownloads[state.voiceEngine].phase === 'ready';
    var ready =
      state.voicePluginEnabled && state.voiceEnabled && state.voiceServiceRunning && available;
    document.getElementById('voice-service-state').textContent = state.voiceServiceRunning
      ? engine.kind === 'api'
        ? '接口配置预览'
        : engine.kind === 'system'
          ? '系统识别预览'
          : '运行预览'
      : '已停止';
    document.getElementById('voice-service-start').disabled =
      !state.voicePluginEnabled || !state.voiceEnabled || state.voiceServiceRunning || !available;
    document.getElementById('voice-service-stop').disabled = !state.voiceServiceRunning;
    document.getElementById('voice-record-button').disabled = !ready;
    document.getElementById('voice-record-button').textContent = state.voiceRecording
      ? '结束录音'
      : '开始录音';
    document.getElementById('voice-record-cancel').disabled = !state.voiceRecording;
    document.getElementById('voice-recorder-state').textContent = state.voiceRecordMessage;
    document.getElementById('voice-hotkey-value').textContent = voiceKeyLabel(state.voiceHotkey);
    document.getElementById('voice-key-change').disabled = state.voiceRecording;
    [
      'voice-engine-select',
      'voice-microphone-select',
      'voice-api-url',
      'voice-api-model',
      'voice-api-key',
      'voice-api-key-toggle',
    ].forEach(function (id) {
      document.getElementById(id).disabled = state.voiceRecording;
    });
    document.getElementById('voice-microphone-state').textContent = state.voiceRecording
      ? '收音状态预览'
      : '未收音';
    document.getElementById('page-voice').dataset.recording = String(state.voiceRecording);
    document.getElementById('voice-plugin-state').textContent = state.voicePluginEnabled
      ? '已启用'
      : '已停用';
    document.getElementById('voice-plugin-toggle').textContent = state.voicePluginEnabled
      ? '停用'
      : '启用';
    document
      .getElementById('voice-plugin-toggle')
      .setAttribute('aria-pressed', String(state.voicePluginEnabled));
  }
  function downloadVoiceModel() {
    var id = state.voiceEngine;
    var model = state.voiceDownloads[id];
    model.phase = 'working';
    model.progress = 0;
    renderVoice();
    voiceDownloadTimers[id] = window.setInterval(function () {
      model.progress += 20;
      if (model.progress >= 100) {
        model.phase = 'ready';
        window.clearInterval(voiceDownloadTimers[id]);
        delete voiceDownloadTimers[id];
      }
      renderVoice();
    }, 150);
  }
  function validateVoiceApi() {
    var message = '';
    try {
      var address = new window.URL(state.voiceApiUrl);
      if (!['http:', 'https:'].includes(address.protocol)) message = '请填写有效的接口地址';
    } catch {
      message = '请填写有效的接口地址';
    }
    if (!message && !state.voiceApiModel.trim()) message = '请填写转写模型名称';
    var status = document.getElementById('voice-api-status');
    status.textContent = message || '接口配置预览';
    status.setAttribute('role', message ? 'alert' : 'status');
    return !message;
  }
  function startVoicePreview() {
    if (
      !state.voicePluginEnabled ||
      !state.voiceEnabled ||
      !state.voiceServiceRunning ||
      state.voiceRecording
    )
      return;
    state.voiceRecording = true;
    state.voiceRecordStartedAt = window.performance.now();
    state.voiceRecordMessage = '录音预览中';
    voiceTimer = window.setInterval(updateVoiceTime, 250);
    updateVoiceTime();
    renderVoice();
  }
  function stopVoicePreview(message) {
    state.voiceRecording = false;
    state.voicePressedAt = null;
    state.voiceRecordMessage = message;
    window.clearInterval(voiceTimer);
    voiceTimer = null;
    updateVoiceTime();
    renderVoice();
  }

  function renderPageContributions() {
    var enabled = state.voicePluginEnabled;
    document.querySelector('[data-nav=voice]').closest('li').hidden = !enabled;
    document
      .querySelectorAll('[data-goto=voice], [data-preview-action=conversation-record-start]')
      .forEach(function (button) {
        button.disabled = !enabled;
      });
    if (!enabled && state.page === 'voice') state.page = 'plugins';
  }

  function render() {
    renderPageContributions();
    renderPersona();
    renderVoice();
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
    renderPlugins();
    renderConversation();
  }

  var conversationTimer = null;
  var pendingConfirmation = null;

  function chatEntry(record) {
    var item = document.createElement('li');
    item.className = 'chat-entry chat-entry--' + record.kind;
    item.dataset.interactionId = record.id;
    item.dataset.interactionKind = record.kind;
    item.dataset.via = record.via;
    item.title = new Date(record.at).toLocaleString('zh-CN');
    if (record.kind === 'pet') {
      var avatar = document.createElement('img');
      avatar.className = 'chat-avatar';
      avatar.src = state.outfitPacks[state.figure].image;
      avatar.alt = state.petName;
      item.append(avatar);
    }
    var bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.textContent = record.text;
    item.append(bubble);
    return item;
  }

  function renderConversation() {
    var history = document.getElementById('conversation-history');
    var stream = document.getElementById('conversation-stream');
    var follow = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 48;
    state.conversationRecords.forEach(function (record, index) {
      if (!stream.querySelector('[data-interaction-id="' + record.id + '"]'))
        stream.insertBefore(chatEntry(record), stream.children[index] || null);
    });
    var thinking = document.getElementById('conversation-thinking');
    if (state.conversationPending && !thinking) {
      thinking = chatEntry({
        id: 'thinking',
        kind: 'pet',
        text: '',
        via: 'console',
        at: Date.now(),
      });
      thinking.id = 'conversation-thinking';
      thinking.removeAttribute('data-interaction-id');
      thinking.classList.add('chat-entry--thinking');
      thinking.setAttribute('aria-label', state.petName + ' 正在回复');
      for (var i = 0; i < 3; i++) {
        var dot = document.createElement('i');
        dot.className = 'chat-dot';
        thinking.querySelector('.chat-bubble').append(dot);
      }
      stream.append(thinking);
    } else if (!state.conversationPending && thinking) thinking.remove();
    if (thinking && state.conversationPending) stream.append(thinking);
    history.dataset.historyCount = String(state.conversationRecords.length);
    var status = document.getElementById('conversation-chat-status');
    status.textContent = state.conversationPending
      ? state.petName + ' 正在回复…'
      : state.modelReplyEnabled && state.modelReplyInstalled
        ? '等你说话'
        : '回复已暂停';
    status.dataset.tone = state.conversationPending ? 'busy' : 'idle';
    var input = document.getElementById('conversation-input');
    input.placeholder = '给' + state.petName + '发消息…';
    var send = document.querySelector('[data-preview-action="conversation-send"]');
    send.disabled = state.conversationPending || !state.conversationDraft.trim();
    document.getElementById('conversation-send-state').textContent = state.conversationPending
      ? '正在回复'
      : state.conversationDraft.trim()
        ? '待发送'
        : '未发送';
    document.getElementById('conversation-compose').dataset.sendState = state.conversationPending
      ? 'sending'
      : 'draft';
    document.querySelector('[data-preview-action="conversation-load-earlier"]').disabled =
      state.conversationEarlier;
    if (state.page === 'conversation') {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 160) + 'px';
      if (follow) stream.scrollTop = stream.scrollHeight;
    }
  }

  function appendConversation(kind, text, via) {
    state.conversationSerial += 1;
    state.conversationRecords.push({
      id: 'int-' + state.conversationSerial,
      kind: kind,
      text: text,
      via: via || 'console',
      at: Date.now(),
    });
    renderConversation();
  }

  function stopConversation() {
    if (!state.conversationPending) return;
    window.clearTimeout(conversationTimer);
    conversationTimer = null;
    state.conversationPending = false;
    appendConversation('interaction', '你停止了这次回复');
  }

  function sendConversation() {
    var text = state.conversationDraft.trim();
    if (!text || state.conversationPending) return;
    state.conversationDraft = '';
    syncControls();
    appendConversation('user', text);
    if (!state.modelReplyEnabled || !state.modelReplyInstalled) return;
    state.conversationPending = true;
    renderConversation();
    // 只演示这一页的排版与状态，不调用模型，不进入真实桌宠记录。
    conversationTimer = window.setTimeout(function () {
      conversationTimer = null;
      state.conversationPending = false;
      appendConversation('pet', '我在呢，慢慢说，我听着。');
    }, 700);
  }

  function renderPlugins() {
    var count = 0;
    var active =
      1 +
      Number(state.voicePluginEnabled) +
      Number(state.builtinSpeechEnabled) +
      Number(state.modelReplyEnabled && state.modelReplyInstalled);
    document.querySelectorAll('#page-plugins article[data-plugin-id]').forEach(function (card) {
      var id = card.dataset.pluginId;
      var installed = id !== 'model-reply' || state.modelReplyInstalled;
      var enabled =
        id === 'voice-input'
          ? state.voicePluginEnabled
          : id === 'builtin-speech'
            ? state.builtinSpeechEnabled
            : id === 'model-reply'
              ? state.modelReplyEnabled
              : true;
      var builtin = id !== 'model-reply';
      card.dataset.pluginState = enabled
        ? id === 'builtin-bridge'
          ? 'protected'
          : 'active'
        : 'disabled';
      var query = state.pluginSearch.trim().toLocaleLowerCase('zh-CN');
      var searchable =
        id +
        ' ' +
        card.querySelector('.card__title').textContent +
        ' ' +
        card.querySelector('.plugin-card__desc').textContent;
      var match = !query || searchable.toLocaleLowerCase('zh-CN').includes(query);
      var filter = state.pluginFilter;
      card.hidden =
        !installed ||
        !match ||
        (filter === 'active' && !enabled) ||
        (filter === 'disabled' && enabled) ||
        (filter === 'builtin' && !builtin);
      if (!card.hidden) count++;
      if (id === 'model-reply') {
        var label = card.querySelector('[data-show="plugin-state-model-reply"]');
        if (label) label.textContent = enabled ? '已启用' : '已停用';
        var toggle = card.querySelector(
          '[data-preview-action="plugin-disable"], [data-preview-action="plugin-enable"]',
        );
        toggle.dataset.previewAction = enabled ? 'plugin-disable' : 'plugin-enable';
        toggle.textContent = enabled ? '停用' : '启用';
        toggle.dataset.confirm = enabled ? 'disable-plugin' : 'enable-plugin';
      }
    });
    setText('plugins-active-count', String(active));
    setText(
      'plugins-disabled-count',
      String(
        Number(!state.voicePluginEnabled) +
          Number(!state.builtinSpeechEnabled) +
          Number(state.modelReplyInstalled && !state.modelReplyEnabled),
      ),
    );
    setText('plugins-protected-count', '1');
    document.getElementById('plugins-empty').hidden = count > 0;
    document.querySelectorAll('[data-plugin-filter]').forEach(function (button) {
      button.setAttribute(
        'aria-pressed',
        String(button.dataset.pluginFilter === state.pluginFilter),
      );
    });
  }

  function previewAction(action, pluginId, interaction) {
    if (action === 'conversation-send') sendConversation();
    else if (action === 'conversation-interact') {
      var messages = {
        touch: '你轻触了' + state.petName + '一下',
        stroke: '你摸了摸' + state.petName,
        'pick-up': '你把' + state.petName + '抱了起来',
        'put-down': '你把' + state.petName + '放了下来',
      };
      appendConversation('interaction', messages[interaction], 'bubble');
    } else if (action === 'conversation-refresh') renderConversation();
    else if (action === 'conversation-load-earlier' && !state.conversationEarlier) {
      var stream = document.getElementById('conversation-stream');
      var top = stream.scrollTop,
        height = stream.scrollHeight;
      state.conversationEarlier = true;
      state.conversationRecords.unshift(
        {
          id: 'earlier-1',
          kind: 'user',
          text: '早上好。',
          via: 'bubble',
          at: Date.now() - 3600000,
        },
        {
          id: 'earlier-2',
          kind: 'pet',
          text: '早上好，今天也一起慢慢来。',
          via: 'bubble',
          at: Date.now() - 3500000,
        },
      );
      renderConversation();
      stream.scrollTop = top + stream.scrollHeight - height;
    } else if (action === 'plugin-enable' || action === 'plugin-disable') {
      if (pluginId === 'model-reply') {
        state.modelReplyEnabled = action === 'plugin-enable';
        if (!state.modelReplyEnabled) stopConversation();
      }
      syncControls();
      render();
    } else if (action === 'plugin-uninstall' && pluginId === 'model-reply') {
      state.modelReplyInstalled = false;
      stopConversation();
      render();
      document.getElementById('plugin-search').focus();
    } else if (action === 'plugins-stop-all') {
      stopConversation();
      setText('plugins-task-count', '0');
      document.getElementById('plugins-runtime').dataset.taskCount = '0';
    } else if (action === 'plugin-config-save')
      document.getElementById('plugin-config-status').textContent = '本地预览';
    else if (action === 'conversation-record-start') {
      state.page = 'voice';
      render();
    }
  }

  function setText(key, value) {
    var selector = key === 'railSummary' ? '#rail-summary' : '[data-show="' + key + '"]';
    document.querySelectorAll(selector).forEach(function (el) {
      el.textContent = value;
    });
  }

  function showPage(id) {
    if (id === 'voice' && !state.voicePluginEnabled) {
      state.page = 'plugins';
      id = state.page;
    }
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
    if (pref === 'bubbleScene') resetBubblePreview();
    if (pref === 'bubblePosition') renderBubblePreview();
    if (
      (pref === 'soundEnabled' && !state.soundEnabled) ||
      (pref === 'soundTalk' && !state.soundTalk)
    )
      stopSpeakingPreview();
    if (pref === 'voiceEnabled' && !state.voiceEnabled) {
      state.voiceServiceRunning = false;
      stopVoicePreview('未录音');
    }
    if (pref === 'voiceMicrophone') stopVoicePreview('未录音');
    if (pref === 'voiceEngine') {
      state.voiceServiceRunning = false;
      stopVoicePreview('未录音');
    }
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
      if (el.dataset.pref.indexOf('voiceApi') === 0) {
        state.voiceServiceRunning = false;
        stopVoicePreview('未录音');
        document.getElementById('voice-api-status').textContent = '';
      }
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
      pendingConfirmation = {
        action: target.dataset.previewAction,
        pluginId: target.dataset.pluginId,
      };
      var card = target.closest('.card');
      document.getElementById('preview-confirm-item').textContent =
        target.dataset.confirmItem ||
        (card && card.querySelector('.card__title')
          ? card.querySelector('.card__title').textContent
          : target.textContent.trim());
      var confirm = document.getElementById('preview-confirm-dialog');
      confirm.returnValue = '';
      confirm.showModal();
    } else if (target.dataset.openDialog)
      document.getElementById(target.dataset.openDialog).showModal();
    else if (target.hasAttribute('data-close-dialog')) {
      previewAction(target.dataset.previewAction, target.dataset.pluginId);
      target.closest('dialog').close();
    } else {
      var badge = document.getElementById('preview-badge');
      badge.textContent = '预览模式';
      badge.setAttribute('role', 'status');
      previewAction(
        target.dataset.previewAction,
        target.dataset.pluginId,
        target.dataset.interaction,
      );
    }
  });

  document.getElementById('preview-confirm-dialog').addEventListener('close', function () {
    var pending = pendingConfirmation;
    pendingConfirmation = null;
    if (this.returnValue === 'confirm' && pending) previewAction(pending.action, pending.pluginId);
  });
  document.getElementById('plugin-search').addEventListener('input', function () {
    state.pluginSearch = this.value;
    renderPlugins();
  });
  document.querySelectorAll('[data-plugin-filter]').forEach(function (button) {
    button.addEventListener('click', function () {
      state.pluginFilter = button.dataset.pluginFilter;
      renderPlugins();
    });
  });
  document
    .querySelector('[data-chat-action="toggle-console"]')
    .addEventListener('click', function () {
      var panel = document.getElementById('conversation-console');
      panel.hidden = !panel.hidden;
      this.setAttribute('aria-expanded', String(!panel.hidden));
    });
  document.getElementById('conversation-input').addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      sendConversation();
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

  var voiceKeyDialog = document.getElementById('voice-key-dialog');
  document.querySelectorAll('[data-voice-action]').forEach(function (button) {
    button.addEventListener('click', function () {
      var action = button.dataset.voiceAction;
      if (action === 'download-model') {
        downloadVoiceModel();
      } else if (action === 'start-service') {
        if (state.voiceEngine === 'api' && !validateVoiceApi()) return;
        state.voiceServiceRunning = true;
        renderVoice();
      } else if (action === 'stop-service') {
        state.voiceServiceRunning = false;
        stopVoicePreview('未录音');
      } else if (action === 'toggle-recording') {
        if (state.voiceRecording) stopVoicePreview('已结束预览');
        else startVoicePreview();
      } else if (action === 'cancel-recording') stopVoicePreview('已取消预览');
      else if (action === 'toggle-plugin') {
        state.voicePluginEnabled = !state.voicePluginEnabled;
        if (!state.voicePluginEnabled) {
          Object.keys(voiceDownloadTimers).forEach(function (id) {
            window.clearInterval(voiceDownloadTimers[id]);
            delete voiceDownloadTimers[id];
            state.voiceDownloads[id].phase = 'absent';
            state.voiceDownloads[id].progress = 0;
          });
          state.voiceServiceRunning = false;
          stopVoicePreview('未录音');
        }
        syncControls();
        render();
      }
    });
  });
  document.getElementById('voice-api-key-toggle').addEventListener('click', function () {
    var key = document.getElementById('voice-api-key');
    var shown = key.type === 'password';
    key.type = shown ? 'text' : 'password';
    this.setAttribute('aria-pressed', String(shown));
    this.setAttribute('aria-label', shown ? '隐藏转写Key' : '显示转写Key');
  });
  document.getElementById('voice-key-change').addEventListener('click', function () {
    pendingVoiceKey = null;
    document.getElementById('voice-key-candidate').textContent = '按下新按键';
    document.getElementById('voice-key-save').disabled = true;
    voiceKeyDialog.showModal();
    document.getElementById('voice-key-capture').focus();
  });
  document.getElementById('voice-key-cancel').addEventListener('click', function () {
    voiceKeyDialog.close();
  });
  document.getElementById('voice-key-save').addEventListener('click', function () {
    state.voiceHotkey = pendingVoiceKey;
    renderVoice();
    voiceKeyDialog.close();
  });
  voiceKeyDialog.addEventListener('close', function () {
    pendingVoiceKey = null;
    document.getElementById('voice-key-change').focus();
  });
  document.addEventListener('keydown', function (event) {
    if (voiceKeyDialog.open) {
      if (event.key === 'Escape' || event.key === 'Tab') return;
      event.preventDefault();
      if (event.repeat) return;
      pendingVoiceKey = event.code;
      document.getElementById('voice-key-candidate').textContent = voiceKeyLabel(event.code);
      document.getElementById('voice-key-save').disabled = false;
      return;
    }
    if (
      state.page !== 'voice' ||
      event.code !== state.voiceHotkey ||
      event.repeat ||
      event.target.closest('input,textarea,select,[contenteditable=true],dialog')
    )
      return;
    if (!state.voicePluginEnabled || !state.voiceEnabled || !state.voiceServiceRunning) return;
    event.preventDefault();
    if (state.voiceRecording) {
      stopVoicePreview('已结束预览');
      return;
    }
    state.voicePressedAt = window.performance.now();
    startVoicePreview();
  });
  document.addEventListener('keyup', function (event) {
    if (event.code !== state.voiceHotkey || state.voicePressedAt === null) return;
    event.preventDefault();
    var held = window.performance.now() - state.voicePressedAt;
    state.voicePressedAt = null;
    if (held >= VOICE_HOLD_MS) stopVoicePreview('已结束预览');
  });
  window.addEventListener('blur', function () {
    if (state.voicePressedAt !== null) stopVoicePreview('已取消预览');
  });
  window.addEventListener('pagehide', function () {
    window.clearInterval(voiceTimer);
    Object.values(voiceDownloadTimers).forEach(function (timer) {
      window.clearInterval(timer);
    });
  });

  document.querySelectorAll('[data-speech-action]').forEach(function (button) {
    button.addEventListener('click', function () {
      if (button.dataset.speechAction === 'toggle') {
        state.builtinSpeechEnabled = !state.builtinSpeechEnabled;
        if (!state.builtinSpeechEnabled) stopSpeakingPreview();
        render();
      } else {
        state.personaPane = 'habits';
        state.page = 'persona';
        render();
        document.getElementById('persona-sound-card').scrollIntoView({ block: 'start' });
      }
    });
  });

  var BUBBLE_SCENES = {
    reply: '今天也在这里陪着你。\n不着急，先做眼前的一件小事。',
    thinking: '',
    typewriter: '窗外慢慢暗下来了。先把今天做到的事情记下来，剩下的明天再继续。',
    choices: '接下来想怎么待一会儿？',
    input: '想聊什么？',
    error: '这次没有完成。可以检查设置，或者稍后再试。',
    long: '有时候，陪伴不需要很多话。\n\n你忙的时候，我可以安静地待在旁边；你想说话的时候，再慢慢讲给我听。\n\n先照顾好眼前的一点点事情，不必一次完成全部。\n\n这是一段用于检查气泡换行和滚动的长文本。https://example.test/a-very-long-path-without-spaces/keep-the-bubble-inside-the-window\n\n把节奏放慢一点，也没关系。',
  };
  var bubbleTimer = null;
  state.bubbleScene = 'reply';
  state.bubblePosition = 'center';
  state.bubbleNight = false;
  state.bubbleDismissed = false;
  state.bubbleReply = '';
  state.bubbleInput = '';
  state.bubbleUser = '';
  state.bubbleRevealed = 0;
  function positionBubblePreview() {
    if (!document.getElementById('pet-bubble-dialog').open) return;
    var scene = document.getElementById('bubble-preview-scene'),
      pet = document.getElementById('bubble-pet-anchor'),
      bubble = document.getElementById('pet-bubble'),
      user = document.getElementById('bubble-user-message');
    var x =
      state.bubblePosition === 'left'
        ? 76
        : state.bubblePosition === 'right'
          ? scene.clientWidth - 76
          : scene.clientWidth / 2;
    pet.style.left = x + 'px';
    var bottom = scene.clientHeight - pet.offsetTop + 18;
    bubble.style.maxWidth = Math.min(318, scene.clientWidth - 24) + 'px';
    bubble.style.maxHeight =
      Math.max(120, scene.clientHeight - bottom - (user.hidden ? 16 : 86)) + 'px';
    bubble.style.bottom = bottom + 'px';
    var left = Math.max(
      12,
      Math.min(scene.clientWidth - bubble.offsetWidth - 12, x - bubble.offsetWidth / 2),
    );
    bubble.style.left = left + 'px';
    bubble.style.setProperty(
      '--bubble-tail-x',
      Math.max(22, Math.min(bubble.offsetWidth - 22, x - left)) + 'px',
    );
    user.style.left =
      Math.max(12, Math.min(scene.clientWidth - user.offsetWidth - 12, x - user.offsetWidth / 2)) +
      'px';
    user.style.bottom = bottom + (bubble.hidden ? 0 : bubble.offsetHeight + 8) + 'px';
  }
  function renderBubblePreview() {
    if (!document.getElementById('pet-bubble-dialog').open) return;
    var scene = state.bubbleScene,
      main = document.getElementById('pet-bubble');
    document.getElementById('bubble-preview-scene').classList.toggle('is-dark', state.bubbleNight);
    document.getElementById('bubble-scene-theme').textContent = state.bubbleNight
      ? '浅色场景'
      : '深色场景';
    main.hidden = state.bubbleDismissed;
    main.classList.toggle('is-status', scene === 'thinking');
    main.dataset.scene = scene;
    var text = state.bubbleReply || BUBBLE_SCENES[scene],
      content = document.getElementById('bubble-content');
    content.textContent = scene === 'typewriter' ? text.slice(0, state.bubbleRevealed) : text;
    content.hidden = scene === 'thinking';
    var status = document.getElementById('bubble-status');
    status.hidden = scene !== 'thinking';
    status.textContent = '';
    if (scene === 'thinking') {
      status.setAttribute('aria-label', '正在思考');
      var dots = document.createElement('span');
      dots.className = 'bubble-thinking-dots';
      dots.setAttribute('aria-hidden', 'true');
      for (var i = 0; i < 3; i++) dots.append(document.createElement('i'));
      status.append(dots);
    }
    document.getElementById('bubble-dismiss').hidden =
      !['choices', 'input', 'error'].includes(scene) || !!state.bubbleReply;
    document.getElementById('bubble-composer').hidden = scene !== 'input' || !!state.bubbleReply;
    var choices = document.getElementById('bubble-choices');
    choices.replaceChildren();
    if (!state.bubbleReply && (scene === 'choices' || scene === 'error'))
      (scene === 'choices' ? ['继续聊天', '安静陪着我'] : ['打开设置', '知道了']).forEach(
        function (label, index) {
          var button = document.createElement('button');
          button.type = 'button';
          button.className = 'bubble-choice';
          button.dataset.bubbleChoice = String(index);
          button.textContent = (scene === 'choices' ? index + 1 + '  ' : '') + label;
          button.addEventListener('click', function () {
            answerBubblePreview(index);
          });
          choices.append(button);
        },
      );
    choices.hidden = !choices.children.length;
    document.getElementById('bubble-stop').hidden =
      scene !== 'typewriter' || state.bubbleRevealed >= text.length;
    var user = document.getElementById('bubble-user-message');
    user.textContent = state.bubbleUser;
    user.hidden = !state.bubbleUser;
    var pack = state.outfitPacks[state.figure],
      palette = pack.palettes.find(function (item) {
        return item.id === state.palette;
      }),
      art = document.querySelector('[data-bubble-pet]');
    art.src = (palette && palette.image) || pack.image;
    art.dataset.palette = (palette && palette.tone) || 'morning';
    document.getElementById('bubble-send').disabled = !state.bubbleInput.trim();
    positionBubblePreview();
  }
  function resetBubblePreview() {
    window.clearInterval(bubbleTimer);
    bubbleTimer = null;
    state.bubbleReply = '';
    state.bubbleUser = '';
    state.bubbleDismissed = false;
    var text = BUBBLE_SCENES[state.bubbleScene];
    state.bubbleRevealed = text.length;
    if (
      state.bubbleScene === 'typewriter' &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      state.bubbleRevealed = 0;
      bubbleTimer = window.setInterval(function () {
        state.bubbleRevealed += 1;
        if (state.bubbleRevealed >= text.length) {
          window.clearInterval(bubbleTimer);
          bubbleTimer = null;
        }
        renderBubblePreview();
      }, 45);
    }
    renderBubblePreview();
    if (state.bubbleScene === 'input') document.getElementById('bubble-input').focus();
  }
  function answerBubblePreview(index) {
    if (state.bubbleScene === 'error') {
      if (index === 0) {
        document.getElementById('pet-bubble-dialog').close();
        state.page = 'plugins';
        render();
      } else {
        state.bubbleDismissed = true;
        renderBubblePreview();
      }
      return;
    }
    state.bubbleReply = index === 0 ? '好呀，你慢慢说，我在听。' : '那我安静地陪着你。';
    renderBubblePreview();
    document.getElementById('bubble-replay').focus();
  }
  function sendBubblePreview() {
    var text = state.bubbleInput.trim();
    if (!text) return;
    state.bubbleUser = text;
    state.bubbleReply = '收到了，我在这里。';
    state.bubbleInput = '';
    document.getElementById('bubble-input').value = '';
    renderBubblePreview();
    document.getElementById('bubble-replay').focus();
  }
  function openBubblePreview() {
    document.getElementById('pet-bubble-dialog').showModal();
    resetBubblePreview();
    window.requestAnimationFrame(positionBubblePreview);
  }
  document.getElementById('open-bubble-preview').addEventListener('click', openBubblePreview);
  document.getElementById('bubble-dialog-close').addEventListener('click', function () {
    document.getElementById('pet-bubble-dialog').close();
  });
  document.getElementById('pet-bubble-dialog').addEventListener('close', function () {
    window.clearInterval(bubbleTimer);
    bubbleTimer = null;
    stopSpeakingPreview();
    if (state.page === 'start') document.getElementById('open-bubble-preview').focus();
    else document.querySelector('[data-nav=' + state.page + ']').focus();
  });
  document.getElementById('bubble-replay').addEventListener('click', resetBubblePreview);
  document.getElementById('bubble-dismiss').addEventListener('click', function () {
    state.bubbleDismissed = true;
    renderBubblePreview();
    document.getElementById('bubble-replay').focus();
  });
  document.getElementById('bubble-scene-theme').addEventListener('click', function () {
    state.bubbleNight = !state.bubbleNight;
    renderBubblePreview();
  });
  document.getElementById('bubble-stop').addEventListener('click', function () {
    window.clearInterval(bubbleTimer);
    bubbleTimer = null;
    state.bubbleRevealed = BUBBLE_SCENES[state.bubbleScene].length;
    renderBubblePreview();
  });
  document.getElementById('bubble-speak').addEventListener('click', function () {
    if (state.audioPlaying) stopSpeakingPreview();
    else void previewSpeakingSound();
  });
  document.getElementById('bubble-send').addEventListener('click', sendBubblePreview);
  document.getElementById('bubble-input').addEventListener('input', function () {
    state.bubbleInput = this.value;
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 110) + 'px';
    document.getElementById('bubble-send').disabled = !state.bubbleInput.trim();
    positionBubblePreview();
  });
  document.getElementById('bubble-input').addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      sendBubblePreview();
    }
  });
  document.addEventListener('keydown', function (event) {
    if (!document.getElementById('pet-bubble-dialog').open || event.isComposing) return;
    if (
      event.key === 'Escape' &&
      !state.bubbleDismissed &&
      ['choices', 'input'].includes(state.bubbleScene)
    ) {
      event.preventDefault();
      state.bubbleDismissed = true;
      renderBubblePreview();
      document.getElementById('bubble-replay').focus();
      return;
    }
    if (
      state.bubbleScene === 'choices' &&
      !state.bubbleReply &&
      !state.bubbleDismissed &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      !event.target.closest('input,textarea,select') &&
      ['1', '2'].includes(event.key)
    ) {
      event.preventDefault();
      answerBubblePreview(Number(event.key) - 1);
    }
  });
  window.addEventListener('resize', positionBubblePreview);
  window.addEventListener('pagehide', function () {
    window.clearInterval(bubbleTimer);
  });

  renderOutfitRows();
  syncControls();
  render();
})();
