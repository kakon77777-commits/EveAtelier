const emptyUsage = Object.freeze({
  iterations: 0,
  providerCalls: 0,
  candidates: 0,
  repairLoops: 0,
  costUnits: 0,
  latencyMs: 0,
});

function required(value, methods, reason) {
  if (!value || methods.some(method => typeof value[method] !== 'function')) {
    throw new TypeError(reason);
  }
  return value;
}

function usage(overrides = {}) {
  return { ...emptyUsage, ...overrides };
}

function exceedsBudget(budget, current, delta) {
  return current.iterations + delta.iterations > budget.maxIterations
    || current.providerCalls + delta.providerCalls > budget.maxProviderCalls
    || current.candidates + delta.candidates > budget.maxCandidates
    || current.repairLoops + delta.repairLoops > budget.maxRepairLoops
    || current.costUnits + delta.costUnits > budget.maxCostUnits
    || current.latencyMs + delta.latencyMs > budget.maxLatencyMs;
}

function actionForNode(node) {
  if (node.kind === 'OPERATOR') return 'EXECUTE';
  if (node.kind === 'EVALUATE') return 'EVALUATE';
  if (node.kind === 'HUMAN_GATE') return 'REQUEST_HUMAN';
  if (node.kind === 'PROMOTE') return 'PROMOTE';
  return 'STOP';
}

function validUsage(value) {
  return value
    && typeof value === 'object'
    && !Array.isArray(value)
    && ['providerCalls', 'candidates', 'costUnits', 'latencyMs']
      .every(key => Number.isFinite(value[key]) && value[key] >= 0)
    && Number.isSafeInteger(value.providerCalls)
    && Number.isSafeInteger(value.candidates)
    && Number.isSafeInteger(value.latencyMs);
}

function assertOperatorOutcome(value, node) {
  if (!value
      || !['FAILED', 'COMPLETED'].includes(value.status)
      || !validUsage(value.usage)
      || !Array.isArray(value.evidenceRefs)
      || value.evidenceRefs.some(item => typeof item !== 'string' || item.length === 0)) {
    throw new Error('rabcl_adapter_outcome_invalid');
  }
  if (value.status === 'FAILED') {
    if (typeof value.failureClass !== 'string'
        || typeof value.decision !== 'string'
        || typeof value.retryAuthorized !== 'boolean') {
      throw new Error('rabcl_adapter_failure_invalid');
    }
  } else if (!value.asset
      || typeof value.executionId !== 'string'
      || value.outputRole !== node.commit.outputRole
      || (node.commit.kind === 'CANDIDATE_VERSION'
        && typeof value.candidateVersionId !== 'string')
      || (node.commit.kind === 'ASSET_ONLY' && value.candidateVersionId !== null)) {
    throw new Error('rabcl_adapter_success_invalid');
  }
}

export class RabclRuntime {
  #store;
  #adapter;
  #now;
  #actor;

  constructor({
    store,
    adapter,
    now = () => new Date().toISOString(),
    actor = { kind: 'SYSTEM', id: 'aads-runtime:v1' },
  }) {
    this.#store = required(
      store,
      ['getSessionSnapshot', 'getOperatorPlan', 'getWorkflow', 'appendEvent'],
      'rabcl_session_store_required',
    );
    this.#adapter = required(
      adapter,
      ['getArtSnapshot', 'executeOperator', 'evaluate', 'recordHumanReview', 'promote'],
      'rabcl_workbench_adapter_required',
    );
    if (typeof now !== 'function') throw new TypeError('rabcl_clock_required');
    this.#now = now;
    this.#actor = structuredClone(actor);
  }

  #eventId(sessionId, snapshot, type) {
    return `aads-event:${sessionId}:${snapshot.sequence + 1}:${type.toLowerCase()}`;
  }

  #append(snapshot, request) {
    return this.#store.appendEvent({
      eventId: this.#eventId(snapshot.session.sessionId, snapshot, request.type),
      sessionId: snapshot.session.sessionId,
      expectedSequence: snapshot.sequence,
      nodeId: request.nodeId ?? null,
      decision: request.decision ?? null,
      output: request.output ?? {},
      usageDelta: request.usageDelta ?? usage(),
      evidenceRefs: request.evidenceRefs ?? [],
      actor: request.actor ?? this.#actor,
      occurredAt: this.#now(),
      type: request.type,
    });
  }

  #stop(snapshot, outcome, evidenceRefs = [], usageDelta = usage()) {
    this.#append(snapshot, {
      type: 'SESSION_STOPPED',
      nodeId: snapshot.currentNodeId,
      decision: 'STOP',
      output: { outcome, nextNodeId: null },
      evidenceRefs,
      usageDelta,
    });
    return this.#store.getSessionSnapshot(snapshot.session.sessionId);
  }

  #initialStateFresh(session) {
    const art = this.#adapter.getArtSnapshot(session.documentId);
    return art.currentVersion.versionId === session.initialArtState.currentVersionId
      && art.documentRevision === session.initialArtState.documentRevision
      && art.componentGraph.componentDigest === session.initialArtState.componentGraphDigest;
  }

  async run(sessionId) {
    while (true) {
      let snapshot = this.#store.getSessionSnapshot(sessionId);
      if (['COMPLETED', 'STOPPED', 'FAILED', 'WAITING_HUMAN'].includes(snapshot.status)) {
        return snapshot;
      }
      const session = snapshot.session;
      const workflow = this.#store.getWorkflow(session.workflowId);
      const plan = this.#store.getOperatorPlan(session.planId);
      if (snapshot.inFlightNodeId !== null) {
        const interrupted = workflow.nodes.find(item => item.nodeId === snapshot.inFlightNodeId);
        return this.#stop(snapshot, 'FAILED', [
          `evidence:rabcl:unknown-after-dispatch:${snapshot.inFlightNodeId}`,
        ], usage({ providerCalls: interrupted?.kind === 'OPERATOR' ? 1 : 0 }));
      }
      const node = workflow.nodes.find(item => item.nodeId === snapshot.currentNodeId);
      if (!node) return this.#stop(snapshot, 'FAILED', ['evidence:rabcl:node-missing']);
      if ((snapshot.visits[node.nodeId] ?? 0) >= node.maxVisits) {
        return this.#stop(snapshot, 'BUDGET_EXHAUSTED', [
          `evidence:rabcl:node-visit-limit:${node.nodeId}`,
        ]);
      }
      const action = actionForNode(node);
      if (!session.authority.allowedActions.includes(action)
          || (node.kind === 'PROMOTE'
            && session.authority.promotionMode !== 'POLICY_GATED')) {
        return this.#stop(snapshot, 'FAILED', [`evidence:aads:authority-forbidden:${action}`]);
      }
      const projected = usage({
        iterations: 1,
        providerCalls: node.kind === 'OPERATOR' ? 1 : 0,
        candidates: node.kind === 'OPERATOR' && node.commit.kind === 'CANDIDATE_VERSION' ? 1 : 0,
      });
      if (exceedsBudget(session.budget, snapshot.usage, projected)) {
        return this.#stop(snapshot, 'BUDGET_EXHAUSTED', ['evidence:aads:budget-preflight']);
      }
      if (['OPERATOR', 'PROMOTE'].includes(node.kind) && !this.#initialStateFresh(session)) {
        return this.#stop(snapshot, 'FAILED', ['evidence:aads:initial-art-state-stale']);
      }
      this.#append(snapshot, {
        type: 'NODE_STARTED',
        nodeId: node.nodeId,
        output: { nextNodeId: node.nodeId },
        usageDelta: usage({ iterations: 1 }),
        evidenceRefs: [`evidence:rabcl:${node.nodeId}:started`],
      });
      snapshot = this.#store.getSessionSnapshot(sessionId);
      if (node.kind === 'OPERATOR') {
        let outcome;
        try {
          outcome = await this.#adapter.executeOperator({
            session,
            plan,
            node,
            snapshot,
            now: this.#now,
          });
          assertOperatorOutcome(outcome, node);
        } catch (error) {
          return this.#stop(snapshot, 'FAILED', [
            `evidence:rabcl:adapter-throw:${error?.code ?? 'UNKNOWN_AFTER_DISPATCH'}`,
          ], usage({ providerCalls: 1 }));
        }
        if (outcome.status === 'FAILED') {
          const fallback = node.fallback.find(item => item.decision === outcome.decision);
          let followFallback = Boolean(fallback && outcome.retryAuthorized === true);
          const fallbackUsage = usage({
            repairLoops: followFallback && outcome.decision === 'REPAIR' ? 1 : 0,
          });
          const fallbackBudgetBlocked = followFallback
            && exceedsBudget(session.budget, snapshot.usage, fallbackUsage);
          if (fallbackBudgetBlocked) followFallback = false;
          const nextNodeId = followFallback ? fallback.nodeId : node.onFailure;
          const decision = followFallback ? outcome.decision : 'STOP';
          const delta = usage({
            providerCalls: outcome.usage.providerCalls,
            candidates: outcome.usage.candidates,
            repairLoops: followFallback && outcome.decision === 'REPAIR' ? 1 : 0,
            costUnits: outcome.usage.costUnits,
            latencyMs: outcome.usage.latencyMs,
          });
          this.#append(snapshot, {
            type: 'NODE_FAILED',
            nodeId: node.nodeId,
            decision,
            output: {
              status: 'FAILED',
              failureClass: outcome.failureClass,
              retryAuthorized: outcome.retryAuthorized,
              nextNodeId,
            },
            usageDelta: delta,
            evidenceRefs: outcome.evidenceRefs,
          });
          if (fallbackBudgetBlocked) {
            snapshot = this.#store.getSessionSnapshot(sessionId);
            return this.#stop(snapshot, 'BUDGET_EXHAUSTED', [
              'evidence:aads:fallback-budget',
            ]);
          }
          continue;
        }
        const delta = usage({
          providerCalls: outcome.usage.providerCalls,
          candidates: outcome.usage.candidates,
          costUnits: outcome.usage.costUnits,
          latencyMs: outcome.usage.latencyMs,
        });
        const output = {
          status: outcome.status,
          asset: outcome.asset,
          candidateVersionId: outcome.candidateVersionId,
          executionId: outcome.executionId,
          outputRole: outcome.outputRole,
          evidenceRefs: outcome.evidenceRefs,
          nextNodeId: node.onSuccess,
        };
        this.#append(snapshot, {
          type: 'NODE_SUCCEEDED',
          nodeId: node.nodeId,
          output,
          usageDelta: delta,
          evidenceRefs: outcome.evidenceRefs,
        });
        snapshot = this.#store.getSessionSnapshot(sessionId);
        if (exceedsBudget(session.budget, snapshot.usage, usage())) {
          return this.#stop(snapshot, 'BUDGET_EXHAUSTED', ['evidence:aads:budget-observed']);
        }
        continue;
      }
      if (node.kind === 'EVALUATE') {
        let outcome;
        try {
          outcome = await this.#adapter.evaluate({ session, node, snapshot, now: this.#now });
          if (!outcome
              || !['ACCEPT', 'ACCEPT_WITH_WARNINGS', 'REPAIR', 'REJECT', 'UNVERIFIED']
                .includes(outcome.verdict)
              || typeof outcome.evaluationId !== 'string'
              || typeof outcome.candidateVersionId !== 'string'
              || !Array.isArray(outcome.evidenceRefs)) {
            throw new Error('rabcl_evaluation_outcome_invalid');
          }
        } catch (error) {
          this.#append(snapshot, {
            type: 'NODE_FAILED',
            nodeId: node.nodeId,
            decision: 'STOP',
            output: {
              status: 'FAILED',
              failureClass: error?.message ?? 'evaluation_failed',
              nextNodeId: node.onReject,
            },
            evidenceRefs: ['evidence:rabcl:evaluation-failed'],
          });
          continue;
        }
        const accepted = ['ACCEPT', 'ACCEPT_WITH_WARNINGS'].includes(outcome.verdict);
        const repair = outcome.verdict === 'REPAIR';
        const nextNodeId = accepted ? node.onAccept : repair ? node.onRepair : node.onReject;
        const decision = accepted ? 'ACCEPT' : repair ? 'REPAIR' : 'STOP';
        const delta = usage({ repairLoops: repair ? 1 : 0 });
        if (repair && exceedsBudget(session.budget, snapshot.usage, delta)) {
          return this.#stop(snapshot, 'BUDGET_EXHAUSTED', ['evidence:aads:repair-budget']);
        }
        this.#append(snapshot, {
          type: 'NODE_SUCCEEDED',
          nodeId: node.nodeId,
          decision,
          output: { ...outcome, nextNodeId },
          usageDelta: delta,
          evidenceRefs: outcome.evidenceRefs,
        });
        continue;
      }
      if (node.kind === 'HUMAN_GATE') {
        this.#append(snapshot, {
          type: 'HUMAN_GATE_WAITING',
          nodeId: node.nodeId,
          decision: 'ASK_HUMAN',
          output: { prompt: node.prompt, nextNodeId: node.nodeId },
          evidenceRefs: [`evidence:rabcl:${node.nodeId}:waiting`],
        });
        return this.#store.getSessionSnapshot(sessionId);
      }
      if (node.kind === 'PROMOTE') {
        try {
          const outcome = this.#adapter.promote({
            session,
            node,
            snapshot,
            actor: session.authority.grantedBy,
            now: this.#now,
          });
          if (!outcome
              || typeof outcome.currentVersionId !== 'string'
              || !Array.isArray(outcome.evidenceRefs)) {
            throw new Error('rabcl_promotion_outcome_invalid');
          }
          this.#append(snapshot, {
            type: 'NODE_SUCCEEDED',
            nodeId: node.nodeId,
            decision: 'ACCEPT',
            output: { ...outcome, nextNodeId: node.onSuccess },
            evidenceRefs: outcome.evidenceRefs,
          });
        } catch (error) {
          this.#append(snapshot, {
            type: 'NODE_FAILED',
            nodeId: node.nodeId,
            decision: 'STOP',
            output: {
              status: 'FAILED',
              failureClass: error?.message ?? 'promotion_failed',
              nextNodeId: node.onFailure,
            },
            evidenceRefs: ['evidence:rabcl:promotion-failed'],
          });
        }
        continue;
      }
      if (node.kind === 'STOP') {
        const type = node.outcome === 'ACCEPTED' ? 'SESSION_COMPLETED' : 'SESSION_STOPPED';
        this.#append(snapshot, {
          type,
          nodeId: node.nodeId,
          decision: node.outcome === 'ACCEPTED' ? 'ACCEPT' : 'STOP',
          output: { outcome: node.outcome, nextNodeId: null },
          evidenceRefs: [`evidence:rabcl:terminal:${node.outcome.toLowerCase()}`],
        });
        return this.#store.getSessionSnapshot(sessionId);
      }
      return this.#stop(snapshot, 'FAILED', ['evidence:rabcl:node-kind-unsupported']);
    }
  }

  submitHumanDecision({ sessionId, decision, reason, reviewer }) {
    let snapshot = this.#store.getSessionSnapshot(sessionId);
    if (snapshot.status !== 'WAITING_HUMAN') throw new Error('rabcl_session_not_waiting_human');
    const workflow = this.#store.getWorkflow(snapshot.session.workflowId);
    const node = workflow.nodes.find(item => item.nodeId === snapshot.currentNodeId);
    if (!node || node.kind !== 'HUMAN_GATE') throw new Error('rabcl_human_gate_not_current');
    const review = this.#adapter.recordHumanReview({
      session: snapshot.session,
      node,
      snapshot,
      decision,
      reason,
      reviewer,
      now: this.#now,
    });
    const accepted = decision === 'APPROVE';
    this.#append(snapshot, {
      type: 'HUMAN_DECISION',
      nodeId: node.nodeId,
      decision: accepted ? 'ACCEPT' : 'STOP',
      output: {
        ...review,
        nextNodeId: accepted ? node.onApprove : node.onReject,
      },
      evidenceRefs: review.evidenceRefs,
      actor: reviewer,
    });
    snapshot = this.#store.getSessionSnapshot(sessionId);
    return snapshot;
  }
}
