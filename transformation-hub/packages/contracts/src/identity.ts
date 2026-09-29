import { z } from 'zod';
import { ROLE_KEYS } from '@hub/domain';
import { defineRoute, registerRoutes } from './route';
import { Uuid, ClassificationSchema, Ok, PageQuery, paged, Text } from './common';

export const RoleKeySchema = z.enum(ROLE_KEYS);

export const ProjectAccessDto = z.object({
  projectId: Uuid,
  roles: z.array(RoleKeySchema),
  workstreamRoles: z.array(z.object({ workstreamId: Uuid, role: RoleKeySchema })),
  permissions: z.array(z.string()),
  roomIds: z.array(Uuid),
});

export const MeDto = z.object({
  user: z.object({
    id: Uuid,
    email: z.string(),
    displayName: z.string(),
    locale: z.string(),
    clearance: ClassificationSchema,
    isDemo: z.boolean(),
  }),
  org: z.object({ id: Uuid, name: z.string(), slug: z.string() }),
  orgRoles: z.array(RoleKeySchema),
  orgPermissions: z.array(z.string()),
  projects: z.array(ProjectAccessDto),
  mode: z.object({ demo: z.boolean(), authMethod: z.string() }),
  csrfToken: z.string(),
});
export type Me = z.infer<typeof MeDto>;

export const DemoUserDto = z.object({ id: Uuid, displayName: z.string(), email: z.string(), title: z.string().nullable(), roleSummary: z.string() });

export const UserDto = z.object({
  id: Uuid,
  email: z.string(),
  displayName: z.string(),
  title: z.string().nullable(),
  clearance: ClassificationSchema,
  isActive: z.boolean(),
  isDemo: z.boolean(),
  lastLoginAt: z.string().nullable(),
});

export const identityRoutes = registerRoutes({
  me: defineRoute({ id: 'identity.me', method: 'GET', path: '/api/v1/me', summary: 'Current principal, scopes and permissions', tags: ['identity'], access: 'authenticated', response: MeDto }),
  setLocale: defineRoute({
    id: 'identity.setLocale',
    method: 'POST',
    path: '/api/v1/me/locale',
    summary: 'Set preferred UI locale',
    tags: ['identity'],
    access: 'authenticated',
    body: z.object({ locale: z.enum(['en', 'ar']) }),
    response: Ok,
  }),
  demoUsers: defineRoute({
    id: 'identity.demoUsers',
    method: 'GET',
    path: '/api/v1/auth/demo-users',
    summary: 'List synthetic demo users (demo mode only; 404 otherwise)',
    tags: ['identity'],
    access: 'public',
    response: z.object({ items: z.array(DemoUserDto), notice: z.string() }),
  }),
  demoLogin: defineRoute({
    id: 'identity.demoLogin',
    method: 'POST',
    path: '/api/v1/auth/demo-login',
    summary: 'Start a session as a synthetic demo user (demo mode only)',
    tags: ['identity'],
    access: 'public',
    body: z.object({ userId: Uuid }),
    response: z.object({ ok: z.literal(true), csrfToken: z.string() }),
  }),
  authConfig: defineRoute({
    id: 'identity.authConfig',
    method: 'GET',
    path: '/api/v1/auth/config',
    summary: 'Which login methods are enabled (honest status)',
    tags: ['identity'],
    access: 'public',
    response: z.object({ demoLogin: z.boolean(), oidc: z.object({ status: z.string(), loginUrl: z.string().nullable() }) }),
  }),
  oidcLogin: defineRoute({
    id: 'identity.oidcLogin',
    method: 'GET',
    path: '/api/v1/auth/oidc/login',
    summary: 'Start enterprise SSO (OIDC Authorization Code + PKCE) — 302 to the IdP; 404 when not configured',
    tags: ['identity'],
    access: 'public',
    binary: true,
    response: z.unknown(),
  }),
  oidcCallback: defineRoute({
    id: 'identity.oidcCallback',
    method: 'GET',
    path: '/api/v1/auth/oidc/callback',
    summary: 'OIDC redirect URI — validates state/PKCE/nonce, maps to a pre-provisioned user, starts a session, 302 to the app',
    tags: ['identity'],
    access: 'public',
    binary: true,
    query: z.object({ code: z.string().max(4096).optional(), state: z.string().max(512).optional(), error: z.string().max(200).optional(), error_description: z.string().max(1000).optional(), iss: z.string().max(500).optional(), session_state: z.string().max(500).optional() }),
    response: z.unknown(),
  }),
  logout: defineRoute({ id: 'identity.logout', method: 'POST', path: '/api/v1/auth/logout', summary: 'Revoke current session', tags: ['identity'], access: 'authenticated', response: Ok }),
  listUsers: defineRoute({
    id: 'identity.listUsers',
    method: 'GET',
    path: '/api/v1/admin/users',
    summary: 'List organization users (account administration — no project content)',
    tags: ['admin'],
    access: { org: 'admin.users.read' },
    query: PageQuery,
    response: paged(UserDto),
  }),
  createUser: defineRoute({
    id: 'identity.createUser',
    method: 'POST',
    path: '/api/v1/admin/users',
    summary: 'Provision a user record (authentication happens at the IdP)',
    tags: ['admin'],
    access: { org: 'admin.users.manage' },
    command: true,
    body: z.object({ email: z.string().email().max(254), displayName: Text(200).pipe(z.string().min(1)), title: Text(200).optional(), clearance: ClassificationSchema.default('internal') }),
    response: UserDto,
  }),
  deactivateUser: defineRoute({
    id: 'identity.deactivateUser',
    method: 'POST',
    path: '/api/v1/admin/users/:userId/deactivate',
    summary: 'Deactivate a user and revoke all sessions',
    tags: ['admin'],
    access: { org: 'admin.users.manage' },
    command: true,
    params: z.object({ userId: Uuid }),
    body: z.object({ reason: Text(1000).pipe(z.string().min(1)) }),
    response: Ok,
  }),
});
