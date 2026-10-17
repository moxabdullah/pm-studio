/* =====================================================================
   EVENT WIRING
   ===================================================================== */
import { $, $$ } from '../core/utils.js';
import { S } from '../core/store.js';
import { render } from '../shell/render.js';
import { A, BLUR, DBL, IN } from './actions.js';

document.addEventListener(
  'click',
  e => {
    if (S.ui.suppressClick) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const el = e.target.closest('[data-a]');
    const inPop = e.target.closest('[data-pop-root]');
    if (S.ui.pop && !inPop) {
      const trig = el && (el.dataset.a === 'pop' || el.dataset.a === 'ctxBtn' || el.dataset.a === 'addFilter');
      if (!trig) {
        S.ui.pop = null;
        if (!el) {
          render();
          return;
        }
      }
    }
    if (S.ui.mention && !e.target.closest('.cbox') && !(el && el.dataset.a === 'pickMention')) {
      S.ui.mention = null;
      if (!el) render();
    }
    if (!el) return;
    if (el.tagName === 'BUTTON' || (el.tagName === 'INPUT' && el.type === 'checkbox' && el.dataset.a)) e.preventDefault();
    const fn = A[el.dataset.a];
    if (fn) {
      e.stopPropagation();
      fn(el, e);
    }
  },
  false,
);
document.addEventListener('dblclick', e => {
  const el = e.target.closest('[data-dbl]');
  if (el && DBL[el.dataset.dbl]) DBL[el.dataset.dbl](el, e);
});
document.addEventListener('contextmenu', e => {
  const el = e.target.closest('[data-ctx]');
  if (!el || e.target.closest('input,textarea,[contenteditable]')) return;
  e.preventDefault();
  S.ui.pop = { type: 'ctx', ctx: el.dataset.ctx, id: el.dataset.id, key: el.dataset.key, vid: el.dataset.vid, x: e.clientX, y: e.clientY, top: e.clientY };
  if (el.dataset.ctx === 'column') S.ui.pop.key = el.dataset.key;
  render();
});
export const isChangeEl = el => el.matches('select, input[type=checkbox], input[type=radio], input[type=file], input[type=date]');
document.addEventListener('input', e => {
  const el = e.target;
  if (!el.dataset || !el.dataset.in || isChangeEl(el)) return;
  IN[el.dataset.in]?.(el, e);
});
document.addEventListener('change', e => {
  const el = e.target;
  if (!el.dataset || !el.dataset.in || !isChangeEl(el)) return;
  IN[el.dataset.in]?.(el, e);
});
document.addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target;
  const n = f.dataset.submit;
  if (n && A[n]) A[n](f, e);
});
document.addEventListener('focusout', e => {
  const el = e.target;
  if (el?.dataset?.blur && BLUR[el.dataset.blur]) BLUR[el.dataset.blur](el);
});
document.addEventListener('mouseover', e => {
  const el = e.target.closest?.('[data-hover-i]');
  if (!el || !S.ui.palette) return;
  const i = +el.dataset.hoverI;
  if (S.ui.palette.hl === i) return;
  S.ui.palette.hl = i;
  $$('.pi.hl').forEach(x => x.classList.remove('hl'));
  el.classList.add('hl');
});
addEventListener('resize', () => {
  if (S.ui.pop) {
    S.ui.pop = null;
    render();
  }
});
try {
  // Across 900 px the sidebar turns from a column of the page into a drawer or back, and is drawn differently (the collapsed rail is the
  // column's only), so the shell is drawn again. Widened with the drawer open, it is shut, or its scrim and the inert page behind it would stay;
  // that does not go through closeMnav, as the sidebar's item is shown and keeps its focus. Narrowed, all of the sidebar is hidden, and the
  // key of the item that had focus may match a control of the page (a link to Projects), which render() would give the focus to: the page
  // takes it, at its top. Widened from the drawer's close button, which has no copy, the focus is lost: the page takes it too.
  matchMedia('(max-width: 900px)').addEventListener('change', e => {
    const inSide = !!$('.side')?.contains(document.activeElement);
    if (!e.matches) S.ui.mnav = false;
    render();
    const a = document.activeElement;
    if (inSide && (e.matches || !a || a === document.body)) $('#main-content')?.focus({ preventScroll: true });
  });
} catch {
  /* not supported here; safe to skip */
}
try {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (S.prefs.theme === 'system') render();
  });
} catch {
  /* not supported here; safe to skip */
}
