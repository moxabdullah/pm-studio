/// <reference path="../pb_data/types.d.ts" />

/* Project stage sets. A workspace keeps the sets of stages its admins and managers made (Settings > Stages): a set is a name plus a
   `doc` with its stages in order, each with an id, a name, a colour key and a `finished` flag; a project names its set and its
   stage in its own doc. The app's shape of it is in src/core/sync-map.js and src/core/normalize.js. A workspace with no sets uses the
   built-in one (DEFAULT_STAGE_SET in src/core/constants.js), which is not a record.

   Same record shape as the other collections: real columns for what rules and filters need (the workspace, the name) and one `doc`.
   Deleting a workspace deletes its stage sets, as it already deletes its teams, projects and templates.

   Everyone signed in reads every workspace's stage sets, as they read its templates and teams. Creating, editing and deleting is for
   admins and managers only: the app hides the buttons from members, and this is what keeps them out when they talk to the API. The
   role is the one on the requester's account (`@request.auth.role`), the same field the other rules read.

   Limits that keep a record written through the API small: a name of up to 80 characters (STAGE_SET_NAME_MAX in
   src/core/constants.js) and a `doc` of up to 64 KB. The count of stages (30), the length of a stage name (40) and the colour keys
   are the app's: it cuts a set to those on reading it (normalize.js). A set cannot be moved to another workspace: an update may
   name the workspace only if it is the one the set already has. Whether a stage or a set still has projects in it is the app's to
   check; the server does not look (projects keep their stage in their doc). */

const KB = 1024;
const SIGNED_IN = '@request.auth.id != ""';
const CAN_MANAGE = SIGNED_IN + ' && (@request.auth.role = "admin" || @request.auth.role = "manager")';
const STAYS_IN_WORKSPACE = '(@request.body.workspace:isset = false || @request.body.workspace = workspace)';

migrate(
  app => {
    app.save(
      new Collection({
        type: 'base',
        name: 'stage_sets',
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
          { type: 'text', name: 'name', required: true, max: 80 },
          { type: 'json', name: 'doc', maxSize: 64 * KB },
          { type: 'autodate', name: 'created', onCreate: true, onUpdate: false },
          { type: 'autodate', name: 'updated', onCreate: true, onUpdate: true },
        ],
        indexes: ['CREATE INDEX `idx_stage_sets_workspace` ON `stage_sets` (`workspace`)'],
      }),
    );
  },
  app => {
    app.delete(app.findCollectionByNameOrId('stage_sets'));
  },
);
