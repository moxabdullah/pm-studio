/// <reference path="../pb_data/types.d.ts" />

// Per-key writes for the `doc` JSON field, and updates that cannot write stale data back.
//
// Besides its few real columns, every record keeps what the app needs in one `doc` JSON field. Saving that field whole means the
// last save wins for ALL its keys: a client holding a 200 ms old copy, saving only because the task was marked done, undoes the words
// someone else typed into the description a moment before (and two people changing different keys, say subtasks and title, undo
// each other the same way). So an update names only what it changes:
//
//   PATCH /api/collections/tasks/records/:id
//   { "status": "done", "docPatch": { "desc": "<p>new</p>", "est": "3d" }, "docUnset": ["recur"] }
//
//   docPatch  a plain object: top-level doc key -> its new value (null is a value, not a removal)
//   docUnset  an array of top-level doc keys to remove (applied after docPatch, so a key named in both ends up removed)
//
// Creates keep sending the whole doc, and so does any update that sends `doc` itself (the dashboard, an import): those are saved
// exactly as before. `doc` together with docPatch or docUnset is ambiguous and answers 400, as does anything malformed.
//
// Nothing here widens access. PocketBase has already checked the collection's update rule against the stored record when this hook
// runs, so a user who may not update it never gets here (404), and a patch only ever changes `doc`: the rules' guards on re-pointing
// a record and on roles look at columns and apply as before.
//
// Why a transaction. PocketBase loads the record when the request arrives and, on save, writes ALL its columns back from that copy.
// The copy is as old as the request has waited, and writes queue for PocketBase's single database connection for writing, so applying
// a patch to it loses keys as soon as two writes overlap (the older copy overwrites the other's key). Every update that does not send
// `doc` therefore runs inside a transaction, which keeps every other write waiting until it ends, and inside it:
//   1. the stored row is read again,
//   2. `doc` becomes the stored doc with docPatch applied and docUnset removed (with neither: the stored doc as it is),
//   3. every plain column (text, number, bool, select, relation) the request did NOT change takes its stored value, so a request that
//      changes `status` cannot put back a stale `assignee`, and the answer and the realtime event carry the committed row,
//   4. the save and everything PocketBase does around it (validation, events, the answer) go on as usual, inside the transaction.
// Updates that only change columns take this path too: left alone, they would write their stale copy of `doc` over somebody's patch.
//
// What it does not cover:
//   - The same key written by two people at once: the later commit wins (two values of one key cannot be merged).
//   - Anything that writes `doc` whole: a request that sends `doc`, a migration, server code.
//   - Fields step 3 leaves alone (system fields such as the verified flag, the password hash, files, dates), and columns the request
//     does change (a modifier like `members+` is worked out by PocketBase from its early copy; the app sends whole values): they keep
//     PocketBase's own behaviour, so a change to one of those made within the same few milliseconds can be undone.
//   - The answer is written inside the transaction, so a commit that fails afterwards (disk full) would have answered 200 for a write
//     that was rolled back; the next load shows the truth.
//   - A server without this file ignores docPatch and docUnset without a word (and answers 200). So every answer to a PATCH of a
//     record carries the header X-Doc-Patch: yes (the routerUse at the end of this file); the app takes its absence as "no hook" and
//     falls back to sending the whole doc (src/core/sync.js).
// Verified on PocketBase 0.40.5: 8 simultaneous patches to one record, 60 times over, lose nothing, and neither do simultaneous
// updates of different columns; without the transaction about half of the keys are lost. Re-test after upgrading PocketBase.
// The cost is one extra read of the record per update, and about a millisecond for running the hook.
onRecordUpdateRequest(e => {
  // Handlers run in isolated runtimes, so everything they use is defined inside them.
  if (!e.collection.fields.getByName('doc')) return e.next();

  const body = e.requestInfo().body;
  const hasDoc = body.doc !== undefined;
  const hasPatch = body.docPatch !== undefined;
  const hasUnset = body.docUnset !== undefined;
  const invalid = (field, message) => new BadRequestError('Invalid doc patch.', { [field]: new ValidationError('validation_invalid_doc_patch', message) });

  if (hasDoc && (hasPatch || hasUnset)) throw invalid(hasPatch ? 'docPatch' : 'docUnset', 'Send either doc or docPatch/docUnset, not both.');
  if (hasDoc) return e.next();

  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const blocked = ['__proto__', 'constructor', 'prototype'];

  // The body holds Go maps and slices; a JSON round trip turns what we need into plain values.
  let patch = {};
  let unset = [];
  if (hasPatch) {
    patch = JSON.parse(JSON.stringify(body.docPatch));
    if (!isObject(patch)) throw invalid('docPatch', 'Must be an object of top-level doc keys and their new values.');
  }
  if (hasUnset) {
    unset = JSON.parse(JSON.stringify(body.docUnset));
    if (!Array.isArray(unset) || unset.some(key => typeof key !== 'string')) throw invalid('docUnset', 'Must be an array of top-level doc keys.');
  }

  const merge = stored => {
    let doc = {};
    try {
      const parsed = JSON.parse(stored);
      if (isObject(parsed)) doc = parsed;
    } catch {
      // a doc that is empty or not JSON starts over from nothing
    }
    for (const key of Object.keys(patch)) if (!blocked.includes(key)) doc[key] = patch[key];
    for (const key of unset) if (!blocked.includes(key)) delete doc[key];
    return doc;
  };

  const app = e.app;
  try {
    app.runInTransaction(txApp => {
      let stored;
      try {
        stored = txApp.findRecordById(e.collection.id, e.record.id);
      } catch (err) {
        if (String(err && err.message).includes('no rows')) throw new NotFoundError();
        throw err;
      }

      const original = e.record.original();
      const fields = e.collection.fields;
      for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        const name = field.getName();
        if (name === 'doc' || field.getSystem() || field.getHidden() || !['text', 'number', 'bool', 'select', 'relation'].includes(field.type())) continue;
        if (JSON.stringify(e.record.get(name)) === JSON.stringify(original.get(name))) e.record.set(name, stored.get(name));
      }
      e.record.set('doc', hasPatch || hasUnset ? merge(stored.getString('doc')) : stored.get('doc'));

      // Everything PocketBase does from here on (the save, the hooks around it, the realtime events) must use the transaction.
      e.app = txApp;
      e.next();
    });
  } finally {
    e.app = app;
  }
});

// Tells clients that this server applies docPatch and docUnset (see the last point above).
routerUse(e => {
  if (e.request.method === 'PATCH' && e.request.url.path.startsWith('/api/collections/')) e.response.header().set('X-Doc-Patch', 'yes');
  return e.next();
});
