// The checks the three test files share. One line per check: `ok`, `FAIL`, or `KNOWN` (a bug on main that a check already covers).
let bad = 0;
export const ok = (c, m) => {
  if (!c) bad++;
  console.log(`    ${c ? 'ok  ' : 'FAIL'} ${m}`);
};
// A check for a bug that is known and not fixed yet: KNOWN while the bug is there, ok once it is gone. It never counts as a FAIL.
export const known = (c, m, why) => console.log(c ? `    ok   ${m}` : `    KNOWN ${m} (${why})`);
export function finish() {
  console.log(bad ? `\n${bad} FAILED` : '\nall ok');
  process.stdout.write('', () => process.exit(bad ? 1 : 0));
}
