/// <reference path="../pb_data/types.d.ts" />

/* Activity gets a workspace. A record used to hang off a project and/or a task and nothing else, so one that names neither (the
   server allows it, the app never wrote it) could not be placed in any workspace and was left out everywhere. Now each carries the
   workspace it belongs to: the app sets it when it writes the entry, and the Activity page shows an entry with no project in the
   workspace it names. An entry that has a project still follows the project's workspace.

   Existing rows are filled in here: from their project's workspace, else from their task's project's workspace. A row that names
   neither (or whose project or task is gone) stays without one, as before. `workspace` is not required: records written by an older
   app have none, and they keep loading.

   The create and update rules gain a condition; everything the first migration requires stays (whoever may read or write an entry is
   still decided by its project and task). Every signed-in user can read every workspace, so without it the workspace would be a label
   anybody could put on any entry: a forged "deleted project" in another workspace's feed, or an entry whose project is in one workspace
   and whose workspace is another, which deleting that workspace would then remove along with a project that survives. So the workspace
   an entry names must agree with what it hangs off:
     - none (the app leaves it out when it has nothing to name), or
     - the project's workspace, when it has a project, or
     - the workspace of its task's project, when it has a task but no project.
   An entry that names neither a project nor a task can therefore not name a workspace; the app never writes one (a deleted project
   takes its entries along). Deleting a workspace deletes the entries that name it, as it already deletes its projects (and so their
   entries).

   An update leaves the stored row alone for what the request does not send, so the rule checks the row as it will be after the
   update: each of workspace, project and task is taken from the request when it sends it (`@request.body.<field>:isset`) and from the
   stored row when not. That makes eight cases, written out by `afterUpdate` below. An update that sends none of the three is not
   checked, so a row that already disagrees with itself (from a superuser, or from before this migration) can still be edited in other
   respects; changing one of the three has to leave it in agreement. A refused update answers 404, as for any other update rule. */

// The workspace `w` of an entry agrees with its project `p` and task `t`. Each is a field name or the request's value for it.
const consistent = (w, p, t) => {
  const ofProject = '(' + p + ' != "" && ' + p + '.workspace = ' + w + ')';
  const ofTask = '(' + p + ' = "" && ' + t + ' != "" && ' + t + '.project.workspace = ' + w + ')';
  return '(' + w + ' = "" || ' + ofProject + ' || ' + ofTask + ')';
};
const FIELDS = ['workspace', 'project', 'task'];
const afterUpdate = () => {
  const cases = [];
  for (let n = 0; n < 8; n++) {
    const sent = FIELDS.map((_, i) => !!((n >> i) & 1));
    const parts = FIELDS.map((f, i) => '@request.body.' + f + ':isset = ' + sent[i]);
    if (n) parts.push(consistent(...FIELDS.map((f, i) => (sent[i] ? '@request.body.' + f : f))));
    cases.push('(' + parts.join(' && ') + ')');
  }
  return '(' + cases.join(' || ') + ')';
};
const ON_CREATE = ' && ' + consistent(...FIELDS);
const ON_UPDATE = ' && ' + afterUpdate();
const without = (rule, tail) => (rule.endsWith(tail) ? rule.slice(0, -tail.length) : rule);

migrate(
  app => {
    const activity = app.findCollectionByNameOrId('activity');
    activity.fields.add(
      new Field({
        type: 'relation',
        name: 'workspace',
        collectionId: app.findCollectionByNameOrId('workspaces').id,
        required: false,
        cascadeDelete: true,
        minSelect: 0,
        maxSelect: 1,
      }),
    );
    activity.addIndex('idx_activity_workspace', false, '`workspace`', '');
    // each rule gains a condition and keeps the old ones
    activity.createRule += ON_CREATE;
    activity.updateRule += ON_UPDATE;
    app.save(activity); // adds the column; the backfill below needs it

    // COALESCE: a project or task that is gone (the relation would be dangling) leaves '' rather than NULL
    app
      .db()
      .newQuery("UPDATE activity SET workspace = COALESCE((SELECT workspace FROM projects WHERE projects.id = activity.project), '') WHERE project != ''")
      .execute();
    app
      .db()
      .newQuery(
        "UPDATE activity SET workspace = COALESCE((SELECT p.workspace FROM tasks t JOIN projects p ON p.id = t.project WHERE t.id = activity.task), '') WHERE workspace = '' AND task != ''",
      )
      .execute();
  },
  app => {
    const activity = app.findCollectionByNameOrId('activity');
    // the rules go first (in the same save): a rule cannot name a field that is not there
    activity.createRule = without(activity.createRule, ON_CREATE);
    activity.updateRule = without(activity.updateRule, ON_UPDATE);
    activity.removeIndex('idx_activity_workspace');
    activity.fields.removeByName('workspace');
    app.save(activity);
  },
);
