import { transition } from './action-state';
import { isSatisfied } from './approval';
import { AuditService, hashEntry } from '../audit/audit.service';
import { parseKeys } from '../config';

const ap = (user: string, role: string) => ({ user, role, at: '' });

describe('state machine', () => {
  it('requires approval before execution', () => {
    expect(() => transition('PENDING_APPROVAL', 'EXECUTING')).toThrow();
    expect(transition('PENDING_APPROVAL', 'APPROVED')).toBe('APPROVED');
  });
  it('allows retry after failure but not after done', () => {
    expect(transition('FAILED', 'EXECUTING')).toBe('EXECUTING');
    expect(() => transition('DONE', 'EXECUTING')).toThrow();
    expect(transition('EXECUTING', 'ROLLED_BACK')).toBe('ROLLED_BACK');
  });
});

describe('approval satisfaction', () => {
  it('needs every required role', () => {
    expect(isSatisfied(['finops', 'secops'], [ap('a', 'secops')])).toBe(false);
    expect(isSatisfied(['finops', 'secops'], [ap('a', 'secops'), ap('b', 'finops')])).toBe(true);
  });
  it('admin covers one role only (four-eyes)', () => {
    expect(isSatisfied(['finops', 'secops'], [ap('a', 'admin')])).toBe(false);
    expect(isSatisfied(['finops', 'secops'], [ap('a', 'admin'), ap('b', 'secops')])).toBe(true);
    expect(isSatisfied(['secops'], [ap('a', 'admin')])).toBe(true);
  });
});

describe('audit chain', () => {
  it('detects tampering', async () => {
    const a = new AuditService(null);
    await a.record('u', 'e1'); await a.record('u', 'e2', 's', { x: 1 });
    expect((await a.verify()).ok).toBe(true);
    ((a as any).mem[0] as any).actor = 'mallory';
    expect(await a.verify()).toEqual({ ok: false, brokenAt: 1 });
    expect(hashEntry('p', { at: '', actor: '', event: '', data: {} })).toHaveLength(64);
  });
});

describe('config', () => {
  it('parses keys and fails closed on bad input', () => {
    expect(parseKeys('k:alice:secops')[0]).toEqual({ key: 'k', user: 'alice', role: 'secops' });
    expect(parseKeys('')).toEqual([]);
    expect(() => parseKeys('k:alice:root')).toThrow();
  });
});
