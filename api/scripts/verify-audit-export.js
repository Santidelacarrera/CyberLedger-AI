#!/usr/bin/env node
// Verifies the hash chain of an audit export (NDJSON from GET /audit/export) without any service running.
//   node scripts/verify-audit-export.js audit.ndjson     (or: ... < audit.ndjson)
// Exit code 0 = intact, 1 = tampered/broken, 2 = usage error.
const { createHash } = require('crypto');
const { readFileSync } = require('fs');

const canonical = (v) =>
  Array.isArray(v) ? v.map(canonical)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v;
const hashEntry = (prev, e) =>
  createHash('sha256').update(JSON.stringify([prev, e.at, e.actor, e.event, e.subject ?? null, canonical(e.data)])).digest('hex');

function verify(text) {
  let prev = 'GENESIS', n = 0;
  for (const line of text.split('\n').filter(Boolean)) {
    const e = JSON.parse(line);
    n++;
    if (e.prevHash !== prev || e.hash !== hashEntry(prev, e)) return { ok: false, brokenAt: e.seq, checked: n };
    prev = e.hash;
  }
  return { ok: true, checked: n };
}

module.exports = { verify };
if (require.main === module) {
  try {
    const r = verify(readFileSync(process.argv[2] ?? 0, 'utf8'));
    console.log(JSON.stringify(r));
    process.exit(r.ok ? 0 : 1);
  } catch (e) { console.error(`error: ${e.message}`); process.exit(2); }
}
