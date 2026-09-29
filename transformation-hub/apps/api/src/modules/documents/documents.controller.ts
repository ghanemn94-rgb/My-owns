import { Controller, Headers, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { documentsRoutes as R, RouteInput } from '@hub/contracts';
import type { EvidenceTargetType, VerificationStatus } from '@hub/domain';
import { ApiRoute, Ctx, Input, RawBody } from '../../platform/contracts';
import type { RequestContext } from '../../platform/context';
import { DocumentsService } from './documents.service';
import { EvidenceService } from './evidence.service';
import { SourcesService } from './sources.service';

/** RFC 6266 / 5987 attachment header with an ASCII fallback (the filename is already sanitised at upload). */
export function attachmentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

@Controller()
export class DocumentsController {
  constructor(
    private readonly docs: DocumentsService,
    private readonly evidence: EvidenceService,
    private readonly sources: SourcesService,
  ) {}

  // NOTE: `search` is declared before `:documentId` routes so "/documents/search" is not captured as an id.
  @ApiRoute(R.searchDocuments)
  search(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.searchDocuments>) {
    return this.docs.search(ctx, i.params.projectId, i.query);
  }

  @ApiRoute(R.listDocuments)
  list(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.listDocuments>) {
    return this.docs.list(ctx, i.params.projectId, i.query);
  }

  @ApiRoute(R.createDocument)
  create(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.createDocument>) {
    return this.docs.create(ctx, i.params.projectId, i.body);
  }

  @ApiRoute(R.getDocument)
  get(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.getDocument>) {
    return this.docs.get(ctx, i.params.projectId, i.params.documentId);
  }

  @ApiRoute(R.uploadVersion)
  upload(
    @Ctx() ctx: RequestContext,
    @Input() i: RouteInput<typeof R.uploadVersion>,
    @RawBody() bytes: Buffer,
    @Headers('x-filename') filename: string | undefined,
    @Headers('x-file-type') fileType: string | undefined,
  ) {
    return this.docs.uploadVersion(ctx, i.params.projectId, i.params.documentId, { bytes, filename, declaredType: fileType, note: i.query.note });
  }

  @ApiRoute(R.downloadVersion)
  async download(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.downloadVersion>, @Res({ passthrough: true }) res: Response) {
    const f = await this.docs.openDownload(ctx, i.params.projectId, i.params.documentId, i.params.versionId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
    res.setHeader('Cache-Control', 'no-store');
    return new StreamableFile(f.stream, { type: f.mime, length: f.size, disposition: attachmentDisposition(f.filename) });
  }

  @ApiRoute(R.classifyDocument)
  classify(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.classifyDocument>) {
    return this.docs.changeClassification(ctx, i.params.projectId, i.params.documentId, i.body, 'raise');
  }

  @ApiRoute(R.declassifyDocument)
  declassify(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.declassifyDocument>) {
    return this.docs.changeClassification(ctx, i.params.projectId, i.params.documentId, i.body, 'lower');
  }

  @ApiRoute(R.moveDocumentRoom)
  moveRoom(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.moveDocumentRoom>) {
    return this.docs.moveRoom(ctx, i.params.projectId, i.params.documentId, i.body);
  }

  @ApiRoute(R.setLegalHold)
  legalHold(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.setLegalHold>) {
    return this.docs.setLegalHold(ctx, i.params.projectId, i.params.documentId, i.body);
  }

  @ApiRoute(R.setRetention)
  retention(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.setRetention>) {
    return this.docs.setRetention(ctx, i.params.projectId, i.params.documentId, i.body);
  }

  @ApiRoute(R.requestDisposal)
  requestDisposal(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.requestDisposal>) {
    return this.docs.requestDisposal(ctx, i.params.projectId, i.params.documentId, i.body);
  }

  @ApiRoute(R.disposeDocument)
  dispose(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.disposeDocument>) {
    return this.docs.dispose(ctx, i.params.projectId, i.params.documentId, i.body);
  }

  // ------------------------------------------------------------------------------------------------ evidence
  @ApiRoute(R.listEvidence)
  listEvidence(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.listEvidence>) {
    return this.evidence.listForTarget(ctx, i.params.projectId, { ...i.query, targetType: i.query.targetType as EvidenceTargetType });
  }

  @ApiRoute(R.linkEvidence)
  linkEvidence(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.linkEvidence>) {
    return this.evidence.link(ctx, i.params.projectId, { ...i.body, targetType: i.body.targetType as EvidenceTargetType });
  }

  @ApiRoute(R.verifyEvidence)
  verifyEvidence(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.verifyEvidence>) {
    return this.evidence.verify(ctx, i.params.projectId, i.params.linkId, i.body);
  }

  @ApiRoute(R.flagEvidenceConflict)
  flagConflict(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.flagEvidenceConflict>) {
    return this.evidence.flagConflict(ctx, i.params.projectId, i.params.linkId, i.body);
  }

  @ApiRoute(R.supersedeEvidence)
  supersede(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.supersedeEvidence>) {
    return this.evidence.supersede(ctx, i.params.projectId, i.params.linkId, i.body);
  }

  // ------------------------------------------------------------------------------------------------ sources
  @ApiRoute(R.listSources)
  listSources(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.listSources>) {
    return this.sources.list(ctx, i.params.projectId, i.query);
  }

  @ApiRoute(R.createSource)
  createSource(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.createSource>) {
    return this.sources.create(ctx, i.params.projectId, i.body);
  }

  @ApiRoute(R.getSource)
  getSource(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.getSource>) {
    return this.sources.get(ctx, i.params.projectId, i.params.sourceId);
  }

  @ApiRoute(R.updateSource)
  updateSource(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.updateSource>) {
    return this.sources.update(ctx, i.params.projectId, i.params.sourceId, i.body);
  }

  @ApiRoute(R.recordExtraction)
  recordExtraction(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.recordExtraction>) {
    return this.sources.recordExtraction(ctx, i.params.projectId, i.params.sourceId, i.body);
  }

  @ApiRoute(R.compareSource)
  compare(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.compareSource>) {
    return this.sources.compare(ctx, i.params.projectId, i.params.sourceId);
  }

  @ApiRoute(R.createClaim)
  createClaim(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.createClaim>) {
    return this.sources.createClaim(ctx, i.params.projectId, i.params.sourceId, i.body);
  }

  @ApiRoute(R.updateClaim)
  updateClaim(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.updateClaim>) {
    return this.sources.updateClaim(ctx, i.params.projectId, i.params.claimId, i.body);
  }

  @ApiRoute(R.reviewClaim)
  reviewClaim(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.reviewClaim>) {
    return this.sources.reviewClaim(ctx, i.params.projectId, i.params.claimId, { ...i.body, verificationStatus: i.body.verificationStatus as VerificationStatus });
  }

  @ApiRoute(R.proposeClaimChange)
  proposeChange(@Ctx() ctx: RequestContext, @Input() i: RouteInput<typeof R.proposeClaimChange>) {
    return this.sources.proposeChange(ctx, i.params.projectId, i.params.claimId, i.body);
  }
}
