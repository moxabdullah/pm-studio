/* =====================================================================
   SAFETY: helpers for data that other people wrote.
   Every field of everything in S.data is untrusted, because any signed-in user can write
   arbitrary JSON into shared records. Text and attributes go through esc() (core/utils.js);
   this module covers what esc() can't: CSS values, lookup-table keys and rich text.
   ===================================================================== */

/* ---------- colours ---------- */
const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/;
const TOKEN_COLOR = /^var\(--[a-z][a-z0-9-]*\)$/;
/* A stored colour is only ever used inside style="--c:…". Escaping isn't enough there (`red;background:url(…)` is
   still valid CSS), so accept a hex colour or an app token such as var(--blue) and replace anything else. */
export function safeColor(c, fallback = 'var(--gray)') {
  return typeof c === 'string' && (HEX_COLOR.test(c) || TOKEN_COLOR.test(c)) ? c : fallback;
}

/* ---------- lookup tables ---------- */
/* Tables like ST, PR and PSTAT are indexed by values from the server. A plain object answers "constructor" or
   "__proto__" with an inherited property, and answers an unknown key with undefined, which then crashes the render
   (`ST[t.status].name`). Here only the table's own keys resolve, and with a `fallback` any other key yields it, so
   one bad record can't break a page for everyone. Without a fallback unknown keys are simply undefined. */
export function lookup(entries, fallback) {
  const table = Object.assign(Object.create(null), entries);
  if (fallback === undefined) return table;
  return new Proxy(table, { get: (t, k) => (k in t ? t[k] : typeof k === 'string' ? fallback : undefined) });
}

/* ---------- rich text ---------- */
/* Task descriptions are HTML on purpose (contenteditable with execCommand). Anything that reaches the page, or
   is saved, goes through this allowlist instead of being trusted. h4 is here because the toolbar's heading
   button produces it. The sets are written as words so the icon scan in vite.config.js ignores them. */
const words = s => new Set(s.split(' '));
const RTE_TAGS = words('p br div b strong i em u s strike ul ol li a h1 h2 h3 h4 h5 h6 blockquote code pre span');
/* Removed together with their content. Any other element that isn't allowed is unwrapped and its text kept. */
const RTE_DROP = words(
  'script style iframe object embed svg math template noscript applet frame frameset noembed noframes audio video canvas head title link meta base',
);
const LINK_PROTOCOLS = words('http: https: mailto:');
const HTML_NS = 'http://www.w3.org/1999/xhtml';

/* The URL parser decides the scheme exactly as the browser will (it ignores tabs, newlines and leading control
   characters), so "java\nscript:" is read as javascript: and refused. What it returns is what gets written. */
function safeHref(raw) {
  try {
    const u = new URL(String(raw ?? '').trim());
    return LINK_PROTOCOLS.has(u.protocol) ? u.href : '';
  } catch {
    return '';
  }
}
/* Replace an element with its children (no spread: a hostile element can have more children than a call can take as arguments). */
function unwrap(n) {
  while (n.firstChild) n.before(n.firstChild);
  n.remove();
}
function cleanChildren(parent) {
  for (const n of [...parent.childNodes]) {
    if (n.nodeType === 3) continue; // text
    if (n.nodeType !== 1) {
      n.remove(); // comments, processing instructions
      continue;
    }
    const tag = n.localName;
    if (n.namespaceURI !== HTML_NS || RTE_DROP.has(tag)) {
      n.remove(); // foreign content (svg, math) and anything executable or embedded
      continue;
    }
    cleanChildren(n); // children first, so an unwrapped element hands over clean nodes
    if (!RTE_TAGS.has(tag)) {
      unwrap(n);
      continue;
    }
    const href = tag === 'a' ? safeHref(n.getAttribute('href')) : '';
    for (const a of [...n.attributes]) n.removeAttributeNode(a);
    if (tag !== 'a') continue;
    if (!href) {
      unwrap(n); // a link with no safe target is just text
      continue;
    }
    n.setAttribute('href', href);
    n.setAttribute('rel', 'noopener noreferrer');
    n.setAttribute('target', '_blank');
  }
}
export function sanitizeHtml(html) {
  const tpl = document.createElement('template'); // parsed into an inert document: nothing loads or runs
  tpl.innerHTML = String(html ?? '');
  cleanChildren(tpl.content);
  return tpl.innerHTML;
}
