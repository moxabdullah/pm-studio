/* =====================================================================
   EVENT WIRING
   ===================================================================== */
import { $, $$ } from '../core/utils.js';
import { S } from '../core/store.js';
import { focusKey, render, sideCollapsed } from '../shell/render.js';
import { remoteRenderNow } from '../shell/remote-render.js';
import { activate } from '../overlays/modals.js';
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
    const opener = S.ui.popOpener;
    let dropped = false; // this click closes the popover
    if (S.ui.pop && !inPop) {
      const trig = el && (el.dataset.a === 'pop' || el.dataset.a === 'ctxBtn' || el.dataset.a === 'addFilter');
      if (!trig) {
        S.ui.pop = null;
        if (!el) {
          render();
          return;
        }
        dropped = true;
        S.ui.popOpener = null; // the control clicked is not of the popover: nothing it opens may take the popover's opener for its own
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
      activate(el, () => fn(el, e));
    }
    // An action that draws nothing (a click on a dialog's blank area) leaves the popover that was dropped above on screen, with the Tab trap
    // and the popover's keys off: it is drawn away, the focus going back to what opened it.
    if (dropped && render._ov?.pop && !S.ui.pop) {
      // A control that takes focus (Copy) keeps it; a click on no such control (a dialog's blank area) goes back to the popover's opener.
      S.ui.popOpener = (el.matches('button, a[href], input, select, textarea') && focusKey(el)) || opener;
      render();
      S.ui.popOpener = null;
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
  S.ui.popOpener = focusKey(el);
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
// A popover was placed for the width it opened at.
const closePopOnResize = () => {
  if (S.ui.pop) {
    S.ui.pop = null;
    render();
  }
};
addEventListener('resize', closePopOnResize);
try {
  // Across 900 px the sidebar turns from a column of the page into a drawer or back. Only two things in the markup follow it, the collapsed
  // rail (a column's only, sideCollapsed()) and the open drawer (its scrim and the inert page); the rest is CSS, which has switched already
  // when this fires. The page is drawn again for them at once, in this task (remoteRenderNow()), so the class and the markup change together
  // and no frame shows one without the other. It is not drawn with render(): a window drag, a rotation or a zoom near 900 px crosses it again
  // and again, and render() would empty a field the user is typing in and let its blur save what is half typed. remoteRender() keeps both.
  // But it waits for a pressed pointer, a drag or a composition, as it always does. The shell must not be the wrong one meanwhile (the
  // collapsed grid in a window too narrow for it, or a drawer shown that S.ui.mnav says is shut, with nothing inert and Esc doing nothing),
  // so the two classes are put right here as well; the redraw then only makes them again, with the markup that follows them.
  // The resize event comes before this one in some browsers and after it in others: the popover it shuts is shut here as well, before the
  // focus is read, so the order does not matter.
  // Focus is moved here, at once, before the redraw. Widened with the drawer open, it is shut (not through closeMnav, as the sidebar's own item is
  // shown and keeps its focus); the close button has no copy on the desktop, and the page is inert until it is drawn again, so that is lifted
  // for the focus. Narrowed, all of the sidebar is hidden, and the key of the item that had focus is the bottom nav's too (they share keys),
  // whose visible copy a later render() would give the focus to. Focus on <body> (a popover's opener in the sidebar, closed by the resize that
  // came first) goes to the page too, at its top, unless a dialog, the command menu or a full task panel is open: focus is on <body> there
  // because the user clicked something in it that cannot hold focus (a heading), and it is not the page's to take.
  matchMedia('(max-width: 900px)').addEventListener('change', e => {
    closePopOnResize();
    const a = document.activeElement;
    const lost = !a || a === document.body;
    const inSide = !!$('.side')?.contains(a);
    const shut = !e.matches && S.ui.mnav;
    $('.shell')?.classList.toggle('collapsed', sideCollapsed());
    if (shut) {
      S.ui.mnav = false;
      $$('[inert]').forEach(x => x.removeAttribute('inert'));
      $('.shell')?.classList.remove('mnav');
      $('.side-scrim')?.remove();
    }
    const over = S.ui.modals.length || S.ui.palette || (S.ui.drawer && S.ui.drawerFull);
    if ((lost && !over) || (inSide && (e.matches || a.offsetParent === null))) $('#main-content')?.focus({ preventScroll: true });
    if (S.ui.collapsed || shut) remoteRenderNow();
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
