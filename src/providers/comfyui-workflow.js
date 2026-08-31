function setBinding(workflow, binding, value, name) {
  if (!binding || typeof binding.nodeId !== 'string' || typeof binding.input !== 'string') {
    throw new Error(`comfyui_binding_invalid:${name}`);
  }
  const node = workflow[binding.nodeId];
  if (!node || !node.inputs || typeof node.inputs !== 'object') {
    throw new Error(`comfyui_binding_node_missing:${name}:${binding.nodeId}`);
  }
  node.inputs[binding.input] = value;
}

export function compileComfyWorkflow({ workflow, bindings, request } = {}) {
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
    throw new TypeError('comfyui_workflow_required');
  }
  if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)) {
    throw new TypeError('comfyui_bindings_required');
  }
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new TypeError('comfyui_request_required');
  }
  if (!Array.isArray(request.intentText) || request.intentText.length === 0) {
    throw new TypeError('comfyui_positive_prompt_required');
  }
  if (!Number.isSafeInteger(request.seed) || request.seed < 0) {
    throw new TypeError('comfyui_seed_invalid');
  }

  const compiled = structuredClone(workflow);
  setBinding(compiled, bindings.sourceImage, request.sourceImageName, 'sourceImage');
  setBinding(compiled, bindings.positivePrompt, request.intentText.join('\n'), 'positivePrompt');
  setBinding(compiled, bindings.negativePrompt, request.negativePrompt ?? '', 'negativePrompt');
  setBinding(compiled, bindings.seed, request.seed, 'seed');
  setBinding(compiled, bindings.filenamePrefix, request.filenamePrefix, 'filenamePrefix');
  if (request.maskImageName !== undefined) {
    setBinding(compiled, bindings.maskImage, request.maskImageName, 'maskImage');
  }
  return compiled;
}
