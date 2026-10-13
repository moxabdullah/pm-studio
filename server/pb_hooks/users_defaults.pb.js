/// <reference path="../pb_data/types.d.ts" />

// Accounts are created by hand in the dashboard, usually with just an email, password and name. Fill in what the app expects:
// the lowest role (the field is required), and a public email (the Members page lists everyone's address, and PocketBase hides it
// from other users unless this is on). Runs whichever way a user gets created; an admin can still change both afterwards.
onRecordCreate(e => {
  if (!e.record.getString('role')) e.record.set('role', 'member');
  e.record.set('emailVisibility', true);
  e.next();
}, 'users');
