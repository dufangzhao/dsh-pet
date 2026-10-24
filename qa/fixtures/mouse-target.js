'use strict';

// 桌宠原生鼠标测试底板：最小只读观测夹具。
// 只在 document 上被动记录真实鼠标左键事件；没有控件、不读键盘、不联网、不写文件。

const MAX_EVENTS = 64;
const RECENT_LIMIT = 8;

const state = {
  downs: 0,
  ups: 0,
  clicks: 0,
  lastEvent: null,
  events: [],
};

globalThis.__m0MouseTarget = state;

const downsNode = document.getElementById('count-downs');
const upsNode = document.getElementById('count-ups');
const clicksNode = document.getElementById('count-clicks');
const lastEventNode = document.getElementById('last-event');
const recentNode = document.getElementById('recent-list');
const statusNode = document.getElementById('status-line');

function isPrimaryMousePointer(event) {
  return event.button === 0 && event.pointerType === 'mouse';
}

function addEvent(type, event) {
  const entry = {
    type: type,
    clientX: event.clientX,
    clientY: event.clientY,
    button: event.button,
    isTrusted: event.isTrusted,
    time: Date.now(),
  };
  state.events.push(entry);
  if (state.events.length > MAX_EVENTS) {
    state.events.shift();
  }
  state.lastEvent = entry;
}

function describe(entry) {
  if (entry === null) {
    return '尚未收到事件';
  }
  const trust = entry.isTrusted ? 'trusted' : 'untrusted';
  const x = Math.round(entry.clientX);
  const y = Math.round(entry.clientY);
  return entry.type + ' · x=' + x + ' y=' + y + ' · button=' + entry.button + ' · ' + trust;
}

function renderRecent() {
  const recent = state.events.slice(-RECENT_LIMIT).reverse();
  recentNode.textContent = '';
  for (const entry of recent) {
    const item = document.createElement('li');
    item.textContent = describe(entry);
    recentNode.appendChild(item);
  }
}

function render() {
  downsNode.textContent = String(state.downs);
  upsNode.textContent = String(state.ups);
  clicksNode.textContent = String(state.clicks);
  lastEventNode.textContent = describe(state.lastEvent);
  renderRecent();
  statusNode.textContent =
    '左键 down ' +
    state.downs +
    ' / up ' +
    state.ups +
    ' / click ' +
    state.clicks +
    '；最近事件：' +
    describe(state.lastEvent) +
    '；已保留 ' +
    state.events.length +
    ' / ' +
    MAX_EVENTS +
    ' 条。';
}

// 被动监听：capture + passive，不 preventDefault，不改变事件默认行为。
document.addEventListener(
  'pointerdown',
  function (event) {
    if (!isPrimaryMousePointer(event)) {
      return;
    }
    state.downs += 1;
    addEvent('pointerdown', event);
    render();
  },
  { capture: true, passive: true },
);

document.addEventListener(
  'pointerup',
  function (event) {
    if (!isPrimaryMousePointer(event)) {
      return;
    }
    state.ups += 1;
    addEvent('pointerup', event);
    render();
  },
  { capture: true, passive: true },
);

document.addEventListener(
  'click',
  function (event) {
    state.clicks += 1;
    addEvent('click', event);
    render();
  },
  { capture: true, passive: true },
);

render();
