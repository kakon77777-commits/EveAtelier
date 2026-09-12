import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  validateFeatureObservation,
  validatePreferenceEvent,
  validateReferenceRole,
  validateSemanticRelation,
  validateSourceIdentity,
  validateVisualConcept,
} from '../../src/visual-knowledge/contracts.js';

const at = '2026-09-12T01:00:00Z';

test('tracked v0.4 fixtures are role-safe and public-path clean', async () => {
  const roleFixture = JSON.parse(await readFile(new URL(
    '../../fixtures/visual_knowledge/reference-role.example.json',
    import.meta.url,
  ), 'utf8'));
  const queryFixture = JSON.parse(await readFile(new URL(
    '../../fixtures/visual_knowledge/retrieval-query.example.json',
    import.meta.url,
  ), 'utf8'));
  assert.equal(validateReferenceRole(roleFixture).ok, true);
  assert.deepEqual(queryFixture.allowedRightsClasses, ['RIGHTS_CLEAR']);
  assert.equal(/[A-Za-z]:[\\/]/.test(JSON.stringify([roleFixture, queryFixture])), false);
});

function source(overrides = {}) {
  return {
    schema: 'eve-atelier-visual-source-identity/v1',
    sourceIdentityId: 'source:synthetic:v04',
    projectId: 'project:synthetic:v04',
    sourceKind: 'SYNTHETIC',
    canonicalLabel: 'Synthetic reference',
    rightsClass: 'RIGHTS_CLEAR',
    evidenceClass: 'RIGHTS_CLEAR_REAL',
    evidenceRefs: ['evidence:synthetic:rights'],
    provenance: { kind: 'HUMAN', id: 'human:v04-owner' },
    createdAt: at,
    ...overrides,
  };
}

function role(overrides = {}) {
  return {
    schema: 'eve-atelier-reference-role/v1',
    roleBindingId: 'role:v04:line',
    projectId: 'project:synthetic:v04',
    referenceAssetId: 'reference:v04:one',
    role: 'LINE_REFERENCE',
    allowedInfluence: ['SURFACE_RENDERING', 'STYLE'],
    scope: { kind: 'PROJECT_LOCAL', projectId: 'project:synthetic:v04', taskId: null },
    evidenceRefs: ['evidence:v04:role'],
    provenance: { kind: 'HUMAN', id: 'human:v04-owner' },
    createdAt: at,
    ...overrides,
  };
}

test('rights-clear identity requires rights-grade evidence and private evidence stays private', () => {
  assert.equal(validateSourceIdentity(source()).ok, true);
  assert.equal(validateSourceIdentity(source({
    evidenceClass: 'HUMAN_OBSERVED',
  })).reason, 'visual_source_rights_evidence_insufficient');
  assert.equal(validateSourceIdentity(source({
    provenance: { kind: 'AI', id: 'ai:no-rights-authority' },
  })).reason, 'visual_source_rights_authority_invalid');
  assert.equal(validateSourceIdentity(source({
    rightsClass: 'PRIVATE_RESEARCH',
    evidenceClass: 'PRIVATE_RESEARCH_AUTHORIZED',
  })).ok, true);
});

test('style roles cannot leak identity while explicit negative identity avoidance remains legal', () => {
  assert.equal(validateReferenceRole(role()).ok, true);
  assert.equal(validateReferenceRole(role({
    allowedInfluence: ['SURFACE_RENDERING', 'FACE_IDENTITY'],
  })).reason, 'visual_reference_role_identity_influence_forbidden');
  assert.equal(validateReferenceRole(role({
    roleBindingId: 'role:v04:negative-face',
    role: 'NEGATIVE_REFERENCE',
    allowedInfluence: ['FACE_IDENTITY'],
  })).ok, true);
});

test('project preference cannot claim universal aesthetic truth', () => {
  const preference = {
    schema: 'eve-atelier-preference-event/v1',
    preferenceId: 'preference:v04:one',
    projectId: 'project:synthetic:v04',
    observer: { kind: 'HUMAN', id: 'human:v04-owner' },
    subjectReferenceAssetId: 'reference:v04:one',
    comparisonReferenceAssetId: null,
    stance: 'LIKE',
    dimensions: ['STYLE'],
    reason: 'Preferred for this project.',
    scope: { kind: 'PROJECT_LOCAL', projectId: 'project:synthetic:v04', taskId: null },
    evidenceClass: 'HUMAN_OBSERVED',
    evidenceRefs: ['evidence:v04:preference'],
    observedAt: at,
  };
  assert.equal(validatePreferenceEvent(preference).ok, true);
  assert.equal(validatePreferenceEvent({
    ...preference,
    reason: 'Objectively best for all users.',
  }).ok, false);
  assert.equal(validatePreferenceEvent({
    ...preference,
    scope: { kind: 'UNIVERSAL', projectId: 'project:synthetic:v04', taskId: null },
  }).ok, false);
});

test('observer projection cannot masquerade as a shared-domain relation', () => {
  const relation = {
    schema: 'eve-atelier-semantic-relation/v1',
    relationId: 'relation:v04:one',
    projectId: 'project:synthetic:v04',
    layer: 'OBSERVER_PROJECTION',
    subject: { kind: 'REFERENCE_ASSET', id: 'reference:v04:one' },
    predicate: 'FEELS_ELEGANT_TO',
    object: { kind: 'VISUAL_CONCEPT', id: 'concept:v04:elegant' },
    confidence: 0.8,
    observerRef: { kind: 'HUMAN', id: 'human:v04-owner' },
    evidenceClass: 'HUMAN_OBSERVED',
    evidenceRefs: ['evidence:v04:observer'],
    provenance: { kind: 'HUMAN', id: 'human:v04-owner' },
    createdAt: at,
  };
  assert.equal(validateSemanticRelation(relation).ok, true);
  assert.equal(validateSemanticRelation({ ...relation, layer: 'SHARED_DOMAIN' }).reason,
    'visual_semantic_relation_observer_scope_invalid');
  assert.equal(validateSemanticRelation({ ...relation, observerRef: null }).reason,
    'visual_semantic_relation_observer_scope_invalid');
});

test('feature vectors are finite, dimension-bound, and L2 normalized', () => {
  const feature = {
    schema: 'eve-atelier-feature-observation/v1',
    featureObservationId: 'feature:v04:one',
    projectId: 'project:synthetic:v04',
    referenceAssetId: 'reference:v04:one',
    extractor: { id: 'extractor:synthetic', version: '1.0.0', spaceId: 'style', dimensions: 2 },
    vector: [0.8, 0.6],
    normalization: 'L2',
    evidenceClass: 'FIXTURE',
    evidenceRefs: ['evidence:v04:feature'],
    provenance: { kind: 'RUNTIME', id: 'extractor:synthetic' },
    createdAt: at,
  };
  assert.equal(validateFeatureObservation(feature).ok, true);
  assert.equal(validateFeatureObservation({ ...feature, vector: [0.8, 0.5] }).reason,
    'visual_feature_vector_not_l2_normalized');
  assert.equal(validateFeatureObservation({
    ...feature,
    extractor: { ...feature.extractor, dimensions: 3 },
  }).ok, false);
});

test('visual concepts always begin as candidates even when proposed by AI', () => {
  const concept = {
    schema: 'eve-atelier-visual-concept/v1',
    conceptId: 'concept:v04:fine-line',
    projectId: 'project:synthetic:v04',
    conceptKey: 'visual.concept.fine-line',
    version: '1.0.0',
    label: 'Fine line',
    description: 'Thin controlled line rendering.',
    domain: 'character-art',
    initialStatus: 'CANDIDATE',
    alternatives: [],
    evidenceRefs: ['evidence:v04:concept'],
    evidenceClass: 'UNVERIFIED',
    provenance: { kind: 'AI', id: 'ai:proposal-only' },
    createdAt: at,
  };
  assert.equal(validateVisualConcept(concept).ok, true);
  assert.equal(validateVisualConcept({ ...concept, initialStatus: 'ACTIVE' }).ok, false);
});
