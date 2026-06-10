/**
 * Walks the live Express router stack and emits a manifest of every route:
 * { method, path, guards }. The authz-matrix integration test asserts every
 * entry is classified (role × own-org/cross-org → expected status); a newly
 * added route therefore shows up as an unclassified manifest entry → the test
 * fails until someone classifies it. That's the drift-detection guarantee.
 *
 * `guards` is best-effort: it records the names of recognizable guard middleware
 * (requireAuth/requireOrg/requireRole) on each route. requireRole returns an
 * anonymous closure, so it surfaces as an unnamed guard — the matrix test pins
 * the real behavior via actual status codes regardless.
 *
 * Run:  pnpm --filter @hearth/api route-manifest
 */
process.env.NODE_ENV ??= 'test'; // skip httpServer.listen + provider load on import

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const { app } = await import('../src/index.js');

interface RouteEntry {
  method: string;
  path: string;
  guards: string[];
}

const KNOWN_GUARDS = new Set(['requireAuth', 'requireOrg', 'requireRole', 'attachUser', 'csrfProtection']);

/** Decode an Express mount-path regexp (e.g. /^\/api\/v1\/auth\/?(?=\/|$)/) → "/api/v1/auth". */
function decodeMountPath(layer: { regexp?: RegExp & { fast_slash?: boolean } }): string {
  const re = layer.regexp;
  if (!re || re.fast_slash) return '';
  const src = re.source;
  const m =
    src.match(/^\^\\\/(.*?)\\\/\?\(\?=\\\/\|\$\)$/) ?? src.match(/^\^\\\/(.*?)\\\/\?\$$/);
  if (!m) return '';
  return '/' + m[1].replace(/\\\//g, '/');
}

function guardsFor(routeStack: Array<{ name?: string; handle?: { name?: string } }>): string[] {
  const names = new Set<string>();
  for (const l of routeStack) {
    const n = l.name ?? l.handle?.name ?? '';
    if (KNOWN_GUARDS.has(n)) names.add(n);
  }
  return [...names];
}

function walk(
  stack: Array<Record<string, unknown>>,
  prefix: string,
  out: RouteEntry[],
): void {
  for (const layer of stack) {
    const route = layer.route as
      | { path: string; methods: Record<string, boolean>; stack: Array<{ name?: string }> }
      | undefined;
    if (route) {
      const methods = Object.keys(route.methods).filter((m) => route.methods[m]);
      for (const method of methods) {
        out.push({
          method: method.toUpperCase(),
          path: (prefix + route.path).replace(/\/{2,}/g, '/') || '/',
          guards: guardsFor(route.stack),
        });
      }
    } else if (layer.name === 'router' && (layer.handle as { stack?: unknown[] })?.stack) {
      const mount = decodeMountPath(layer as { regexp?: RegExp });
      walk((layer.handle as { stack: Array<Record<string, unknown>> }).stack, prefix + mount, out);
    }
  }
}

const router = (app as unknown as { _router?: { stack: Array<Record<string, unknown>> } })._router;
if (!router) {
  throw new Error('Could not read app._router — Express internal layout may have changed.');
}

const routes: RouteEntry[] = [];
walk(router.stack, '', routes);
routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'route-manifest.json');
writeFileSync(outPath, JSON.stringify({ generatedRoutes: routes.length, routes }, null, 2) + '\n');

// eslint-disable-next-line no-console
console.log(`route-manifest: ${routes.length} routes → ${outPath}`);
const unguarded = routes.filter(
  (r) => r.method !== 'GET' && r.path.startsWith('/api/v1') && r.guards.length === 0,
);
if (unguarded.length) {
  // eslint-disable-next-line no-console
  console.log(`  note: ${unguarded.length} non-GET routes with no recognizable guard (review for authz):`);
  for (const r of unguarded.slice(0, 20)) console.log(`    ${r.method} ${r.path}`);
}

process.exit(0);
