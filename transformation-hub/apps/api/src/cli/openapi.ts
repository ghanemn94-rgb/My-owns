import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import { ROUTES, declaredSortKeys } from '@hub/contracts';

/** Emit OpenAPI 3.1 from the contract registry (ADR-0007). Usage: node dist/cli/openapi.js [outfile] */
function toSchema(s: z.ZodTypeAny) {
  try {
    return z.toJSONSchema(s, { unrepresentable: 'any', io: 'input' });
  } catch {
    return { type: 'object' };
  }
}

const paths: Record<string, Record<string, unknown>> = {};
/** Headers accompanying raw uploads (`upload: true` routes). */
const UPLOAD_HEADERS = [
  { name: 'x-filename', in: 'header', required: true, description: 'Original file name, percent-encoded UTF-8 (sanitised server-side; never used as a storage path)', schema: { type: 'string' } },
  { name: 'x-file-type', in: 'header', required: false, description: 'Declared MIME type (untrusted; the server detects the type from the bytes)', schema: { type: 'string' } },
];
for (const r of Object.values(ROUTES)) {
  const p = r.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
  const params = Object.keys((r.params as z.ZodObject<z.ZodRawShape>).shape ?? {}).map((name) => ({ name, in: 'path', required: true, schema: { type: 'string' } }));
  const querySchema = toSchema(r.query) as { properties?: Record<string, unknown>; required?: string[] };
  // A parameter whose schema accepts nothing (`sort` on fixed-order lists) is not advertised; the description says so.
  const acceptsNothing = (schema: unknown) => JSON.stringify((schema as { not?: unknown }).not) === '{}';
  const query = Object.entries(querySchema.properties ?? {})
    .filter(([, schema]) => !acceptsNothing(schema))
    .map(([name, schema]) => ({ name, in: 'query', required: querySchema.required?.includes(name) ?? false, schema }));
  // List sorting (QA-P1-13): allow-listed keys per route; anything else is a 400.
  const sortKeys = declaredSortKeys(r.query);
  const sortNote =
    sortKeys === undefined
      ? ''
      : sortKeys.length
        ? ` Sort: \`?sort=\` one of ${sortKeys.map((k) => `\`${k}\``).join(', ')} (prefix \`-\` for descending; ties by id, NULLs last); other values → 400.`
        : ' Sort: fixed order; \`?sort=\` → 400.';
  const access = typeof r.access === 'object' ? `organization permission \`${r.access.org}\`` : r.access === 'public' ? 'public' : r.access === 'authenticated' ? 'any authenticated user' : `project permission \`${r.access}\``;
  (paths[p] ??= {})[r.method.toLowerCase()] = {
    operationId: r.id,
    summary: r.summary,
    description: `Access: ${access}.${r.command ? ' Domain command (explicit state change; audited).' : ''}${sortNote}`,
    tags: r.tags,
    parameters: [...params, ...query, ...(r.upload ? UPLOAD_HEADERS : [])],
    ...(r.method !== 'GET'
      ? {
          requestBody: r.upload
            ? // Raw file bytes (bounded by HUB_MAX_UPLOAD_MB); the file name / declared type travel in headers.
              { required: true, content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } }
            : { required: true, content: { 'application/json': { schema: toSchema(r.body) } } },
        }
      : {}),
    responses: {
      '200': { description: 'OK', content: r.binary ? { 'application/octet-stream': {} } : { 'application/json': { schema: toSchema(r.response) } } },
      default: { description: 'RFC 7807 problem', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } },
    },
    security: r.access === 'public' ? [] : [{ session: [] }],
  };
}
const doc = {
  openapi: '3.1.0',
  info: { title: 'Mobily Transformation & Transactions Hub API', version: 'v1', description: 'Generated from packages/contracts. Session cookie + x-csrf-token header on non-GET requests.' },
  servers: [{ url: '/' }],
  components: {
    securitySchemes: { session: { type: 'apiKey', in: 'cookie', name: 'hub_session' } },
    schemas: {
      Problem: {
        type: 'object',
        required: ['type', 'title', 'status', 'code'],
        properties: { type: { type: 'string' }, title: { type: 'string' }, status: { type: 'integer' }, detail: { type: 'string' }, code: { type: 'string' }, correlationId: { type: 'string' } },
      },
    },
  },
  paths,
};
const out = process.argv[2] ?? 'openapi.json';
writeFileSync(out, JSON.stringify(doc, null, 2));
// eslint-disable-next-line no-console
console.log(`OpenAPI written to ${out}: ${Object.keys(ROUTES).length} operations`);
