export type ActionStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'EXECUTING' | 'DONE' | 'FAILED' | 'ROLLED_BACK';

const TRANSITIONS: Record<ActionStatus, ActionStatus[]> = {
  PENDING_APPROVAL: ['APPROVED', 'REJECTED'],
  APPROVED: ['EXECUTING'],
  EXECUTING: ['DONE', 'FAILED', 'ROLLED_BACK'],
  FAILED: ['EXECUTING', 'ROLLED_BACK'], // retry or give up
  REJECTED: [],
  DONE: [],
  ROLLED_BACK: [],
};

export function transition(from: ActionStatus, to: ActionStatus): ActionStatus {
  if (!TRANSITIONS[from].includes(to)) throw new Error(`Invalid transition ${from} -> ${to}`);
  return to;
}
