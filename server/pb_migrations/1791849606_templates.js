/// <reference path="../pb_data/types.d.ts" />

/* Project templates. A workspace keeps the templates its admins and managers made from its own projects (New project offers them
   next to "Blank project"). A template is a name plus a `doc` with the icon, the colour and the task list to copy; the app's shape of
   it is in src/core/sync-map.js and src/core/normalize.js.

   Same record shape as the other collections: real columns for what rules and filters need (the workspace, the name) and one `doc`.
   Deleting a workspace deletes its templates, as it already deletes its teams and projects.

   Everyone signed in reads every workspace's templates, as they read its teams. Creating, editing and deleting is for admins and
   managers only: the app hides the buttons from members, and this is what keeps them out when they talk to the API. The role is the
   one on the requester's account (`@request.auth.role`), the same field the other rules read.

   Limits that keep a template written through the API small: a name of up to 80 characters (TEMPLATE_NAME_MAX in
   src/core/constants.js) and a `doc` of up to 2 MB. The count of tasks (300) and of subtasks per task (50) is the app's: it cuts a
   template to those on reading it (normalize.js) and on copying it into a project. A template cannot be moved to another workspace:
   an update may name the workspace only if it is the one the template already has. */

const MB = 1024 * 1024;
const SIGNED_IN = '@request.auth.id != ""';
const CAN_MANAGE = SIGNED_IN + ' && (@request.auth.role = "admin" || @request.auth.role = "manager")';
const STAYS_IN_WORKSPACE = '(@request.body.workspace:isset = false || @request.body.workspace = workspace)';

migrate(
  app => {
    app.save(
      new Collection({
        type: 'base',
        name: 'templates',
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
          { type: 'json', name: 'doc', maxSize: 2 * MB },
          { type: 'autodate', name: 'created', onCreate: true, onUpdate: false },
          { type: 'autodate', name: 'updated', onCreate: true, onUpdate: true },
        ],
        indexes: ['CREATE INDEX `idx_templates_workspace` ON `templates` (`workspace`)'],
      }),
    );
  },
  app => {
    app.delete(app.findCollectionByNameOrId('templates'));
  },
);
