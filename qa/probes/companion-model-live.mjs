import { fork, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';

// Deliberately not *.test: normal QA never calls a real model.
const OPT_IN = 'PET_COMPANION_LIVE_MAGPIE';
const GATEWAY = 'http://127.0.0.1:3425/v1';
const MODEL = 'codex/gpt-6.1-sol';
const IMAGE = '1panel/deepseek-harness:0.2.0-rc.2';
const MAX_CALLS = 8;
const WINDOW_MS = 180000;
const worker = process.argv.includes('--worker');
const safeName = (value) => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(value) ? value : null;

if (process.env[OPT_IN] !== '1') {
  console.log(`Not run: explicit ${OPT_IN}=1 and a fresh bounded real-call authorization are required.`);
} else if (!worker) {
  const startedAt = Date.now();
  // Native/Core error logging may contain private upstream details. No raw stdout/stderr is retained
  // or forwarded; only this probe's allowlisted IPC report leaves the worker.
  const child = fork(fileURLToPath(import.meta.url), ['--worker'], {
    execArgv: ['--import', 'tsx'],
    env: { ...process.env, PET_COMPANION_LIVE_STARTED_AT: String(startedAt) },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  let report;
  child.on('message', (value) => { if (value?.kind === 'companion-a2-report') report = value.report; });
  const watchdog = setTimeout(() => child.kill('SIGTERM'), WINDOW_MS + 20000);
  const hardStop = setTimeout(() => child.kill('SIGKILL'), WINDOW_MS + 30000);
  const outcome = await new Promise((resolve) => {
    child.once('error', () => resolve({ code: null, spawnFailed: true }));
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(watchdog);
  clearTimeout(hardStop);
  console.log(JSON.stringify(report ?? { a2Passed: false, failure: 'worker-report-unavailable', outcome }, null, 2));
  process.exitCode = report?.a2Passed && outcome.code === 0 ? 0 : 1;
} else {
  const report = await run().catch((error) => ({ a2Passed: false, failure: 'probe-setup-failed', errorType: safeName(error?.name) }));
  if (process.send) await new Promise((resolve) => process.send({ kind: 'companion-a2-report', report }, () => resolve()));
  process.disconnect?.();
  process.exitCode = report.a2Passed ? 0 : 1;
}

async function run() {
  const { createCompanionService } = await import('../../apps/companion-service/src/service.ts');
  const { MAGPIE_CONNECTION } = await import('../../packages/companion-runtime/src/index.ts');
  const { cleanupContainers } = await import('../fixtures/companion-service/helpers.mjs');
  const execute = promisify(execFile);
  const startedAt = Number(process.env.PET_COMPANION_LIVE_STARTED_AT);
  const deadline = startedAt + WINDOW_MS;
  const directory = await mkdtemp(path.join(tmpdir(), 'companion-real-a2-'));
  const profile = path.join(directory, 'profile');
  await mkdir(profile, { mode: 0o700 });
  const token = randomUUID() + randomUUID();
  const report = {
    level: 'real-magpie-cortico-docker', gateway: GATEWAY, model: MODEL, authSource: 'local-client-id',
    startedAt, maxNativeGenerations: MAX_CALLS, windowMs: WINDOW_MS, directory,
    nativeGenerations: [], toolReceipts: [], memory: null, conversation: null, primary: null, interactionB: null,
    artifacts: [], optionalCancellation: { attempted: false, reason: 'not-yet-evaluated' },
    a2Passed: false, failure: null, cleanup: { serviceClosed: false, ownedContainersAbsent: false },
  };
  let service;
  let nativeCalls = 0;
  let pendingNative = 0;
  let stopReason = null;
  let closing = false;
  let primaryId = null;
  let bInputId = null;
  let bMarker = null;
  let bObserved = null;
  const callNames = new Map();
  const trip = (reason) => { stopReason ??= reason; };
  const timer = setTimeout(() => trip('overall-window-exhausted'), Math.max(1, deadline - Date.now()));
  const check = () => { if (stopReason || Date.now() >= deadline) throw new Error(stopReason ?? 'overall-window-exhausted'); };
  const snapshot = () => service.runtime.snapshot();
  async function waitFor(predicate, stage) {
    for (;;) {
      const state = await snapshot();
      if (state.agent.status === 'unavailable') throw new Error(`${stage}-agent-unavailable`);
      const found = predicate(state);
      if (found) return found;
      check();
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  const parseOutput = (output) => {
    const text = typeof output === 'string' ? output : Array.isArray(output)
      ? output.filter((item) => typeof item?.text === 'string').map((item) => item.text).join('') : null;
    if (!text) return null;
    try { return JSON.parse(text); } catch { return null; }
  };
  try {
    const image = await execute('docker', ['image', 'inspect', IMAGE, '--format', '{{.Id}}']);
    report.image = IMAGE;
    report.imageId = image.stdout.trim();
    check();
    service = await createCompanionService({ dataDirectory: profile, token, port: 0, image: IMAGE,
      mode: 'scripted', modelBaseUrl: GATEWAY, model: MODEL });
    const registration = service.models.connections.registration(MAGPIE_CONNECTION);
    const originalFactory = registration.connection.nativeProvider;
    if (typeof originalFactory !== 'function') throw new Error('default-native-factory-unavailable');
    registration.connection.nativeProvider = (baseUrl, apiKey) => {
      if (baseUrl !== GATEWAY || apiKey !== 'magpie-dsh-pet') throw new Error('unexpected-connection-target');
      const native = originalFactory(baseUrl, apiKey);
      return { async respond(request, options) {
        if (closing || stopReason || Date.now() >= deadline || nativeCalls >= MAX_CALLS) {
          trip('native-generation-budget-or-window-exhausted');
          throw new Error('native-generation-admission-stopped');
        }
        if (request.model !== MODEL) { trip('unexpected-model'); throw new Error('unexpected-model'); }
        const entry = { ordinal: ++nativeCalls, startedAt: Date.now(), finishedAt: null,
          requestedOutputTokens: request.max_output_tokens ?? null, attempts: [], tools: [] };
        report.nativeGenerations.push(entry);
        pendingNative++;
        for (const item of request.input ?? []) {
          if (item.type !== 'function_call_output') continue;
          const receipt = parseOutput(item.output);
          const name = callNames.get(item.call_id);
          if (name && receipt && ['accepted', 'duplicate'].includes(receipt.status) && typeof receipt.commandId === 'string') {
            const publicReceipt = { name, commandId: receipt.commandId, status: receipt.status,
              taskId: typeof receipt.taskId === 'string' ? receipt.taskId : null,
              messageId: typeof receipt.messageId === 'string' ? receipt.messageId : null };
            if (!report.toolReceipts.some((known) => known.commandId === publicReceipt.commandId)) report.toolReceipts.push(publicReceipt);
          }
        }
        if (bMarker && !bObserved && JSON.stringify(request.input ?? []).includes(bMarker)) {
          const task = primaryId ? await service.runtime.state('getTask', { id: primaryId }) : null;
          bObserved = { firstNativeGeneration: entry.ordinal, observedAt: Date.now(),
            taskStatus: task?.status ?? null, inputId: bInputId };
        }
        try {
          // Preserve the original request/options/result/error references and authority path.
          const generation = await native.respond(request, options);
          entry.attempts = generation.attempts.map((attempt) => ({ status: attempt.status ?? null,
            outcome: safeName(attempt.outcome), purpose: safeName(attempt.purpose) }));
          for (const item of generation.response.output ?? []) {
            if (item.type === 'function_call') { callNames.set(item.call_id, item.name); entry.tools.push(safeName(item.name)); }
          }
          return generation;
        } catch (error) {
          entry.errorType = safeName(error?.name);
          entry.causeType = safeName(error?.cause?.name);
          entry.attempts = (error?.attempts ?? []).map((attempt) => ({ status: attempt.status ?? null, outcome: safeName(attempt.outcome) }));
          if (!closing) trip('native-generation-failed');
          throw error;
        } finally {
          pendingNative--;
          entry.finishedAt = Date.now();
          if (entry.ordinal === MAX_CALLS && !closing) trip('native-generation-budget-reached');
        }
      } };
    };
    const initialView = await service.models.view();
    const source = initialView.connectors.find((item) => item.id === MAGPIE_CONNECTION);
    const applied = await service.models.save({ commandId: randomUUID(), connectorId: MAGPIE_CONNECTION,
      expectedProfileRevision: initialView.profileRevision, expectedConfigRevision: source.configRevision, mode: 'model' });
    if (!applied.view.enabled || nativeCalls) throw new Error('model-activation-not-ready-or-called-unexpectedly');
    const identity = (await snapshot()).agent.id;
    const remember = await service.runtime.message({ commandId: randomUUID(),
      text: '请记住我的明确偏好：回答简短。可保存为 answer-style=回答简短。现在用一句简短中文向我确认。' });
    const preference = await waitFor((state) => {
      const fact = state.facts.find((item) => item.value.includes('回答简短'));
      const reply = state.messages.find((item) => item.role === 'assistant' && item.inputId === remember.messageId);
      return fact && reply ? { fact, reply } : null;
    }, 'preference');
    report.memory = { key: preference.fact.key, value: preference.fact.value.slice(0, 200), revision: preference.fact.revision };
    report.conversation = { inputId: remember.messageId, assistant: preference.reply.text.slice(0, 400) };
    check();
    const before = new Set((await snapshot()).tasks.map((item) => item.id));
    const requestA = await service.runtime.message({ commandId: randomUUID(), text:
      '请通过 start_work 真正生成两个UTF-8文件，工具code必须是Node ES module、不是shell。数据A=12、B=8、C=5，请代码计算总和25。' +
      '代码开始后先用Promise等待12秒，让我测试后台执行时继续交流；然后写items.csv，表头item,amount，依次四行A,12 / B,8 / C,5 / TOTAL,25（每行换行）；' +
      '写summary.md说明三项和Total: 25。声明这两个输出，任务timeoutMs=30000。受理后简短告知，不要等待执行结束，不要追加其它任务。' });
    const running = await waitFor((state) => {
      const task = state.tasks.find((item) => !before.has(item.id));
      if (task && ['failed', 'cancelled', 'unknown', 'interrupted'].includes(task.status)) throw new Error('primary-task-failed-before-interaction');
      const receipt = task && report.toolReceipts.find((item) => item.name === 'start_work' && item.taskId === task.id);
      return task?.status === 'running' && receipt ? { task, receipt } : null;
    }, 'primary-admission');
    primaryId = running.task.id;
    report.primary = { inputId: requestA.messageId, taskId: primaryId, executionId: running.task.executionId,
      admissionReceipt: running.receipt, runningObservedAt: Date.now() };
    bMarker = `LIVE_B_${randomUUID()}`;
    const requestB = await service.runtime.message({ commandId: randomUUID(), text:
      `任务进行中我也要继续交流。请现在简短确认“我现在能继续交流”，不要等文件任务完成。验收标记${bMarker}。` });
    bInputId = requestB.messageId;
    const bReply = await waitFor((state) => state.messages.find((item) => item.role === 'assistant' && item.inputId === requestB.messageId), 'input-b');
    const afterB = await service.runtime.state('getTask', { id: primaryId });
    report.interactionB = { inputId: requestB.messageId, assistant: bReply.text.slice(0, 400), publishedAt: bReply.createdAt,
      taskStatusAtReplyObservation: afterB.status, nativeObservation: bObserved };
    if (!bObserved || bObserved.taskStatus !== 'running' || afterB.status !== 'running') throw new Error('input-b-waited-for-task-completion');
    const current = await snapshot();
    if (MAX_CALLS - nativeCalls >= 4 && pendingNative === 0 && current.agent.status === 'ready' && Date.now() + 40000 < deadline) {
      const prior = new Set(current.tasks.map((item) => item.id));
      report.optionalCancellation = { attempted: true };
      await service.runtime.message({ commandId: randomUUID(), text:
        '另开一个独立start_work任务，Node ES module先等20秒再写cancelled.txt，timeoutMs=30000；仅此一个新任务，不操作已有任务。' });
      const second = await waitFor((state) => state.tasks.find((item) => !prior.has(item.id) && item.status === 'running'), 'optional-admission');
      const untouchedBefore = await service.runtime.state('getTask', { id: primaryId });
      await service.runtime.stopTask(second.id, randomUUID());
      const cancelled = await waitFor((state) => {
        const task = state.tasks.find((item) => item.id === second.id);
        if (task && ['completed', 'failed', 'unknown'].includes(task.status)) throw new Error('optional-stop-not-confirmed');
        return task?.status === 'cancelled' ? task : null;
      }, 'optional-stop');
      const untouchedAfter = await service.runtime.state('getTask', { id: primaryId });
      if (['cancelled', 'cancel-requested'].includes(untouchedAfter.status)) throw new Error('unrelated-primary-cancelled');
      report.optionalCancellation = { attempted: true, taskId: second.id, status: cancelled.status,
        unrelatedBefore: untouchedBefore.status, unrelatedAfter: untouchedAfter.status };
    } else report.optionalCancellation = { attempted: false, reason: 'insufficient-settled-native-budget-for-optional-task-and-result-rounds',
      callsUsed: nativeCalls, pendingNative, existingEvidence: 'qa/companion-acceptance.md + companion-service Docker integration gates' };
    const done = await waitFor((state) => {
      const task = state.tasks.find((item) => item.id === primaryId);
      if (task && ['failed', 'cancelled', 'interrupted', 'unknown'].includes(task.status)) throw new Error('primary-task-not-completed');
      return task?.status === 'completed' ? task : null;
    }, 'primary-completion');
    if (done.exitCode !== 0 || done.executionId !== running.task.executionId) throw new Error('primary-exit-or-correlation-invalid');
    const files = new Map();
    for (const name of ['summary.md', 'items.csv']) {
      const artifact = done.artifacts.find((item) => item.name === name);
      if (!artifact) throw new Error('required-artifact-missing');
      const response = await fetch(`${service.url}/api/artifacts/${encodeURIComponent(artifact.id)}`, {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error('artifact-download-failed');
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length !== artifact.sizeBytes || bytes.length > 4096) throw new Error('artifact-size-invalid');
      const text = bytes.toString('utf8');
      files.set(name, text);
      report.artifacts.push({ name, artifactId: artifact.id, taskId: artifact.taskId, sizeBytes: artifact.sizeBytes,
        downloadedBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), text });
    }
    const rows = files.get('items.csv').replace(/^\uFEFF/, '').trim().split(/\r?\n/).map((line) => line.split(',').map((field) => field.trim().replace(/^"|"$/g, '')));
    const data = new Map(rows.slice(1).map(([name, amount]) => [name.toUpperCase(), Number(amount)]));
    if (rows.length !== 5 || data.get('A') !== 12 || data.get('B') !== 8 || data.get('C') !== 5 || data.get('TOTAL') !== 25 ||
        data.get('A') + data.get('B') + data.get('C') !== 25 || !files.get('summary.md').includes('25')) throw new Error('artifact-data-or-total-invalid');
    const final = await snapshot();
    if (final.agent.id !== identity || !final.facts.some((item) => item.value.includes('回答简短'))) throw new Error('identity-or-preference-lost');
    report.primary = { ...report.primary, status: done.status, exitCode: done.exitCode, completedAt: done.updatedAt,
      identityPreserved: true, total: 25, realModelToolReceipt: true };
    report.a2Passed = true;
  } catch (error) {
    report.failure = { stage: stopReason ?? 'acceptance-assertion', errorType: safeName(error?.name),
      code: typeof error?.message === 'string' && /^[a-z0-9-]{1,100}$/.test(error.message) ? error.message : 'non-public-error' };
    try {
      const state = service ? await snapshot() : null;
      if (state) report.lastPublicState = { agentStatus: state.agent.status, agentError: state.agent.error?.code ?? null,
        tasks: state.tasks.map((item) => ({ id: item.id, status: item.status, exitCode: item.exitCode, error: item.error?.code ?? null })) };
    } catch { /* A failed provider/store must not trigger another model call just to report. */ }
  } finally {
    closing = true;
    clearTimeout(timer);
    try { await service?.close(); report.cleanup.serviceClosed = true; }
    catch { report.cleanup.serviceClosed = false; report.a2Passed = false; }
    try { await cleanupContainers(profile); report.cleanup.ownedContainersAbsent = true; }
    catch { report.cleanup.ownedContainersAbsent = false; report.a2Passed = false; }
    report.nativeGenerationCalls = nativeCalls;
    report.stopReason = stopReason;
    report.finishedAt = Date.now();
    report.elapsedMs = report.finishedAt - startedAt;
    await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
    report.reportPath = path.join(directory, 'report.json');
  }
  return report;
}
