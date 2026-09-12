import { validateVisualIntent } from '../visual-intelligence/contracts.js';
import { cloneKnowledgeValue } from './contracts.js';

const roleMap = Object.freeze({
  STYLE_CORE_REFERENCE: 'POSITIVE_STYLE',
  IDENTITY_REFERENCE: 'IDENTITY',
  FACE_REFERENCE: 'IDENTITY',
  PROPORTION_REFERENCE: 'STRUCTURE',
  POSE_REFERENCE: 'STRUCTURE',
  COSTUME_REFERENCE: 'IDENTITY',
  COLOR_REFERENCE: 'COLOR',
  LINE_REFERENCE: 'POSITIVE_STYLE',
  LIGHTING_REFERENCE: 'LIGHTING',
  COMPOSITION_REFERENCE: 'POSITIVE_STYLE',
  NEGATIVE_REFERENCE: 'NEGATIVE',
});

const dimensionMap = Object.freeze({
  IDENTITY: 'IDENTITY',
  FACE_IDENTITY: 'IDENTITY',
  CHARACTER_IDENTITY: 'IDENTITY',
  COSTUME_IDENTITY: 'IDENTITY',
  GENDER: 'IDENTITY',
  STRUCTURE: 'STRUCTURE',
  PROPORTION_SYNTAX: 'STRUCTURE',
  GARMENT_VOLUME: 'STRUCTURE',
  STYLE: 'STYLE',
  SURFACE_RENDERING: 'STYLE',
  COMPOSITION_RHYTHM: 'COMPOSITION',
  DETAIL_LANGUAGE: 'STYLE',
  PALETTE_COMPATIBILITY: 'COLOR',
  COLOR: 'COLOR',
  LIGHTING: 'LIGHTING',
  COMPOSITION: 'COMPOSITION',
  MATERIAL: 'MATERIAL',
  PRIVACY: 'PRIVACY',
  LOCALITY: 'LOCALITY',
  COST: 'COST',
  LATENCY: 'LATENCY',
  HUMAN_REVIEW: 'HUMAN_REVIEW',
  ALPHA: 'ALPHA',
  EDGE: 'EDGE',
});

function required(store) {
  if (!store || typeof store.getRecord !== 'function') {
    throw new TypeError('reference_intent_knowledge_store_required');
  }
  return store;
}

export function bindReferenceDrivenIntent({
  baseIntent,
  directives,
  knowledgeStore,
} = {}) {
  knowledgeStore = required(knowledgeStore);
  const validation = validateVisualIntent(baseIntent);
  if (!validation.ok) throw new Error(validation.reason);
  if (!Array.isArray(directives) || directives.length === 0) {
    throw new TypeError('reference_intent_directives_required');
  }
  const references = [...baseIntent.references];
  const hardConstraints = [...baseIntent.hardConstraints];
  const existingIds = new Set(references.map(item => item.referenceId));
  for (const directive of directives) {
    if (!directive
        || typeof directive !== 'object'
        || Array.isArray(directive)
        || Object.keys(directive).length !== 2
        || typeof directive.directiveId !== 'string'
        || directive.directiveId.length === 0
        || typeof directive.roleBindingId !== 'string'
        || directive.roleBindingId.length === 0
        || existingIds.has(directive.directiveId)) {
      throw new Error('reference_intent_directive_invalid');
    }
    const role = knowledgeStore.getRecord('REFERENCE_ROLE', directive.roleBindingId);
    const reference = knowledgeStore.getRecord('REFERENCE_ASSET', role.referenceAssetId);
    const source = knowledgeStore.getRecord('SOURCE_IDENTITY', reference.sourceIdentityId);
    if (role.projectId !== baseIntent.projectId || reference.projectId !== baseIntent.projectId) {
      throw new Error('reference_intent_project_mismatch');
    }
    const appliesTo = [...new Set(role.allowedInfluence.map(item => dimensionMap[item]))]
      .filter(Boolean);
    if (appliesTo.length === 0) throw new Error('reference_intent_influence_unmappable');
    references.push({
      referenceId: directive.directiveId,
      assetRef: cloneKnowledgeValue(reference.assetRef),
      role: roleMap[role.role],
      appliesTo,
    });
    existingIds.add(directive.directiveId);
    if (source.rightsClass !== 'RIGHTS_CLEAR'
        && !hardConstraints.some(item => (
          item.dimension === 'PRIVACY'
          && item.requirement === `LOCAL_ONLY_REFERENCE:${reference.referenceAssetId}`
        ))) {
      hardConstraints.push({
        dimension: 'PRIVACY',
        requirement: `LOCAL_ONLY_REFERENCE:${reference.referenceAssetId}`,
      });
    }
  }
  const value = { ...cloneKnowledgeValue(baseIntent), references, hardConstraints };
  const boundValidation = validateVisualIntent(value);
  if (!boundValidation.ok) throw new Error(boundValidation.reason);
  return value;
}
