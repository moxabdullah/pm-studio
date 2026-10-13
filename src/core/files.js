/* ---------- files: uploads, downloads and attachments ----------
   Everything between the app and the `files` collection that is not plain record syncing (src/core/sync.js does that: a rename or a
   delete is an ordinary change to S.data). The file bytes travel here, outside the sync diff, because a record needs its blob.

   Exports
     MAX_FILE_BYTES     the largest upload the server takes: the file field's maxSize in server/pb_migrations (100 MB, inclusive)
     isRaster(f)        true when the stored file is a png, jpg, gif or webp. Those are the only uploads the app ever draws, always
                        through <img>. Everything else is downloaded, never shown: SVG and HTML in the page could run scripts.
                        The stored name decides (the server derives its extension from the uploaded file), not the display name,
                        which anybody can change.
     fileOf(task, att)  the files object ({ id, file, name, ... } as in D().files) behind a task attachment. Attachments carry the
                        record's id; data from before that is found by name (same task first, then same project). null if none.
     uploadFile(app, blob, { onProgress })
                        Creates the files record on the server with the blob (multipart, through an XMLHttpRequest because only that
                        reports upload progress; fetch cannot) and puts the answer into S.data without the diff sending it again
                        (adopt in sync.js). `app` is the app's file object: { id, project, task, name, type, size, by, at }, which
                        goes through the same toRecord() mapping as every other sync. onProgress gets 0..1. Resolves with the object
                        in D().files, or null when the session ended while the upload ran (nothing is added then). Sends what is
                        unsaved first, so a project created a moment ago exists on the server. Rejects with a
                        ClientResponseError: status 0 is "cannot reach the server", isAbort is a cancelled upload.
     uploadMessage(err) the server's reason for a rejected upload, as a sentence
     downloadFile(f)    gets a file token (cached, see pb.js fileUrl) and starts the browser's download of `f`, a files object. The
                        URL carries download=true, so the server answers `Content-Disposition: attachment` for every type and the
                        page is never replaced by the file. The saved name is the display name (server/pb_hooks/file_names.pb.js).

   Uploads end when the person signs out or becomes somebody else: a file of the old session must not land in the new one. */
import { ClientResponseError } from 'pocketbase';
import { authStore, fileUrl, pb } from './pb.js';
import { toFormData, toRecord } from './sync-map.js';
import { adopt, flush, hasUnsaved } from './sync.js';
import { D } from './store.js';

export const MAX_FILE_BYTES = 100 * 1024 * 1024;

const RASTER = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);
const extOf = name =>
  String(name ?? '')
    .split('.')
    .pop()
    .toLowerCase();
export const isRaster = f => !!f && RASTER.has(extOf(f.file));

/* ---------- attachments ---------- */
export function fileOf(task, att) {
  const files = D().files;
  return (
    files.find(x => x.id === att.id) ||
    files.find(x => x.name === att.name && x.task === task.id) ||
    files.find(x => x.name === att.name && x.project === task.project) ||
    null
  );
}

/* ---------- upload ---------- */
const running = new Map(); // XMLHttpRequest -> id of the user who started it

authStore.onChange(() => {
  for (const [xhr, who] of running) if (!authStore.isValid || authStore.record?.id !== who) xhr.abort();
});
/* Closing the tab would cut an upload off without a word. (sync.js asks about unsaved changes the same way.) */
addEventListener('beforeunload', e => {
  if (!running.size) return;
  e.preventDefault();
  e.returnValue = '';
});

function post(form, onProgress) {
  return new Promise((resolve, reject) => {
    const url = pb.buildURL('/api/collections/files/records');
    const xhr = new XMLHttpRequest();
    const fail = (status, response = {}, isAbort = false) => {
      running.delete(xhr);
      reject(new ClientResponseError({ url, status, response, isAbort }));
    };
    xhr.open('POST', url);
    if (authStore.token) xhr.setRequestHeader('Authorization', authStore.token);
    xhr.upload.onprogress = e => {
      if (e.lengthComputable && e.total) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      let body = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* a proxy's error page, say: no details to read */
      }
      if (xhr.status < 200 || xhr.status > 299) return fail(xhr.status, body);
      running.delete(xhr);
      resolve(body);
    };
    xhr.onerror = () => fail(0);
    xhr.ontimeout = () => fail(0);
    xhr.onabort = () => fail(0, {}, true);
    running.set(xhr, authStore.record?.id || '');
    xhr.send(form);
  });
}

export async function uploadFile(app, blob, { onProgress } = {}) {
  const who = authStore.record?.id || '';
  // The record points at its project, which may still be on its way to the server (created a moment ago): let it arrive first.
  if (hasUnsaved()) await flush();
  if (!who || authStore.record?.id !== who) return null; // signed out meanwhile
  const form = toFormData(toRecord('files', app, { me: who }), blob, blob.name);
  const rec = await post(form, onProgress);
  if (authStore.record?.id !== who) return null;
  return adopt('files', rec);
}

export function uploadMessage(err) {
  const r = err?.response || {};
  if (err?.status === 413) return 'The server does not accept a file this large.';
  const [, detail] = Object.entries(r.data || {})[0] || [];
  return detail?.message || r.message || err?.message || 'Unknown error';
}

/* ---------- download ---------- */
export async function downloadFile(f) {
  if (!f?.file) throw new Error("This file isn't on the server.");
  const a = document.createElement('a');
  a.href = await fileUrl(f, { download: true });
  a.download = ''; // the name comes from the server's Content-Disposition
  a.rel = 'noopener';
  a.addEventListener('click', e => e.stopPropagation()); // the app's click handling has nothing to do with this one
  document.body.append(a);
  a.click();
  a.remove();
}
