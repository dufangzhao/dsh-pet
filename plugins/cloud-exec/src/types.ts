import type { KernelError } from '@pet/contracts';

export type CloudExecutionRequest = {
  executionId?: string;
  code: string;
  files?: Array<{ path: string; content: string }>;
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
