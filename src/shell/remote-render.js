/* ---------- rendering changes that other people made ----------
   render() throws the whole page away and builds it again. For a change the user made, that is what they expect. For a change that
   arrived from the server it must not cost them anything: not the caret, not a title they are halfway through typing, not a drag.
   The sync engine calls remoteRender() instead of render(). It
     - coalesces a burst of changes into one render (100 ms),
     - holds the render back while a drag, a pointer press, an IME composition or an open select menu is in progress, and renders as
       soon as that ends,
     - keeps every text field the user has changed but not yet committed (the task title commits on blur, for example), and the focus
       and caret of the field they are typing in, including the rich-text description (character offsets, since its nodes are rebuilt),
     - stops the blur handlers (which commit a field) from firing because the page was rebuilt around the focused field. */
import { autosize, focusKey, render } from './render.js';

const COALESCE_MS = 100;
const RECHECK_MS = 150;
const STALE_MS = 15000; // a drag, press or composition whose end was never reported (released outside the window, say) stops counting after this

let timer = 0;
let dragSince = 0;
let pressSince = 0;
let composeSince = 0;
let rendering = false;

const on = since => since > 0 && Date.now() - since < STALE_MS;
const busy = () => on(dragSince) || on(pressSince) || on(composeSince) || !!document.querySelector('.select-menu');
/* Something the user was doing has ended: render soon, after the app's own handlers for that event have run. */
function ended() {
  if (timer) {
    clearTimeout(timer);
    timer = setTimeout(run, 50);
  }
}

document.addEventListener(
  'dragstart',
  () => {
    dragSince = Date.now();
  },
  true,
);
for (const type of ['dragend', 'drop']) {
  document.addEventListener(
    type,
    () => {
      dragSince = 0;
      ended();
    },
    true,
  );
}
document.addEventListener(
  'pointerdown',
  () => {
    pressSince = Date.now();
  },
  true,
);
for (const type of ['pointerup', 'pointercancel']) {
  document.addEventListener(
    type,
    () => {
      pressSince = 0;
      ended();
    },
    true,
  );
}
addEventListener('blur', () => {
  pressSince = dragSince = 0; // the window lost focus: a press or drag cannot still be going on
});
document.addEventListener(
  'compositionstart',
  () => {
    composeSince = Date.now();
  },
  true,
);
document.addEventListener(
  'compositionend',
  () => {
    composeSince = 0;
    ended();
  },
  true,
);
// While the page is rebuilt for a remote change, the focused field disappearing is not the user leaving it.
document.addEventListener(
  'focusout',
  e => {
    if (rendering) e.stopImmediatePropagation();
  },
  true,
);

export function remoteRender() {
  if (!timer) timer = setTimeout(run, COALESCE_MS);
}
function run() {
  timer = 0;
  if (busy()) {
    timer = setTimeout(run, RECHECK_MS);
    return;
  }
  const kept = capture();
  rendering = true;
  try {
    render();
  } finally {
    rendering = false;
  }
  restore(kept);
}

/* ---------- keeping what the user is doing ---------- */
const TEXT_TYPES = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'password', 'number']);
const isTextField = el => el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && TEXT_TYPES.has(el.getAttribute('type') || ''));
const query = key => {
  try {
    return key ? document.querySelector(key) : null;
  } catch {
    return null;
  }
};

/* Characters from the start of `root`'s text to a point inside it, and back. */
function textOffset(root, node, offset) {
  const range = document.createRange();
  range.selectNodeContents(root);
  range.setEnd(node, offset);
  return range.toString().length;
}
function locate(root, offset) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let left = offset;
  let last = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    last = node;
    if (left <= node.nodeValue.length) return [node, left];
    left -= node.nodeValue.length;
  }
  return last ? [last, last.nodeValue.length] : [root, root.childNodes.length];
}

function capture() {
  // Fields changed but not committed. A field whose value follows the model on every keystroke comes back right by itself.
  const dirty = [];
  for (const el of document.querySelectorAll('textarea, input')) {
    if (!isTextField(el) || el.value === el.defaultValue) continue;
    const key = focusKey(el);
    if (key) dirty.push({ key, value: el.value });
  }
  const a = document.activeElement;
  let focus = null;
  if (a && a !== document.body && (isTextField(a) || a.isContentEditable)) {
    focus = { key: focusKey(a), rich: a.isContentEditable, sel: null };
    if (!focus.rich) focus.sel = { start: a.selectionStart, end: a.selectionEnd, dir: a.selectionDirection, scroll: a.scrollTop };
    else {
      const s = getSelection();
      if (s.rangeCount && a.contains(s.anchorNode) && a.contains(s.focusNode)) {
        focus.sel = { anchor: textOffset(a, s.anchorNode, s.anchorOffset), head: textOffset(a, s.focusNode, s.focusOffset) };
      }
    }
  }
  return { dirty, focus };
}
function restore({ dirty, focus }) {
  for (const d of dirty) {
    const el = query(d.key);
    if (!el || el.value === d.value) continue;
    el.value = d.value;
    if (el.matches('textarea[data-autosize]')) autosize(el);
  }
  const el = focus && query(focus.key);
  if (!el) return;
  el.focus({ preventScroll: true });
  if (!focus.sel) return;
  if (focus.rich) {
    const [anchorNode, anchorOffset] = locate(el, focus.sel.anchor);
    const [headNode, headOffset] = locate(el, focus.sel.head);
    getSelection().setBaseAndExtent(anchorNode, anchorOffset, headNode, headOffset);
  } else {
    try {
      el.setSelectionRange(focus.sel.start, focus.sel.end, focus.sel.dir);
      el.scrollTop = focus.sel.scroll;
    } catch {
      /* the field does not support a selection */
    }
  }
}
