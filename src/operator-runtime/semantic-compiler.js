import { validateSemanticDirective } from './contracts.js';
import { valueMatchesSchema } from './semantic-values.js';

function allOperators(pack) {
  return pack.families.flatMap(family => family.variants);
}

function planState(status) {
  if (status === 'ACTIVE') {
    return {
      status: 'READY',
      executable: false,
      blockers: ['operator_plan_execution_compiler_not_implemented'],
    };
  }
  if (['EXPERIMENTAL_UNCALIBRATED', 'CALIBRATED'].includes(status)) {
    return { status: 'UNVERIFIED', executable: false, blockers: ['operator_pack_not_active'] };
  }
  if (status === 'DEPRECATED') {
    return { status: 'BLOCKED', executable: false, blockers: ['operator_pack_deprecated'] };
  }
  return { status: 'BLOCKED', executable: false, blockers: ['operator_pack_draft'] };
}

function validateDirectiveAgainstPack({ directive, pack, semanticOperator, rule }) {
  const axes = new Map(pack.axes.map(axis => [axis.axisId, axis]));
  const locks = new Set(pack.locks.map(lock => lock.lockId));
  const seenAxes = new Set();
  for (const change of directive.axisChanges) {
    if (seenAxes.has(change.axisId)) throw new Error(`semantic_axis_change_duplicate:${change.axisId}`);
    seenAxes.add(change.axisId);
    const axis = axes.get(change.axisId);
    if (!axis) throw new Error(`semantic_axis_not_supported:${change.axisId}`);
    if (!valueMatchesSchema(change.value, axis.valueSchema)) {
      throw new Error(`semantic_axis_value_invalid:${change.axisId}`);
    }
    const supported = semanticOperator.effects.some(effect => (
      effect.axisId === change.axisId && effect.mode === change.mode
    ));
    if (!supported) throw new Error(`semantic_effect_not_supported:${change.axisId}:${change.mode}`);
  }
  const requestedLocks = new Set();
  for (const lock of directive.locks) {
    if (!locks.has(lock.lockId)) throw new Error(`semantic_lock_not_supported:${lock.lockId}`);
    requestedLocks.add(lock.lockId);
  }
  const requiredAxes = new Set([...rule.requiredAxisIds]);
  const missingAxis = [...requiredAxes].find(axisId => !seenAxes.has(axisId));
  if (missingAxis) throw new Error(`semantic_required_axis_missing:${missingAxis}`);
  const requiredLocks = new Set([
    ...semanticOperator.requiredLockIds,
    ...rule.requiredLockIds,
  ]);
  const missingLock = [...requiredLocks].find(lockId => !requestedLocks.has(lockId));
  if (missingLock) throw new Error(`semantic_required_lock_missing:${missingLock}`);
}

export function compileSemanticDirective({ store, directive } = {}) {
  const validation = validateSemanticDirective(directive);
  if (!validation.ok) throw new Error(validation.reason);
  if (!store || typeof store.getPack !== 'function' || typeof store.getStatus !== 'function') {
    throw new TypeError('operator_registry_store_required');
  }
  const pack = store.getPack(directive.packRef);
  const status = store.getStatus(directive.packRef);
  const operators = allOperators(pack);
  const semanticOperator = operators.find(operator => (
    operator.operatorId === directive.operatorRef.operatorId
    && operator.version === directive.operatorRef.version
  ));
  if (!semanticOperator) throw new Error('semantic_operator_not_found');
  if (semanticOperator.executionMode !== 'COMPILE_ONLY') {
    throw new Error('semantic_operator_must_be_compile_only');
  }
  const rule = pack.compilerRules.find(candidate => (
    candidate.sourceOperatorId === semanticOperator.operatorId
  ));
  if (!rule) throw new Error('semantic_compiler_rule_not_found');
  validateDirectiveAgainstPack({ directive, pack, semanticOperator, rule });
  const state = planState(status);

  return {
    schema: 'eve-atelier-operator-plan/v1',
    planId: `plan:${directive.directiveId}`,
    sourceDirectiveId: directive.directiveId,
    packRef: structuredClone(directive.packRef),
    status: state.status,
    executable: state.executable,
    blockers: [...state.blockers],
    steps: rule.emitsOperatorIds.map((operatorId, index) => {
      const operator = operators.find(candidate => candidate.operatorId === operatorId);
      return {
        stepId: `step:${index + 1}`,
        operatorRef: { operatorId: operator.operatorId, version: operator.version },
        target: structuredClone(directive.target),
        expectedRevision: directive.expectedRevision,
        constraints: {
          axisChanges: structuredClone(directive.axisChanges),
          locks: structuredClone(directive.locks),
        },
      };
    }),
  };
}
