/**
 * J1 public surface: immutable snapshot, native repository, coordinator.
 * No UI, no catalog writes, no shared-backend claims.
 */
export {
  JOB_SNAPSHOT_VERSION,
  JOB_SNAPSHOT_LIMITS,
  captureComposition,
  validateComposition,
  canonicalCompositionPayload,
  normalizeJobCompositionForPreview,
} from "./snapshot";
export type {
  JobCircularLines,
  EmbeddedIconDefinition,
  JobTextSnapshot,
  JobIconSnapshot,
  JobGraphicPathSnapshot,
  JobGraphicSnapshot,
  JobApprovedSnapshot,
  JobCustomer,
  JobCompositionSnapshot,
  IconResolution,
  CompositionInput,
  CaptureResult,
  ValidateResult,
  CanonicalResult,
  JobPreview,
} from "./snapshot";
export { createJobsRepository } from "./repository";
export {
  JOBS_DB_NAME,
  JOBS_STORE_NAME,
  JOBS_DB_VERSION,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
} from "./repository";
export type {
  JobsErrorCode,
  JobsError,
  StoredJob,
  CreateInput,
  CreateResult,
  GetResult,
  SkippedJob,
  ListResult,
  JobsRepository,
} from "./repository";
export { createConfirmationCoordinator } from "./coordinator";
export type {
  ConfirmWriterInput,
  ConfirmWriterJob,
  ConfirmWriter,
  AttemptPreview,
  ConfirmResult,
  ConfirmationCoordinator,
} from "./coordinator";
