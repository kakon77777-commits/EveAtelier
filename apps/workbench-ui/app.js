const state = {
  config: null,
  workspace: null,
  selectedRoleBindingIds: new Set(),
  selectedCandidateId: null,
  busy: false,
};

const byId = id => document.getElementById(id);

function node(tag, className = '', text = '') {
  const value = document.createElement(tag);
  if (className) value.className = className;
  if (text) value.textContent = text;
  return value;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? 'request_failed');
  return payload;
}

function announce(message, error = false) {
  const toast = byId('status-message');
  toast.textContent = message;
  toast.classList.toggle('error', error);
  toast.classList.add('visible');
  window.setTimeout(() => toast.classList.remove('visible'), 2800);
}

function setBusy(value) {
  state.busy = value;
  for (const button of document.querySelectorAll('button')) button.disabled = value;
}

function renderCanvas() {
  const canvas = state.workspace.canvas;
  const image = byId('canvas-image');
  image.src = canvas.asset.url;
  image.alt = `目前版本 ${canvas.currentVersionId}`;
  image.hidden = false;
  byId('canvas-empty').hidden = true;
  byId('canvas-version').textContent = canvas.currentVersionId;
  byId('canvas-meta').textContent = `${canvas.width} × ${canvas.height} · ${canvas.colorSpace}`;
  byId('knowledge-revision').textContent = `Knowledge r${state.workspace.knowledgeRevision}`;
}

function renderReferences() {
  const board = byId('reference-board');
  board.replaceChildren();
  byId('reference-count').textContent = String(state.workspace.referenceBoard.length);
  for (const reference of state.workspace.referenceBoard) {
    const card = node('article', 'reference-card');
    const image = node('img');
    image.src = reference.asset.url;
    image.alt = reference.labels.join(' · ') || reference.referenceAssetId;
    card.append(image, node('div', 'card-title', reference.labels.join(' · ')));
    card.append(node('div', 'card-meta', `${reference.rightsClass} · ${reference.asset.mediaType}`));
    const roles = node('div', 'role-list');
    for (const binding of reference.roleBindings) {
      const label = node('label', 'role-choice');
      const input = node('input');
      input.type = 'checkbox';
      input.checked = state.selectedRoleBindingIds.has(binding.roleBindingId);
      input.addEventListener('change', () => {
        if (input.checked) state.selectedRoleBindingIds.add(binding.roleBindingId);
        else state.selectedRoleBindingIds.delete(binding.roleBindingId);
      });
      label.append(input, document.createTextNode(binding.role.replaceAll('_REFERENCE', '')));
      roles.append(label);
    }
    card.append(roles);
    board.append(card);
  }
}

function renderCandidates() {
  const list = byId('candidate-list');
  list.replaceChildren();
  byId('candidate-count').textContent = String(state.workspace.candidateCompare.length);
  if (state.workspace.candidateCompare.length === 0) {
    list.append(node('div', 'empty-state compact', '提交意圖後，候選版本會出現在這裡。'));
    return;
  }
  if (!state.selectedCandidateId) {
    state.selectedCandidateId = state.workspace.candidateCompare.at(-1).versionId;
  }
  for (const candidate of state.workspace.candidateCompare) {
    const card = node('article', `candidate-card${candidate.versionId === state.selectedCandidateId ? ' selected' : ''}`);
    const image = node('img');
    image.src = candidate.asset.url;
    image.alt = `候選版本 ${candidate.versionId}`;
    const title = node('div', 'card-title', candidate.versionId);
    const meta = node('div', 'card-meta', candidate.current ? 'CURRENT · 已晉升' : 'CANDIDATE · 尚未覆寫目前版本');
    card.append(image, title, meta);
    if (candidate.evaluation) card.append(node('span', 'verdict', candidate.evaluation.verdict));
    const label = node('label', 'candidate-select');
    const radio = node('input');
    radio.type = 'radio';
    radio.name = 'candidate';
    radio.value = candidate.versionId;
    radio.checked = candidate.versionId === state.selectedCandidateId;
    radio.addEventListener('change', () => {
      state.selectedCandidateId = candidate.versionId;
      renderCandidates();
    });
    label.append(radio, document.createTextNode('比較這個候選'));
    card.append(label);
    list.append(card);
  }
}

function renderHistory() {
  const list = byId('history-list');
  list.replaceChildren();
  for (const item of [...state.workspace.history].reverse().slice(0, 30)) {
    const row = node('li');
    row.append(node('span'), node('strong', '', item.type), node('span', '', item.summary));
    row.title = item.at;
    list.append(row);
  }
}

function renderReview() {
  const form = byId('review-form');
  const empty = byId('review-empty');
  const gate = state.workspace.reviewQueue.at(-1) ?? null;
  form.hidden = gate === null;
  empty.hidden = gate !== null;
  byId('gate-state').textContent = gate ? 'Waiting human' : 'No gate';
  byId('gate-state').classList.toggle('quiet', gate === null);
  if (gate) {
    form.dataset.sessionId = gate.sessionId;
    byId('review-target').textContent = `${gate.goal}\nCandidate: ${gate.candidateVersionId ?? 'unresolved'}`;
  } else {
    delete form.dataset.sessionId;
    byId('review-reason').value = '';
  }
}

function render() {
  if (!state.workspace) return;
  byId('runtime-label').textContent = `${state.workspace.project.documentType} · r${state.workspace.canvas.documentRevision}`;
  renderCanvas();
  renderReferences();
  renderCandidates();
  renderHistory();
  renderReview();
}

async function loadWorkspace() {
  if (!state.config) state.config = await fetchJson('/api/config');
  const search = new URLSearchParams({
    projectId: state.config.projectId,
    documentId: state.config.documentId,
  });
  state.workspace = await fetchJson(`/api/workspaces?${search}`);
  render();
}

byId('intent-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (state.busy) return;
  setBusy(true);
  try {
    const result = await fetchJson('/api/intents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: state.config.projectId,
        documentId: state.config.documentId,
        text: byId('intent-text').value,
        taskTypeHint: byId('task-hint').value,
        roleBindingIds: [...state.selectedRoleBindingIds],
        preferences: [],
        hardConstraints: [],
        overrides: [],
        retrievalContextRefs: [],
      }),
    });
    state.workspace = result.workspace;
    state.selectedCandidateId = result.workspace.candidateCompare.at(-1)?.versionId ?? null;
    render();
    announce(result.session.status === 'WAITING_HUMAN' ? '候選已完成，等待你的判斷。' : `工作流：${result.session.status}`);
  } catch (error) {
    announce(`無法提交：${error.message}`, true);
  } finally {
    setBusy(false);
  }
});

byId('review-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (state.busy) return;
  const decision = event.submitter?.value;
  const sessionId = event.currentTarget.dataset.sessionId;
  if (!decision || !sessionId) return;
  setBusy(true);
  try {
    const result = await fetchJson('/api/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        decision,
        reason: byId('review-reason').value,
      }),
    });
    state.workspace = result.workspace;
    render();
    announce(decision === 'APPROVE' ? '已批准並由 AADS 完成晉升。' : '已拒絕；目前版本保持不變。');
  } catch (error) {
    announce(`無法記錄判斷：${error.message}`, true);
  } finally {
    setBusy(false);
  }
});

byId('refresh-button').addEventListener('click', async () => {
  if (state.busy) return;
  setBusy(true);
  try {
    await loadWorkspace();
    announce('已從 canonical stores 重新讀取。');
  } catch (error) {
    announce(`重新整理失敗：${error.message}`, true);
  } finally {
    setBusy(false);
  }
});

loadWorkspace().catch(error => announce(`工作台載入失敗：${error.message}`, true));
