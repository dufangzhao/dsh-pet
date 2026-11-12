// Read-only observation around real WebAudio. Never creates a substitute context or sends ACKs.
export function installSpeechObservers() {
  const qa = window.__speechQA = { contexts: [], playbacks: {}, events: [], activeNodes: new Set(),
    peakNodes: 0, scheduledFrames: 0, endedFrames: 0, starts: 0, stops: 0, current: null, errors: [], truncated: false, droppedEvents: 0 };
  const event = (kind, detail = {}) => {
    if (qa.events.length < 6000) qa.events.push({ kind, at: Date.now(), ...detail });
    else { qa.truncated = true; qa.droppedEvents++; }
  };
  const Base = window.AudioContext;
  window.AudioContext = class extends Base {
    constructor(...args) {
      super(...args);
      const context = this, id = qa.contexts.length;
      const entry = { id, playbackId: qa.current, rate: this.sampleRate, state: this.state, closed: false };
      qa.contexts.push(entry); event('context-created', { id, playbackId: entry.playbackId, rate: this.sampleRate });
      this.addEventListener('statechange', () => { entry.state = context.state; });
      const resume = this.resume.bind(this);
      this.resume = async () => { await resume(); entry.state = context.state; event('context-resumed', { id, state: context.state }); };
      const close = this.close.bind(this);
      this.close = async () => { try { await close(); entry.state = context.state; entry.closed = true; event('context-closed', { id, state: context.state }); } catch (error) { qa.errors.push({ kind: 'context-close-failed', name: error.name }); throw error; } };
      const create = this.createBufferSource.bind(this);
      this.createBufferSource = () => {
        const node = create(); let stopped = false, frames = 0;
        const start = node.start.bind(node), stop = node.stop.bind(node);
        node.start = (...params) => {
          frames = node.buffer?.length ?? 0;
          const rate = node.buffer?.sampleRate ?? null;
          start(...params); qa.activeNodes.add(node); qa.starts++; qa.scheduledFrames += frames;
          qa.peakNodes = Math.max(qa.peakNodes, qa.activeNodes.size);
          const playback = qa.playbacks[entry.playbackId]; if (playback) playback.scheduledFrames += frames;
          event('node-start', { contextId: id, playbackId: entry.playbackId, frames, bufferRate: rate, active: qa.activeNodes.size });
        };
        node.stop = (...params) => { const result = stop(...params); stopped = true; qa.stops++; qa.activeNodes.delete(node); event('node-stop', { contextId: id, playbackId: entry.playbackId }); return result; };
        node.addEventListener('ended', () => {
          qa.activeNodes.delete(node);
          if (!stopped) { qa.endedFrames += frames; const playback = qa.playbacks[entry.playbackId]; if (playback) playback.endedFrames += frames; }
          event('node-ended', { contextId: id, playbackId: entry.playbackId, frames, stopped, active: qa.activeNodes.size });
        });
        return node;
      };
    }
  };
  const bridge = window.petSharedSpeech;
  if (bridge) {
    bridge.onChanged(async () => { const result = await bridge.getState(); if (result.ok) event('speech-state', { state: result.value }); });
    bridge.onAudio((value, payload) => {
      if (value.kind === 'start') {
        qa.current = value.playbackId;
        qa.playbacks[value.playbackId] = { identity: value, bytes: 0, receivedFrames: 0, scheduledFrames: 0,
          endedFrames: 0, maxChunkBytes: 0, sequence: value.sequence, sequenceErrors: 0, priorChunkNotScheduled: 0, terminal: null, stopped: false };
      }
      const playback = qa.playbacks[value.playbackId];
      if (!playback) { qa.errors.push({ kind: 'unobserved-start', playbackId: value.playbackId }); return; }
      if (value.kind === 'chunk') {
        if (value.sequence !== playback.sequence + 1) playback.sequenceErrors++;
        if (playback.scheduledFrames < playback.receivedFrames) playback.priorChunkNotScheduled++;
        playback.sequence = value.sequence; playback.bytes += payload?.byteLength ?? 0;
        playback.receivedFrames += (payload?.byteLength ?? 0) / 2;
        playback.maxChunkBytes = Math.max(playback.maxChunkBytes, payload?.byteLength ?? 0);
      } else if (value.kind === 'end') playback.terminal = value.terminal;
      else if (value.kind === 'stop') playback.stopped = true;
      event('audio-event', { eventKind: value.kind, playbackId: value.playbackId, utteranceId: value.utteranceId,
        segmentIndex: value.segmentIndex, sequence: value.sequence, byteLength: payload?.byteLength ?? 0 });
    });
  }
}
export function readSpeechObservations() {
  const qa = window.__speechQA;
  return { contexts: qa.contexts, playbacks: qa.playbacks, events: qa.events, activeNodes: qa.activeNodes.size,
    peakNodes: qa.peakNodes, scheduledFrames: qa.scheduledFrames, endedFrames: qa.endedFrames,
    starts: qa.starts, stops: qa.stops, errors: qa.errors, truncated: qa.truncated, droppedEvents: qa.droppedEvents };
}
