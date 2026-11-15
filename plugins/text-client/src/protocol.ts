/** Native/browser wire reuse without React, DOM actions or plugin activation. */
export * from './client/protocol.js';
export * from './client/guards.js';
export * from './client/sse.js';
export * from './client/voice-protocol.js';
export * from './client/voice-guards.js';
export * from './client/speech-protocol.js';
export * from './client/speech-guards.js';
export * from './client/local-host-protocol.js';
export { isActive, isTerminal, taskStatusView } from './client/state.js';
