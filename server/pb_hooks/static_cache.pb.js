/// <reference path="../pb_data/types.d.ts" />

// PocketBase serves the built app without Cache-Control. Each build renames the hashed asset files, so a browser that kept an old
// index.html would point at files that are gone and show a blank page. Ask for revalidation on every HTML response (the page itself
// and the fallback for app routes). The hashed assets stay cacheable; the API and the dashboard are left alone.
routerUse(e => {
  const path = e.request.url.path;
  const app = path !== '/api' && !path.startsWith('/api/') && path !== '/_' && !path.startsWith('/_/');
  const html = path.endsWith('/') || path.endsWith('.html') || !path.split('/').pop().includes('.');
  if (app && html) e.response.header().set('Cache-Control', 'no-cache');
  return e.next();
});
