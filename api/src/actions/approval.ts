import { Approval } from './actions.repo';

/** True when approvals cover every required role. `admin` is a wildcard covering one role.
 *  Approvers are distinct users (enforced on insert), so a dual-control action needs one person per role. */
export function isSatisfied(required: string[], approvals: Approval[]): boolean {
  const open = new Set(required);
  const ordered = [...approvals].sort((a) => (a.role === 'admin' ? 1 : -1)); // specific roles first
  for (const a of ordered) {
    if (open.has(a.role)) open.delete(a.role);
    else if (a.role === 'admin' && open.size) open.delete([...open][0]);
  }
  return open.size === 0;
}
