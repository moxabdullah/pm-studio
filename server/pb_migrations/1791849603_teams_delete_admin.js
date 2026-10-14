/// <reference path="../pb_data/types.d.ts" />

/* Only an admin can delete a team. Deleting one also clears it from each member's account (the `team` field in their `doc`), and
   only an admin can write another user's account, so a delete by anyone else left those members pointing at a team that is gone.
   Reading, creating and editing teams stay open to every signed-in user, as before. */
migrate(
  app => {
    const teams = app.findCollectionByNameOrId('teams');
    teams.deleteRule = '@request.auth.id != "" && @request.auth.role = "admin"';
    app.save(teams);
  },
  app => {
    const teams = app.findCollectionByNameOrId('teams');
    teams.deleteRule = '@request.auth.id != ""';
    app.save(teams);
  },
);
