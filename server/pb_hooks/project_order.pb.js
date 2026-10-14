/// <reference path="../pb_data/types.d.ts" />

// The server picks where a new project goes in the list.
//
// `projects.order` ranks every project of every workspace (a lower value is listed earlier), and the app puts a new project first. A
// client cannot choose that value on its own: a member does not see a private project, so the lowest value it knows is not the lowest
// there is, and the value it picks for a new project can equal a hidden one's. So when a signed-in user (not a superuser) creates a
// project, whatever `order` the request carries is replaced by one less than the lowest `order` of ALL projects, private ones included.
// The app still sends a value, a placeholder it shows until the answer comes back; the answer carries the real one.
//
// Superusers keep what they send: the dev seed and the imports create projects in an order of their own.
// Nothing here widens access. PocketBase has already checked the create rule when this hook runs, and the hook only sets `order`.
//
// Why a transaction. The lowest value is read first and written afterwards; if another create ran in between, both would take the same
// value. PocketBase has a single database connection for writing, and a transaction keeps every other write waiting until it ends, so
// reading the lowest value inside one (through txApp, not through the app that arrived with the request) and saving the project in
// the same transaction means the next create reads the value this one wrote. The same shape as pb_hooks/doc_patch.pb.js.
// Verified on PocketBase 0.40.5: 6 rounds of 12 simultaneous creates (72 projects) all got different values; without the transaction
// (the same hook with the read and the save outside it) 28 of the 72 repeated a value. Re-test after upgrading PocketBase.
//
// What it does not cover:
//   - Projects created some other way than through the API by a non-superuser (a migration, server code, a superuser) keep their own
//     value, and two projects may then share one. Ties are settled by id in the app (projOrderFrom in src/core/sync-map.js), so the
//     list stays stable; it is only cosmetic.
//   - A rolled-back create leaves no trace: the value was never saved, and the next create takes it.
//   - Reordering is the app's business: an update of `order` is not touched.
onRecordCreateRequest(e => {
  if (e.hasSuperuserAuth()) return e.next();

  const app = e.app;
  try {
    app.runInTransaction(txApp => {
      // MIN is NULL without projects; then the first one gets 0 (COALESCE(.., 1) - 1). The fraction in the template makes the field a
      // float: with a whole number it is an integer, and scanning a fractional order (the app writes those) into it fails.
      const row = new DynamicModel({ lowest: 0.5 });
      txApp.db().newQuery('SELECT COALESCE(MIN(`order`), 1) AS lowest FROM projects').one(row);
      e.record.set('order', row.lowest - 1);

      // Everything PocketBase does from here on (the save, the hooks around it, the realtime events) must use the transaction.
      e.app = txApp;
      e.next();
    });
  } finally {
    e.app = app;
  }
}, 'projects');
