export type ActionStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'EXECUTING' | 'DONE' | 'FAILED';

const TRANSITIONS: Record<ActionStatus, ActionStatus[]> = {
  PENDING_APPROVAL: ['APPROVED', 'REJECTED'],
  APPROVED: ['EXECUTING'],
  EXECUTING: ['DONE', 'FAILED'],
  FAILED: ['EXECUTING'], // retry
  REJECTED: [],
  DONE: [],
};

export function transition(from: ActionStatus, to: ActionStatus): ActionStatus {
  if (!TRANSITIONS[from].includes(to)) throw new Error(`Invalid transition ${from} -> ${to}`);
  return to;
}
