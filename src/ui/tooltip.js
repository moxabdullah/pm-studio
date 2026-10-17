/* ---------- the collapsed sidebar's tooltips ---------- */
import { focusKey } from '../shell/render.js';

/* The rail clips whatever sticks out of it (.side and .side-scroll), so a tooltip drawn inside it, as ::after, is never seen. This one is a
   single element in the body, placed by script. Only railTip() (layout.js) emits data-tip-pos="right". Whether the rail is the collapsed one is
   asked at every update and not remembered: the class flips at 900 px without a render. */
const SEL = '.collapsed > nav.side [data-tip-pos="right"]';
let tip = null;
/* The anchors, { el, key }: the item under the pointer, and the item the keyboard is on. The pointer's wins. The key is kept because a render
   replaces the element and the new one is found by it. */
let hover = null;
let focus = null;
let quiet = null; // key of the item a press or Esc dismissed: no tip for it until the anchor is another one
let shown = null; // key of the item the tip is drawn for

const anchor = (cur, el) => (el ? (cur && cur.el === el ? cur : { el, key: focusKey(el) || '' }) : null);
/* The anchor as it is now: after a render its element is gone and the same item is looked up by its key (in nav.side, since the topbar has a
   [data-pop="user"] too). The focus anchor counts only while its element has the focus, whatever the browser did on the removal. */
function current(a, focused) {
  if (!a) return null;
  let el = a.el;
  if (!el.isConnected) {
    try {
      el = a.key ? document.querySelector('nav.side ' + a.key) : null;
    } catch {
      el = null;
    }
  }
  if (!el || !el.matches(SEL) || (focused && el !== document.activeElement)) return null;
  return { el, key: a.key };
}
function hide() {
  if (!tip.hidden) tip.hidden = true;
  shown = null;
}
/* Draws the tip for the anchor, or hides it. Called on every event that can change either, and after each render (afterRender). */
export function syncRailTip() {
  if (!tip) return;
  hover = current(hover);
  focus = current(focus, true);
  const a = hover || focus;
  if (!a) {
    quiet = null;
    return hide();
  }
  if (quiet !== null && a.key !== quiet) quiet = null;
  if (a.key === quiet) return hide();
  const r = a.el.getBoundingClientRect();
  const mid = r.top + r.height / 2;
  // Scrolled out of the list: the item is clipped there, and its tip would hang in the air.
  const box = a.el.closest('.side-scroll')?.getBoundingClientRect();
  if (box && (mid < box.top || mid > box.bottom)) return hide();
  tip.textContent = a.el.dataset.tip;
  tip.style.left = r.right + 8 + 'px';
  tip.style.top = mid + 'px';
  tip.hidden = false;
  // The delay and fade start again for another item, or from hidden (hide() clears shown), but not for the same item found again after a
  // render: that restores focus before afterRender, so it is the keys that are compared, not the elements.
  if (shown !== a.key) {
    tip.style.animation = 'none';
    void tip.offsetWidth;
    tip.style.animation = '';
  }
  shown = a.key;
}
/* A click goes to a page and draws it again; Esc is the way to dismiss a tip. Either way it does not return while the pointer or the keyboard
   stays on the item. */
function dismiss() {
  const a = hover || focus;
  if (a) quiet = a.key;
  syncRailTip();
}

export function initRailTip() {
  if (tip) return;
  tip = document.createElement('div');
  tip.id = 'rail-tip';
  tip.className = 'tip-float';
  tip.setAttribute('aria-hidden', 'true'); // each item of the rail has an aria-label with the same text
  tip.hidden = true;
  document.body.appendChild(tip);
  document.addEventListener('pointerover', e => {
    if (e.pointerType === 'touch') return;
    hover = anchor(hover, e.target.closest?.(SEL));
    syncRailTip();
  });
  document.addEventListener('pointerout', e => {
    if (e.relatedTarget != null) return;
    hover = null; // the pointer left the window
    syncRailTip();
  });
  addEventListener('blur', () => {
    hover = null;
    syncRailTip();
  });
  document.addEventListener('focusin', e => {
    let visible = false;
    try {
      visible = e.target.matches(':focus-visible');
    } catch {
      /* not supported here; no tip for focus */
    }
    focus = visible ? anchor(focus, e.target.matches(SEL) ? e.target : null) : null;
    syncRailTip();
  });
  document.addEventListener('focusout', () => {
    focus = null;
    // Not at once: a render that takes the focused item away (Chrome fires this on the removal) gives the focus back to the new one before it
    // ends, and the tip must not be hidden and shown again, nor the dismissal forgotten, in between.
    queueMicrotask(syncRailTip);
  });
  document.addEventListener('pointerdown', dismiss);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') dismiss();
  });
  // scroll does not bubble, so a list scrolling anywhere is heard on the way down
  document.addEventListener('scroll', syncRailTip, { capture: true });
  addEventListener('resize', syncRailTip);
  try {
    // The resize event comes before the media query is evaluated, so the collapsed class (events.js) is not yet flipped when it fires.
    matchMedia('(max-width: 900px)').addEventListener('change', syncRailTip);
  } catch {
    /* not supported here; safe to skip */
  }
}
