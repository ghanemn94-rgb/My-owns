import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, inArray, isNull, sql, SQL } from 'drizzle-orm';
import { schema } from '@hub/db';
import {
  CLASSIFICATIONS,
  assertDisclosureReleasable,
  assertDisclosureRequestable,
  assertRoomGrantAllowed,
  clearanceAllows,
  conflict,
  forbidden,
  notFound,
  ruleViolation,
  Classification,
  DisclosureStatus,
  RoomAccessLevel,
  RoomScopedRole,
} from '@hub/domain';
import type { RouteInput, jvRoutes } from '@hub/contracts';
import type { RequestContext } from '../../platform/context';
import { isFullScope } from '../../platform/context';
import { assertVersion, likeContains, loadInProject, offsetOf, pageOf, updateVersioned } from '../../platform/helpers';
import { orderBySort } from '../../platform/sort';
import { newId } from '../../platform/ids';
import { DocumentsService } from '../documents/documents.service';
import { OBJECT_STORAGE, ObjectStorage } from '../documents/storage/object-storage';
import { JvSupport, RoomRow, iso } from './jv.support';

type Q<K extends keyof typeof jvRoutes> = RouteInput<(typeof jvRoutes)[K]>;
type DisclosureRow = typeof schema.roomDisclosure.$inferSelect;

/** Project-wide permissions that make a member a room ADMINISTRATOR (room metadata and grants — never content). */
const ROOM_ADMIN_PERMISSIONS = ['jv.room.manage', 'jv.room.grant_access', 'jv.room.revoke_access', 'jv.room.lock'];

/**
 * Partner / internal / clean-team rooms (VDR): explicit, revocable, expiring grants are the ONLY way into a room (an
 * NDA or a partner stage never is — REQ-JV-005); partner A's room is invisible to partner B (AT-03); clean-team rooms
 * only to clean-team members (REQ-ENT-012). Content visibility is applied inside SQL (lists, counts), downloads are
 * re-authorized on every request (revocation is immediate — AT-19) and every access leaves an append-only history.
 */
@Injectable()
export class RoomsService {
  constructor(
    private readonly s: JvSupport,
    private readonly docs: DocumentsService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  // ---------------------------------------------------------------------------------------------------------
  // helpers

  private grantedRoomIds(ctx: RequestContext, projectId: string): string[] {
    const s = ctx.principal.projects.get(projectId);
    if (!s) return [];
    return [...new Set([...s.roomIds, ...s.roomRoles.map((r) => r.roomId)])];
  }

  private isAdmin(ctx: RequestContext, projectId: string): boolean {
    const s = ctx.principal.projects.get(projectId);
    if (!s || !isFullScope(s)) return false;
    const perms = this.s.policy.projectPermissions(ctx.principal, projectId);
    return ROOM_ADMIN_PERMISSIONS.some((p) => perms.has(p));
  }

  private allowedClassifications(ctx: RequestContext): Classification[] {
    return CLASSIFICATIONS.filter((c) => clearanceAllows(ctx.principal.clearance, c));
  }

  /** Room metadata visible to the caller: classification ≤ clearance AND (granted OR room administrator). */
  private roomVisibleSql(ctx: RequestContext, projectId: string): SQL {
    const t = schema.partnerRoom;
    const granted = this.grantedRoomIds(ctx, projectId);
    const grantedSql = granted.length ? inArray(t.id, granted) : sql`false`;
    return and(eq(t.projectId, projectId), inArray(t.classification, this.allowedClassifications(ctx)), this.isAdmin(ctx, projectId) ? undefined : grantedSql)!;
  }

  /** A room whose metadata the caller may see (administrator or grantee) — 404 otherwise. */
  private async loadRoomMeta(ctx: RequestContext, projectId: string, roomId: string): Promise<RoomRow> {
    const room = await this.s.room(projectId, roomId);
    const visible = clearanceAllows(ctx.principal.clearance, room.classification as Classification) && (this.isAdmin(ctx, projectId) || this.grantedRoomIds(ctx, projectId).includes(room.id));
    if (!visible) throw notFound();
    return room;
  }

  /** Room CONTENT: the permission with room + clean-team + classification conditions (grant required) — 404 otherwise. */
  private async loadRoomContent(ctx: RequestContext, projectId: string, roomId: string, permission: string): Promise<RoomRow> {
    const room = await this.s.room(projectId, roomId);
    // Role-level pre-check (I-R3): the release asserts not_self with the disclosure's requester.
    this.s.policy.assertGranted(ctx, permission, this.s.roomAttrs(room));
    return room;
  }

  private roomDto(r: RoomRow, granted: Set<string>, levels: Map<string, RoomAccessLevel>) {
    return {
      id: r.id,
      name: r.name,
      type: this.s.roomType(r),
      partnerId: r.partnerId,
      classification: r.classification,
      locked: !!r.lockedAt,
      canOpen: granted.has(r.id),
      myAccessLevel: levels.get(r.id) ?? null,
      isDemo: r.isDemo,
      createdAt: r.createdAt.toISOString(),
      version: r.version,
    };
  }

  private async myLevels(ctx: RequestContext, roomIds: string[]): Promise<Map<string, RoomAccessLevel>> {
    const out = new Map<string, RoomAccessLevel>();
    if (!roomIds.length || !ctx.principal.userId) return out;
    const r = await this.s.db.tx().execute<{ room_id: string; level: RoomAccessLevel }>(sql`
      select room_id, (array_agg(access_level order by case access_level when 'manage' then 0 when 'contribute' then 1 else 2 end))[1] as level
        from room_grant where user_id = ${ctx.principal.userId} and revoked_at is null and (expires_at is null or expires_at > now())
         and room_id in (${sql.join(roomIds.map((i) => sql`${i}::uuid`), sql`, `)}) group by room_id`);
    for (const row of r.rows) out.set(row.room_id, row.level);
    return out;
  }

  // ---------------------------------------------------------------------------------------------------------
  // Rooms

  async list(ctx: RequestContext, projectId: string, q: Q<'listRooms'>['query']) {
    await this.s.project(projectId);
    const t = schema.partnerRoom;
    const typeSql = q.type === 'clean_team' ? eq(t.isCleanTeam, true) : q.type === 'partner' ? and(eq(t.isCleanTeam, false), sql`${t.partnerId} is not null`) : q.type === 'internal' ? and(eq(t.isCleanTeam, false), isNull(t.partnerId)) : undefined;
    const where = and(this.roomVisibleSql(ctx, projectId), typeSql, q.q ? ilike(t.name, likeContains(q.q)) : undefined);
    const tx = this.s.db.tx();
    const [{ total }] = (await tx.select({ total: count() }).from(t).where(where)) as [{ total: number }];
    const order = orderBySort(q.sort, { name: t.name, createdAt: t.createdAt }, t.id, [asc(t.name), asc(t.id)]);
    const rows = await tx.select().from(t).where(where).orderBy(...order).limit(q.pageSize).offset(offsetOf(q));
    const granted = new Set(this.grantedRoomIds(ctx, projectId));
    const levels = await this.myLevels(ctx, rows.map((r) => r.id).filter((id) => granted.has(id)));
    return pageOf(rows.map((r) => this.roomDto(r, granted, levels)), Number(total), q);
  }

  /** Opening a room is an audited read (jv.room.read, auditRead). Counts use the caller's ACL inside SQL. */
  async get(ctx: RequestContext, projectId: string, roomId: string) {
    const room = await this.loadRoomContent(ctx, projectId, roomId, 'jv.room.read');
    const allowed = this.allowedClassifications(ctx);
    const inList = (col: string) => sql.raw(`${col} in (${allowed.map((c) => `'${c}'`).join(', ')})`);
    const c = await this.s.db.tx().execute<{ documents: number; disclosures: number; dd: number; findings: number }>(sql`
      select (select count(*)::int from document where project_id = ${projectId} and room_id = ${roomId} and deleted_at is null and ${inList('classification')}) as documents,
             (select count(*)::int from room_disclosure x join document d on d.id = x.document_id where x.project_id = ${projectId} and x.room_id = ${roomId} and x.status = 'released' and ${inList('d.classification')}) as disclosures,
             (select count(*)::int from diligence_request where project_id = ${projectId} and room_id = ${roomId} and ${inList('classification')}) as dd,
             (select count(*)::int from diligence_finding where project_id = ${projectId} and room_id = ${roomId} and ${inList('classification')}) as findings`);
    await this.s.audit.record({ action: 'jv.room.read', entityType: 'partner_room', entityId: room.id, projectId });
    const granted = new Set([room.id]);
    const levels = await this.myLevels(ctx, [room.id]);
    const x = c.rows[0]!;
    return {
      ...this.roomDto(room, granted, levels),
      description: room.description,
      lockedAt: iso(room.lockedAt),
      lockReason: room.lockReason,
      counts: { documents: x.documents, disclosuresReleased: x.disclosures, ddRequests: x.dd, findings: x.findings },
    };
  }

  async create(ctx: RequestContext, projectId: string, body: Q<'createRoom'>['body']) {
    const project = await this.s.project(projectId);
    this.s.assertListable(ctx, projectId, 'jv.room.manage');
    this.s.assertClassification(ctx, body.classification);
    this.s.policy.assert(ctx, 'jv.room.manage', { projectId, classification: body.classification });
    if (body.type === 'partner' && !body.partnerId) throw ruleViolation('jv.room.partner_required', 'A partner room belongs to a partner');
    if (body.type === 'internal' && body.partnerId) throw ruleViolation('jv.room.internal_no_partner', 'An internal room has no partner (use a partner room)');
    if (body.partnerId) {
      const p = await loadInProject(this.s.db, schema.partner, projectId, body.partnerId);
      if (!this.s.policy.canSee(ctx, { projectId, classification: p.classification as Classification })) throw notFound();
      if (p.stage === 'withdrawn') throw ruleViolation('jv.partner.withdrawn', 'A withdrawn partner cannot receive a room');
    }
    const id = newId();
    const tx = this.s.db.tx();
    await tx.insert(schema.partnerRoom).values({
      id,
      orgId: ctx.principal.orgId,
      projectId,
      partnerId: body.partnerId ?? null,
      name: body.name,
      description: body.description ?? null,
      isCleanTeam: body.type === 'clean_team',
      classification: body.classification,
      isDemo: project.isDemo,
      createdBy: ctx.principal.userId,
    });
    await this.s.audit.record({ action: 'jv.room.create', entityType: 'partner_room', entityId: id, projectId, after: { type: body.type, partnerId: body.partnerId ?? null, classification: body.classification } });
    // The creator of a partner / internal room administers its index (manage grant). Clean-team membership is never
    // automatic: it is assigned by Legal with the clean_team role and an attestation (REQ-ENT-012).
    let creatorGrantId: string | null = null;
    if (body.type !== 'clean_team' && ctx.principal.userId) {
      creatorGrantId = newId();
      await tx.insert(schema.roomGrant).values({ id: creatorGrantId, orgId: ctx.principal.orgId, projectId, roomId: id, userId: ctx.principal.userId, accessLevel: 'manage', role: null, reason: 'Room creator (index administration)', grantedBy: ctx.principal.userId });
      await this.s.roomEvent(ctx, { projectId, roomId: id, kind: 'grant', subjectUserId: ctx.principal.userId, grantId: creatorGrantId, note: 'Room creator (index administration)' });
      await this.s.audit.record({ action: 'jv.room.grant_access', entityType: 'room_grant', entityId: creatorGrantId, projectId, after: { roomId: id, userId: ctx.principal.userId, accessLevel: 'manage', role: null, basis: 'room creator' } });
    }
    await this.s.permissionChanged(projectId, id, 'room_created');
    return { id, version: 1, creatorGrantId };
  }

  async update(ctx: RequestContext, projectId: string, roomId: string, body: Q<'updateRoom'>['body']) {
    const room = await this.loadRoomMeta(ctx, projectId, roomId);
    this.s.policy.assert(ctx, 'jv.room.manage', this.s.adminAttrs(room));
    const values: Record<string, unknown> = {};
    if (body.name !== undefined) values['name'] = body.name;
    if (body.description !== undefined) values['description'] = body.description;
    const row = await updateVersioned(this.s.db, schema.partnerRoom, { id: room.id, projectId, expectedVersion: body.expectedVersion }, values);
    await this.s.audit.record({ action: 'jv.room.update', entityType: 'partner_room', entityId: room.id, projectId, before: { name: room.name, description: room.description }, after: values });
    return { id: room.id, version: row['version'] as number };
  }

  async setLock(ctx: RequestContext, projectId: string, roomId: string, body: Q<'lockRoom'>['body'], lock: boolean) {
    const room = await this.loadRoomMeta(ctx, projectId, roomId);
    this.s.policy.assert(ctx, 'jv.room.lock', this.s.adminAttrs(room));
    if (!!room.lockedAt === lock) throw ruleViolation(lock ? 'jv.room.already_locked' : 'jv.room.not_locked', lock ? 'The room is already locked' : 'The room is not locked');
    const row = await updateVersioned(this.s.db, schema.partnerRoom, { id: room.id, projectId, expectedVersion: body.expectedVersion }, lock ? { lockedAt: this.s.clock.now(), lockedBy: ctx.principal.userId, lockReason: body.reason } : { lockedAt: null, lockedBy: null, lockReason: null });
    await this.s.roomEvent(ctx, { projectId, roomId: room.id, kind: lock ? 'room_locked' : 'room_unlocked', note: body.reason });
    await this.s.audit.record({ action: lock ? 'jv.room.lock' : 'jv.room.unlock', entityType: 'partner_room', entityId: room.id, projectId, before: { locked: !!room.lockedAt }, after: { locked: lock }, reason: body.reason });
    await this.s.permissionChanged(projectId, room.id, lock ? 'room_locked' : 'room_unlocked');
    return { id: room.id, version: row['version'] as number };
  }

  // ---------------------------------------------------------------------------------------------------------
  // Grants (REQ-JV-005, REQ-ENT-012, access-matrix §2.4 / §2.8 / §4)

  async listGrants(ctx: RequestContext, projectId: string, roomId: string) {
    const room = await this.loadRoomMeta(ctx, projectId, roomId);
    this.s.policy.assert(ctx, 'jv.room.revoke_access', this.s.adminAttrs(room));
    const g = schema.roomGrant;
    const rows = await this.s.db
      .tx()
      .select({ g, name: schema.appUser.displayName, accountType: schema.appUser.accountType })
      .from(g)
      .leftJoin(schema.appUser, eq(schema.appUser.id, g.userId))
      .where(and(eq(g.projectId, projectId), eq(g.roomId, roomId)))
      .orderBy(desc(g.grantedAt), desc(g.id));
    const now = this.s.clock.now().getTime();
    return {
      items: rows.map(({ g: x, name, accountType }) => ({
        id: x.id,
        roomId: x.roomId,
        userId: x.userId,
        displayName: name ?? null,
        accountType: (accountType as 'internal' | 'external' | null) ?? null,
        accessLevel: x.accessLevel as RoomAccessLevel,
        role: x.role,
        reason: x.reason,
        attestationRef: x.attestationRef,
        grantedBy: x.grantedBy,
        grantedAt: x.grantedAt.toISOString(),
        expiresAt: iso(x.expiresAt),
        revokedAt: iso(x.revokedAt),
        revokedBy: x.revokedBy,
        revokeReason: x.revokeReason,
        active: !x.revokedAt && (!x.expiresAt || x.expiresAt.getTime() > now),
      })),
    };
  }

  async grant(ctx: RequestContext, projectId: string, roomId: string, body: Q<'grantRoomAccess'>['body']) {
    this.s.assertHuman(ctx, 'Granting room access');
    const room = await this.loadRoomMeta(ctx, projectId, roomId);
    // Administration never needs a content grant; not_self against the grantee (access-matrix §5.1).
    this.s.policy.assert(ctx, 'jv.room.grant_access', this.s.adminAttrs(room, { requesterUserId: body.userId }));
    const [u] = await this.s.db
      .tx()
      .select({ id: schema.appUser.id, accountType: schema.appUser.accountType, isActive: schema.appUser.isActive, clearance: schema.appUser.clearance })
      .from(schema.appUser)
      .where(eq(schema.appUser.id, body.userId));
    if (!u) throw notFound();
    const partner = room.partnerId ? await loadInProject(this.s.db, schema.partner, projectId, room.partnerId) : null;
    const [contact] = await this.s.db
      .tx()
      .select({ partnerId: schema.partnerContact.partnerId })
      .from(schema.partnerContact)
      .where(and(eq(schema.partnerContact.projectId, projectId), eq(schema.partnerContact.userId, body.userId), isNull(schema.partnerContact.revokedAt)));
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    assertRoomGrantAllowed({
      room: { type: this.s.roomType(room), locked: !!room.lockedAt, partnerId: room.partnerId, partnerStage: partner?.stage ?? null },
      grantee: { userId: u.id, accountType: u.accountType as 'internal' | 'external', isActive: u.isActive, isFullProjectMember: await this.s.isFullMember(projectId, u.id), boundPartnerId: contact?.partnerId ?? null },
      grantorUserId: ctx.principal.userId!,
      grantorRoles: this.s.rolesOf(ctx, projectId),
      role: (body.role ?? null) as RoomScopedRole | null,
      accessLevel: body.accessLevel,
      expiresAt,
      now: this.s.clock.now(),
      attestationRef: body.attestationRef ?? null,
    });
    // The grantee must be cleared for the room (a grant never lifts a clearance).
    if (!clearanceAllows(u.clearance as Classification, room.classification as Classification)) {
      throw ruleViolation('jv.room.grantee_clearance', "The grantee's clearance is below the room's classification");
    }
    const g = schema.roomGrant;
    const [active] = await this.s.db
      .tx()
      .select({ id: g.id })
      .from(g)
      .where(and(eq(g.projectId, projectId), eq(g.roomId, roomId), eq(g.userId, u.id), isNull(g.revokedAt), sql`(${g.expiresAt} is null or ${g.expiresAt} > now())`));
    if (active) throw conflict('jv.room.already_granted', 'The user already holds an active grant on this room — revoke it before granting another level');
    const id = newId();
    await this.s.db
      .tx()
      .insert(g)
      .values({ id, orgId: ctx.principal.orgId, projectId, roomId, userId: u.id, accessLevel: body.accessLevel, role: body.role ?? null, reason: body.reason, attestationRef: body.attestationRef ?? null, grantedBy: ctx.principal.userId!, expiresAt });
    await this.s.roomEvent(ctx, { projectId, roomId, kind: 'grant', subjectUserId: u.id, grantId: id, note: body.reason });
    await this.s.audit.record({ action: 'jv.room.grant_access', entityType: 'room_grant', entityId: id, projectId, after: { roomId, userId: u.id, accessLevel: body.accessLevel, role: body.role ?? null, expiresAt: body.expiresAt ?? null, attestationRef: body.attestationRef ?? null }, reason: body.reason });
    await this.s.permissionChanged(projectId, roomId, 'grant', { grantId: id });
    return { id };
  }

  async revoke(ctx: RequestContext, projectId: string, roomId: string, grantId: string, body: Q<'revokeRoomAccess'>['body']) {
    const room = await this.loadRoomMeta(ctx, projectId, roomId);
    this.s.policy.assert(ctx, 'jv.room.revoke_access', this.s.adminAttrs(room));
    const grant = await loadInProject(this.s.db, schema.roomGrant, projectId, grantId);
    if (grant.roomId !== room.id) throw notFound();
    if (grant.revokedAt) throw ruleViolation('jv.room.grant_already_revoked', 'The grant is already revoked (history is kept)');
    const now = this.s.clock.now();
    await this.s.db.tx().update(schema.roomGrant).set({ revokedAt: now, revokedBy: ctx.principal.userId, revokeReason: body.reason }).where(and(eq(schema.roomGrant.id, grant.id), eq(schema.roomGrant.projectId, projectId)));
    await this.s.roomEvent(ctx, { projectId, roomId, kind: 'grant_revoked', subjectUserId: grant.userId, grantId: grant.id, note: body.reason });
    await this.s.audit.record({ action: 'jv.room.revoke_access', entityType: 'room_grant', entityId: grant.id, projectId, before: { revokedAt: null }, after: { roomId, userId: grant.userId, revokedAt: now.toISOString() }, reason: body.reason });
    await this.s.permissionChanged(projectId, roomId, 'grant_revoked', { grantId: grant.id });
    return { id: grant.id, revokedAt: now.toISOString() };
  }

  // ---------------------------------------------------------------------------------------------------------
  // VDR index and disclosures (REQ-JV-009)

  async index(ctx: RequestContext, projectId: string, roomId: string, q: Q<'getRoomIndex'>['query']) {
    await this.loadRoomContent(ctx, projectId, roomId, 'jv.room.read');
    const d = schema.document;
    const where = and(
      eq(d.projectId, projectId),
      eq(d.roomId, roomId),
      isNull(d.deletedAt),
      this.s.policy.visibilitySql(ctx, projectId, { classification: d.classification, room: d.roomId }),
      q.q ? ilike(d.title, likeContains(q.q)) : undefined,
    );
    const tx = this.s.db.tx();
    const [{ total }] = (await tx.select({ total: count() }).from(d).where(where)) as [{ total: number }];
    // Fixed order (a room-scoped list: an unknown room is 404, so it declares no sort keys).
    const order = [sql`${d.title} collate "und-x-icu" asc`, asc(d.id)];
    const rows = await tx
      .select({ d, v: schema.documentVersion })
      .from(d)
      .leftJoin(schema.documentVersion, and(eq(schema.documentVersion.id, d.currentVersionId), eq(schema.documentVersion.projectId, d.projectId)))
      .where(where)
      .orderBy(...order)
      .limit(q.pageSize)
      .offset(offsetOf(q));
    const latest = new Map<string, DisclosureRow>();
    if (rows.length) {
      const ds = await tx
        .select()
        .from(schema.roomDisclosure)
        .where(and(eq(schema.roomDisclosure.projectId, projectId), eq(schema.roomDisclosure.roomId, roomId), inArray(schema.roomDisclosure.documentId, rows.map((r) => r.d.id))))
        .orderBy(desc(schema.roomDisclosure.createdAt), desc(schema.roomDisclosure.id));
      for (const x of ds) if (!latest.has(x.documentId)) latest.set(x.documentId, x);
    }
    // Opening the VDR index is an audited read (jv.room.read, auditRead).
    await this.s.audit.record({ action: 'jv.room.read', entityType: 'partner_room', entityId: roomId, projectId, after: { view: 'index', page: q.page } });
    return pageOf(
      rows.map(({ d: doc, v }) => {
        const disc = latest.get(doc.id);
        return {
          documentId: doc.id,
          title: doc.title,
          kind: doc.kind,
          classification: doc.classification,
          currentVersion: v ? { id: v.id, versionNo: v.versionNo, filename: v.filename, scanStatus: v.scanStatus } : null,
          disclosure: disc ? { id: disc.id, status: disc.status as DisclosureStatus, documentVersionId: disc.documentVersionId, releasedAt: iso(disc.releasedAt) } : null,
        };
      }),
      Number(total),
      q,
    );
  }

  async listDisclosures(ctx: RequestContext, projectId: string, roomId: string, q: Q<'listDisclosures'>['query']) {
    await this.loadRoomContent(ctx, projectId, roomId, 'jv.disclosure_log.read');
    const x = schema.roomDisclosure;
    const d = schema.document;
    const where = and(
      eq(x.projectId, projectId),
      eq(x.roomId, roomId),
      this.s.policy.visibilitySql(ctx, projectId, { classification: d.classification, room: d.roomId }),
      q.status ? eq(x.status, q.status) : undefined,
      q.q ? ilike(d.title, likeContains(q.q)) : undefined,
    );
    const tx = this.s.db.tx();
    const base = tx.select({ total: count() }).from(x).innerJoin(d, and(eq(d.id, x.documentId), eq(d.projectId, x.projectId)));
    const [{ total }] = (await base.where(where)) as [{ total: number }];
    const order = [desc(x.createdAt), desc(x.id)];
    const rows = await tx
      .select({ x, title: d.title, versionNo: schema.documentVersion.versionNo, filename: schema.documentVersion.filename })
      .from(x)
      .innerJoin(d, and(eq(d.id, x.documentId), eq(d.projectId, x.projectId)))
      .innerJoin(schema.documentVersion, and(eq(schema.documentVersion.id, x.documentVersionId), eq(schema.documentVersion.projectId, x.projectId)))
      .where(where)
      .orderBy(...order)
      .limit(q.pageSize)
      .offset(offsetOf(q));
    return pageOf(rows.map((r) => this.disclosureDto(r.x, r.title, r.versionNo, r.filename)), Number(total), q);
  }

  private disclosureDto(x: DisclosureRow, title: string, versionNo: number, filename: string) {
    return {
      id: x.id,
      roomId: x.roomId!,
      documentId: x.documentId,
      documentTitle: title,
      documentVersionId: x.documentVersionId,
      versionNo,
      filename,
      diligenceRequestId: x.diligenceRequestId,
      status: x.status as DisclosureStatus,
      requestNote: x.requestNote,
      requestedBy: x.requestedBy,
      requestedAt: x.createdAt.toISOString(),
      releasedBy: x.releasedBy,
      releasedAt: iso(x.releasedAt),
      revokedBy: x.revokedBy,
      revokedAt: iso(x.revokedAt),
      statusReason: x.statusReason,
      version: x.version,
    };
  }

  /** Request release of a specific version into the partner room (index management: manage-level grant). */
  async requestDisclosure(ctx: RequestContext, projectId: string, roomId: string, body: Q<'requestDisclosure'>['body']) {
    const project = await this.s.project(projectId);
    const room = await this.loadRoomContent(ctx, projectId, roomId, 'jv.room.manage');
    await this.s.assertLevel(ctx, room, 'manage');
    const doc = await this.s.visibleDocument(ctx, projectId, body.documentId);
    const { version, usable } = await this.s.documentVersion(projectId, doc.id, body.documentVersionId, doc.currentVersionId);
    assertDisclosureRequestable({ roomType: this.s.roomType(room), roomLocked: !!room.lockedAt, versionUsable: usable, documentInRoom: doc.roomId === room.id });
    const [live] = await this.s.db
      .tx()
      .select({ id: schema.roomDisclosure.id })
      .from(schema.roomDisclosure)
      .where(and(eq(schema.roomDisclosure.projectId, projectId), eq(schema.roomDisclosure.roomId, roomId), eq(schema.roomDisclosure.documentVersionId, version.id), inArray(schema.roomDisclosure.status, ['requested', 'released'])));
    if (live) throw conflict('jv.disclosure.already_live', 'This version is already requested or released in the room');
    const id = newId();
    await this.s.db.tx().insert(schema.roomDisclosure).values({ id, orgId: ctx.principal.orgId, projectId, documentId: doc.id, documentVersionId: version.id, status: 'requested', requestNote: body.note ?? null, requestedBy: ctx.principal.userId!, isDemo: project.isDemo });
    await this.s.roomEvent(ctx, { projectId, roomId, kind: 'disclosure_requested', disclosureId: id, documentVersionId: version.id, note: body.note ?? null });
    await this.s.audit.record({ action: 'jv.disclosure.request', entityType: 'room_disclosure', entityId: id, projectId, after: { roomId, documentId: doc.id, documentVersionId: version.id } });
    return { id, version: 1 };
  }

  private async loadDisclosure(projectId: string, roomId: string, disclosureId: string): Promise<DisclosureRow> {
    const x = await loadInProject(this.s.db, schema.roomDisclosure, projectId, disclosureId);
    if (x.roomId !== roomId) throw notFound();
    return x;
  }

  async decideDisclosure(ctx: RequestContext, projectId: string, roomId: string, disclosureId: string, body: Q<'releaseDisclosure'>['body']) {
    this.s.assertHuman(ctx, 'Releasing a disclosure');
    const room = await this.loadRoomContent(ctx, projectId, roomId, 'jv.disclosure.release');
    const x = await this.loadDisclosure(projectId, roomId, disclosureId);
    const doc = await this.s.visibleDocument(ctx, projectId, x.documentId);
    const { version, usable } = await this.s.documentVersion(projectId, doc.id, x.documentVersionId, null);
    // Role → state (requested, usable version, room not locked: 422) → not_self: never the requester (policy) nor the
    // uploader of the version (domain) — I-R3.
    this.s.policy.assertApproval(ctx, 'jv.disclosure.release', { ...this.s.roomAttrs(room, doc.classification as Classification), requesterUserId: x.requestedBy }, () =>
      assertDisclosureReleasable({ status: x.status as DisclosureStatus, releaserUserId: ctx.principal.userId!, requesterUserId: x.requestedBy, uploaderUserId: version.uploadedBy, versionUsable: usable, roomLocked: !!room.lockedAt }),
    );
    assertVersion(x, body.expectedVersion, 'disclosure');
    const release = body.outcome === 'release';
    const now = this.s.clock.now();
    const row = (await updateVersioned(this.s.db, schema.roomDisclosure, { id: x.id, projectId, expectedVersion: body.expectedVersion }, release ? { status: 'released', releasedBy: ctx.principal.userId, releasedAt: now, statusReason: body.note ?? null } : { status: 'rejected', rejectedBy: ctx.principal.userId, statusReason: body.note ?? null })) as DisclosureRow;
    await this.s.roomEvent(ctx, { projectId, roomId, kind: release ? 'disclosure_released' : 'disclosure_rejected', disclosureId: x.id, documentVersionId: x.documentVersionId, note: body.note ?? null });
    await this.s.audit.record({ action: release ? 'jv.disclosure.release' : 'jv.disclosure.reject', entityType: 'room_disclosure', entityId: x.id, projectId, before: { status: x.status }, after: { status: row.status, documentVersionId: x.documentVersionId }, reason: body.note ?? null });
    if (release) await this.s.permissionChanged(projectId, roomId, 'disclosure_released', { disclosureId: x.id });
    return { id: x.id, status: row.status as DisclosureStatus, version: row.version };
  }

  async revokeDisclosure(ctx: RequestContext, projectId: string, roomId: string, disclosureId: string, body: Q<'revokeDisclosure'>['body']) {
    await this.loadRoomContent(ctx, projectId, roomId, 'jv.disclosure.revoke');
    const x = await this.loadDisclosure(projectId, roomId, disclosureId);
    if (x.status !== 'released') throw ruleViolation('jv.disclosure.not_released', `Only a released item can be withdrawn (this one is ${x.status})`);
    const now = this.s.clock.now();
    const row = (await updateVersioned(this.s.db, schema.roomDisclosure, { id: x.id, projectId, expectedVersion: body.expectedVersion }, { status: 'revoked', revokedBy: ctx.principal.userId, revokedAt: now, statusReason: body.reason })) as DisclosureRow;
    await this.s.roomEvent(ctx, { projectId, roomId, kind: 'disclosure_revoked', disclosureId: x.id, documentVersionId: x.documentVersionId, note: body.reason });
    await this.s.audit.record({ action: 'jv.disclosure.revoke', entityType: 'room_disclosure', entityId: x.id, projectId, before: { status: x.status }, after: { status: 'revoked' }, reason: body.reason });
    await this.s.permissionChanged(projectId, roomId, 'disclosure_revoked', { disclosureId: x.id });
    return { id: x.id, status: row.status as DisclosureStatus, version: row.version };
  }

  async accessLog(ctx: RequestContext, projectId: string, roomId: string, q: Q<'listRoomAccessLog'>['query']) {
    await this.loadRoomContent(ctx, projectId, roomId, 'jv.disclosure_log.read');
    const e = schema.roomAccessEvent;
    const where = and(eq(e.projectId, projectId), eq(e.roomId, roomId), q.kind ? eq(e.kind, q.kind) : undefined);
    const tx = this.s.db.tx();
    const [{ total }] = (await tx.select({ total: count() }).from(e).where(where)) as [{ total: number }];
    const rows = await tx.select().from(e).where(where).orderBy(desc(e.createdAt), desc(e.id)).limit(q.pageSize).offset(offsetOf(q));
    return {
      ...pageOf(
        rows.map((r) => ({
          id: r.id,
          kind: r.kind as Q<'listRoomAccessLog'>['query']['kind'] & string,
          actorUserId: r.actorUserId,
          subjectUserId: r.subjectUserId,
          grantId: r.grantId,
          disclosureId: r.disclosureId,
          diligenceRequestId: r.diligenceRequestId,
          documentVersionId: r.documentVersionId,
          note: r.note,
          createdAt: r.createdAt.toISOString(),
        })),
        Number(total),
        q,
      ),
      people: await this.s.people(rows.flatMap((r) => [r.actorUserId, r.subjectUserId])),
    };
  }

  // ---------------------------------------------------------------------------------------------------------
  // External (counterparty) projection — only items DISCLOSED into the account's own room

  private externalRoomIds(ctx: RequestContext, projectId: string): string[] {
    const s = ctx.principal.projects.get(projectId);
    return s ? s.roomRoles.filter((r) => r.role === 'external_partner_limited').map((r) => r.roomId) : [];
  }

  async externalRooms(ctx: RequestContext, projectId: string) {
    // The route is session-level (project scope enforced by the guard): the counterparty permission is asserted here.
    if (!this.s.policy.canInProject(ctx, 'jv.disclosure.view', projectId)) throw forbidden('policy.forbidden', 'Missing permission jv.disclosure.view');
    const ids = this.externalRoomIds(ctx, projectId);
    if (!ids.length) return { items: [] };
    const t = schema.partnerRoom;
    const rows = await this.s.db
      .tx()
      .select({ id: t.id, name: t.name })
      .from(t)
      .where(and(eq(t.projectId, projectId), inArray(t.id, ids), inArray(t.classification, this.allowedClassifications(ctx))))
      .orderBy(asc(t.name), asc(t.id));
    return { items: rows };
  }

  private async externalRoom(ctx: RequestContext, projectId: string, roomId: string, permission: string): Promise<RoomRow> {
    const room = await this.loadRoomContent(ctx, projectId, roomId, permission);
    // Counterparty accounts see only their partner room (never an internal or clean-team room, even if mis-granted).
    if (this.s.roomType(room) !== 'partner') throw notFound();
    return room;
  }

  private externalDisclosuresWhere(ctx: RequestContext, projectId: string, roomId: string): SQL {
    const x = schema.roomDisclosure;
    const d = schema.document;
    return and(eq(x.projectId, projectId), eq(x.roomId, roomId), eq(x.status, 'released'), isNull(d.deletedAt), eq(d.roomId, roomId), inArray(d.classification, this.allowedClassifications(ctx)))!;
  }

  async externalDisclosures(ctx: RequestContext, projectId: string, roomId: string) {
    const room = await this.externalRoom(ctx, projectId, roomId, 'jv.disclosure.view');
    const x = schema.roomDisclosure;
    const d = schema.document;
    const v = schema.documentVersion;
    const rows = await this.s.db
      .tx()
      .select({ id: x.id, title: d.title, filename: v.filename, versionNo: v.versionNo, sizeBytes: v.sizeBytes, releasedAt: x.releasedAt })
      .from(x)
      .innerJoin(d, and(eq(d.id, x.documentId), eq(d.projectId, x.projectId)))
      .innerJoin(v, and(eq(v.id, x.documentVersionId), eq(v.projectId, x.projectId)))
      .where(this.externalDisclosuresWhere(ctx, projectId, roomId))
      .orderBy(desc(x.releasedAt), desc(x.id));
    await this.s.audit.record({ action: 'jv.disclosure.view', entityType: 'partner_room', entityId: room.id, projectId, after: { items: rows.length } });
    return { items: rows.map((r) => ({ id: r.id, title: r.title, filename: r.filename, versionNo: r.versionNo, sizeBytes: r.sizeBytes, releasedAt: r.releasedAt!.toISOString() })) };
  }

  /** Audited download of a RELEASED version — refused (404) after revocation of the grant or the disclosure, or a lock. */
  async openExternalDownload(ctx: RequestContext, projectId: string, roomId: string, disclosureId: string) {
    const room = await this.externalRoom(ctx, projectId, roomId, 'jv.disclosure.download');
    const x = schema.roomDisclosure;
    const d = schema.document;
    const [row] = await this.s.db
      .tx()
      .select({ x, d })
      .from(x)
      .innerJoin(d, and(eq(d.id, x.documentId), eq(d.projectId, x.projectId)))
      .where(and(eq(x.id, disclosureId), this.externalDisclosuresWhere(ctx, projectId, roomId)));
    if (!row) throw notFound();
    this.s.policy.assert(ctx, 'jv.disclosure.download', this.s.roomAttrs(room, row.d.classification as Classification));
    const { version, usable } = await this.s.documentVersion(projectId, row.d.id, row.x.documentVersionId, null);
    if (!usable) throw forbidden('jv.disclosure.version_not_usable', 'This version cannot be downloaded');
    await this.docs.assertIntegrity(ctx, version, 'disclosure download');
    await this.s.roomEvent(ctx, { projectId, roomId, kind: 'download', subjectUserId: ctx.principal.userId, disclosureId, documentVersionId: version.id });
    await this.s.audit.record({ action: 'jv.disclosure.download', entityType: 'room_disclosure', entityId: disclosureId, projectId, after: { roomId, documentVersionId: version.id, sha256: version.sha256, sizeBytes: version.sizeBytes } });
    return { stream: await this.storage.get(version.storageKey), filename: version.filename, mime: version.mimeType, size: version.sizeBytes };
  }
}
