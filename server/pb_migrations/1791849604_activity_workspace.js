/// <reference path="../pb_data/types.d.ts" />

/* Activity gets a workspace. A record used to hang off a project and/or a task and nothing else, so one that names neither (the
   server allows it, the app never wrote it) could not be placed in any workspace and was left out everywhere. Now each carries the
   workspace it belongs to: the app sets it when it writes the entry, and the Activity page shows an entry with no project in the
   workspace it names. An entry that has a project still follows the project's workspace.

   Existing rows are filled in here: from their project's workspace, else from their task's project's workspace. A row that names
   neither (or whose project or task is gone) stays without one, as before. `workspace` is not required: records written by an older
   app have none, and they keep loading.

   The access rules stay as they are. Whoever may read or write an entry is still decided by its project and task; every signed-in
   user can read every workspace, so naming one gives nobody a view they did not have. Deleting a workspace deletes the entries that
   name it, as it already deletes its projects (and so their entries). */
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
    activity.removeIndex('idx_activity_workspace');
    activity.fields.removeByName('workspace');
    app.save(activity);
  },
);
