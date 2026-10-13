import { expect, test } from 'vitest';
import { auditQuery, formatDuration, pageLabel, severityOf } from './auditUtils';

test('builds a query with only the set filters and day bounds', () => {
  expect(auditQuery({}, 50, 0)).toBe('limit=50&offset=0');
  const q = new URLSearchParams(auditQuery({ event: 'action.failed', actor: ' sara ', severity: 'warning', from: '2026-09-01', to: '2026-09-02' }, 25, 50));
  expect(q.get('actor')).toBe('sara'); expect(q.get('event')).toBe('action.failed'); expect(q.get('severity')).toBe('warning');
  expect(q.get('from')).toBe('2026-09-01T00:00:00.000Z'); expect(q.get('to')).toBe('2026-09-02T23:59:59.999Z');
  expect(q.get('offset')).toBe('50');
  expect(new URLSearchParams(auditQuery({ actor: '  ', severity: '' }, 10, 0)).has('actor')).toBe(false);
});

test('formats durations', () => {
  expect(formatDuration(null)).toBe('—');
  expect(formatDuration(42)).toBe('42 s');
  expect(formatDuration(600)).toBe('10.0 min');
  expect(formatDuration(7200)).toBe('2.0 h');
});

test('severity defaults to info and page label handles empty', () => {
  expect(severityOf('action.rolled_back')).toBe('critical');
  expect(severityOf('whatever')).toBe('info');
  expect(pageLabel(0, 0, 0)).toBe('0 de 0');
  expect(pageLabel(100, 20, 120)).toBe('101–120 de 120');
});
