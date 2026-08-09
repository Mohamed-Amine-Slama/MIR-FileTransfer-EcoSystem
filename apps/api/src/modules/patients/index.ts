/**
 * Public API of the `patients` module (BUILD_SPEC §5.1).
 *
 * Other modules get the service and its types. They do NOT get the repository,
 * the controller, or the claim-token internals — imaging must not be able to
 * mint a claim credential, and nothing outside this module should ever query
 * patients_patients directly (§5.1 rule 1).
 */
export { PatientsService } from './internal/patients.service';
export type {
  CreatePatientInput,
  CreatePatientResult,
} from './internal/patients.service';
export type { PatientCandidate } from './internal/patient-matching';
export { PatientsModule } from './patients.module';
