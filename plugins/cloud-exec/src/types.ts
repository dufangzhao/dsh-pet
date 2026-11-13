import type { CompanionMaterialSelection, KernelError, Result } from '@pet/contracts';
import type { PluginTask } from '@pet/plugin-sdk';

/** Host-private source; locators and binary bytes never enter capability JSON. */
export type CloudMaterialSource = {
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly chunks: AsyncIterable<Uint8Array>;
  /** Revalidate captured participant/audience authority, including after asynchronous reads. */
  check(): Promise<void>;
};

export type CloudMaterialReadRequest = {
  readonly task: PluginTask;
  readonly executionId: string;
  readonly selection: CompanionMaterialSelection;
};

/**
 * Bind to the existing ActiveWork handle, not merely a caller-supplied executionId.
 * Own/close the source, call and await consume exactly once, and settle on task.signal.
 */
export type CloudMaterialReader = (
  request: CloudMaterialReadRequest,
  consume: (source: CloudMaterialSource) => Promise<void>,
) => Promise<Result<null>>;

export type CloudExecutionRequest = {
  executionId?: string;
  code: string;
  files?: Array<{ path: string; content: string }>;
  materials?: CompanionMaterialSelection[];
  outputs?: Array<{ path: string; mediaType?: string }>;
  timeoutMs?: number;
};

export type CloudExecutionArtifact = {
  path: string;
  relativePath: string;
  mediaType: string;
  sizeBytes: number;
};

export type CloudExecutionResult = {
  jobId: string;
  status: 'exited' | 'cancelled' | 'timed-out' | 'unknown';
  exitCode: number | null;
  stdout: string;
  stderr: string;
  logsTruncated: boolean;
  settled: boolean;
  artifacts: CloudExecutionArtifact[];
  error: KernelError | null;
};

export type CloudReconcileRequest = { after?: string; limit?: number };

export type CloudReconcileResult = {
  receipts: Array<{ executionId: string; result: CloudExecutionResult }>;
  nextCursor: string | null;
};

export type CloudExecConfig = {
  image: string;
  workspaceDirectory: string;
  timeoutMs: number;
  maxLogBytes: number;
  maxArtifactBytes: number;
  memoryMb: number;
  cpus: number;
  pidsLimit: number;
};
