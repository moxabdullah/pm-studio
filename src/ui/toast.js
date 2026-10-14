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
  el.setAttribute('role', 'status');
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
  if (opt.replaces) host.querySelectorAll(`.toast[data-key="${opt.replaces}"]`).forEach(t => t.querySelector('.ibtn').onclick());
  host.appendChild(el);
  setTimeout(kill, opt.ms || 4200);
}
/* guarded mutation: refuses edits while the server cannot be reached. "Try again" reconnects, and applies the edit if that works.
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
/* Call on every submit, before mutate(), and pass the result as its `still`: it holds only while this is the newest attempt for `key`. */
const attempts = { obj: new WeakMap(), str: new Map() };
export function latest(key) {
  const reg = typeof key === 'string' ? attempts.str : attempts.obj;
  const n = (reg.get(key) || 0) + 1;
  reg.set(key, n);
  return () => reg.get(key) === n;
}
/* latest() for the fields of one record that an edit writes, e.g. latestFields('task', id, ['status']): holds while this is the newest
   attempt for every one of them, so an older edit's "Try again" can never overwrite a newer edit of the same field. */
export function latestFields(kind, id, fields) {
  const fresh = fields.map(f => latest(`${kind}:${id}:${f}`));
  return () => fresh.every(x => x());
}
