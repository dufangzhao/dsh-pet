import assert from 'node:assert/strict';
import test from 'node:test';

const {
  beginIntent,
  canStart,
  captureLimitHint,
  editPreview,
  emptyVoiceState,
  finishModeLabel,
  markCancelled,
  markFailed,
  markRecording,
  markSubmitted,
  markSubmitting,
  markUncertain,
  planFinish,
  readinessReason,
  showPreview,
  stillOurs,
} = await import('../src/client/voice-form.ts');

const targetKey = 'client-1:agent-1';

function view(over = {}) {
  const provider = {
    providerRef: 'pet.asr-magpie/magpie',
    label: 'Magpie',
    synthetic: false,
    source: 'ready',
    configRevision: 3,
    settings: {
      baseUrl: 'https://gw.example/v1',
      modelRef: 'xiaomi/mimo-v2.5-asr',
      finishMode: 'send',
    },
    bindingId: 'binding-1',
    credential: { available: true, writable: false, version: '1', source: 'memory' },
    readiness: 'configured',
    reason: null,
    ...(over.provider ?? {}),
  };
  return {
    version: 1,
    feature: {
      source: 'ready',
      configRevision: 3,
      providerRef: 'pet.asr-magpie/magpie',
      finishMode: 'send',
      ...(over.feature ?? {}),
    },
    providers: [provider],
  };
}

const intent = {
  captureId: 'cap-1',
  clientId: 'client-1',
  agentId: 'agent-1',
  serviceEpoch: 'epoch-1',
  finishMode: 'send',
  targetKey,
};

function ticket(over = {}) {
  return {
    version: 1,
    captureId: 'cap-1',
    clientId: 'client-1',
    agentId: 'agent-1',
    serviceEpoch: 'epoch-1',
    bindingId: 'binding-1',
    finishMode: 'send',
    expiresAt: 1,
    encoding: 'f32le',
    sampleRate: 16000,
    channels: 1,
    chunkSamples: 1600,
    maxSamples: 320000,
    ...over,
  };
}

function result(over = {}) {
  return {
    ticket: ticket(),
    phase: 'final',
    samples: 16000,
    cleanup: 'settled',
    outcome: { kind: 'final', text: '你好' },
    error: null,
    completedAt: 1,
    ...over,
  };
}

test('未连接时不能开始，并说明原因', () => {
  assert.equal(canStart(emptyVoiceState, view(), false).ok, false);
  assert.match(canStart(emptyVoiceState, view(), false).reason, /未连接/);
});

test('视图还没读到时不能开始', () => {
  assert.equal(canStart(emptyVoiceState, null, true).ok, false);
});

test('配置齐全时可以开始', () => {
  assert.deepEqual(canStart(emptyVoiceState, view(), true), { ok: true, reason: null });
});

test('未配置模型时不能开始，且不说成「不支持」', () => {
  const unconfigured = view({
    provider: { readiness: 'unconfigured', reason: 'model-unconfigured' },
  });
  const rules = canStart(emptyVoiceState, unconfigured, true);
  assert.equal(rules.ok, false);
  assert.match(rules.reason, /还没有选择转写模型/);
});

test('unsupported-protocol 与未配置给出不同原因', () => {
  const unsupported = view({
    provider: { readiness: 'unavailable', reason: 'unsupported-protocol' },
  });
  assert.match(readinessReason(unsupported), /不支持语音协议/);
});

test('正在采集时不能重复开始', () => {
  const running = beginIntent(emptyVoiceState, intent);
  assert.equal(canStart(running, view(), true).ok, false);
  assert.match(canStart(running, view(), true).reason, /还没结束/);
});

test('功能被停用时不能开始', () => {
  const disabled = view({
    feature: { source: 'disabled' },
    provider: { readiness: 'unavailable', reason: 'feature-disabled' },
  });
  assert.equal(canStart(emptyVoiceState, disabled, true).ok, false);
});

test('beginIntent 固定 intent 并清掉上一次的预览', () => {
  const dirty = showPreview(emptyVoiceState, '旧文本');
  const next = beginIntent(dirty, intent);
  assert.equal(next.phase, 'arming');
  assert.deepEqual(next.intent, intent);
  assert.equal(next.preview, null);
});

test('markRecording 只在 arming 之后生效', () => {
  assert.equal(markRecording(emptyVoiceState).phase, 'idle');
  assert.equal(markRecording(beginIntent(emptyVoiceState, intent)).phase, 'recording');
});

test('取消清空 intent 与预览', () => {
  const running = showPreview(beginIntent(emptyVoiceState, intent), '草稿');
  const cancelled = markCancelled();
  assert.equal(cancelled.phase, 'idle');
  assert.equal(cancelled.intent, null);
  assert.equal(cancelled.preview, null);
  assert.notEqual(running.phase, 'idle');
});

test('失败保留原因并允许重来', () => {
  const failed = markFailed(beginIntent(emptyVoiceState, intent), null, '录音中断了。');
  assert.equal(failed.phase, 'error');
  assert.equal(failed.intent, null);
  assert.match(failed.notice, /录音中断/);
  assert.equal(canStart(failed, view(), true).ok, true);
});

test('no-speech 不提交，给出提示', () => {
  const plan = planFinish(result({ phase: 'empty', outcome: { kind: 'no-speech' } }));
  assert.equal(plan.text, null);
  assert.match(plan.notice, /没有识别到语音/);
});

test('空文本按 no-speech 处理，不发空消息', () => {
  const plan = planFinish(result({ outcome: { kind: 'final', text: '   ' } }));
  assert.equal(plan.text, null);
  assert.match(plan.notice, /没有识别到语音/);
});

test('还没有结果时不假装完成', () => {
  const plan = planFinish(result({ phase: 'transcribing', outcome: null }));
  assert.equal(plan.text, null);
  assert.match(plan.notice, /还没有转写结果/);
});

test('send 模式返回可发送文本', () => {
  const plan = planFinish(result());
  assert.equal(plan.mode, 'send');
  assert.equal(plan.text, '你好');
  assert.equal(plan.notice, null);
});

test('review 模式沿用票据里的模式', () => {
  const plan = planFinish(result({ ticket: ticket({ finishMode: 'review' }) }));
  assert.equal(plan.mode, 'review');
  assert.equal(plan.text, '你好');
});

test('预览可编辑，且不推进任何版本', () => {
  const shown = showPreview(beginIntent(emptyVoiceState, intent), '你好');
  assert.equal(shown.phase, 'review');
  const edited = editPreview(shown, '你好呀');
  assert.equal(edited.preview, '你好呀');
  assert.deepEqual(edited.intent, shown.intent);
});

test('非 review 阶段不接受预览编辑', () => {
  const idle = emptyVoiceState;
  assert.equal(editPreview(idle, 'x'), idle);
});

test('提交成功后回到 idle', () => {
  const submitted = markSubmitted();
  assert.equal(submitted.phase, 'idle');
  assert.equal(submitted.submitting, null);
});

test('结果未知时保留文本与同一个 commandId 供原样重试', () => {
  const submitting = markSubmitting(
    showPreview(beginIntent(emptyVoiceState, intent), '你好'),
    'cmd-1',
  );
  const uncertain = markUncertain(submitting, '你好');
  assert.equal(uncertain.phase, 'review');
  assert.equal(uncertain.preview, '你好');
  assert.match(uncertain.notice, /不会重复发送/);
});

test('目标换了，旧采集不再属于当前连接', () => {
  const running = beginIntent(emptyVoiceState, intent);
  assert.equal(stillOurs(running, targetKey), true);
  assert.equal(stillOurs(running, 'client-1:agent-2'), false);
  assert.equal(stillOurs(running, null), false);
  assert.equal(stillOurs(emptyVoiceState, targetKey), false);
});

test('20 秒上限的文案随模式变化，且两种都提到 20 秒', () => {
  assert.match(captureLimitHint('send'), /20 秒.*发送/);
  assert.match(captureLimitHint('review'), /20 秒.*预览/);
});

test('模式标签说清结束后会发生什么', () => {
  assert.match(finishModeLabel('send'), /直接发送/);
  assert.match(finishModeLabel('review'), /预览/);
});
