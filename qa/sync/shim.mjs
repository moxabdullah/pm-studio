globalThis.document = {
  querySelectorAll: () => [],
  getElementById: () => null,
  querySelector: () => null,
  documentElement: { dataset: {}, style: {}, classList: { add() {}, remove() {}, toggle() {} } },
  addEventListener() {},
  hidden: false,
};
globalThis.window = globalThis.window || globalThis;
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
globalThis.navigator ||= {};
globalThis.ResizeObserver ||= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}; // pages/projects.js makes one when it loads
