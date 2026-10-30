
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const WORKFLOWS_DIR = path.join(__dirname, "..", "..", "workflows");

const STATES = Object.freeze({
  PENDING: "pending",
  RUNNING: "running",
  WAITING: "waiting_for_approval",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  SKIPPED: "skipped",
});

function now() {
  return new Date().toISOString();
}

function loadWorkflow(workflowId) {
  if (
    typeof workflowId !== "string" ||
    !/^[a-z0-9-]+$/.test(workflowId)
  ) {
    throw new Error("Invalid workflow ID.");
  }

  const file = path.join(WORKFLOWS_DIR, `${workflowId}.json`);

  if (!fs.existsSync(file)) {
    throw new Error(`Workflow not found: ${workflowId}`);
  }

  const workflow = JSON.parse(fs.readFileSync(file, "utf8"));
  validateWorkflow(workflow);

  if (workflow.id !== workflowId) {
    throw new Error("Workflow filename and ID do not match.");
  }

  return workflow;
}

function validateWorkflow(workflow) {
  if (
    !workflow ||
    typeof workflow.id !== "string" ||
    !/^[a-z0-9-]+$/.test(workflow.id) ||
    !Array.isArray(workflow.inputs) ||
    !Array.isArray(workflow.steps) ||
    !Array.isArray(workflow.allowedTools) ||
    workflow.steps.length === 0 ||
    workflow.steps.length > 100 ||
    workflow.allowedTools.some(tool => typeof tool !== "string" || !tool.trim())
  ) {
    throw new Error("Invalid workflow definition.");
  }

  if (new Set(workflow.allowedTools).size !== workflow.allowedTools.length) {
    throw new Error("Duplicate tool in allowedTools.");
  }

  if (workflow.successChecks !== undefined) {
    if (!Array.isArray(workflow.successChecks)) throw new Error("successChecks must be an array.");
    const checkIds = new Set();
    for (const check of workflow.successChecks) {
      if (!check || typeof check.id !== "string" || !check.id.trim() ||
          typeof check.stepId !== "string" || !/^[a-zA-Z0-9_-]+$/.test(check.stepId) ||
          !["exists", "non_empty_string", "array", "non_empty_array", "positive_number", "object"].includes(check.type) ||
          (check.path !== undefined && typeof check.path !== "string")) {
        throw new Error("Invalid workflow success check.");
      }
      if (checkIds.has(check.id)) throw new Error(`Duplicate success check ID: ${check.id}`);
      checkIds.add(check.id);
    }
  }

  const supportedInputTypes = new Set(["string", "array", "number", "boolean", "object"]);
  const inputNames = new Set();

  for (const input of workflow.inputs) {
    if (
      !input ||
      typeof input.name !== "string" ||
      !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(input.name) ||
      !supportedInputTypes.has(input.type) ||
      (input.required !== undefined && typeof input.required !== "boolean")
    ) {
      throw new Error("Invalid workflow input definition.");
    }
    if (inputNames.has(input.name)) {
      throw new Error(`Duplicate input: ${input.name}`);
    }
    inputNames.add(input.name);
  }

  const byId = new Map();

  for (const step of workflow.steps) {
    if (
      !step ||
      typeof step.id !== "string" ||
      !/^[a-zA-Z0-9_-]+$/.test(step.id) ||
      typeof step.tool !== "string" ||
      !step.tool.trim() ||
      !Array.isArray(step.dependsOn) ||
      step.dependsOn.some(dependency => typeof dependency !== "string") ||
      new Set(step.dependsOn).size !== step.dependsOn.length ||
      (step.capabilityStatus !== undefined && !["available", "not_implemented"].includes(step.capabilityStatus)) ||
      (step.action !== undefined && typeof step.action !== "string")
    ) {
      throw new Error("Invalid workflow step.");
    }

    if (byId.has(step.id)) {
      throw new Error(`Duplicate step ID: ${step.id}`);
    }

    if (!workflow.allowedTools.includes(step.tool)) {
      throw new Error(`Tool "${step.tool}" is not allowed.`);
    }

    if (
      step.approval !== undefined &&
      !["none", "required"].includes(step.approval)
    ) {
      throw new Error(`Invalid approval policy for "${step.id}".`);
    }

    byId.set(step.id, step);
  }

  for (const check of workflow.successChecks || []) {
    if (!byId.has(check.stepId)) throw new Error(`Unknown step "${check.stepId}" in success check "${check.id}".`);
  }

  const visited = new Set();
  const visiting = new Set();

  function visit(id) {
    if (visiting.has(id)) {
      throw new Error("Circular workflow dependencies detected.");
    }
    if (visited.has(id)) return;

    const step = byId.get(id);
    visiting.add(id);

    for (const dependency of step.dependsOn) {
      if (!byId.has(dependency)) {
        throw new Error(
          `Unknown dependency "${dependency}" in "${id}".`
        );
      }
      if (dependency === id) {
        throw new Error(`Step "${id}" cannot depend on itself.`);
      }
      visit(dependency);
    }

    visiting.delete(id);
    visited.add(id);
  }

  for (const id of byId.keys()) visit(id);
  return true;
}

function validateInputs(workflow, inputs = {}) {
  if (
    !inputs ||
    typeof inputs !== "object" ||
    Array.isArray(inputs)
  ) {
    throw new Error("Inputs must be an object.");
  }

  const definitions = new Map(
    workflow.inputs.map(input => [input.name, input])
  );

  for (const key of Object.keys(inputs)) {
    if (!definitions.has(key)) {
      throw new Error(`Unexpected input: ${key}`);
    }
  }

  for (const definition of workflow.inputs) {
    const value = inputs[definition.name];

    const missingRequiredValue = value === undefined || value === null ||
      (typeof value === "string" && value.trim() === "") ||
      (Array.isArray(value) && value.length === 0);
    if (definition.required && missingRequiredValue) {
      throw new Error(`Missing required input: ${definition.name}`);
    }

    if (value === undefined || value === null) continue;

    if (
      definition.type === "string" &&
      typeof value !== "string"
    ) {
      throw new Error(`${definition.name} must be a string.`);
    }

    if (
      definition.type === "array" &&
      !Array.isArray(value)
    ) {
      throw new Error(`${definition.name} must be an array.`);
    }

    if (
      definition.type === "number" &&
      (typeof value !== "number" || !Number.isFinite(value))
    ) {
      throw new Error(`${definition.name} must be a number.`);
    }

    if (definition.type === "boolean" && typeof value !== "boolean") {
      throw new Error(`${definition.name} must be a boolean.`);
    }

    if (definition.type === "object" &&
      (typeof value !== "object" || Array.isArray(value))) {
      throw new Error(`${definition.name} must be an object.`);
    }
  }

  return true;
}

function createWorkflowRun(workflow, inputs = {}, options = {}) {
  validateWorkflow(workflow);
  validateInputs(workflow, inputs);

  const timestamp = now();

  return {
    runId: crypto.randomUUID(),
    workflowId: workflow.id,
    workflowVersion: workflow.version || "1.0.0",
    inputs: { ...inputs },
    status: "ready",
    createdAt: timestamp,
    updatedAt: timestamp,
    criteriaResults: [],
    steps: workflow.steps.map(definition => ({
      stepId: definition.id,
      tool: definition.tool,
      state: STATES.PENDING,
      attempts: 0,
      maxAttempts: Math.max(
        1,
        Math.min(options.maxAttempts || 2, 5)
      ),
      dependsOn: [...definition.dependsOn],
      approval: definition.approval || "none",
      capabilityStatus: definition.capabilityStatus || "available",
      result: null,
      error: null,
    })),
  };
}

function getReadySteps(workflow, run) {
  const states = new Map(
    run.steps.map(step => [step.stepId, step.state])
  );

  return workflow.steps
    .filter(definition => {
      const current = run.steps.find(
        step => step.stepId === definition.id
      );

      return (
        current &&
        current.state === STATES.PENDING &&
        current.capabilityStatus === "available" &&
        current.approval !== "required" &&
        definition.dependsOn.every(
          id => states.get(id) === STATES.SUCCEEDED
        )
      );
    })
    .map(step => step.id);
}

function updateRunStatus(run) {
  run.updatedAt = now();

  if (run.steps.some(s => s.state === STATES.FAILED)) {
    run.status = "failed";
  } else if (run.steps.some(s => s.state === STATES.WAITING)) {
    run.status = "waiting_for_approval";
  } else if (
    run.steps.every(
      s => s.state === STATES.SUCCEEDED || s.state === STATES.SKIPPED
    )
  ) {
    run.status = run.steps.some(s => s.state === STATES.SKIPPED)
      ? "completed_with_skips"
      : "completed";
  } else if (
    run.steps.some(s => s.state === STATES.RUNNING)
  ) {
    run.status = "in_progress";
  } else {
    run.status = "ready";
  }
}

async function skipDependentSteps(workflow, run, recordEvent, persist) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const definition of workflow.steps) {
      const step = run.steps.find(item => item.stepId === definition.id);
      if (!step || step.state !== STATES.PENDING) continue;
      const blockedDependency = definition.dependsOn.some(id => {
        const dependency = run.steps.find(item => item.stepId === id);
        return dependency && [STATES.FAILED, STATES.SKIPPED].includes(dependency.state);
      });
      if (!blockedDependency) continue;
      step.state = STATES.SKIPPED;
      step.error = "A dependency did not succeed.";
      await recordEvent({
        type: "step_skipped",
        workflowId: run.workflowId,
        runId: run.runId,
        stepId: step.stepId,
      });
      changed = true;
    }
  }
  updateRunStatus(run);
  await persist(run);
}

function startStep(workflow, run, stepId) {
  const definition = workflow.steps.find(s => s.id === stepId);
  const step = run.steps.find(s => s.stepId === stepId);

  if (!definition || !step) throw new Error(`Step not found: ${stepId}`);
  if (step.state !== STATES.PENDING) {
    throw new Error(`Step "${stepId}" is not pending.`);
  }
  if (!workflow.allowedTools.includes(step.tool)) {
    throw new Error(`Tool "${step.tool}" is not allowed.`);
  }
  if (step.capabilityStatus !== "available") {
    throw new Error(`Capability not implemented: ${step.tool}`);
  }
  if (step.approval === "required") {
    throw new Error(`Step "${stepId}" requires approval.`);
  }

  for (const dependency of definition.dependsOn) {
    const previous = run.steps.find(s => s.stepId === dependency);
    if (!previous || previous.state !== STATES.SUCCEEDED) {
      throw new Error(`Dependency "${dependency}" has not succeeded.`);
    }
  }

  step.state = STATES.RUNNING;
  step.attempts += 1;
  step.error = null;
  updateRunStatus(run);
  return run;
}

function requestStepApproval(workflow, run, stepId) {
  const definition = workflow.steps.find(s => s.id === stepId);
  const step = run.steps.find(s => s.stepId === stepId);

  if (!definition || !step) throw new Error(`Step not found: ${stepId}`);
  if (step.state !== STATES.PENDING) {
    throw new Error("Only pending steps can request approval.");
  }
  if (step.approval !== "required") {
    throw new Error("This step does not require approval.");
  }
  if (step.capabilityStatus !== "available") {
    throw new Error(`Capability not implemented: ${step.tool}`);
  }

  for (const dependency of definition.dependsOn) {
    const previous = run.steps.find(s => s.stepId === dependency);
    if (!previous || previous.state !== STATES.SUCCEEDED) {
      throw new Error(`Dependency "${dependency}" has not succeeded.`);
    }
  }

  step.state = STATES.WAITING;
  if (typeof definition.approvalPreviewFrom === "string") {
    const previewStep = run.steps.find(item => item.stepId === definition.approvalPreviewFrom);
    step.approvalPreview = previewStep ? previewStep.result : null;
  }
  updateRunStatus(run);
  return run;
}

function resolveApproval(workflow, run, stepId, approved) {
  const step = run.steps.find(s => s.stepId === stepId);

  if (!step || step.state !== STATES.WAITING) {
    throw new Error("No approval is pending for this step.");
  }

  if (approved !== true && approved !== false) {
    throw new Error("Approval decision must be true or false.");
  }

  if (approved) {
    // Approval allows execution; it does not claim success.
    step.state = STATES.PENDING;
    step.approval = "approved";
  } else {
    step.state = STATES.SKIPPED;
    step.error = "Approval declined by user.";
  }

  updateRunStatus(run);
  return run;
}

function recordStepResult(run, stepId, result) {
  const step = run.steps.find(s => s.stepId === stepId);

  if (!step || step.state !== STATES.RUNNING) {
    throw new Error("Step must be running before recording a result.");
  }

  step.state = STATES.SUCCEEDED;
  step.result = result === undefined ? null : result;
  step.error = null;
  updateRunStatus(run);
  return run;
}

function recordStepFailure(run, stepId, errorMessage) {
  const step = run.steps.find(s => s.stepId === stepId);

  if (!step || step.state !== STATES.RUNNING) {
    throw new Error("Step must be running before recording failure.");
  }

  step.error = String(errorMessage || "Unknown error").slice(0, 1000);

  if (step.attempts < step.maxAttempts) {
    step.state = STATES.PENDING;
  } else {
    step.state = STATES.FAILED;
  }

  updateRunStatus(run);
  return run;
}

function requestCancellation(run) {
  if (!run || !Array.isArray(run.steps)) throw new Error("A valid workflow run is required.");
  if (["completed", "completed_with_skips", "failed", "cancelled"].includes(run.status)) {
    throw new Error(`Cannot cancel a ${run.status} workflow.`);
  }
  run.cancelRequested = true;
  run.updatedAt = now();
  return run;
}

function recoverRun(run) {
  for (const step of run.steps) {
    // A process may have stopped after marking a step running.
    // Reset it for a bounded retry; external actions must be idempotent.
    if (step.state === STATES.RUNNING) {
      step.state =
        step.attempts < step.maxAttempts
          ? STATES.PENDING
          : STATES.FAILED;
      step.error = "Recovered after interruption.";
    }
  }

  updateRunStatus(run);
  return run;
}

function readResultPath(value, resultPath) {
  if (!resultPath || resultPath === "$" || resultPath === ".") return value;
  return resultPath.split(".").reduce((current, key) => {
    if (current === null || current === undefined) return undefined;
    return current[key];
  }, value);
}

function evaluateSuccessChecks(workflow, run) {
  const checks = workflow.successChecks || [];
  if (!checks.length) return { passed: true, results: [] };
  const results = checks.map(check => {
    const step = run.steps.find(item => item.stepId === check.stepId);
    const value = readResultPath(step?.result, check.path);
    let passed = false;
    switch (check.type) {
      case "exists": passed = value !== undefined && value !== null; break;
      case "non_empty_string": passed = typeof value === "string" && value.trim().length > 0; break;
      case "array": passed = Array.isArray(value); break;
      case "non_empty_array": passed = Array.isArray(value) && value.length > 0; break;
      case "positive_number": passed = typeof value === "number" && Number.isFinite(value) && value > 0; break;
      case "object": passed = Boolean(value) && typeof value === "object" && !Array.isArray(value); break;
      default: passed = false;
    }
    return { id: check.id, stepId: check.stepId, passed, type: check.type, message: passed ? "Verified" : `Verification failed: expected ${check.type}${check.path ? ` at ${check.path}` : ""}.` };
  });
  return { passed: results.every(result => result.passed), results };
}

async function executeWorkflow(workflow, run, options = {}) {
  const executeTool = options.executeTool;
  const persist = options.persist || (async () => {});
  const recordEvent = options.recordEvent || (async () => {});

  if (typeof executeTool !== "function") {
    throw new Error("executeTool callback is required.");
  }

  validateWorkflow(workflow);

  if (run.workflowId !== workflow.id) {
    throw new Error("Run and workflow IDs do not match.");
  }

  if (["completed", "completed_with_skips", "failed", "cancelled"].includes(run.status)) {
    throw new Error(`Cannot execute a ${run.status} workflow.`);
  }

  const maxSteps = Math.min(
    Math.max(options.maxSteps || 50, 1),
    200
  );
  let processed = 0;

  await persist(run);

  while (processed < maxSteps) {
    if (run.cancelRequested) {
      for (const pending of run.steps) {
        if ([STATES.PENDING, STATES.WAITING].includes(pending.state)) {
          pending.state = STATES.SKIPPED;
          pending.error = "Cancelled by user.";
        }
      }
      run.status = "cancelled";
      run.cancelRequested = false;
      run.updatedAt = now();
      await recordEvent({ type: "run_cancelled", workflowId: run.workflowId, runId: run.runId });
      await persist(run);
      return run;
    }

    const waiting = run.steps.find(s => s.state === STATES.WAITING);

    if (waiting) {
      run.status = "waiting_for_approval";
      await persist(run);
      return run;
    }

    const failedDependency = workflow.steps.find(definition => {
      const current = run.steps.find(s => s.stepId === definition.id);
      return (
        current.state === STATES.PENDING &&
        definition.dependsOn.some(id => {
          const dependency = run.steps.find(s => s.stepId === id);
          return dependency &&
            [STATES.FAILED, STATES.SKIPPED].includes(dependency.state);
        })
      );
    });

    if (failedDependency) {
      const blocked = run.steps.find(
        s => s.stepId === failedDependency.id
      );
      blocked.state = STATES.SKIPPED;
      blocked.error = "A dependency did not succeed.";
      await recordEvent({
        type: "step_skipped",
        workflowId: run.workflowId,
        runId: run.runId,
        stepId: blocked.stepId,
      });
      updateRunStatus(run);
      await persist(run);
      continue;
    }

    const unavailableStep = workflow.steps.find(definition => {
      const current = run.steps.find(s => s.stepId === definition.id);
      return current && current.state === STATES.PENDING &&
        current.capabilityStatus !== "available" &&
        definition.dependsOn.every(id =>
          run.steps.some(s => s.stepId === id && s.state === STATES.SUCCEEDED)
        );
    });

    if (unavailableStep) {
      const blocked = run.steps.find(s => s.stepId === unavailableStep.id);
      blocked.state = STATES.FAILED;
      blocked.error = `Capability not implemented: ${blocked.tool}`;
      updateRunStatus(run);
      await recordEvent({
        type: "step_failed",
        workflowId: run.workflowId,
        runId: run.runId,
        stepId: blocked.stepId,
        tool: blocked.tool,
        error: blocked.error,
        retrying: false,
      });
      await persist(run);
      await skipDependentSteps(workflow, run, recordEvent, persist);
      break;
    }

    const approvalStep = workflow.steps.find(definition => {
      const current = run.steps.find(s => s.stepId === definition.id);
      return (
        current.state === STATES.PENDING &&
        current.approval === "required" &&
        current.capabilityStatus === "available" &&
        definition.dependsOn.every(id =>
          run.steps.some(
            s => s.stepId === id && s.state === STATES.SUCCEEDED
          )
        )
      );
    });

    if (approvalStep) {
      requestStepApproval(workflow, run, approvalStep.id);
      await recordEvent({
        type: "approval_requested",
        workflowId: run.workflowId,
        runId: run.runId,
        stepId: approvalStep.id,
      });
      await persist(run);
      return run;
    }

    const ready = getReadySteps(workflow, run);

    if (ready.length === 0) break;

    const stepId = ready[0];
    const definition = workflow.steps.find(s => s.id === stepId);
    const step = run.steps.find(s => s.stepId === stepId);

    startStep(workflow, run, stepId);
    await recordEvent({
      type: "step_started",
      workflowId: run.workflowId,
      runId: run.runId,
      stepId,
      tool: step.tool,
      attempt: step.attempts,
    });
    await persist(run);

    try {
      const result = await executeTool(step.tool, {
        workflowId: workflow.id,
        runId: run.runId,
        stepId,
        inputs: { ...run.inputs },
        previousResults: Object.fromEntries(
          run.steps
            .filter(s => s.state === STATES.SUCCEEDED)
            .map(s => [s.stepId, s.result])
        ),
      });

      if (!result || result.success !== true) {
        throw new Error(
          result && result.error
            ? result.error
            : `Tool "${step.tool}" did not report success.`
        );
      }

      recordStepResult(run, stepId, result.data ?? result);
      await recordEvent({
        type: "step_succeeded",
        workflowId: run.workflowId,
        runId: run.runId,
        stepId,
      });
    } catch (error) {
      recordStepFailure(run, stepId, error.message);
      const retrying = step.state === STATES.PENDING;
      await recordEvent({
        type: "step_failed",
        workflowId: run.workflowId,
        runId: run.runId,
        stepId,
        error: step.error,
        retrying,
      });
      if (retrying) {
        const baseDelay = Math.max(0, Math.min(Number(options.retryDelayMs ?? 250) || 0, 5000));
        const delay = Math.min(5000, baseDelay * (2 ** Math.max(0, step.attempts - 1)));
        if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    await persist(run);
    processed += 1;

    if (step.state === STATES.FAILED) {
      // Do not keep running unrelated steps after a terminal failure.
      await skipDependentSteps(workflow, run, recordEvent, persist);
      break;
    }
  }

  updateRunStatus(run);

  const hasUnfinishedSteps = run.steps.some(step =>
    [STATES.PENDING, STATES.RUNNING, STATES.WAITING].includes(step.state)
  );
  if (!hasUnfinishedSteps && !["cancelled", "failed"].includes(run.status) &&
      run.steps.every(step => [STATES.SUCCEEDED, STATES.SKIPPED].includes(step.state))) {
    const verification = evaluateSuccessChecks(workflow, run);
    run.criteriaResults = verification.results;
    if (!verification.passed) {
      run.status = "failed";
      run.error = "Workflow steps finished, but one or more configured success checks failed.";
      await recordEvent({ type: "success_checks_failed", workflowId: run.workflowId, runId: run.runId });
    } else if (verification.results.length) {
      await recordEvent({ type: "success_checks_passed", workflowId: run.workflowId, runId: run.runId });
    }
  }

  if (
    processed >= maxSteps &&
    run.status !== "completed" &&
    run.status !== "failed"
  ) {
    run.status = "paused";
  }

  await persist(run);
  return run;
}

async function resumeWorkflow(workflow, run, options = {}) {
  if (run.status === "failed") {
    const retryable = run.steps.filter(
      step =>
        step.state === STATES.FAILED &&
        step.attempts < step.maxAttempts
    );

    for (const step of retryable) {
      step.state = STATES.PENDING;
      step.error = null;
    }
  }

  if (run.status === "paused") {
    run.status = "ready";
  }

  return executeWorkflow(workflow, run, options);
}

module.exports = {
  STATES,
  loadWorkflow,
  validateWorkflow,
  validateInputs,
  createWorkflowRun,
  getReadySteps,
  startStep,
  requestStepApproval,
  resolveApproval,
  recordStepResult,
  recordStepFailure,
  recoverRun,
  evaluateSuccessChecks,
  requestCancellation,
  executeWorkflow,
  resumeWorkflow,
};


