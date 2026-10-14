/// <reference path="../pb_data/types.d.ts" />

/* A notification can only be created for yourself. The first migration let any signed-in user create one, so a user could put
   entries into a colleague's inbox. The app only ever writes notifs with recipient = the signed-in user (src/core/sync-map.js), and
   read, update and delete already require recipient = the requester. Server code (hooks) is not bound by rules, so notifications
   for other people can still be written by a hook when that feature arrives. */
migrate(
  app => {
    const notifs = app.findCollectionByNameOrId('notifs');
    notifs.createRule = '@request.auth.id != "" && recipient = @request.auth.id';
    app.save(notifs);
  },
  app => {
    const notifs = app.findCollectionByNameOrId('notifs');
    notifs.createRule = '@request.auth.id != ""';
    app.save(notifs);
  },
);
