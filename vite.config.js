import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { icons as lucide } from 'lucide';

/* `virtual:icons` exports only the Lucide icons the source actually names, as inline SVG markup,
   so the bundle carries ~170 icons instead of the full set. Any quoted kebab-case token in src/
   that matches a Lucide icon name is included. */
function lucideSubset() {
  const id = 'virtual:icons',
    resolved = '\0' + id;
  const walk = dir =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
      const p = path.join(dir, e.name);
      return e.isDirectory() ? walk(p) : /\.js$/.test(e.name) ? [p] : [];
    });
  const pascal = n =>
    n
      .split('-')
      .map(p => p[0].toUpperCase() + p.slice(1))
      .join('');
  return {
    name: 'lucide-subset',
    resolveId: s => (s === id ? resolved : null),
    load(s) {
      if (s !== resolved) return null;
      const text = walk(path.resolve('src'))
        .map(f => fs.readFileSync(f, 'utf8'))
        .join('\n');
      const names = [...new Set([...text.matchAll(/['"`]([a-z][a-z0-9]*(?:-[a-z0-9]+)*)['"`]/g)].map(m => m[1]))].filter(n => lucide[pascal(n)]).sort();
      const out = {};
      for (const n of names) {
        let node = lucide[pascal(n)];
        if (node[0] === 'svg') node = node[2];
        out[n] = node
          .map(
            ([t, a]) =>
              `<${t} ${Object.entries(a)
                .filter(([k]) => k !== 'key')
                .map(([k, v]) => `${k}="${v}"`)
                .join(' ')}/>`,
          )
          .join('');
      }
      return `export const ICONS = ${JSON.stringify(out)};`;
    },
  };
}

export default defineConfig({
  plugins: [lucideSubset()],
  server: {
    port: 5173,
    /* The app talks to PocketBase on the same origin. In dev that means this proxy; in production PocketBase serves the app.
       Realtime updates are a long-lived server-sent-events stream on /api/realtime. http-proxy passes it through unbuffered and
       sets no timeouts of its own. When PocketBase is down the browser should see a network failure, as it does in production,
       so the connection is dropped instead of answering with Vite's HTTP 500. */
    proxy: {
      '/api': {
        target: process.env.PB_URL || 'http://127.0.0.1:8090',
        changeOrigin: true,
        configure: proxy => proxy.on('error', (_err, _req, res) => res?.destroy?.()),
      },
    },
  },
});
