import {
  CONSTRAINT_DIMENSIONS,
  cloneVisualValue,
  normalizeVisualValue,
  validateConstraintPacket,
  validateVisualIntent,
} from './contracts.js';

const compiler = Object.freeze({ id: 'aads-constraint-compiler:bounded-v1', version: '1.0.0' });

function detectedTask(intent) {
  if (intent.taskTypeHint !== 'UNKNOWN') return intent.taskTypeHint;
  const text = intent.text;
  if (/(?:背景.{0,8}(?:去掉|移除|透明)|去背|remove\s+(?:the\s+)?background|transparent\s+background)/iu.test(text)) {
    return 'BACKGROUND_REMOVAL';
  }
  if (/(?:打光|補光|光線|冷光|暖光|relight|lighting)/iu.test(text)) return 'RELIGHT';
  if (/(?:重新上色|改色|recolou?r)/iu.test(text)) return 'RECOLOR';
  if (/(?:調整尺寸|縮放|resize)/iu.test(text)) return 'RESIZE';
  if (/(?:合成|疊圖|composite)/iu.test(text)) return 'COMPOSITE';
  return 'UNKNOWN';
}

function builtInConstraints(intent, taskType) {
  const values = [];
  const add = (dimension, strength, mode, value, suffix) => values.push({
    constraintId: `constraint:${intent.intentId}:${suffix}`,
    dimension,
    strength,
    mode,
    value,
    sourceRef: intent.intentId,
  });
  if (taskType === 'BACKGROUND_REMOVAL') {
    add('IDENTITY', 'HARD', 'PRESERVE', 'source-subject', 'identity');
    add('STRUCTURE', 'HARD', 'PRESERVE', 'source-structure', 'structure');
    add('ALPHA', 'HARD', 'SET', 'transparent-background', 'alpha');
    add('EDGE', 'STRONG', 'AVOID', 'white-fringe', 'edge');
    add('LOCALITY', 'STRONG', 'MINIMIZE', 'subject-boundary-only', 'locality');
  } else if (taskType === 'RELIGHT') {
    add('IDENTITY', 'HARD', 'PRESERVE', 'source-subject', 'identity');
    add('STRUCTURE', 'HARD', 'PRESERVE', 'source-structure', 'structure');
    add('MATERIAL', 'STRONG', 'PRESERVE', 'source-material-response', 'material');
    if (/(?:左後冷光|rear[- ]?left.{0,8}cool|cool.{0,8}rear[- ]?left)/iu.test(intent.text)) {
      add('LIGHTING', 'STRONG', 'SET', {
        direction: 'REAR_LEFT',
        temperature: 'COOL',
      }, 'rear-left-cool');
    } else {
      add('LIGHTING', 'STRONG', 'SET', 'requested-relighting', 'lighting');
    }
    if (/(?:臉.{0,8}暖光|face.{0,8}warm|warm.{0,8}face)/iu.test(intent.text)) {
      add('LIGHTING', 'HARD', 'PRESERVE', {
        region: 'FACE',
        temperature: 'WARM',
      }, 'face-warm');
    }
  } else if (taskType === 'RECOLOR') {
    add('IDENTITY', 'HARD', 'PRESERVE', 'source-subject', 'identity');
    add('STRUCTURE', 'HARD', 'PRESERVE', 'source-structure', 'structure');
    add('COLOR', 'STRONG', 'SET', 'requested-color-direction', 'color');
  } else if (taskType === 'RESIZE') {
    add('IDENTITY', 'HARD', 'PRESERVE', 'source-subject', 'identity');
    add('COMPOSITION', 'STRONG', 'PRESERVE', 'source-composition', 'composition');
  } else if (taskType === 'COMPOSITE') {
    add('STRUCTURE', 'STRONG', 'PRESERVE', 'declared-layer-order', 'structure');
    add('COMPOSITION', 'STRONG', 'SET', 'requested-composite', 'composition');
  }
  return values;
}

export function compileVisualIntent(rawIntent, {
  packetId,
  compiledAt,
  allowedPrivacy = ['LOCAL'],
  requireLocal = true,
  maxCostUnits = 0,
  maxLatencyMs = 60_000,
  humanReview = true,
} = {}) {
  const intent = normalizeVisualValue(rawIntent, 'aads_visual_intent_json_value_invalid');
  const intentValidation = validateVisualIntent(intent);
  if (!intentValidation.ok) throw new Error(intentValidation.reason);
  if (typeof packetId !== 'string' || packetId.length === 0) {
    throw new TypeError('aads_constraint_packet_id_required');
  }
  if (Date.parse(compiledAt) < Date.parse(intent.submittedAt)) {
    throw new Error('aads_constraint_compiled_before_intent');
  }
  const taskType = detectedTask(intent);
  const effectiveHumanReview = humanReview || taskType === 'UNKNOWN';
  const constraints = builtInConstraints(intent, taskType);
  for (let index = 0; index < intent.hardConstraints.length; index += 1) {
    const item = intent.hardConstraints[index];
    constraints.push({
      constraintId: `constraint:${intent.intentId}:human-hard:${index + 1}`,
      dimension: item.dimension,
      strength: 'HARD',
      mode: 'SET',
      value: item.requirement,
      sourceRef: `${intent.intentId}:hard:${index + 1}`,
    });
  }
  for (let index = 0; index < intent.preferences.length; index += 1) {
    const item = intent.preferences[index];
    constraints.push({
      constraintId: `constraint:${intent.intentId}:preference:${index + 1}`,
      dimension: 'STYLE',
      strength: 'PREFERENCE',
      mode: item.kind === 'LIKE' ? 'SET' : 'AVOID',
      value: { subjectRef: item.subjectRef, reason: item.reason },
      sourceRef: `${intent.intentId}:preference:${index + 1}`,
    });
  }
  for (let index = 0; index < intent.overrides.length; index += 1) {
    const item = intent.overrides[index];
    const dimension = CONSTRAINT_DIMENSIONS.includes(item.scope.toUpperCase())
      ? item.scope.toUpperCase()
      : 'COMPOSITION';
    constraints.push({
      constraintId: `constraint:${intent.intentId}:override:${index + 1}`,
      dimension,
      strength: 'HARD',
      mode: 'SET',
      value: item.instruction,
      sourceRef: `${intent.intentId}:override:${index + 1}`,
    });
  }
  const requiredDimensions = [...new Set(constraints.map(item => item.dimension))];
  if (effectiveHumanReview && !requiredDimensions.includes('HUMAN_REVIEW')) {
    constraints.push({
      constraintId: `constraint:${intent.intentId}:human-review`,
      dimension: 'HUMAN_REVIEW',
      strength: 'HARD',
      mode: 'SET',
      value: 'required-before-promotion',
      sourceRef: intent.intentId,
    });
    requiredDimensions.push('HUMAN_REVIEW');
  }
  const packet = {
    schema: 'eve-atelier-constraint-packet/v1',
    packetId,
    intentId: intent.intentId,
    projectId: intent.projectId,
    documentId: intent.documentId,
    taskType,
    constraints,
    referenceDirections: intent.references.map((reference, index) => ({
      directionId: `direction:${intent.intentId}:${index + 1}`,
      assetRef: cloneVisualValue(reference.assetRef),
      role: reference.role,
      appliesTo: [...reference.appliesTo],
    })),
    providerPolicy: {
      allowedPrivacy: [...allowedPrivacy],
      requireLocal,
      maxCostUnits,
      maxLatencyMs,
    },
    evaluationPolicy: {
      requiredDimensions,
      humanReview: effectiveHumanReview,
    },
    requiresHumanClarification: taskType === 'UNKNOWN',
    compiler: cloneVisualValue(compiler),
    compiledAt,
  };
  const validation = validateConstraintPacket(packet);
  if (!validation.ok) throw new Error(validation.reason);
  return packet;
}
