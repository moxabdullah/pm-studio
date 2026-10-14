/// <reference path="../pb_data/types.d.ts" />

// The server picks where a new project goes in the list.
//
// `projects.order` ranks every project of every workspace (a lower value is listed earlier), and the app puts a new project first. A
// client cannot choose that value on its own: a member does not see a private project, so the lowest value it knows is not the lowest
// there is, and the value it picks for a new project can equal a hidden one's. So when a signed-in user (not a superuser) creates a
// project, whatever `order` the request carries is replaced by one less than the lowest `order` of ALL projects, private ones included.
// The app still sends a value, a placeholder it shows until the answer comes back; the answer carries the real one.
//
// The server decides only on create. An update may still set `order` to any value within the limit below, including one equal to
// another project's, a private one's too; the app settles ties by id, so that is cosmetic (see the end of the list below).
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
//   - Reordering is the app's business. The update hook at the end of this file only keeps `order` in a range where stepping down by
//     one still gives a smaller number; inside it a user may set any value, one equal to another project's (a hidden one's too)
//     included. The visible order does not suffer (ties are settled by id), and it is only if that project is ever shown that it
//     lands next to the other one.
//   - A value outside the range that a superuser, a migration or the database itself put there is left alone: the update hook only
//     looks at a request that changes `order`, so members can still edit such a project. The create hook skips these values when it
//     looks for the lowest (see below), so new projects step down from the lowest value inside its window and do not tie; such a
//     project may still sort before every new one. The exception is a value less than one inside the window's edge (only a superuser
//     can set one): a step down from it leaves the window, and creates tie there.
onRecordCreateRequest(e => {
  if (e.hasSuperuserAuth()) return e.next();

  const app = e.app;
  try {
    app.runInTransaction(txApp => {
      // MIN is NULL without projects; then the first one gets 0 (COALESCE(.., 1) - 1). The fraction in the template makes the field a
      // float: with a whole number it is an integer, and scanning a fractional order (the app writes those) into it fails.
      // Only values within +-2^50 (about 1.1e15) count. Next to -1.7976931348623157e308, one less is the same number, so every new
      // project would take it and tie; a superuser can set such a value (an update by anybody else is refused below), and the database
      // can hold infinity. The window is far wider than the +-1e12 a user may set, so a value that passed the update hook, and the
      // steps of one below it that creates take, stay inside it (at this size a double still tells x from x - 1); that keeps each create
      // below the last. 2^50 and not 1e15 so that a round number somebody types to push a project to the top does not sit on the edge:
      // a value less than one inside the edge would step outside it, and then every create would tie.
      const row = new DynamicModel({ lowest: 0.5 });
      txApp.db().newQuery('SELECT COALESCE(MIN(`order`), 1) AS lowest FROM projects WHERE `order` BETWEEN -1125899906842624 AND 1125899906842624').one(row);
      e.record.set('order', row.lowest - 1);

      // Everything PocketBase does from here on (the save, the hooks around it, the realtime events) must use the transaction.
      e.app = txApp;
      e.next();
    });
  } finally {
    e.app = app;
  }
}, 'projects');

// Keeps `order` where the allocation above can work with it.
//
// The update rule puts no bound on `order`, so one member could save -1.7976931348623157e308: one less than that is the same
// number, and every project created afterwards would take it and tie. Only a superuser could undo it. So an update by anybody
// but a superuser may only set `order` to a finite number of at most 1e12 in size. The app never goes near that: creates step down
// by one from 0 and a reorder hands out the values that are already there or one between two neighbours (projectOrders in
// src/core/sync.js).
//
// What counts is the value PocketBase is about to save (`e.record`, loaded from the request before this runs), not the body key:
// `order+` and `order-` add to or subtract from the stored number, and the result is what is checked. A request that does not change
// `order` is not checked, so a project whose value a superuser left outside the range can still be renamed.
// PocketBase has already turned what the request sent into a number by then: "NaN" and "Infinity" arrive as such and are refused
// like any other value outside the range, but text that is not a number, null, a list or a boolean arrive as 0 or 1 and are saved
// as that (a harmless value; the hook cannot tell them from a 0 that was meant).
//
// What it does not cover:
//   - Superusers: they keep what they send, as on create (the dev seed, the imports). The create hook above copes with the values
//     they may leave behind.
//   - Anything that is not an update through the API (a migration, server code, the database).
onRecordUpdateRequest(e => {
  if (e.hasSuperuserAuth()) return e.next();

  // Handlers run in isolated runtimes, so everything they use is defined inside them. The same 1e12 is quoted in the comment above.
  const LIMIT = 1e12;

  const order = e.record.get('order');
  if (order !== e.record.original().get('order') && (!Number.isFinite(order) || Math.abs(order) > LIMIT)) {
    throw new BadRequestError('Invalid order.', {
      order: new ValidationError('validation_invalid_order', 'Must be a number between -1e12 and 1e12.'),
    });
  }
  return e.next();
}, 'projects');
