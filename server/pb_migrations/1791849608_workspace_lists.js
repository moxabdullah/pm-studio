/// <reference path="../pb_data/types.d.ts" />

/* Workspace lists. A workspace keeps one record here, holding the lists its admins and managers edit in Settings: the task labels now
   (Settings > Labels), the project fields next. The record is a workspace and one `doc`; the `doc` holds each list under its own key
   (`labels`: [{ id, name, colour key }] in display order). The app's shape of it is in src/core/sync-map.js and src/core/normalize.js.
   A workspace with no record, or a record without a `labels` key, uses the built-in labels (DEFAULT_LABELS in src/core/constants.js),
   which are not records; a `labels` list that is empty means no labels.

   One record per workspace: the unique index on `workspace` refuses a second one (two admins saving the first list at once), and the
   app then puts its own back. The `doc` is not split into a column per list because nothing filters on it, and because a list is
   always read and written whole.

   Deleting a workspace deletes its lists, as it already deletes its teams, projects, templates and stage sets.

   Everyone signed in reads every workspace's lists, as they read its stage sets and templates. Creating, editing and deleting is for
   admins and managers only: the app hides the buttons from members, and this is what keeps them out when they talk to the API. The
   role is the one on the requester's account (`@request.auth.role`), the same field the other rules read.

   Limits that keep a record written through the API small: a `doc` of up to 256 KB. The count of labels (50), the length of a label
   name (30) and the colour keys are the app's: it cuts a list to those on reading it (normalize.js). A record cannot be moved to
   another workspace: an update may name the workspace only if it is the one the record already has. Whether a label still has tasks
   is the app's to check; the server does not look (tasks keep their labels in their doc). */

const KB = 1024;
const SIGNED_IN = '@request.auth.id != ""';
const CAN_MANAGE = SIGNED_IN + ' && (@request.auth.role = "admin" || @request.auth.role = "manager")';
const STAYS_IN_WORKSPACE = '(@request.body.workspace:isset = false || @request.body.workspace = workspace)';

migrate(
  app => {
    app.save(
      new Collection({
        type: 'base',
        name: 'workspace_lists',
        listRule: SIGNED_IN,
        viewRule: SIGNED_IN,
        createRule: CAN_MANAGE,
        updateRule: CAN_MANAGE + ' && ' + STAYS_IN_WORKSPACE,
        deleteRule: CAN_MANAGE,
        fields: [
          {
            type: 'relation',
            name: 'workspace',
            collectionId: app.findCollectionByNameOrId('workspaces').id,
            required: true,
            cascadeDelete: true,
            minSelect: 0,
            maxSelect: 1,
          },
          { type: 'json', name: 'doc', maxSize: 256 * KB },
          { type: 'autodate', name: 'created', onCreate: true, onUpdate: false },
          { type: 'autodate', name: 'updated', onCreate: true, onUpdate: true },
        ],
        indexes: ['CREATE UNIQUE INDEX `idx_workspace_lists_workspace` ON `workspace_lists` (`workspace`)'],
      }),
    );
  },
  app => {
    app.delete(app.findCollectionByNameOrId('workspace_lists'));
  },
);
