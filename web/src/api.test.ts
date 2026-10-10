import { expect, test } from 'vitest';
import { authHeader } from './api';

test('JWT goes as Bearer, other keys as x-api-key', () => {
  expect(authHeader({ baseUrl: '', apiKey: 'a.b.c' })).toEqual({ authorization: 'Bearer a.b.c' });
  expect(authHeader({ baseUrl: '', apiKey: 'dev-secops' })).toEqual({ 'x-api-key': 'dev-secops' });
});
