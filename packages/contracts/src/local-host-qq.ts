import type { KernelError } from './errors.js';
import type {
  QQAccountRef,
  QQExternalActor,
  QQQuoteEvidence,
  QQReplyRoute,
} from './companion-origin.js';
import type { QQFileEvidence } from './companion-qq.js';
import type { LocalHostSourceBinding, LocalHostTaskReference } from './local-host.js';
import type { LocalHostProcessIdentity } from './local-host-process.js';

export const LOCAL_AGENT_LINK_PLUGIN_ID = 'pet.local-agent-link';
export const LOCAL_AGENT_LINK_CREDENTIAL_ID = 'local-agent-bearer';
export const LOCAL_HOST_QQ_CONTROL_PATH = '/api/local-host';

/** Safe native metadata. Ephemeral handles never participate in canonical event/evidence identity. */
export interface LocalHostQQMaterial {
  readonly handle: string;
  readonly kind: 'image' | 'voice' | 'file';
  readonly quoted: boolean;
  readonly name: string | null;
  readonly reportedType: string | null;
  readonly reportedSize: number | string | null;
  readonly fileId: string | null;
  readonly expectedSha256: string | null;
}
export interface LocalHostQQInput {
  readonly eventKey: string | null;
  readonly observationId: string;
  readonly actor: QQExternalActor;
  readonly route: QQReplyRoute;
  readonly text: string;
  readonly quote: QQQuoteEvidence | null;
  readonly mentioned: boolean;
  readonly self: boolean;
  readonly machine: boolean;
  readonly contextOnly: boolean;
  readonly observedAt: number;
  readonly materials: readonly LocalHostQQMaterial[];
  readonly fileEvidence: QQFileEvidence | null;
}
export interface LocalHostQQSourceOffer {
  readonly account: QQAccountRef;
  readonly binding: LocalHostSourceBinding;
  readonly processIdentity: LocalHostProcessIdentity;
}
export interface LocalHostQQInputOffer {
  readonly source: LocalHostQQSourceOffer;
  readonly input: LocalHostQQInput;
}
export type LocalHostQQMaterialSelector =
  | { readonly kind: 'event-part'; readonly handle: string; readonly index: number }
  | {
      readonly kind: 'observed-file';
      readonly observationId: string;
      readonly evidence: QQFileEvidence;
    };
export interface LocalHostQQMaterialRead {
  readonly source: LocalHostQQSourceOffer;
  readonly inputId: string;
  readonly materialId: string;
  readonly selector: LocalHostQQMaterialSelector;
  /** Transport reference, mapped privately to real tasks at both endpoints. */
  readonly stream: LocalHostTaskReference & { readonly streamId: string };
}
export interface LocalHostQQMaterialOffer {
  readonly source: LocalHostQQSourceOffer;
  readonly inputId: string;
  readonly materialId: string;
  readonly stream: LocalHostTaskReference & { readonly streamId: string };
  readonly task: LocalHostTaskReference;
}
export interface LocalHostQQMaterialComplete {
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly cleanup: 'settled';
}

export type LocalHostQQSelection =
  | { readonly mode: 'service-local'; readonly hostId: null }
  | { readonly mode: 'remote-host'; readonly hostId: string };
export interface LocalHostQQSelectionCommand {
  readonly expectedRevision: number;
  readonly selection: LocalHostQQSelection;
}
export interface LocalHostQQView {
  readonly revision: number;
  readonly selection: LocalHostQQSelection;
  readonly phase: 'disabled' | 'waiting' | 'connected' | 'retiring' | 'failed';
  readonly peer: {
    readonly bootId: string;
    readonly sessionId: string;
    readonly packageVersion: string;
  } | null;
  readonly sources: readonly LocalHostQQSourceOffer[];
  readonly error: KernelError | null;
}
export interface LocalAgentLinkTarget {
  readonly baseUrl: string;
  readonly agentId: string;
  readonly agentEpoch: string;
}
export interface LocalAgentLinkTargetCommand extends LocalAgentLinkTarget {
  readonly expectedRevision: number;
}
export interface LocalAgentLinkCredentialCommand {
  readonly expectedRevision: number;
  readonly expectedCredentialVersion: string;
  readonly value: string | null;
}
export interface LocalAgentLinkView {
  readonly revision: number;
  readonly target: LocalAgentLinkTarget;
  readonly credentialVersion: string;
  readonly hasCredential: boolean;
  readonly phase: 'disabled' | 'offline' | 'connecting' | 'connected' | 'retiring' | 'failed';
  readonly sessionId: string | null;
  readonly error: KernelError | null;
}
