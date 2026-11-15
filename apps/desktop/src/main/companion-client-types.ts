import type { OwnerRef, Result } from '@pet/contracts';
import type { ArtifactSaveCommit } from './companion-artifact.js';
export interface DesktopCompanionSource {
  readonly owner: OwnerRef;
  readonly digest: string;
  readonly policyEpoch: number;
  readonly configRevision: number;
  readonly baseUrl: string;
  readonly signal: AbortSignal;
}
export interface DesktopCompanionEndpointSave {
  readonly baseUrl: string;
  readonly configRevision: number;
  readonly source: Result<DesktopCompanionSource>;
}
export interface DesktopCompanionHostPort {
  readEndpoint(): Promise<Result<{ readonly baseUrl: string; readonly revision: number }>>;
  readSource(): Promise<Result<DesktopCompanionSource>>;
  saveEndpoint(
    baseUrl: string,
    expectedRevision: number,
  ): Promise<Result<DesktopCompanionEndpointSave>>;
  onConfigurationCommit(listener: (revision: number) => void): () => void;
  isCurrent(source: DesktopCompanionSource): Promise<boolean>;
  withToken<T>(
    source: DesktopCompanionSource,
    token: string,
    signal: AbortSignal,
    operation: (token: string, signal: AbortSignal) => Promise<T>,
    commit?: ArtifactSaveCommit,
  ): Promise<T>;
}
export interface DesktopArtifactDestination {
  choose(name: string, senderId: number, signal: AbortSignal): Promise<string | null>;
}
