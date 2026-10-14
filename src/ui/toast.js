/* ---------- toasts ---------- */
import { $, esc } from '../core/utils.js';
import { ic } from '../core/icons.js';
import { S, save } from '../core/store.js';
import { retryNow, sessionGen } from '../core/sync.js';
import { render } from '../shell/render.js';

export function toast(msg, opt = {}) {
  const host = $('#toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', opt.sticky && opt.kind === 'err' ? 'alert' : 'status'); // one that stays until it is dismissed is not to be missed
  const icon = opt.kind === 'err' ? ic('circle-alert', 15, 'bad') : opt.kind === 'info' ? ic('info', 15) : ic('circle-check', 15, 'ok');
  el.innerHTML = `${icon}<span class="grow">${esc(msg)}</span>${opt.action ? `<button class="ta">${esc(opt.action)}</button>` : ''}<button class="ibtn ibtn-xs" aria-label="Dismiss" style="color:inherit;opacity:.6">${ic('x', 13)}</button>`;
  const kill = () => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 160);
  };
  if (opt.action)
    el.querySelector('.ta').onclick = () => {
      opt.onAction?.();
      kill();
    };
  el.querySelector('.ibtn').onclick = kill;
  // `key` names a toast that a later one can take the place of (`replaces`), so two look-alike "Try again" toasts never sit side by side
  if (opt.key) el.dataset.key = opt.key;
  if (opt.sticky) el.dataset.sticky = '1';
  if (opt.replaces) host.querySelectorAll(`.toast[data-key="${opt.replaces}"]`).forEach(t => t.querySelector('.ibtn').onclick());
  host.appendChild(el);
  if (!opt.sticky) setTimeout(kill, opt.ms || 4200); // `sticky`: it stays until it is dismissed, another toast takes its place or the session ends
}
/* Removes the toasts that stay until dismissed: they tell of the session that is ending, and must not be shown on the sign-in page
   or to the next person who signs in. At once, not faded out: the fade would leave a record's name on the sign-in page for a moment. */
export function clearStickyToasts() {
  $('#toasts')
    ?.querySelectorAll('.toast[data-sticky]')
    .forEach(t => t.remove());
}
/* guarded mutation: refuses edits while the server cannot be reached. "Try again" reconnects, and applies the edit if that works.
   Not everything goes through here: inline editing (a description, a subtask's note), view state, preferences, saved views, the
   project order, read state and Undo call save() themselves, so what they change is kept while offline and sent once the connection
   is back. Their toasts must not say "saved" then.
   `done` is what the caller does once the edit is in (close the form, say what happened). It runs here, after the edit, so that
   "Try again" completes the whole operation: replaying only the edit would leave a submitted form open to be submitted again.
   `still`, when given, is checked after reconnecting: a toast can outlive its form, and the edit is re-applied only while it holds. */
export function mutate(fn, done, still) {
  if (S.ui.offline) {
    let tried = false; // once per toast: a double click while it fades out would apply the edit twice
    const gen = sessionGen(); // and never after signing out: the toast can outlive the session
    toast("Your changes couldn't be saved. You're offline.", {
      kind: 'err',
      action: 'Try again',
      replaces: 'offline', // the sync engine's own offline toast only reconnects; this one also applies the edit
      onAction: async () => {
        if (tried) return;
        tried = true;
        if ((await retryNow()) && sessionGen() === gen && (!still || still())) mutate(fn, done, still);
      },
    });
    return false;
  }
  fn();
  save();
  render();
  done?.();
  return true;
}
/* Call on every submit, before mutate(), and pass the result as its `still`: it holds only while this is the newest attempt for `key`.
   Every attempt takes a new number, so a key that was forgotten and is taken again never matches an attempt from before. String keys
   (latestFields takes one per record field) are forgotten 10 minutes after their last attempt, so a long-lived tab does not keep one for
   every field it ever edited: the toast is long gone by then, and a forgotten key only refuses a "Try again", as a newer edit would. */
const attempts = { obj: new WeakMap(), str: new Map() };
const FORGET_MS = 10 * 60e3;
let seq = 0;
export function latest(key) {
  const n = ++seq;
  if (typeof key !== 'string') {
    attempts.obj.set(key, n);
    return () => attempts.obj.get(key) === n;
  }
  const now = performance.now();
  for (const [k, a] of attempts.str) {
    if (now - a.at < FORGET_MS) break; // oldest first: a key taken again is put back at the end
    attempts.str.delete(k);
  }
  attempts.str.delete(key);
  attempts.str.set(key, { n, at: now });
  return () => attempts.str.get(key)?.n === n;
}
/* latest() for the fields of one record that an edit writes, e.g. latestFields('task', id, ['status']): holds while this is the newest
   attempt for every one of them, so an older edit's "Try again" can never overwrite a newer edit of the same field. */
export function latestFields(kind, id, fields) {
  const fresh = fields.map(f => latest(`${kind}:${id}:${f}`));
  return () => fresh.every(x => x());
}
