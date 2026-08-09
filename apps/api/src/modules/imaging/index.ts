/**
 * Public API of the `imaging` module (BUILD_SPEC §5.1).
 *
 * Deliberately NOT exported: OrthancHttpClient and the DICOMweb controller.
 * Orthanc credentials and the retrieval path stay inside this module — no
 * other module has a legitimate reason to reach the DICOM server, and an
 * export here would be the first step toward one doing it without the
 * authorization and audit that P8.2 requires.
 */
export { UploadService } from './internal/upload.service';
export type { CreateSessionInput, RegisterFileInput, FileUploadState } from './internal/upload.service';
export { IngestionService } from './internal/ingestion.service';
export { StudyAccessService } from './internal/study-access.service';
export type { AccessKind, AuthorisedStudy } from './internal/study-access.service';
export { ImagingModule } from './imaging.module';
