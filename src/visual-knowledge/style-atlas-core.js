import { createHash } from 'node:crypto';
import { canonicalJson } from '../operator-runtime/canonical.js';
import {
  cloneKnowledgeValue,
  validateAtlasSnapshot,
  validateRetrievalContext,
} from './contracts.js';

function digest(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function round(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function tokens(value) {
  const text = String(value ?? '').normalize('NFKC').toLowerCase();
  const words = text.match(/[\p{L}\p{N}]+/gu) ?? [];
  const result = new Set(words);
  for (const word of words) {
    if (/\p{Script=Han}/u.test(word)) {
      for (const character of [...word]) result.add(character);
      const characters = [...word];
      for (let index = 0; index + 1 < characters.length; index += 1) {
        result.add(`${characters[index]}${characters[index + 1]}`);
      }
    }
  }
  return result;
}

function overlap(left, right) {
  if (left.size === 0 || right.size === 0) return 0;
  let count = 0;
  for (const token of left) if (right.has(token)) count += 1;
  return count / left.size;
}

function cosine(left, right) {
  if (left.length !== right.length) throw new Error('style_atlas_vector_dimension_mismatch');
  return left.reduce((sum, item, index) => sum + (item * right[index]), 0);
}

function extractorKey(value) {
  return canonicalJson(value.extractor);
}

function conceptStatuses(records) {
  const statuses = new Map(records.visualConcepts.map(item => [item.conceptId, item.initialStatus]));
  for (const event of records.conceptStatusEvents) statuses.set(event.conceptId, event.toStatus);
  return statuses;
}

function preferenceScores(records) {
  const scores = new Map();
  const refs = new Map();
  const add = (id, score, preferenceId) => {
    scores.set(id, (scores.get(id) ?? 0) + score);
    if (!refs.has(id)) refs.set(id, []);
    refs.get(id).push(preferenceId);
  };
  for (const preference of records.preferences) {
    if (preference.stance === 'LIKE' || preference.stance === 'PREFER_SUBJECT') {
      add(preference.subjectReferenceAssetId, 1, preference.preferenceId);
    } else if (preference.stance === 'DISLIKE') {
      add(preference.subjectReferenceAssetId, -1, preference.preferenceId);
    } else if (preference.stance === 'PREFER_COMPARISON') {
      add(preference.subjectReferenceAssetId, -1, preference.preferenceId);
      add(preference.comparisonReferenceAssetId, 1, preference.preferenceId);
    } else if (preference.stance === 'TIE') {
      add(preference.subjectReferenceAssetId, 0, preference.preferenceId);
      add(preference.comparisonReferenceAssetId, 0, preference.preferenceId);
    }
  }
  return { scores, refs };
}

function clusters(records, threshold) {
  const grouped = new Map();
  for (const feature of records.featureObservations) {
    const key = extractorKey(feature);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(feature);
  }
  const result = [];
  for (const [key, features] of [...grouped.entries()].sort(([left], [right]) => (
    left.localeCompare(right)
  ))) {
    features.sort((left, right) => left.referenceAssetId.localeCompare(right.referenceAssetId));
    const parent = features.map((_, index) => index);
    const find = index => {
      while (parent[index] !== index) {
        parent[index] = parent[parent[index]];
        index = parent[index];
      }
      return index;
    };
    const union = (left, right) => {
      const l = find(left);
      const r = find(right);
      if (l !== r) parent[Math.max(l, r)] = Math.min(l, r);
    };
    for (let left = 0; left < features.length; left += 1) {
      for (let right = left + 1; right < features.length; right += 1) {
        if (cosine(features[left].vector, features[right].vector) >= threshold) {
          union(left, right);
        }
      }
    }
    const components = new Map();
    for (let index = 0; index < features.length; index += 1) {
      const root = find(index);
      if (!components.has(root)) components.set(root, []);
      components.get(root).push(features[index]);
    }
    for (const component of components.values()) {
      const members = component.map(item => item.referenceAssetId).sort();
      let minimumSimilarity = 1;
      for (let left = 0; left < component.length; left += 1) {
        for (let right = left + 1; right < component.length; right += 1) {
          minimumSimilarity = Math.min(
            minimumSimilarity,
            cosine(component[left].vector, component[right].vector),
          );
        }
      }
      result.push({
        clusterId: `atlas-cluster:${digest({ key, members }).slice(0, 32)}`,
        extractorRef: cloneKnowledgeValue(component[0].extractor),
        memberReferenceAssetIds: members,
        minimumSimilarity: round(minimumSimilarity),
      });
    }
  }
  return result.sort((left, right) => left.clusterId.localeCompare(right.clusterId));
}

export function buildAtlasSnapshotFromRecords({
  records,
  projectId,
  atlasSnapshotId,
  knowledgeRevision,
  clusterThreshold = 0.9,
  createdAt,
}) {
  const roles = new Map();
  for (const role of records.referenceRoles) {
    if (!roles.has(role.referenceAssetId)) roles.set(role.referenceAssetId, []);
    roles.get(role.referenceAssetId).push(role.role);
  }
  const status = conceptStatuses(records);
  const concepts = new Map();
  for (const relation of records.semanticRelations) {
    let referenceId;
    let conceptId;
    if (relation.subject.kind === 'REFERENCE_ASSET'
        && relation.object.kind === 'VISUAL_CONCEPT') {
      referenceId = relation.subject.id;
      conceptId = relation.object.id;
    } else if (relation.object.kind === 'REFERENCE_ASSET'
        && relation.subject.kind === 'VISUAL_CONCEPT') {
      referenceId = relation.object.id;
      conceptId = relation.subject.id;
    }
    if (referenceId && status.get(conceptId) === 'ACTIVE') {
      if (!concepts.has(referenceId)) concepts.set(referenceId, []);
      concepts.get(referenceId).push(conceptId);
    }
  }
  const { scores, refs } = preferenceScores(records);
  const sources = new Map(records.sourceIdentities.map(item => [item.sourceIdentityId, item]));
  const referenceCards = records.referenceAssets.map(reference => {
    const evaluations = records.artifactEvaluations.filter(item => (
      item.assetRef.assetId === reference.assetRef.assetId
    ));
    return {
      referenceAssetId: reference.referenceAssetId,
      assetRef: cloneKnowledgeValue(reference.assetRef),
      rightsClass: sources.get(reference.sourceIdentityId)?.rightsClass ?? 'UNKNOWN',
      labels: [...reference.labels].sort(),
      roles: [...new Set(roles.get(reference.referenceAssetId) ?? [])].sort(),
      conceptIds: [...new Set(concepts.get(reference.referenceAssetId) ?? [])].sort(),
      acceptedEvaluationIds: evaluations.filter(item => (
        ['ACCEPT', 'ACCEPT_WITH_WARNINGS'].includes(item.verdict)
      )).map(item => item.knowledgeEvaluationId).sort(),
      rejectedEvaluationIds: evaluations.filter(item => (
        ['REPAIR', 'REJECT'].includes(item.verdict)
      )).map(item => item.knowledgeEvaluationId).sort(),
      preferenceScore: scores.get(reference.referenceAssetId) ?? 0,
    };
  }).sort((left, right) => left.referenceAssetId.localeCompare(right.referenceAssetId));
  const favorites = [...scores.entries()]
    .filter(([, score]) => score > 0)
    .map(([referenceAssetId, score]) => ({
      referenceAssetId,
      score,
      preferenceIds: [...new Set(refs.get(referenceAssetId) ?? [])].sort(),
    }))
    .sort((left, right) => right.score - left.score
      || left.referenceAssetId.localeCompare(right.referenceAssetId));
  const negativeReferenceAssetIds = [...roles.entries()]
    .filter(([, values]) => values.includes('NEGATIVE_REFERENCE'))
    .map(([referenceAssetId]) => referenceAssetId)
    .sort();
  const value = {
    schema: 'eve-atelier-style-atlas-snapshot/v1',
    atlasSnapshotId,
    projectId,
    knowledgeRevision,
    sourceDigest: digest(records),
    clusterThreshold,
    referenceCards,
    clusters: clusters(records, clusterThreshold),
    favorites,
    negativeReferenceAssetIds,
    createdAt,
  };
  const validation = validateAtlasSnapshot(value);
  if (!validation.ok) throw new Error(validation.reason);
  return value;
}

const selectedFieldForKind = Object.freeze({
  REFERENCE_ASSET: 'referenceAssetIds',
  VISUAL_CONCEPT: 'conceptIds',
  STYLE_OBSERVATION: 'styleObservationIds',
  PREFERENCE_EVENT: 'preferenceIds',
  ARTIFACT_EVALUATION: 'artifactEvaluationIds',
  FAILURE_MODE: 'failureModeIds',
  PROVIDER_EVIDENCE: 'providerEvidenceIds',
  WORKFLOW_EXPERIENCE: 'workflowExperienceIds',
  SEMANTIC_RELATION: 'semanticRelationIds',
});

function activeConcepts(records) {
  const statuses = conceptStatuses(records);
  return records.visualConcepts.filter(item => statuses.get(item.conceptId) === 'ACTIVE');
}

function candidate(kind, id, score, reasons, requiredReferenceIds = []) {
  return {
    recordKind: kind,
    recordId: id,
    score: round(Math.min(1, score)),
    reasons,
    requiredReferenceIds,
  };
}

export function buildRetrievalContextFromAtlas({
  atlas,
  records,
  query,
  retrievalContextId,
  createdAt,
}) {
  const queryTokens = tokens(query.text);
  const candidates = [];
  const concepts = new Map(records.visualConcepts.map(item => [item.conceptId, item]));
  const allowedReferenceIds = new Set(atlas.referenceCards
    .filter(card => query.allowedRightsClasses.includes(card.rightsClass))
    .map(card => card.referenceAssetId));
  for (const card of atlas.referenceCards) {
    if (!query.allowedRightsClasses.includes(card.rightsClass)) continue;
    const conceptText = card.conceptIds.map(id => {
      const item = concepts.get(id);
      return item ? `${item.label} ${item.description}` : '';
    }).join(' ');
    const lexical = overlap(queryTokens, tokens([
      ...card.labels, ...card.roles, conceptText,
    ].join(' ')));
    const roleMatches = query.roles.filter(role => card.roles.includes(role)).length;
    const accepted = card.acceptedEvaluationIds.length > 0;
    const negativeRequested = query.roles.includes('NEGATIVE_REFERENCE');
    const negative = card.roles.includes('NEGATIVE_REFERENCE');
    let score = lexical * 0.45
      + Math.min(0.3, roleMatches * 0.15)
      + (accepted ? 0.15 : 0)
      + (card.preferenceScore > 0 ? 0.1 : 0);
    if (negative && negativeRequested) score += 0.25;
    if (negative && !negativeRequested) score *= 0.25;
    const reasons = [];
    if (lexical > 0) reasons.push('LEXICAL_MATCH');
    if (roleMatches > 0) reasons.push('REFERENCE_ROLE_MATCH');
    if (accepted) reasons.push('ACCEPTED_EVALUATION');
    if (card.preferenceScore > 0) reasons.push('PROJECT_FAVORITE');
    if (negative && negativeRequested) reasons.push('NEGATIVE_REFERENCE_MATCH');
    reasons.push(`RIGHTS_ALLOWED:${card.rightsClass}`);
    if (score > 0 && reasons.length > 0) {
      candidates.push(candidate('REFERENCE_ASSET', card.referenceAssetId, score, reasons));
    }
  }
  for (const concept of activeConcepts(records)) {
    const lexical = overlap(queryTokens, tokens(`${concept.label} ${concept.description} ${concept.domain}`));
    if (lexical > 0) candidates.push(candidate(
      'VISUAL_CONCEPT', concept.conceptId, 0.35 + lexical * 0.5, ['ACTIVE_CONCEPT', 'LEXICAL_MATCH'],
    ));
  }
  const selectedReferences = new Set(candidates
    .filter(item => item.recordKind === 'REFERENCE_ASSET').map(item => item.recordId));
  const selectedAssets = new Set(atlas.referenceCards
    .filter(card => selectedReferences.has(card.referenceAssetId))
    .map(card => card.assetRef.assetId));
  const selectedReferenceByAsset = new Map(atlas.referenceCards
    .filter(card => selectedReferences.has(card.referenceAssetId))
    .sort((left, right) => left.referenceAssetId.localeCompare(right.referenceAssetId))
    .map(card => [card.assetRef.assetId, card.referenceAssetId]));
  for (const evaluation of records.artifactEvaluations) {
    if (selectedAssets.has(evaluation.assetRef.assetId)) candidates.push(candidate(
      'ARTIFACT_EVALUATION', evaluation.knowledgeEvaluationId,
      ['ACCEPT', 'ACCEPT_WITH_WARNINGS'].includes(evaluation.verdict) ? 0.7 : 0.45,
      ['EXACT_ARTIFACT_EVALUATION'],
      [selectedReferenceByAsset.get(evaluation.assetRef.assetId)],
    ));
  }
  for (const observation of records.styleObservations) {
    if (!allowedReferenceIds.has(observation.subjectReferenceAssetId)
        || (observation.comparisonReferenceAssetId !== null
          && !allowedReferenceIds.has(observation.comparisonReferenceAssetId))) continue;
    const dimensionMatches = query.dimensions.filter(dimension => (
      Object.hasOwn(observation.dimensions, dimension)
    )).length;
    if (selectedReferences.has(observation.subjectReferenceAssetId) || dimensionMatches > 0) {
      candidates.push(candidate('STYLE_OBSERVATION', observation.observationId,
        0.3 + Math.min(0.5, dimensionMatches * 0.1),
        dimensionMatches > 0 ? ['DIMENSION_MATCH'] : ['REFERENCE_EVIDENCE'],
        [
          observation.subjectReferenceAssetId,
          ...(observation.comparisonReferenceAssetId === null
            ? [] : [observation.comparisonReferenceAssetId]),
        ]));
    }
  }
  for (const preference of records.preferences) {
    if (!allowedReferenceIds.has(preference.subjectReferenceAssetId)
        || (preference.comparisonReferenceAssetId !== null
          && !allowedReferenceIds.has(preference.comparisonReferenceAssetId))) continue;
    if (selectedReferences.has(preference.subjectReferenceAssetId)
        || selectedReferences.has(preference.comparisonReferenceAssetId)
        || preference.dimensions.some(item => query.dimensions.includes(item))) {
      candidates.push(candidate('PREFERENCE_EVENT', preference.preferenceId, 0.55,
        ['PROJECT_LOCAL_HUMAN_PREFERENCE'], [
          preference.subjectReferenceAssetId,
          ...(preference.comparisonReferenceAssetId === null
            ? [] : [preference.comparisonReferenceAssetId]),
        ]));
    }
  }
  for (const failure of records.failureModes) {
    if (failure.referenceAssetIds.some(id => !allowedReferenceIds.has(id))) continue;
    const dimensionMatch = failure.dimensions.some(item => query.dimensions.includes(item));
    const lexical = overlap(queryTokens, tokens(`${failure.code} ${failure.label} ${failure.description}`));
    if (dimensionMatch || lexical > 0) candidates.push(candidate(
      'FAILURE_MODE', failure.failureModeId, 0.4 + lexical * 0.4,
      [dimensionMatch ? 'DIMENSION_MATCH' : 'LEXICAL_MATCH'],
      [...failure.referenceAssetIds],
    ));
  }
  for (const provider of records.providerEvidence) {
    const lexical = overlap(queryTokens, tokens(`${provider.operatorRef.operatorId} ${provider.contextTags.join(' ')}`));
    if (provider.contextTags.includes(query.taskType) || lexical > 0) candidates.push(candidate(
      'PROVIDER_EVIDENCE', provider.providerEvidenceId,
      0.35 + lexical * 0.35 + (provider.outcome === 'SUCCESS' ? 0.15 : 0),
      ['HISTORICAL_PROVIDER_EVIDENCE'],
    ));
  }
  for (const experience of records.workflowExperiences) {
    if (experience.taskType === query.taskType) candidates.push(candidate(
      'WORKFLOW_EXPERIENCE', experience.workflowExperienceId,
      experience.outcome === 'ACCEPTED' ? 0.75 : 0.35,
      ['TASK_TYPE_MATCH', 'WORKFLOW_HISTORY'],
    ));
  }
  for (const relation of records.semanticRelations) {
    if (selectedReferences.has(relation.subject.id)
        || selectedReferences.has(relation.object.id)) candidates.push(candidate(
      'SEMANTIC_RELATION', relation.relationId,
      0.3 + relation.confidence * 0.3,
      [relation.layer === 'OBSERVER_PROJECTION'
        ? 'OBSERVER_CONDITIONED_RELATION'
        : 'SEMANTIC_RELATION'],
      [relation.subject, relation.object]
        .filter(ref => ref.kind === 'REFERENCE_ASSET')
        .map(ref => ref.id),
    ));
  }
  const unique = new Map();
  for (const item of candidates) {
    const key = `${item.recordKind}:${item.recordId}`;
    const retained = unique.get(key);
    if (!retained || item.score > retained.score) unique.set(key, item);
  }
  const ranked = [...unique.values()]
    .sort((left, right) => right.score - left.score
      || left.recordKind.localeCompare(right.recordKind)
      || left.recordId.localeCompare(right.recordId));
  const selectedInternal = [];
  const retainedKeys = new Set();
  const retainedReferences = new Set();
  let progress = true;
  while (selectedInternal.length < query.limit && progress) {
    progress = false;
    for (const item of ranked) {
      const key = `${item.recordKind}:${item.recordId}`;
      if (retainedKeys.has(key)
          || item.requiredReferenceIds.some(id => !retainedReferences.has(id))) continue;
      selectedInternal.push(item);
      retainedKeys.add(key);
      if (item.recordKind === 'REFERENCE_ASSET') retainedReferences.add(item.recordId);
      progress = true;
      if (selectedInternal.length === query.limit) break;
    }
  }
  const selectionEvidence = selectedInternal.map(({ requiredReferenceIds, ...item }) => item);
  const selected = {
    referenceAssetIds: [],
    conceptIds: [],
    styleObservationIds: [],
    preferenceIds: [],
    artifactEvaluationIds: [],
    failureModeIds: [],
    providerEvidenceIds: [],
    workflowExperienceIds: [],
    semanticRelationIds: [],
  };
  for (const item of selectionEvidence) selected[selectedFieldForKind[item.recordKind]].push(item.recordId);
  for (const values of Object.values(selected)) values.sort();
  const value = {
    schema: 'eve-atelier-visual-retrieval-context/v1',
    retrievalContextId,
    projectId: atlas.projectId,
    query: cloneKnowledgeValue(query),
    knowledgeRevision: atlas.knowledgeRevision,
    atlasSnapshotId: atlas.atlasSnapshotId,
    atlasSourceDigest: atlas.sourceDigest,
    selected,
    selectionEvidence,
    createdAt,
  };
  const validation = validateRetrievalContext(value);
  if (!validation.ok) throw new Error(validation.reason);
  return value;
}

export function cosineSimilarity(left, right) {
  return round(cosine(left, right));
}
