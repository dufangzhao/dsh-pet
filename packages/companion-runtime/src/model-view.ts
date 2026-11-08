import type { CompanionModelCheckView, CompanionModelView } from '@pet/contracts';
import { MAGPIE_CONNECTION } from './model-connection-types.js';

export function emptyModelCheck(configured: boolean): CompanionModelCheckView {
  return {
    state: configured ? 'configured' : 'unconfigured',
    commandId: null,
    binding: null,
    startedAt: null,
    checkedAt: null,
    elapsedMs: null,
    evidence: null,
    error: null,
  };
}

/** An explicit initial projection for the default adapter; this does not discover a gateway. */
export function createInitialModelView(
  profileRevision: number,
  credentialVersion: string,
): CompanionModelView {
  return {
    profileRevision,
    desired: { mode: 'scripted', connectorId: MAGPIE_CONNECTION },
    applied: null,
    enabled: false,
    connectors: [
      {
        id: MAGPIE_CONNECTION,
        label: 'Magpie',
        synthetic: false,
        configRevision: 1,
        settings: {
          baseUrl: 'http://127.0.0.1:3425/v1',
          model: '',
          authMode: 'local-client-id',
        },
        model: null,
        credential: {
          required: false,
          available: true,
          source: 'local-client-id',
          version: credentialVersion,
          writable: false,
        },
      },
    ],
    check: emptyModelCheck(false),
    error: null,
  };
}
