import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import 'reflect-metadata';
import { Controller, Get, Module, type INestApplication } from '@nestjs/common';
import { DiscoveryModule, NestFactory } from '@nestjs/core';
import { z } from 'zod';
import { ROUTES, defineRoute, registerRoutes } from '@hub/contracts';
import { isKnownPermission } from '@hub/domain';
import { AppModule } from '../../src/app.module';
import { createApp } from '../../src/bootstrap';
import { ApiRoute } from '../../src/platform/contracts';
import { checkContracts } from '../../src/platform/contract-check';
import { closeApp, closePools, getApp } from '../helpers';
import { TEST_ENV } from '../test-env';

/**
 * P1 closure — the contract registry is the single source of routes: the API refuses to boot with a handler that has no
 * registered contract (REQ-PLT-005, negative test), and the generated OpenAPI document covers exactly the registered
 * and served routes, each with its permission and security requirement (REQ-ARC-007).
 */
const API_ROOT = join(__dirname, '..', '..');

afterAll(async () => {
  await closeApp();
  await closePools();
});

// A registered contract that a test controller binds correctly (positive control) — removed from the registry afterwards.
const probeRoute = defineRoute({ id: 'p1c.probe.bound', method: 'GET', path: '/api/v1/p1c-probe/bound', summary: 'P1 closure probe', tags: ['p1c'], access: 'authenticated', response: z.object({ ok: z.literal(true) }) });
// A contract object that is NOT in the registry (never passed to registerRoutes).
const unregisteredRoute = defineRoute({ id: 'p1c.probe.unregistered', method: 'GET', path: '/api/v1/p1c-probe/unregistered', summary: 'not registered', tags: ['p1c'], access: 'authenticated', response: z.object({ ok: z.literal(true) }) });

@Controller()
class P1cRogueController {
  /** A plain Nest route with no contract and no permission. */
  @Get('/api/v1/p1c-probe/rogue')
  rogue() {
    return { ok: true };
  }
}

@Controller()
class P1cBoundController {
  @ApiRoute(probeRoute)
  bound() {
    return { ok: true };
  }
}

@Controller()
class P1cUnregisteredController {
  @ApiRoute(unregisteredRoute)
  unregistered() {
    return { ok: true };
  }
}

async function tinyApp(controllers: unknown[]): Promise<INestApplication> {
  @Module({ imports: [DiscoveryModule], controllers: controllers as never[] })
  class TinyModule {}
  const app = await NestFactory.create(TinyModule, { logger: false });
  await app.init();
  return app;
}

/** Temporarily add controllers to the real AppModule (restored in finally). */
async function withExtraControllers<T>(extra: unknown[], fn: () => Promise<T>): Promise<T> {
  const original = Reflect.getMetadata('controllers', AppModule) as unknown[];
  Reflect.defineMetadata('controllers', [...original, ...extra], AppModule);
  try {
    return await fn();
  } finally {
    Reflect.defineMetadata('controllers', original, AppModule);
  }
}

describe('P1 closure — PLT-005: the contract-registry check fails for a handler without a registered contract/permission [REQ-PLT-005, ADR-0007]', () => {
  it('unit: checkContracts reports an unbound handler and a handler bound to an unregistered contract; a registered binding passes', async () => {
    registerRoutes({ probeRoute });
    try {
      const app = await tinyApp([P1cRogueController, P1cBoundController, P1cUnregisteredController]);
      try {
        const c = checkContracts(app);
        expect(c.unbound).toContain('P1cRogueController.rogue');
        expect(c.unbound.some((u) => u.startsWith('P1cUnregisteredController.unregistered'))).toBe(true);
        expect(c.unbound.some((u) => u.startsWith('P1cBoundController'))).toBe(false);
        // Every real route is "missing" in this tiny app — the check also catches unimplemented contracts.
        expect(c.missing).toContain('identity.me');
        expect(c.missing).not.toContain('p1c.probe.bound');
      } finally {
        await app.close();
      }
    } finally {
      delete ROUTES['p1c.probe.bound'];
    }
  });

  it('the real API refuses to boot with a rogue handler (no contract) and with a registered but unimplemented contract', async () => {
    await withExtraControllers([P1cRogueController], async () => {
      await expect(createApp({ logger: false })).rejects.toThrow(/Contract check failed[\s\S]*handlers without contract: \[P1cRogueController\.rogue\]/);
    });
    await withExtraControllers([P1cUnregisteredController], async () => {
      await expect(createApp({ logger: false })).rejects.toThrow(/Contract check failed[\s\S]*P1cUnregisteredController\.unregistered/);
    });
    registerRoutes({ ghost: defineRoute({ id: 'p1c.probe.ghost', method: 'POST', path: '/api/v1/p1c-probe/ghost', summary: 'declared, never implemented', tags: ['p1c'], access: 'authenticated', response: z.object({}) }) });
    try {
      await expect(createApp({ logger: false })).rejects.toThrow(/Unimplemented routes: \[p1c\.probe\.ghost\]/);
    } finally {
      delete ROUTES['p1c.probe.ghost'];
    }
    // Restored: the unmodified application boots and its check is clean.
    const { app } = await createApp({ logger: false });
    try {
      const c = checkContracts(app);
      expect(c.unbound).toEqual([]);
      expect(c.missing).toEqual([]);
      expect(c.implemented).toBe(Object.keys(ROUTES).length);
    } finally {
      await app.close();
    }
  });
});

// ------------------------------------------------------------------------------------------------------------------
interface Operation {
  operationId: string;
  description: string;
  security: { session: string[] }[];
  parameters: { name: string; in: string }[];
  requestBody?: { content: Record<string, { schema: Record<string, unknown> }> };
  responses: Record<string, { content?: Record<string, { schema?: Record<string, unknown> }> }>;
}

/** Routes the running Express app actually serves (method + Express path). */
function servedRoutes(app: INestApplication): Set<string> {
  const express = app.getHttpAdapter().getInstance() as { router?: { stack: unknown[] }; _router?: { stack: unknown[] } };
  const stack = (express.router ?? express._router)?.stack ?? [];
  const out = new Set<string>();
  for (const layer of stack as { route?: { path: string; methods: Record<string, boolean> } }[]) {
    if (!layer.route) continue;
    for (const [m, on] of Object.entries(layer.route.methods)) if (on && m !== '_all') out.add(`${m.toUpperCase()} ${layer.route.path}`);
  }
  return out;
}

describe('P1 closure — ARC-007: the generated OpenAPI 3.1 document matches the registered and served routes; every operation declares its permission [REQ-ARC-007, ADR-0007]', () => {
  it('OpenAPI (dist/cli/openapi.js) ⇔ contract registry ⇔ routes served by the API; permissions, security and converted schemas on every operation; no secrets', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'p1c-openapi-'));
    try {
      const out = join(dir, 'openapi.json');
      execFileSync(process.execPath, [join(API_ROOT, 'dist', 'cli', 'openapi.js'), out], { cwd: API_ROOT, env: { ...process.env, ...TEST_ENV }, stdio: 'pipe' });
      const raw = readFileSync(out, 'utf8');
      const doc = JSON.parse(raw) as { openapi: string; paths: Record<string, Record<string, Operation>>; components: { securitySchemes: Record<string, unknown> } };
      expect(doc.openapi).toBe('3.1.0');
      expect(doc.components.securitySchemes.session).toEqual({ type: 'apiKey', in: 'cookie', name: 'hub_session' });

      // OpenAPI operations keyed as "METHOD /express/:path".
      const ops = new Map<string, Operation>();
      for (const [path, methods] of Object.entries(doc.paths)) {
        for (const [m, op] of Object.entries(methods)) ops.set(`${m.toUpperCase()} ${path.replace(/\{([A-Za-z0-9_]+)\}/g, ':$1')}`, op);
      }
      const routes = Object.values(ROUTES);
      expect(routes.length).toBeGreaterThan(300);

      // (1) registry ⇔ OpenAPI: same operations, one per route id.
      expect(ops.size).toBe(routes.length);
      expect(new Set([...ops.values()].map((o) => o.operationId)).size).toBe(routes.length);
      for (const r of routes) {
        const op = ops.get(`${r.method} ${r.path}`);
        expect(op, `${r.id} ${r.method} ${r.path} missing from OpenAPI`).toBeTruthy();
        expect(op!.operationId).toBe(r.id);
      }

      // (2) served ⇔ OpenAPI: every route the API answers is documented, and every documented route is served.
      const app = await getApp();
      const served = [...servedRoutes(app)].filter((s) => !/ \/api\/v1\/health|^(GET|HEAD) \/(health|ready|live)/.test(s) && !s.startsWith('HEAD '));
      expect(served.length).toBeGreaterThan(300);
      const undocumented = served.filter((s) => !ops.has(s));
      expect(undocumented).toEqual([]);
      const unserved = [...ops.keys()].filter((k) => !served.includes(k));
      expect(unserved).toEqual([]);

      // (3) every operation declares its permission and a matching security requirement.
      const publicIds: string[] = [];
      for (const r of routes) {
        const op = ops.get(`${r.method} ${r.path}`)!;
        const access = r.access;
        if (access === 'public') {
          publicIds.push(r.id);
          expect(op.description, r.id).toMatch(/^Access: public\./);
          expect(op.security, r.id).toEqual([]);
          continue;
        }
        expect(op.security, r.id).toEqual([{ session: [] }]);
        if (access === 'authenticated') expect(op.description, r.id).toMatch(/^Access: any authenticated user\./);
        else if (typeof access === 'object') {
          expect(isKnownPermission(access.org), `${r.id}: unknown org permission ${access.org}`).toBe(true);
          expect(op.description, r.id).toContain(`Access: organization permission \`${access.org}\``);
        } else {
          expect(isKnownPermission(access), `${r.id}: unknown permission ${access}`).toBe(true);
          expect(r.path, `${r.id}: a project permission needs :projectId`).toContain(':projectId');
          expect(op.description, r.id).toContain(`Access: project permission \`${access}\``);
        }
      }
      // The unauthenticated surface is an explicit, reviewed allow-list (login bootstrap only).
      expect(publicIds.sort()).toEqual(['identity.authConfig', 'identity.demoLogin', 'identity.demoUsers', 'identity.oidcCallback', 'identity.oidcLogin'].sort());

      // (4) schemas were converted from the contracts (the generator's `{ type: 'object' }` fallback never used) and
      //     path parameters / request bodies are declared.
      for (const r of routes) {
        const op = ops.get(`${r.method} ${r.path}`)!;
        const pathParams = [...r.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]);
        for (const name of pathParams) expect(op.parameters.some((p) => p.in === 'path' && p.name === name), `${r.id} path param ${name}`).toBe(true);
        if (r.method !== 'GET') {
          expect(op.requestBody, r.id).toBeTruthy();
          if (!r.upload) expect(op.requestBody!.content['application/json']!.schema.$schema, `${r.id} request schema converted`).toMatch(/json-schema\.org/);
        }
        if (!r.binary) expect(op.responses['200']!.content!['application/json']!.schema!.$schema, `${r.id} response schema converted`).toMatch(/json-schema\.org/);
        expect(op.responses.default, r.id).toBeTruthy();
      }

      // (5) no secrets or environment values in the published document.
      expect(raw).not.toContain(TEST_ENV.DATABASE_URL!);
      expect(raw).not.toMatch(/postgres:\/\/|hub_dev_only|BEGIN [A-Z ]*PRIVATE KEY/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
