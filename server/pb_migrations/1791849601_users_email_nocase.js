/// <reference path="../pb_data/types.d.ts" />

/* Email addresses are case-insensitive: John@Gr8rStudio.com signs in as john@gr8rstudio.com, and a second account that differs
   only by case is a duplicate. PocketBase matches an email case-insensitively only when the unique index on it is COLLATE NOCASE.
   If two existing accounts differ only by case, creating the index fails and the server won't start: merge or rename one first. */
const INDEX = 'idx_email__pb_users_auth_';

migrate(
  app => {
    const users = app.findCollectionByNameOrId('users');
    users.removeIndex(INDEX);
    users.addIndex(INDEX, true, '`email` COLLATE NOCASE', "`email` != ''");
    app.save(users);
  },
  app => {
    const users = app.findCollectionByNameOrId('users');
    users.removeIndex(INDEX);
    users.addIndex(INDEX, true, '`email`', "`email` != ''");
    app.save(users);
  },
);
