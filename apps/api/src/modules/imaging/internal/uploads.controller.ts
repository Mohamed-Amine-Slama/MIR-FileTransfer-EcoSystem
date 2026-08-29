import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { RequiresRole } from '../../../shared/authz/access-metadata';
import { UploadService, type FileUploadState } from './upload.service';

/**
 * Resumable upload transport — BUILD_SPEC P7.1/P7.2.
 *
 * Deliberately thin. Every authorization decision belongs to UploadService and
 * the RLS policies underneath it: creating a session for another doctor's
 * patient fails at the database's WITH CHECK policy and surfaces as
 * NotFoundException, which Nest renders as 404 rather than 403 so the endpoint
 * cannot be used to probe which patient ids exist (BUILD_SPEC §6).
 *
 * Chunks arrive as raw application/octet-stream rather than multipart:
 * multipart adds encoding overhead and a parse step on both ends for a single
 * opaque blob, and on a constrained Libyan uplink that overhead is real money.
 *
 * Restricted to `libya_doctor`. Uploading is the referring side's action; no
 * other role has a reason to reach these routes at all, and the narrower
 * declaration means a future role addition cannot silently inherit upload
 * rights (P1.5).
 */

const createSessionSchema = z.object({
  patientId: z.string().uuid(),
  // An upper bound so a typo cannot open a session claiming millions of files.
  // A CD-based study is hundreds of files; 10,000 is generous headroom.
  expectedFileCount: z.number().int().positive().max(10_000),
});

const registerFileSchema = z.object({
  clientFileId: z.string().min(1).max(512),
  fileName: z.string().min(1).max(512),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'sha256 must be 64 lowercase hex characters'),
  contentEncoding: z.enum(['identity', 'gzip']).optional(),
});

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadService) {}

  @RequiresRole('libya_doctor')
  @Post()
  async createSession(@Body() body: unknown): Promise<{ sessionId: string; expiresAt: string }> {
    const parsed = createSessionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid upload session request');

    const { sessionId, expiresAt } = await this.uploads.createSession(parsed.data);
    return { sessionId, expiresAt: expiresAt.toISOString() };
  }

  @RequiresRole('libya_doctor')
  @Post(':sessionId/files')
  async registerFile(
    @Param('sessionId') sessionId: string,
    @Body() body: unknown,
  ): Promise<FileUploadState> {
    const parsed = registerFileSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid file registration');

    return this.uploads.registerFile({ sessionId, ...parsed.data });
  }

  /**
   * The resume point after a dropped connection (P7.2).
   *
   * The answer is authoritative server state, never the client's recollection
   * of what it managed to send. A client that believes it sent more than the
   * server recorded would otherwise skip a chunk and produce a file that fails
   * checksum at the end of a long upload.
   */
  @RequiresRole('libya_doctor')
  @Get('files/:fileId')
  async getFileState(@Param('fileId') fileId: string): Promise<FileUploadState> {
    return this.uploads.getFileState(fileId);
  }

  @RequiresRole('libya_doctor')
  @Put('files/:fileId/chunks/:chunkIndex')
  async appendChunk(
    @Param('fileId') fileId: string,
    @Param('chunkIndex', ParseIntPipe) chunkIndex: number,
    @Req() req: Request,
  ): Promise<{ receivedBytes: number; nextChunkIndex: number; duplicate: boolean }> {
    // express.raw() leaves a Buffer here. Anything else means the request did
    // not carry application/octet-stream, and passing a parsed body through as
    // if it were bytes would corrupt the staged file.
    const body: unknown = req.body;
    if (!Buffer.isBuffer(body)) {
      throw new BadRequestException('Chunk body must be application/octet-stream');
    }
    if (body.byteLength === 0) {
      throw new BadRequestException('Chunk body is empty');
    }

    return this.uploads.appendChunk(fileId, chunkIndex, body);
  }

  @RequiresRole('libya_doctor')
  @Post('files/:fileId/complete')
  async completeFile(@Param('fileId') fileId: string): Promise<{ verified: true; sha256: string }> {
    return this.uploads.completeFile(fileId);
  }
}
