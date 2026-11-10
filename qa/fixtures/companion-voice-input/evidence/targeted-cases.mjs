// QA-only production cases. Importing this module starts no instance and changes no product state.
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

export async function runTargetedNative({ page, app, report, id, api, newPeer, configure, reconnect,
  recording, idle, voiceState, companionState, observe, shot, stage }) {
  const providerRef = 'pet.asr-magpie/magpie';
  const users = snapshot => snapshot.messages.filter(message => message.role === 'user');
  const beforeUsers = async () => users(await api('/api/snapshot'));
  const assertDelta = async (before, delta, expectedText) => {
    await expect.poll(async () => (await beforeUsers()).length - before.length, { timeout: 15000 }).toBe(delta);
    const after = await beforeUsers();
    const oldIds = new Set(before.map(message => message.id));
    const added = after.filter(message => !oldIds.has(message.id));
    assert.equal(added.length, delta);
    if (expectedText !== undefined) assert.equal(added[0]?.text, expectedText);
    for (const old of before) assert.ok(after.some(message => message.id === old.id));
    return added.map(message => ({ id: message.id, inputId: message.inputId, text: message.text }));
  };
  const currentProvider = async () => (await api('/api/voice')).providers.find(item => item.providerRef === providerRef);
  const dialog = () => page.getByRole('dialog');
  const close = async () => dialog().getByRole('button', { name: '关闭', exact: true }).click();
  const open = async () => { await page.getByTestId('nav-start').click(); await page.getByTestId('voice-open').click(); };
  const chat = async () => page.getByTestId('nav-conversation').click();
  const setMode = async mode => {
    await open(); await page.getByTestId('voice-settings-mode').selectOption(mode);
    await page.getByTestId('voice-settings-save-mode').click();
    await expect.poll(async () => (await api('/api/voice')).feature.finishMode).toBe(mode);
    await expect(page.getByTestId('voice-settings-notice')).toHaveText('已保存。'); await close(); await chat();
  };
  const usePeer = async peer => { await configure(peer); await reconnect(); };
  const typedSend = async text => {
    const before = await beforeUsers();
    await page.getByTestId('conversation-input').fill(text); await page.getByTestId('conversation-send').click();
    return assertDelta(before, 1, text);
  };
  const integrity = async baseline => {
    const state = await companionState();
    assert.equal(state.source, 'ready'); assert.equal(state.phase, 'live');
    assert.equal(state.connectionId, baseline.connectionId); assert.equal(state.baseUrl, baseline.baseUrl);
    assert.equal(state.snapshot?.agent.id, baseline.snapshot.agent.id); assert.ok(Array.isArray(state.pending));
    assert.equal(typeof state.configRevision, 'number'); assert.equal(typeof state.revision, 'number');
    await chat(); await expect(page.locator('#conversation-chat-status')).toContainText('已连接');
    await expect(page.getByTestId('conversation-input')).toBeEnabled();
    return { source: state.source, phase: state.phase, connectionId: state.connectionId, baseUrl: state.baseUrl,
      agentId: state.snapshot.agent.id, pending: state.pending, configRevision: state.configRevision, revision: state.revision };
  };
  report.observations.targeted = {};

  stage('targeted-native-high-voice-revision');
  const revisionPeer = await newPeer(); await usePeer(revisionPeer);
  await recording(page);
  await expect.poll(async () => (await voiceState()).revision - (await companionState()).revision,
    { timeout: 12000 }).toBeGreaterThan(10);
  const voiceHigh = await voiceState(), companionBefore = await companionState();
  await page.getByTestId('voice-cancel').click(); await idle();
  assert.equal(revisionPeer.snapshot.audioCount, 0);
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().endsWith('/console/index.html'));
    if (!window) throw new Error('Console window missing'); window.setSize(880, 600);
  });
  await open(); await page.getByTestId('voice-settings-read-catalog').click();
  await expect(page.getByTestId('voice-settings-catalog')).toContainText('读到 2 个 ASR 候选');
  await page.getByTestId('voice-settings-candidate').selectOption('xiaomi/mimo-v2.5-asr');
  await page.getByTestId('voice-settings-save').click();
  await expect(page.getByTestId('voice-settings-notice')).toHaveText('已保存。');
  const metrics = await dialog().evaluate(element => {
    const content = element.querySelector('.pk-dialog__content');
    return { dialog: { client: element.clientWidth, scroll: element.scrollWidth },
      content: content ? { client: content.clientWidth, scroll: content.scrollWidth } : null,
      viewport: window.innerWidth, document: document.documentElement.scrollWidth };
  });
  assert.ok(metrics.dialog.scroll <= metrics.dialog.client + 1, 'dialog horizontal overflow');
  assert.ok(metrics.content && metrics.content.scroll <= metrics.content.client + 1, 'dialog content horizontal overflow');
  assert.ok(metrics.document <= metrics.viewport + 1, 'page horizontal overflow');
  await shot(page, 'targeted-catalog-880x600');
  const providerBeforeDraft = await currentProvider();
  const unsaved = 'xiaomi/mimo-v2.5-asr-unsaved-draft';
  await page.getByTestId('voice-settings-model').fill(unsaved);
  await page.getByTestId('voice-settings-mode').selectOption('review');
  await page.getByTestId('voice-settings-save-mode').click();
  await expect.poll(async () => (await api('/api/voice')).feature.finishMode).toBe('review');
  await expect(page.getByTestId('voice-settings-notice')).toHaveText('已保存。');
  await expect(page.getByTestId('voice-settings-model')).toHaveValue(unsaved);
  assert.equal((await currentProvider()).settings.modelRef, providerBeforeDraft.settings.modelRef);
  assert.equal((await currentProvider()).configRevision, providerBeforeDraft.configRevision);
  // An actual concurrent provider save invalidates this open form's provider CAS baseline.
  await api('/api/voice/provider', { providerRef, expectedRevision: providerBeforeDraft.configRevision,
    settings: { ...providerBeforeDraft.settings, modelRef: '' } });
  await page.getByTestId('voice-settings-save').click();
  await expect(page.getByTestId('voice-settings-notice')).toContainText('配置已被更新');
  await expect(page.getByTestId('voice-settings-model')).toHaveValue(unsaved);
  assert.equal((await currentProvider()).settings.modelRef, '');
  await shot(page, 'targeted-provider-stale-baseline-retains-draft'); await close();
  const stateAfterSettings = await integrity(companionBefore);
  const stateMessage = await typedSend(`targeted-state-${id}`);
  report.observations.targeted.stateAndDraft = { voiceRevision: voiceHigh.revision,
    companionRevisionBefore: companionBefore.revision, stateAfterSettings, metrics, addedMessage: stateMessage };
  report.checks.push('targeted-real-native-voice-revision-exceeds-companion-settings-retain-full-state-and-dirty-provider-CAS-draft-no-overflow');
  await configure(revisionPeer); await reconnect(); await setMode('send');

  stage('targeted-native-delayed-real-stream-delivery');
  const gatePeer = await newPeer(); await usePeer(gatePeer);
  const gateBefore = await beforeUsers();
  await page.evaluate(() => { window.__voiceNativeQA.holdNextDelivery = true; });
  await page.getByTestId('voice-start').click();
  await expect.poll(async () => (await observe(page)).deliveryPending).toBe(true);
  await expect(page.getByTestId('voice-state')).toHaveText('正在准备麦克风…');
  const finish = page.getByTestId('voice-finish');
  assert.ok(await finish.count() === 0 || !(await finish.isEnabled()), 'arming must expose no usable finish');
  await expect(page.getByTestId('voice-cancel')).toBeEnabled();
  const held = await observe(page); assert.ok(held.tracks.includes('live'));
  await page.getByTestId('voice-cancel').click();
  await expect.poll(async () => (await voiceState()).phase).toBe('retiring');
  const pending = await voiceState(); assert.equal(pending.cleanup, 'pending');
  assert.equal((await observe(page)).deliveryPending, true);
  assert.ok((await observe(page)).tracks.includes('live'), 'real held stream remains live until product receives and stops it');
  await shot(page, 'targeted-cancel-awaits-real-stream-delivery');
  await page.evaluate(() => window.__voiceNativeQA.releaseDelivery()); await idle();
  assert.equal(gatePeer.snapshot.audioCount, 0); await assertDelta(gateBefore, 0);
  report.observations.targeted.delayedDelivery = { held, pending, released: await observe(page),
    scope: 'Delays delivery of a genuinely acquired synthetic-device stream; not an OS permission prompt test.' };
  report.checks.push('targeted-arming-cancel-only-real-getUserMedia-delivery-gate-honest-Main-pending-then-track-stop-ACK');

  for (const [result, text] of [['auth', '身份验证失败'], ['rate-limited', '请求过于频繁']]) {
    stage(`targeted-native-terminal-${result}`);
    const peer = await newPeer(false, result); await usePeer(peer); const before = await beforeUsers();
    await recording(page); await page.getByTestId('voice-finish').click();
    await expect(page.getByTestId('voice-error')).toContainText(text, { timeout: 15000 });
    await idle(); await assertDelta(before, 0); assert.equal(peer.snapshot.audioCount, 1);
    assert.equal((await companionState()).phase, 'live');
    await expect(page.getByTestId('conversation-input')).toBeEnabled();
    await shot(page, `targeted-terminal-${result}`);
    const added = await typedSend(`targeted-text-after-${result}-${id}`);
    report.observations.targeted[result] = { ui: text, peer: peer.snapshot, addedTextMessage: added };
    report.checks.push(`targeted-real-native-ASR-${result}-fixed-terminal-error-zero-transcript-message-text-stays-live`);
  }

  stage('targeted-native-real-20-second-auto-finish');
  const capPeer = await newPeer(); await usePeer(capPeer); await setMode('send');
  const capBefore = await beforeUsers(); const capStart = Date.now();
  await expect(page.getByTestId('voice-hint')).toContainText(/20\s*秒.*自动结束并发送/);
  await recording(page);
  await expect.poll(() => capPeer.snapshot.audioCount, { timeout: 30000 }).toBe(1);
  const capAudio = await capPeer.firstAudio; assert.equal(capAudio.samples, 320000); assert.equal(capAudio.wavBytes, 640044);
  const capAdded = await assertDelta(capBefore, 1, '受控测试转录'); await idle();
  report.observations.targeted.autoCap = { audio: capAudio, elapsedMs: Date.now() - capStart, added: capAdded };
  assert.equal(capPeer.snapshot.audioCount, 1);
  report.checks.push('targeted-real-native-20s-auto-finish-exact-320000-samples-and-one-new-message-by-ID-delta');
  await shot(page, 'targeted-real-20s-auto-finish');

  stage('targeted-native-review-edit-explicit-send');
  const reviewPeer = await newPeer(); await usePeer(reviewPeer); await setMode('review');
  const reviewBefore = await beforeUsers(); const typedDraft = `typed-review-draft-${id}`;
  await page.getByTestId('conversation-input').fill(typedDraft);
  await recording(page); await page.getByTestId('voice-finish').click();
  await expect(page.getByTestId('voice-preview')).toHaveValue('受控测试转录', { timeout: 15000 });
  await idle(); await assertDelta(reviewBefore, 0);
  await expect(page.getByTestId('conversation-input')).toHaveValue(typedDraft);
  const edited = `受控测试转录，已编辑-${id}`;
  await page.getByTestId('voice-preview').fill(edited); await shot(page, 'targeted-review-edited-not-submitted');
  await assertDelta(reviewBefore, 0); await page.getByTestId('voice-send').click();
  const reviewAdded = await assertDelta(reviewBefore, 1, edited);
  await expect(page.getByTestId('conversation-input')).toHaveValue(typedDraft);
  assert.equal(reviewPeer.snapshot.audioCount, 1);
  report.observations.targeted.review = { edited, added: reviewAdded, audio: reviewPeer.snapshot };
  report.checks.push('targeted-real-native-review-keeps-typed-draft-edit-is-unsent-until-explicit-send-one-ID-delta');
  await shot(page, 'targeted-review-explicitly-sent');
}
