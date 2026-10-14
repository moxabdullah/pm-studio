/* ---------- PocketBase client ----------
   One shared client for the whole app. It talks to the same origin: the Vite dev server proxies /api to PocketBase,
   and in production PocketBase serves the app itself. VITE_PB_URL points the browser somewhere else.

   Exports
     pb                the PocketBase client (auto-cancellation is off, see below)
     authStore         pb.authStore; token + record live under one storage key, see RememberAuthStore
     setRemember(bool) call before pb.collection('users').authWithPassword(): true keeps the session in localStorage,
                       false only for this tab (sessionStorage). Defaults to true.
     fileUrl(file, { download })
                       async; URL of an uploaded file. `file` is a files object as fromRecord() returns it ({ id, file }).
                       Uploads are protected, so the URL carries a short-lived file token. Fetch it right before using it. */
import PocketBase, { BaseAuthStore, getTokenPayload } from 'pocketbase';

const AUTH_KEY = 'gr8r.auth';

/* Storage may be missing or throw (private windows, blocked site data), so every access is guarded. */
const area = name => {
  try {
    return globalThis[name] || null;
  } catch {
    return null;
  }
};
const read = store => {
  try {
    const saved = JSON.parse(store?.getItem(AUTH_KEY) || 'null');
    return saved?.token ? saved : null;
  } catch {
    return null;
  }
};
const write = (store, value) => {
  try {
    store?.setItem(AUTH_KEY, JSON.stringify(value));
  } catch {
    /* quota or blocked: the session lasts until the page is closed */
  }
};
const drop = store => {
  try {
    store?.removeItem(AUTH_KEY);
  } catch {
    /* nothing to remove */
  }
};

/* The auth token and user record, in localStorage when "remember me" is on and in sessionStorage when it is off.
   Only one of the two ever holds a session. This is the only thing the app keeps in browser storage. */
class RememberAuthStore extends BaseAuthStore {
  remember = true;

  constructor() {
    super();
    const forTab = read(area('sessionStorage'));
    const saved = forTab || read(area('localStorage'));
    if (saved) {
      this.remember = !forTab;
      super.save(saved.token, saved.record);
    }
    // Another tab signed in or out of the remembered session.
    globalThis.addEventListener?.('storage', e => {
      if (!this.remember || e.storageArea !== area('localStorage') || (e.key !== null && e.key !== AUTH_KEY)) return;
      const next = read(area('localStorage'));
      if (next) super.save(next.token, next.record);
      else super.clear();
    });
  }

  save(token, record) {
    const [keep, other] = this.remember ? ['localStorage', 'sessionStorage'] : ['sessionStorage', 'localStorage'];
    write(area(keep), { token, record });
    drop(area(other));
    super.save(token, record);
  }

  clear() {
    drop(area('localStorage'));
    drop(area('sessionStorage'));
    super.clear();
  }
}

export const authStore = new RememberAuthStore();
export const pb = new PocketBase(import.meta.env?.VITE_PB_URL || '/', authStore);
/* The sync layer runs several requests to the same endpoint at once. With auto-cancellation on, the SDK would abort
   all but one of them, and an aborted request surfaces as a status-0 error that looks like "offline". */
pb.autoCancellation(false);

export const setRemember = on => {
  authStore.remember = !!on;
};

/* File tokens last a few minutes. Reuse one until shortly before it expires, and never across users. */
let cachedToken = { value: '', expires: 0 };
authStore.onChange(() => {
  cachedToken = { value: '', expires: 0 };
});
async function fileToken() {
  for (;;) {
    if (cachedToken.value && Date.now() < cachedToken.expires - 10000) return cachedToken.value;
    const owner = authStore.token;
    const value = await pb.files.getToken();
    // The sign-in changed while the request was on its way (sign-out, another account, a new password): that token belongs to the old
    // one, so it is neither kept nor used. Ask again. Calls that overlap each get their own request; whichever finishes under the
    // current sign-in fills the cache, and the others find it there.
    if (authStore.token !== owner) continue;
    cachedToken = { value, expires: (getTokenPayload(value).exp || 0) * 1000 };
    return value;
  }
}

export async function fileUrl(file, { download = false } = {}) {
  return pb.files.getURL({ id: file.id, collectionName: 'files' }, file.file, { token: await fileToken(), download });
}
