/* ---------- the collapsed sidebar's tooltips ---------- */
import { focusKey } from '../shell/render.js';

/* The rail clips whatever sticks out of it (.side and .side-scroll), so a tooltip drawn inside it, as ::after, is never seen. This one is a
   single element in the body, placed by script. Only railTip() (layout.js) emits data-tip-pos="right". Whether the rail is the collapsed one is
   asked at every update and not remembered: the class flips at 900 px without a render. */
const SEL = '.collapsed > nav.side [data-tip-pos="right"]';
let tip = null;
/* Two inputs, the pointer and the keyboard, each with its anchor and its own dismissal. An anchor is { el, key }: the item the input is on.
   The key is kept because a render replaces the element and the new one is found by it. A dismissal is the key of an item that gets no tip.
   It ends when its input really changes, never because of what a render sends after it. */
let hover = null;
let focus = null;
let hoverQuiet = null;
let focusQuiet = null;
/* The input that moved last: its item comes first, the other one's is the fallback. */
let last = 'hover';
/* The pointer's last position, { x, y }. A render under a still pointer makes the browser send pointerover events again, at this same position,
   and a real move is told from these by the coordinates. */
let pt = null;
/* The key of the last focus taken as a new one. A render that gives the focus back to the same item is not a new focus, and the focus that
   left the page's items for good (the body, a field) clears it. */
let fkey = null;
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
const moved = (a, b) => !a || !b || a.x !== b.x || a.y !== b.y;
/* Where the tip goes for this input: its anchor, if it is there, not dismissed, and not scrolled out of the list (the item is clipped there,
   and its tip would hang in the air). */
function place(a, quiet) {
  if (!a || a.key === quiet) return null;
  const r = a.el.getBoundingClientRect();
  const mid = r.top + r.height / 2;
  const box = a.el.closest('.side-scroll')?.getBoundingClientRect();
  return box && (mid < box.top || mid > box.bottom) ? null : { a, r, mid };
}
/* Draws the tip for an item, or hides it. Called on every event that can change an anchor, and after each render (afterRender). */
export function syncRailTip() {
  if (!tip) return;
  hover = current(hover);
  focus = current(focus, true);
  // The input that moved last has the tip; if it has none to show, the other one does.
  const at = last === 'hover' ? place(hover, hoverQuiet) || place(focus, focusQuiet) : place(focus, focusQuiet) || place(hover, hoverQuiet);
  if (!at) return hide();
  const { a, r, mid } = at;
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
    const real = moved(pt, { x: e.clientX, y: e.clientY });
    pt = { x: e.clientX, y: e.clientY };
    // A pointerover that is not a move is the browser putting the pointer back after a render. It may name an ancestor of the item that was
    // removed, and the new item comes in the next one, so it asks the page what is under the pointer now instead of reading its target.
    const under = real ? e.target : document.elementFromPoint(pt.x, pt.y);
    hover = anchor(hover, under?.closest?.(SEL));
    // Another item, or none, is a new hover and ends the dismissal; the children of one item are not. What a render sends ends nothing.
    if (real && hover?.key !== hoverQuiet) hoverQuiet = null;
    if (real && hover) last = 'hover';
    syncRailTip();
  });
  document.addEventListener(
    'pointermove',
    e => {
      if (e.pointerType === 'touch') return;
      const real = moved(pt, { x: e.clientX, y: e.clientY });
      pt = { x: e.clientX, y: e.clientY };
      // Moving over the item takes the tip back from the keyboard (only when it has to, this runs on every move).
      if (real && hover && last !== 'hover') {
        last = 'hover';
        syncRailTip();
      }
    },
    { passive: true },
  );
  document.addEventListener('pointerout', e => {
    if (e.relatedTarget != null) return;
    hover = hoverQuiet = null; // the pointer left the window
    syncRailTip();
  });
  addEventListener('blur', () => {
    hover = focus = null; // the dismissals stay
    syncRailTip();
  });
  document.addEventListener('focusin', e => {
    let k = null;
    try {
      if (e.target.matches(':focus-visible') && e.target.matches(SEL)) k = focusKey(e.target) || '';
    } catch {
      /* not supported here; no tip for focus */
    }
    // A render gives the focus back to the same item (k is fkey): that is not a new focus, and the keyboard's dismissal and the order of the
    // inputs stay as they are.
    if (k !== fkey) {
      focusQuiet = null;
      if (k !== null) last = 'focus';
    }
    fkey = k;
    focus = k !== null ? anchor(focus, e.target) : null;
    syncRailTip();
  });
  document.addEventListener('focusout', () => {
    focus = null;
    // Not at once: a render that takes the focused item away (Chrome fires this on the removal) gives the focus back to the new one before it
    // ends, and the tip must not be hidden and shown again, nor the dismissal forgotten, in between. If no focus came back, it was left.
    queueMicrotask(() => {
      if (!focus) fkey = null;
      syncRailTip();
    });
  });
  // A click goes to a page and draws it again, so the press dismisses the item it is on; the pointerover events that follow the draw, at the
  // same position, are not a move. A press on no item leaves the tips alone (the focus it takes ends the keyboard's, if it does).
  document.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') return;
    pt = { x: e.clientX, y: e.clientY };
    const el = e.target.closest?.(SEL);
    if (!el) return;
    hover = anchor(hover, el);
    hoverQuiet = hover.key;
    syncRailTip();
  });
  // Esc dismisses the item of each input, not only the one shown: the other one's would come up in its place, and a second Esc would bring
  // the first back.
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    hoverQuiet = hover?.key ?? hoverQuiet;
    focusQuiet = focus?.key ?? focusQuiet;
    syncRailTip();
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
