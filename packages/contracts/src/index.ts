/**
 * `@pet/contracts` root entry.
 *
 * Browser-safe by construction: this entry exports only types, pure constants,
 * fixed error copy and JSON Schema *data*. It must never import Node, Electron,
 * Ajv or semver, and must not run code generation on import — the executable
 * validators live in `@pet/contracts/validation`.
 *
 * The M0 prototype bridge (`pet-prototype.ts`) is re-exported unchanged.
 */

export * from './pet-prototype.js';

export * from './json.js';
export * from './ids.js';
export * from './errors.js';
export * from './patterns.js';
export * from './shared-schemas.js';
export * from './manifest.js';
export * from './permission.js';
export * from './contribution.js';
export * from './resource.js';
export * from './lifecycle.js';
export * from './capability.js';
export * from './task.js';
export * from './media.js';
export * from './control.js';
export * from './host-status.js';
export * from './console.js';
export * from './config.js';
export * from './security.js';
export * from './local-asr.js';
export * from './demo.js';
export * from './application.js';
export * from './pet-preferences.js';
export * from './presentation.js';
export * from './speech-output.js';
export * from './voice-input.js';
export * from './model-connection.js';
export * from './model-services.js';
export * from './design-lab.js';
export * from './companion.js';
export * from './companion-profile.js';
export * from './companion-memory.js';
export * from './desktop-companion.js';
export * from './audio-capture.js';
export * from './companion-voice.js';
export * from './desktop-voice.js';
export * from './companion-speech.js';
export * from './desktop-speech.js';
export * from './companion-origin.js';
export * from './companion-material.js';
export * from './companion-qq.js';
export * from './local-host.js';
export * from './local-host-process.js';
export * from './local-host-qq.js';
export * from './local-host-console.js';
export * from './desktop-local-host.js';
export type {
  ResponsesConnectionSettings,
  CompanionModelCredentialView,
  CompanionModelConnectorView,
  CompanionModelBindingView,
  CompanionModelCheckView,
  CompanionModelView,
  CompanionModelSaveCommand,
  CompanionModelCredentialCommand,
  CompanionModelTestCommand,
  CompanionModelCommandResult,
} from './companion-model.js';
