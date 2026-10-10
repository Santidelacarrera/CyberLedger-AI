import { transition } from './action-state';

describe('action state machine', () => {
  it('requires approval before execution', () => {
    expect(() => transition('PENDING_APPROVAL', 'EXECUTING')).toThrow();
    expect(transition('PENDING_APPROVAL', 'APPROVED')).toBe('APPROVED');
  });
  it('allows retry after failure but not after done', () => {
    expect(transition('FAILED', 'EXECUTING')).toBe('EXECUTING');
    expect(() => transition('DONE', 'EXECUTING')).toThrow();
  });
});
