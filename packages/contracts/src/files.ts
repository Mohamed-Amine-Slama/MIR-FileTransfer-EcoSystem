import { z } from 'zod';
import { caseRefSchema } from './case';
import { caseSideSchema } from './corridor';

/**
 * Medical files — brief §5.2 (client-side validation) and §5.4 (audit trail).
 *
 * Two things live here because they are the two obligations the FRONTEND has
 * about files. Everything else about a study — storage, encryption at rest,
 * de-identification — is backend and out of scope per §6.
 */

/**
 * §5.4 P1 and §4.4: "who accessed/modified it and when, shown to authorized
 * users". The actor is a display name plus a corridor SIDE, never a country
 * (§4.3), so a Libyan clinic reads "the destination clinic viewed this" with
 * no country logic on the screen rendering it.
 */
export const FILE_ACCESS_ACTIONS = ['uploaded', 'viewed', 'downloaded', 'replaced'] as const;
export const fileAccessActionSchema = z.enum(FILE_ACCESS_ACTIONS);
export type FileAccessAction = z.infer<typeof fileAccessActionSchema>;

export const fileAccessEventSchema = z.object({
  id: z.string().min(1),
  caseRef: caseRefSchema,
  /** The study the access was against — the unit a case actually carries. */
  studyId: z.string().min(1),
  actorDisplayName: z.string().min(1),
  actorSide: caseSideSchema,
  action: fileAccessActionSchema,
  occurredAt: z.string().datetime(),
});
export type FileAccessEvent = z.infer<typeof fileAccessEventSchema>;

/**
 * The most recent access to one study, or null if there has been none.
 *
 * Null rather than a throw or a placeholder event: "nobody has opened this
 * yet" is a real and common state for a freshly uploaded study, and the caller
 * renders it differently from an access it cannot describe.
 */
export function lastAccessOf(
  events: readonly FileAccessEvent[],
  studyId: string,
): FileAccessEvent | null {
  let latest: FileAccessEvent | null = null;
  for (const event of events) {
    if (event.studyId !== studyId) continue;
    if (latest === null || Date.parse(event.occurredAt) > Date.parse(latest.occurredAt)) {
      latest = event;
    }
  }
  return latest;
}

// ---------------------------------------------------------------------------

/**
 * §5.2 P0: "client-side validation on required fields and file types/sizes
 * before submission".
 *
 * THIS IS A COURTESY, NOT A CONTROL. The API validates by CONTENT — a magic
 * number, not a filename — because an extension is chosen by whoever named the
 * file. What this buys is the clinic on a slow Libyan link learning that they
 * picked the wrong folder in a second rather than after twenty minutes of
 * upload, which is the actual failure the brief is describing.
 */
const ALLOWED_EXTENSIONS = ['dcm', 'dicom', 'pdf', 'jpg', 'jpeg', 'png'] as const;

/**
 * DICOM files exported by scanners very often have NO extension at all —
 * `IM000001`, `I0000023`. Refusing those would reject the single most common
 * shape of a real study, so an absent extension is allowed and left to the
 * content check on the server.
 */
function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toLowerCase();
}

/** 4 GiB: a large multi-series CT fits; a whole PACS export does not. */
export const MAX_MEDICAL_FILE_BYTES = 4 * 1024 * 1024 * 1024;

export type FileRejectionKey = 'fileTypeNotAllowed' | 'fileTooLarge' | 'fileEmpty';

export interface FileCandidate {
  name: string;
  sizeBytes: number;
}

/**
 * Returns a DICTIONARY KEY for the first problem, or null if the file is
 * acceptable. A key rather than a message because §4.2 requires this to be
 * readable in Arabic and French, and a validator that returns English prose
 * cannot be.
 */
export function validateMedicalFile(file: FileCandidate): FileRejectionKey | null {
  const extension = extensionOf(file.name);
  if (extension !== null && !(ALLOWED_EXTENSIONS as readonly string[]).includes(extension)) {
    return 'fileTypeNotAllowed';
  }
  if (file.sizeBytes <= 0) return 'fileEmpty';
  if (file.sizeBytes > MAX_MEDICAL_FILE_BYTES) return 'fileTooLarge';
  return null;
}
