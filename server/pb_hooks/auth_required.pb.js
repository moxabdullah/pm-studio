/// <reference path="../pb_data/types.d.ts" />

// Collection rules alone don't turn guests away: with `@request.auth.id != ""` an anonymous list returns 200 with
// no items and a view returns 404. This answers 401 for any anonymous record request instead. Sign-in
// (auth-with-password, auth-methods), health, realtime and file URLs live on other paths and are not affected.
routerUse(e => {
  if (!e.auth && /^\/api\/collections\/[^/]+\/records(\/|$)/.test(e.request.url.path)) {
    throw new UnauthorizedError('Sign in to access this resource.');
  }
  return e.next();
});
