/// <reference path="../pb_data/types.d.ts" />

/* Phase 1 schema: every collection, field, index and access rule.

   Each record collection keeps a few real columns (what rules and filters need) plus one `doc` JSON field
   that holds the rest of the app object as-is. The column <-> app-field mapping lives in src/core/sync-map.js.

   Access model:
   - Everything needs a signed-in user (server/pb_hooks/auth_required.pb.js turns guests away with 401 first).
   - A project is visible when it is not private, the requester is one of its members, or the requester is an admin.
     Tasks, comments, activity, files and events inherit that from their project.
   - notifs, saved_views and user_prefs belong to one user. Only admins create users; there is no public sign-up.

   Rule syntax notes (verified on PocketBase 0.40.5):
   - `members.id ?= @request.auth.id` matches a multi-relation. `members ?= @request.auth.id` looks equivalent but does not match.
   - Create rules see the new record's own fields (`private`, `project.members.id`, `uploaded_by`, ...).
   - A rule can follow a relation in the request body (`@request.body.project.private`). The update rules use that so a record
     can't be moved into a private project its editor can't see.
   - `@request.body.role` is the value PocketBase would store, so the role rule also catches arrays, `role+` and multipart forms.
     `+role` slips past the check but cannot change a single select. Re-test all of this after upgrading PocketBase. */

const MB = 1024 * 1024;

const SIGNED_IN = '@request.auth.id != ""';
const IS_ADMIN = '@request.auth.role = "admin"';
const ADMIN_ONLY = SIGNED_IN + ' && ' + IS_ADMIN;
const ANY_USER = SIGNED_IN;
// `path` is the relation path from the record being checked to its project: '' on projects, 'project.' on tasks, ...
const visible = path => '(' + path + 'private = false || ' + path + 'members.id ?= @request.auth.id || ' + IS_ADMIN + ')';
const inProject = path => SIGNED_IN + ' && ' + visible(path);
const ownedBy = field => SIGNED_IN + ' && ' + field + ' = @request.auth.id';

// An update may re-point `field` only at a parent the requester can see (`path` leads from that parent to its project).
// Absent from the body means unchanged. `optional` also accepts clearing the link.
const movableTo = (field, path, optional) =>
  '(@request.body.' + field + ':isset = false || ' + (optional ? '@request.body.' + field + ' = "" || ' : '') + visible('@request.body.' + path) + ')';
// An update may not hand a personal record to somebody else.
const staysWithOwner = field => '(@request.body.' + field + ':isset = false || @request.body.' + field + ' = @request.auth.id)';

// Activity can hang off a project, a task, both or neither. Whatever it hangs off must be visible.
const ACTIVITY_VISIBLE = SIGNED_IN + ' && (project = "" || ' + visible('project.') + ') && (task = "" || ' + visible('task.project.') + ')';

// A user may edit their own profile but not their own role; only admins change roles (Phase 2 refines this).
const USER_UPDATE = SIGNED_IN + ' && (' + IS_ADMIN + ' || (id = @request.auth.id && (@request.body.role:isset = false || @request.body.role = role)))';

const text = (name, extra) => Object.assign({ type: 'text', name: name }, extra);
const bool = name => ({ type: 'bool', name: name });
const number = name => ({ type: 'number', name: name });
const doc = () => ({ type: 'json', name: 'doc', maxSize: 5 * MB });
const timestamps = () => [
  { type: 'autodate', name: 'created', onCreate: true, onUpdate: false },
  { type: 'autodate', name: 'updated', onCreate: true, onUpdate: true },
];
const index = (table, column, unique) =>
  'CREATE ' + (unique ? 'UNIQUE ' : '') + 'INDEX `idx_' + table + '_' + column + '` ON `' + table + '` (`' + column + '`)';

migrate(
  app => {
    const idOf = name => app.findCollectionByNameOrId(name).id;
    const relation = (name, target, opts) => {
      const o = opts || {};
      return {
        type: 'relation',
        name: name,
        collectionId: idOf(target),
        required: !!o.required,
        cascadeDelete: !!o.cascade,
        minSelect: 0,
        maxSelect: o.multiple ? 999 : 1,
      };
    };
    // rules: { read, create, update, delete } (read covers list and view)
    const create = (name, rules, fields, indexes) => {
      app.save(
        new Collection({
          type: 'base',
          name: name,
          listRule: rules.read,
          viewRule: rules.read,
          createRule: rules.create,
          updateRule: rules.update,
          deleteRule: rules.delete,
          fields: fields.concat([doc()], timestamps()),
          indexes: indexes.map(c => index(name, c[0], c[1])),
        }),
      );
    };
    const all = rule => ({ read: rule, create: rule, update: rule, delete: rule });

    // ---- users (built-in auth collection) ----
    const users = app.findCollectionByNameOrId('users');
    users.fields.add(new Field(text('title')));
    users.fields.add(new Field(text('color')));
    users.fields.add(new Field(text('status')));
    users.fields.add(new Field({ type: 'select', name: 'role', values: ['admin', 'manager', 'member'], maxSelect: 1, required: true }));
    users.fields.add(new Field(doc()));
    users.listRule = ANY_USER;
    users.viewRule = ANY_USER;
    users.createRule = ADMIN_ONLY;
    users.updateRule = USER_UPDATE;
    users.deleteRule = ADMIN_ONLY;
    users.manageRule = ADMIN_ONLY;
    users.authToken.duration = 30 * 24 * 60 * 60; // the login page promises "Remember me for 30 days"
    // No SMTP in Phase 1, so every new-device login would log "Failed to send login alert". Switch it on together with SMTP.
    users.authAlert.enabled = false;
    app.save(users);
    // accounts that predate the role column count as members
    app.db().newQuery("UPDATE users SET role = 'member' WHERE role = '' OR role IS NULL").execute();

    // ---- workspaces and teams ----
    create('workspaces', { read: ANY_USER, create: ADMIN_ONLY, update: ADMIN_ONLY, delete: ADMIN_ONLY }, [text('name', { required: true }), text('color')], []);
    create('teams', all(ANY_USER), [relation('workspace', 'workspaces', { cascade: true }), text('name', { required: true })], [['workspace']]);

    // ---- projects and what hangs off them ----
    create(
      'projects',
      all(inProject('')),
      [
        relation('workspace', 'workspaces', { cascade: true }),
        relation('team', 'teams'),
        relation('lead', 'users'),
        bool('private'),
        relation('members', 'users', { multiple: true }),
        bool('archived'),
        number('order'),
      ],
      [['workspace'], ['team']],
    );
    create(
      'tasks',
      Object.assign(all(inProject('project.')), { update: inProject('project.') + ' && ' + movableTo('project', 'project.') }),
      [relation('project', 'projects', { required: true, cascade: true }), text('status'), relation('assignee', 'users'), bool('archived')],
      [['project'], ['assignee']],
    );
    // Comments and activity: no author check on create (undo re-creates colleagues' entries). Author ownership arrives with Phase 2 permissions.
    create(
      'comments',
      Object.assign(all(inProject('task.project.')), { update: inProject('task.project.') + ' && ' + movableTo('task', 'task.project.') }),
      [relation('task', 'tasks', { required: true, cascade: true }), relation('author', 'users')],
      [['task']],
    );
    create(
      'activity',
      Object.assign(all(ACTIVITY_VISIBLE), {
        update: ACTIVITY_VISIBLE + ' && ' + movableTo('project', 'project.', true) + ' && ' + movableTo('task', 'task.project.', true),
      }),
      [relation('project', 'projects', { cascade: true }), relation('task', 'tasks', { cascade: true }), relation('by', 'users')],
      [['project'], ['task']],
    );
    create(
      'notifs',
      Object.assign(all(ownedBy('recipient')), { create: ANY_USER, update: ownedBy('recipient') + ' && ' + staysWithOwner('recipient') }),
      [relation('recipient', 'users', { required: true, cascade: true })],
      [['recipient']],
    );
    create(
      'files',
      Object.assign(all(inProject('project.')), {
        create: inProject('project.') + ' && uploaded_by = @request.auth.id',
        update: inProject('project.') + ' && ' + movableTo('project', 'project.'),
      }),
      [
        relation('project', 'projects', { required: true, cascade: true }),
        relation('uploaded_by', 'users'),
        { type: 'file', name: 'file', maxSelect: 1, maxSize: 100 * MB, protected: true, required: true },
      ],
      [['project']],
    );
    create(
      'events',
      Object.assign(all(inProject('project.')), { update: inProject('project.') + ' && ' + movableTo('project', 'project.') }),
      [relation('project', 'projects', { required: true, cascade: true })],
      [['project']],
    );

    // ---- per-user data ----
    create(
      'saved_views',
      Object.assign(all(ownedBy('owner')), { update: ownedBy('owner') + ' && ' + staysWithOwner('owner') }),
      [relation('project', 'projects', { required: true, cascade: true }), relation('owner', 'users', { required: true, cascade: true })],
      [['project'], ['owner']],
    );
    create(
      'user_prefs',
      Object.assign(all(ownedBy('user')), { update: ownedBy('user') + ' && ' + staysWithOwner('user') }),
      [relation('user', 'users', { required: true, cascade: true })],
      [['user', true]],
    );

    const settings = app.settings();
    settings.meta.appName = 'PM Space';
    app.save(settings);
  },
  app => {
    ['user_prefs', 'saved_views', 'events', 'files', 'notifs', 'activity', 'comments', 'tasks', 'projects', 'teams', 'workspaces'].forEach(name => {
      app.delete(app.findCollectionByNameOrId(name));
    });

    // back to the PocketBase defaults
    const users = app.findCollectionByNameOrId('users');
    users.listRule = 'id = @request.auth.id';
    users.viewRule = 'id = @request.auth.id';
    users.createRule = '';
    users.updateRule = 'id = @request.auth.id';
    users.deleteRule = 'id = @request.auth.id';
    users.manageRule = null;
    users.authToken.duration = 432000;
    users.authAlert.enabled = true;
    ['doc', 'role', 'status', 'color', 'title'].forEach(name => users.fields.removeByName(name));
    app.save(users);

    const settings = app.settings();
    settings.meta.appName = 'Acme';
    app.save(settings);
  },
);
