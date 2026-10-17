/* Counts come from the results files (one JSON line per check, written by check() in browser.mjs), never from console output.
   Records with note:true are not checks. A check id that appears twice is counted twice (the second as "id#2"). */
import fs from 'node:fs';
import path from 'node:path';

export function loadResults(file) {
  if (!fs.existsSync(file)) return null;
  const seen = new Map();
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (rec.note) continue;
    const n = (seen.get(rec.id) || 0) + 1;
    seen.set(rec.id, n);
    out.push({ ...rec, key: n === 1 ? rec.id : `${rec.id}#${n}` });
  }
  return out;
}

/* known: { checkId: reason } for the suite. A known check that fails is a KNOWN bug (not a pass, not a new failure); one that
   passes is listed as "fixed" so the entry can go. */
export function tally(records, known = {}) {
  const t = { total: 0, pass: 0, fail: [], known: [], fixed: [] };
  for (const r of records || []) {
    t.total++;
    const reason = known[r.id] ?? known[r.key];
    if (reason) {
      if (r.pass) t.fixed.push(r.key);
      else t.known.push(`${r.key}: ${reason}`);
    } else if (r.pass) t.pass++;
    else t.fail.push(r.key);
  }
  // a known check that passes is still a pass; it is reported separately so the entry can be removed
  t.pass += t.fixed.length;
  return t;
}

export const resultsFile = outDir => path.join(outDir, 'results.jsonl');

export function describeTally(name, t, extra = '') {
  const bits = [`${t.pass} pass`, `${t.fail.length} fail`];
  if (t.known.length) bits.push(`${t.known.length} KNOWN`);
  let line = `${name}: ${bits.join(', ')} of ${t.total}${extra ? ` (${extra})` : ''}`;
  if (t.fail.length) line += `\n    FAIL ${t.fail.join(' ')}`;
  for (const k of t.known) line += `\n    KNOWN ${k}`;
  if (t.fixed.length) line += `\n    known bug now passes (remove it from known.mjs): ${t.fixed.join(' ')}`;
  return line;
}
