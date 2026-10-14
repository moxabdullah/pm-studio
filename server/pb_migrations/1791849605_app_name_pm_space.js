/// <reference path="../pb_data/types.d.ts" />

/* The product is named PM Space. A server set up earlier stores another application name (Settings > Application in the dashboard; it
   appears in the e-mails PocketBase sends and in the names of automatic backups). This sets it on every existing install, replacing
   whatever is stored, including a name an admin chose. A new install gets the same name from the first migration. */
migrate(
  app => {
    const settings = app.settings();
    settings.meta.appName = 'PM Space';
    app.save(settings);
  },
  () => {
    // nothing to undo: the name that was there is not kept, so there is no earlier value to put back
  },
);
