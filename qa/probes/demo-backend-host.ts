import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DEMO_PLUGIN_IDS as ID } from '../../packages/contracts/src/index.js';
import { DesktopHost } from '../../apps/desktop/src/main/desktop-host.js';
import { DemoController } from '../../apps/desktop/src/main/demo-controller.js';
import { demoReadiness } from '../../apps/desktop/src/main/demo-readiness.js';
import { decodePcm16Wave } from '../../packages/host-kernel/src/experiments/wave-pcm.js';
const root = path.resolve(__dirname, '../..');
void (async () => {
  let demo: DemoController | undefined;
  const phases = new Set<string>();
  const host = await DesktopHost.create({
    executable: process.execPath,
    workerEntry: path.join(root, 'apps/desktop/dist/runtime/worker.cjs'),
    builtinDirectory: path.join(root, 'plugins'),
    userDirectory: path.join(__dirname, 'profile/plugins'),
    adapters: demoReadiness(path.join(root, '.cache/asr-models')),
    media: {
      input: (ref, writer) => (demo ? demo.input(ref, writer) : writer.cancel()),
      output: (ref, reader) => (demo ? demo.output(ref, reader) : reader.cancel()),
      capabilityTask: (parent, child, capability, method) =>
        demo?.capabilityTask(parent, child, capability, method),
    },
  });
  try {
    await host.driver.ready();
    demo = await DemoController.create(host, path.join(root, '.cache/asr-models'), () => {
      void demo?.snapshot().then((snapshot) => phases.add(snapshot.phase));
    });
    const model = 'sensevoice-small-int8';
    const config = await host.configs.save(
      { pluginId: ID.asr, instanceId: 'default' },
      { model },
      0,
    );
    if (!config.ok) throw new Error('ASR first config: ' + config.error.code);
    for (const pluginId of [ID.asr, ID.demo, ID.voice, ID.avatar]) {
      const entry = host.manager.get({ pluginId, instanceId: 'default' });
      if (!entry) throw new Error('Missing real plugin: ' + pluginId);
      const source = host.describeTrust(entry.owner);
      if (
        !source ||
        !host.permissionControl.confirmTrust(
          { pluginId, instanceId: 'default' },
          source.digest,
          true,
        )
      )
        throw new Error('Fixture trust failed');
      host.permissionControl.setPreset({ pluginId, instanceId: 'default' }, 'local');
      const saved = await host.configs.get({ pluginId, instanceId: 'default' });
      if (!saved.ok) throw new Error('Plugin config missing');
      const enabled = await host.manager.enable(
        { pluginId, instanceId: 'default' },
        saved.value.data,
      );
      if (!enabled.ok || enabled.value.state !== 'active')
        throw new Error('Plugin enable failed: ' + pluginId + ':' + JSON.stringify(enabled));
    }
    const ticket = await demo.beginRecording(42);
    if (!ticket.ok) throw new Error('Record prepare failed: ' + ticket.error.code);
    if (!demo.microphoneAllowed(42) || demo.microphoneAllowed(43))
      throw new Error('Mic frame scope failed');
    const ready = demo.captureReady(ticket.value.token, 42, 16000);
    if (!ready.ok) throw new Error('Capture ready failed');
    const raw = await fs.readFile(path.join(root, '.cache/asr-models', model, 'test_wavs/zh.wav'));
    const sha = createHash('sha1')
      .update(Buffer.from('blob ' + raw.byteLength + String.fromCharCode(0)))
      .update(raw)
      .digest('hex');
    if (sha !== '24a2bfc5c039f9d97db2cf1f2461699b582e0a90')
      throw new Error('Public sample changed');
    const samples = decodePcm16Wave(raw).samples;
    let sequence = 0;
    for (let offset = 0; offset < samples.length; offset += 1600) {
      const bytes = new Uint8Array(
        new Float32Array(samples.subarray(offset, offset + 1600)).buffer,
      );
      const sent = demo.pushAudio(ticket.value.token, 42, sequence++, bytes);
      if (!sent.ok) throw new Error('PCM rejected');
    }
    const ended = demo.finishRecording(ticket.value.token, 42, sequence);
    if (!ended.ok) throw new Error('Capture end failed');
    const wait = async (count: number) => {
      const limit = performance.now() + 30000;
      while (performance.now() < limit) {
        const state = await demo!.snapshot();
        if (state.phase === 'error') throw new Error('Demo failed: ' + JSON.stringify(state.error));
        if (state.phase === 'idle' && state.messages.length >= count) return state;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error('Demo timed out: ' + JSON.stringify(host.tasks.diagnostics()));
    };
    const voice = await wait(2);
    if (!voice.messages[1]!.text.includes('脚本，不是 AI'))
      throw new Error('Offline reply must be honest');
    const sent = await demo.sendText('你好');
    if (!sent.ok) throw new Error('Text send failed');
    const text = await wait(4);
    const report = {
      status: 'passed',
      electron: process.versions.electron,
      node: process.versions.node,
      realPlugins: [ID.asr, ID.demo, ID.voice, ID.avatar],
      publicPcmSeconds: samples.length / 16000,
      voiceCharacters: [...voice.messages[0]!.text].length,
      replyMode: text.settings.replyMode,
      messages: text.messages.length,
      phases: [...phases],
      micLeaseReleased: !demo.microphoneAllowed(42),
      permissions: host.permissions.diagnostics(),
      auditRecords: host.permissionControl.snapshotAudit().total,
      pendingWork: host.tasks.diagnostics().pendingWork,
    };
    demo.close();
    const shutdown = await host.shutdown();
    process.send?.({ ...report, shutdown });
  } catch (error) {
    demo?.close();
    await host.shutdown();
    throw error;
  }
})()
  .catch((error) => {
    process.send?.({ status: 'failed', failure: String(error?.message ?? 'failed') });
    process.exitCode = 1;
  })
  .finally(() => {
    if (process.connected) process.disconnect();
  });
