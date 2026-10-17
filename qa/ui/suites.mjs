/* The browser suites. Each entry: the script(s) to run (every script gets its own fresh database, as the original kits did), a
   line on what it covers, and `expect`, the number of checks a complete run records (a run that stops early is flagged). */
import path from 'node:path';

export const SUITES = {
  pdbase: {
    files: ['pdbase.mjs'],
    expect: 6,
    about: 'Project form: half-typed target date, Edit writes only what changed, two sessions (the first sections of pd, in a fresh order)',
  },
  pd: { files: ['pd.mjs'], expect: 23, about: 'Project form: half-typed target date, Edit writes only what changed, a project with no target date' },
  r2b: { files: ['r2b.mjs'], expect: 27, about: 'Projects table, overview Details, project form, field values' },
  r2c: {
    files: ['r2c.mjs'],
    expect: 25,
    about: 'Fields editor: focus after Delete and Type, copy and confirms, live announcement, name checked at write time',
  },
  r3a: {
    files: ['r3a.mjs'],
    expect: 24,
    about: 'Change detection on the Edit form, half-typed values never saved as a clear, errors in place, live-update backstop',
  },
  r3b: { files: ['r3b.mjs'], expect: 15, about: 'Projects table says when columns are hidden (edge fade, tab stop only while it scrolls)' },
  r3c: { files: ['r3c.mjs'], expect: 18, about: 'Fields editor (read-only Type, remove-options confirm), overview field rows, tiny numbers' },
  sA: { files: ['sA.mjs'], expect: 42, about: 'Settings fields editor (add, edit, move, delete) against the server and a second session' },
  pf: {
    files: ['pf.mjs'],
    expect: 129,
    about: 'Pipeline follow-ups: drag highlight, focus return from Details picks, phone sidebar out of the Tab order, palette; PF_ONLY=R runs round 2',
  },
  pipeline: {
    expect: 58,
    files: ['pipeline/p2a.mjs', 'pipeline/p2b.mjs', 'pipeline/strict.mjs', 'pipeline/new-checks.mjs', 'pipeline/r3-checks.mjs'],
    about:
      'Project pipeline board: real-mouse drags across a wide board (edge scroll, wheel mid-drag, far columns), scroll retention, keyboard, picker, Escape, file drop, phone and landscape layouts; ONLY=a,b,... limits new-checks',
  },
  rt: { files: ['rt.mjs'], expect: 54, about: 'Rail tooltips and a11y: RT*, A*, R2*, R3*; RT_ONLY=R2 runs one group (comma list allowed)' },
  sb: {
    files: ['sb.mjs'],
    expect: 15,
    about:
      'Collapsed sidebar rail: accessible names, expanded and phone drawer unchanged, tooltip, keyboard focus; a folder named sb-main next to PM_OUT (an earlier run) turns on the N2, N3 and P1 comparisons',
  },
};

export const resolveSuites = names => {
  if (names.includes('all') && names.length > 1) throw new Error('"all" cannot be combined with suite names (the others would be ignored)');
  const list = !names.length || names.includes('all') ? Object.keys(SUITES) : names;
  const bad = list.filter(n => {
    const parts = n.split(':');
    const [base, only] = parts;
    return parts.length > 2 || !Object.hasOwn(SUITES, base) || (only !== undefined && !SUITES[base].files.some(f => path.basename(f, '.mjs') === only));
  });
  if (bad.length) throw new Error(`unknown suite ${bad.join(', ')}. Suites: ${Object.keys(SUITES).join(' ')} (or "all")`);
  return list;
};
