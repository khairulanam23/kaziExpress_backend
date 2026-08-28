/**
 * Regenerates `src/docs/openapi.json` from the routes that actually exist.
 *
 * The spec had drifted to documenting 22 of ~150 operations with the wrong
 * error envelope, which is worse than no spec: it is confidently wrong. Rather
 * than hand-maintain it, the route modules are loaded and their Express router
 * stacks read, so paths and methods cannot disagree with the server. Each route
 * file is then parsed for the middleware that guards it — `requirePermission`,
 * `checkRoles`, `isAuthorized` — and for the Zod validator attached to it, so
 * the security and request shape are derived rather than remembered.
 *
 * Run with: npm run docs:generate
 */
import fs from 'fs';
import path from 'path';

const MODULES_DIR = path.join(__dirname, '..', 'src', 'modules');
const OUTPUT = path.join(__dirname, '..', 'src', 'docs', 'openapi.json');
const BASE = '/api/v1';

interface RouteInfo {
  module: string;
  method: string;
  expressPath: string;
  fullPath: string;
  permission: string | null;
  roles: string[];
  authenticated: boolean;
  validator: string | null;
  comment: string | null;
}

/** Turn `/employees/:id` into `/employees/{id}` and collect the parameter names. */
function toOpenApiPath(expressPath: string): { path: string; params: string[] } {
  const params: string[] = [];
  const converted = expressPath.replace(/:([A-Za-z0-9_]+)/g, (_m, name) => {
    params.push(name);
    return `{${name}}`;
  });
  return { path: converted, params };
}

/**
 * Reads the guards and validator declared on a route line. Route files put the
 * whole chain on one line, and a `router.use(...)` above applies to every route
 * in the file — both are accounted for.
 */
function parseRouteFile(source: string) {
  // `router.use(...)` may list several guards in one call, so match the whole
  // argument list rather than assuming isAuthorized stands alone.
  const useCalls = [...source.matchAll(/router\.use\(([^;]*?)\);/gs)].map((m) => m[1]);
  const fileWideAuth = useCalls.some((args) => /\bisAuthorized\b/.test(args));
  const fileWidePermission = useCalls.map((args) => args.match(/requirePermission\('([A-Z_]+)'\)/)?.[1]).find(Boolean) ?? null;
  const fileWideRoles = useCalls.flatMap((args) =>
    [...args.matchAll(/checkRoles\(([^)]*)\)/g)].flatMap((m) => [...m[1].matchAll(/'([A-Z]+)'/g)].map((r) => r[1])),
  );

  const byRoute = new Map<string, Omit<RouteInfo, 'module' | 'fullPath'>>();
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/router\.(get|post|put|patch|delete)\(\s*'([^']+)'\s*,?([^\n]*)/);
    if (!match) continue;

    const [, method, routePath, rest] = match;
    const permission = rest.match(/requirePermission\('([A-Z_]+)'\)/)?.[1] ?? fileWidePermission;
    // Most routes name `isAuthorized` inline rather than relying on router.use.
    const inlineAuth = /\bisAuthorized\b/.test(rest);
    const roles = [...rest.matchAll(/checkRoles\(([^)]*)\)/g)]
      .flatMap((m) => [...m[1].matchAll(/'([A-Z]+)'/g)].map((r) => r[1]));
    const validator = rest.match(/(validate[A-Za-z]+)/)?.[1] ?? null;

    // The JSDoc or `//` line directly above is the human description.
    let comment: string | null = null;
    for (let j = i - 1; j >= Math.max(0, i - 4); j--) {
      const above = lines[j].trim();
      if (!above) continue;
      const text = above.replace(/^\/\*\*?|\*\/$|^\*|^\/\//g, '').trim();
      if (text && !text.startsWith('router.')) {
        comment = text.replace(/^@route\s+\S+\s+\S+\s*—?\s*/, '').trim() || null;
      }
      break;
    }

    byRoute.set(`${method.toUpperCase()} ${routePath}`, {
      method: method.toUpperCase(),
      expressPath: routePath,
      permission,
      roles: roles.length ? roles : fileWideRoles,
      authenticated: fileWideAuth || inlineAuth || !!permission || roles.length > 0,
      validator,
      comment,
    });
  }

  return byRoute;
}

/** Walks `src/modules` the same way `app.ts` does, so the prefixes match. */
function collectRoutes(dir: string, prefix: string, out: RouteInfo[]) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) {
      collectRoutes(full, `${prefix}/${entry.replace('.route', '')}`, out);
      continue;
    }
    if (!entry.endsWith('.route.ts')) continue;

    const moduleName = entry.split('.')[0];
    const parsed = parseRouteFile(fs.readFileSync(full, 'utf-8'));

    // The router itself is the authority on which paths exist.
    const routeModule = require(full);
    const stack = (routeModule.stack ?? []) as any[];
    for (const layer of stack) {
      if (!layer.route) continue;
      for (const method of Object.keys(layer.route.methods)) {
        const key = `${method.toUpperCase()} ${layer.route.path}`;
        const meta = parsed.get(key);
        out.push({
          module: moduleName,
          method: method.toUpperCase(),
          expressPath: layer.route.path,
          fullPath: `${prefix}${layer.route.path}`.replace(/\/$/, '') || prefix,
          permission: meta?.permission ?? null,
          roles: meta?.roles ?? [],
          authenticated: meta?.authenticated ?? true,
          validator: meta?.validator ?? null,
          comment: meta?.comment ?? null,
        });
      }
    }
  }
}

function build() {
  const routes: RouteInfo[] = [];
  collectRoutes(MODULES_DIR, BASE, routes);
  routes.sort((a, b) => a.fullPath.localeCompare(b.fullPath) || a.method.localeCompare(b.method));

  const paths: Record<string, any> = {};
  const tags = new Set<string>();

  for (const route of routes) {
    // Paths are relative to `servers[].url`, which already carries the /api/v1
    // prefix — repeating it here would resolve to /api/v1/api/v1/...
    const { path: openApiPath, params } = toOpenApiPath(route.fullPath.slice(BASE.length) || '/');
    tags.add(route.module);

    const guards: string[] = [];
    if (route.permission) guards.push(`Requires the \`${route.permission}\` permission.`);
    if (route.roles.length) guards.push(`Restricted to ${route.roles.join(' / ')}.`);
    if (!route.authenticated) guards.push('Public — no authentication required.');

    const isBinary = /\/(pdf|export|file)$/.test(route.fullPath);

    const operation: any = {
      tags: [route.module],
      summary: route.comment ?? `${route.method} ${openApiPath}`,
      description: guards.join(' ') || undefined,
      security: route.authenticated ? [{ bearerAuth: [] }] : [],
      parameters: params.map((name) => ({
        name,
        in: 'path',
        required: true,
        schema: { type: 'string' },
      })),
      responses: {
        '200': {
          description: 'Success',
          content: isBinary
            ? { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } }
            : { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } },
        },
        '400': { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        ...(route.authenticated
          ? {
              '401': { description: 'Not authenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
              '403': { description: 'Not permitted', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            }
          : {}),
        '404': { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      },
    };

    if (['POST', 'PUT', 'PATCH'].includes(route.method)) {
      operation.requestBody = {
        required: true,
        content: {
          'application/json': {
            schema: { type: 'object', additionalProperties: true },
            ...(route.validator ? { example: { $comment: `Validated by ${route.validator}` } } : {}),
          },
        },
      };
    }

    paths[openApiPath] ??= {};
    paths[openApiPath][route.method.toLowerCase()] = operation;
  }

  const spec = {
    openapi: '3.0.0',
    info: {
      title: 'Kazi Express API',
      version: '1.0.0',
      description:
        'Generated from the route modules by `scripts/generate-openapi.ts` — run `npm run docs:generate` after adding or changing a route. ' +
        'Every response is wrapped by `helpers/responses/custom-response.ts`, which emits `status` (boolean) rather than `success`, ' +
        'and reports failures as an `errors` array of `{ field, message }`.',
    },
    servers: [{ url: 'http://localhost:5000/api/v1', description: 'Local development' }],
    tags: [...tags].sort().map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      schemas: {
        SuccessResponse: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            status: { type: 'boolean', example: true },
            statusCode: { type: 'integer', example: 200 },
            path: { type: 'string' },
            method: { type: 'string' },
            timestamp: { type: 'string', format: 'date-time' },
            data: {},
          },
          required: ['message', 'status', 'statusCode'],
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            status: { type: 'boolean', example: false },
            statusCode: { type: 'integer', example: 400 },
            path: { type: 'string' },
            method: { type: 'string' },
            timestamp: { type: 'string', format: 'date-time' },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                properties: { field: { type: 'string' }, message: { type: 'string' } },
              },
            },
          },
          required: ['message', 'status', 'statusCode'],
        },
      },
    },
  };

  fs.writeFileSync(OUTPUT, `${JSON.stringify(spec, null, 2)}\n`);
  const operations = routes.length;
  console.log(`✓ openapi.json regenerated: ${Object.keys(paths).length} paths, ${operations} operations, ${tags.size} tags`);
  const unguarded = routes.filter((r) => !r.authenticated).map((r) => `${r.method} ${r.fullPath}`);
  if (unguarded.length) console.log(`  public endpoints: ${unguarded.join(', ')}`);
}

build();
