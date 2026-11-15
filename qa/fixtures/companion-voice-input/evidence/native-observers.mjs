// QA-only observation: every device/context/worklet method delegates to the real browser method.
export function installCaptureObservers() {
  const qa = window.__voiceNativeQA = { events: [], streams: [], contexts: [], nodes: [], frames: [], calls: 0, holdNextDelivery: false, deliveryPending: false, releaseDelivery: null };
  const event = (kind, extra = {}) => qa.events.push({ kind, at: Date.now(), ...extra });
  const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (...args) => {
    qa.calls++; event('getUserMedia-called');
    const holdDelivery = qa.holdNextDelivery;
    qa.holdNextDelivery = false;
    try {
      const stream = await original(...args); qa.streams.push(stream); event('getUserMedia-granted');
      for (const track of stream.getTracks()) {
        const stop = track.stop.bind(track);
        track.stop = () => { stop(); event('track-stopped', { state: track.readyState }); };
      }
      if (holdDelivery) {
        await new Promise(resolve => {
          qa.deliveryPending = true;
          qa.releaseDelivery = () => { qa.deliveryPending = false; qa.releaseDelivery = null; event('real-stream-delivery-resumed'); resolve(); };
          event('real-stream-delivery-held');
        });
      }
      return stream;
    } catch (error) { event('getUserMedia-denied', { name: error.name, message: String(error.message).slice(0, 200) }); throw error; }
  };
  const Context = window.AudioContext;
  window.AudioContext = class extends Context {
    constructor(...args) {
      super(...args); qa.contexts.push(this); event('context-created', { rate: this.sampleRate });
      const close = this.close.bind(this);
      this.close = async () => { await close(); event('context-closed', { state: this.state }); };
      const add = this.audioWorklet.addModule.bind(this.audioWorklet);
      this.audioWorklet.addModule = async (...params) => { await add(...params); event('worklet-module-loaded', { url: String(params[0]) }); };
    }
  };
  const Worklet = window.AudioWorkletNode;
  window.AudioWorkletNode = class extends Worklet {
    constructor(...args) {
      super(...args); qa.nodes.push(this); event('worklet-created');
      this.port.addEventListener('message', ({ data }) => {
        if (data instanceof Float32Array) { qa.frames.push(data.length); event('worklet-frame', { samples: data.length }); }
        else event('worklet-marker', { marker: data });
      });
      const post = this.port.postMessage.bind(this.port);
      this.port.postMessage = (...params) => { event('worklet-command', { command: params[0] }); return post(...params); };
      const close = this.port.close.bind(this.port);
      this.port.close = () => { close(); event('worklet-port-closed'); };
    }
  };
}
export function readCaptureObservations() {
  const qa = window.__voiceNativeQA;
  return { events: qa.events, frames: qa.frames, calls: qa.calls, deliveryPending: qa.deliveryPending,
    tracks: qa.streams.flatMap(stream => stream.getTracks().map(track => track.readyState)),
    contexts: qa.contexts.map(context => context.state) };
}
