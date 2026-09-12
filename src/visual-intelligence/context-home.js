import {
  cloneVisualValue,
  createDigest,
  normalizeVisualValue,
  validateContextSnapshot,
  validateWorkerContextProjection,
  validateWorkerProfile,
} from './contracts.js';
import { isCanonicalInstant } from '../operator-runtime/time.js';

const sectionReaders = Object.freeze({
  GLOSSARY: value => value.glossary,
  OPERATORS: value => value.operatorPackRefs,
  DOCUMENTS: value => value.artDocuments,
  SESSIONS: value => value.activeSessionRefs,
  EVIDENCE: value => value.evidenceRefs,
  AUTHORITIES: value => [value.sourceAuthorities],
  RETRIEVAL: value => value.retrievalContextRefs ?? [],
});

export function buildProjectContextSnapshot(value) {
  value = normalizeVisualValue(value, 'aads_context_snapshot_json_value_invalid');
  const validation = validateContextSnapshot(value);
  if (!validation.ok) throw new Error(validation.reason);
  return cloneVisualValue(value);
}

export function buildWorkerContextProjection({
  contextSnapshot,
  profile,
  projectionId,
  createdAt,
} = {}) {
  contextSnapshot = buildProjectContextSnapshot(contextSnapshot);
  profile = normalizeVisualValue(profile, 'aads_worker_profile_json_value_invalid');
  const profileValidation = validateWorkerProfile(profile);
  if (!profileValidation.ok) throw new Error(profileValidation.reason);
  if (typeof projectionId !== 'string' || projectionId.trim().length === 0) {
    throw new TypeError('aads_worker_projection_id_required');
  }
  if (!isCanonicalInstant(createdAt)) {
    throw new TypeError('aads_worker_projection_time_required');
  }
  if (Date.parse(createdAt) < Date.parse(contextSnapshot.createdAt)
      || Date.parse(createdAt) < Date.parse(profile.createdAt)) {
    throw new Error('aads_worker_projection_before_sources');
  }
  const sections = {};
  for (const section of profile.allowedSections) {
    sections[section] = cloneVisualValue(sectionReaders[section](contextSnapshot)
      .slice(0, profile.maxEntriesPerSection));
  }
  const projection = {
    schema: 'eve-atelier-worker-context-projection/v1',
    projectionId,
    contextSnapshotId: contextSnapshot.contextSnapshotId,
    contextDigest: createDigest(contextSnapshot),
    projectId: contextSnapshot.projectId,
    profileId: profile.profileId,
    purpose: profile.purpose,
    sections,
    limits: {
      allowedSections: [...profile.allowedSections],
      maxEntriesPerSection: profile.maxEntriesPerSection,
    },
    authority: {
      writeBack: false,
      canEvaluate: false,
      canPromote: false,
      canMerge: false,
      canRelease: false,
      canDeploy: false,
    },
    createdAt,
  };
  const projectionValidation = validateWorkerContextProjection(projection);
  if (!projectionValidation.ok) throw new Error(projectionValidation.reason);
  return projection;
}
