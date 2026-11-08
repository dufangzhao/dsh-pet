/** Read-only canonical identity/persona projection; never the raw host Config. */
export interface CompanionProfileView {
  readonly agentId: string;
  readonly name: string;
  readonly persona: string;
  readonly revision: number;
}
