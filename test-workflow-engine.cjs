
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Isolate all persistence in a temporary directory. Never delete the user's data.
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "friday-pai-workflow-tests-"));
process.env.PERSONAL_AI_DATA_DIR = DATA_DIR;

const engine = require("./electron/agent/workflowEngine.cjs");
const recorder = require("./electron/agent/taskRecorder.cjs");

const RUNS_FILE = path.join(DATA_DIR, "workflow-runs.json");
const EVENTS_FILE = path.join(DATA_DIR, "task-events.json");

let passed = 0;

function test(name, callback) {
  try {
    callback();
    console.log(`PASS ${++passed}: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name}`);
    throw error;
  }
}

async function asyncTest(name, callback) {
  try {
    await callback();
    console.log(`PASS ${++passed}: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name}`);
    throw error;
  }
}

async function main() {
  // Persistence is isolated in DATA_DIR; create it once without touching project data.
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const workflow = engine.loadWorkflow("research-study");

  test("All shipped workflow definitions parse and validate", () => {
    const workflowsDir = path.join(__dirname, "workflows");
    const files = fs.readdirSync(workflowsDir).filter(file => file.endsWith(".json"));
    assert.ok(files.length > 0);
    for (const file of files) {
      const parsed = JSON.parse(fs.readFileSync(path.join(workflowsDir, file), "utf8"));
      assert.equal(engine.validateWorkflow(parsed), true, file);
      assert.equal(parsed.id, file.slice(0, -5));
    }
  });

  test("Loads the research workflow", () => {
    assert.equal(workflow.id, "research-study");
    assert.equal(engine.validateWorkflow(workflow), true);
  });

  test("Goal planning is a reviewable, approval-gated persistence workflow", () => {
    const goalWorkflow = engine.loadWorkflow("goal-planning");
    assert.deepEqual(goalWorkflow.steps.map(step => step.tool), ["llm_goal_plan", "goal_manager_save_plan"]);
    const saveStep = goalWorkflow.steps.find(step => step.id === "save_goal_plan");
    assert.equal(saveStep.approval, "required");
    assert.equal(saveStep.approvalPreviewFrom, "generate_goal_plan");
  });

  test("Rejects missing required inputs", () => {
    assert.throws(
      () => engine.createWorkflowRun(workflow, {}),
      /Missing required input/
    );
  });

  test("Rejects unknown input names", () => {
    assert.throws(
      () => engine.createWorkflowRun(workflow, {
        topic: "AI",
        unexpected: true,
      }),
      /Unexpected input/
    );
  });

  const run = engine.createWorkflowRun(workflow, {
    topic: "Artificial intelligence",
    focus: "Personal assistants",
  });

  test("Creates a run with pending steps", () => {
    assert.equal(run.status, "ready");
    assert.ok(run.runId);
    assert.ok(run.steps.every(s => s.state === "pending"));
  });

  test("Only the first dependent step is ready", () => {
    assert.deepEqual(engine.getReadySteps(workflow, run), ["search"]);
  });

  test("Cannot start a step before dependencies succeed", () => {
    assert.throws(
      () => engine.startStep(workflow, run, "summarize"),
      /Dependency/
    );
  });

  test("Starts the first step", () => {
    engine.startStep(workflow, run, "search");
    assert.equal(
      run.steps.find(s => s.stepId === "search").state,
      "running"
    );
  });

  test("Records successful step results", () => {
    engine.recordStepResult(run, "search", { test: true });
    assert.equal(
      run.steps.find(s => s.stepId === "search").state,
      "succeeded"
    );
  });

  test("Unlocks the next dependent step", () => {
    assert.deepEqual(engine.getReadySteps(workflow, run), ["summarize"]);
  });

  test("Rejects unimplemented capabilities", () => {
    const unavailableWorkflow = {
      id: "unavailable-capability-test",
      inputs: [],
      allowedTools: ["future_tool"],
      steps: [{
        id: "future_step",
        tool: "future_tool",
        dependsOn: [],
        approval: "none",
        capabilityStatus: "not_implemented",
      }],
    };
    const unavailableRun = engine.createWorkflowRun(unavailableWorkflow);
    assert.throws(
      () => engine.startStep(unavailableWorkflow, unavailableRun, "future_step"),
      /Capability not implemented/
    );
  });

  test("Retries a failed step within its limit", () => {
    const retryRun = engine.createWorkflowRun(workflow, {
      topic: "Testing",
    });

    engine.startStep(workflow, retryRun, "search");
    engine.recordStepFailure(retryRun, "search", "Temporary error");

    const search = retryRun.steps.find(s => s.stepId === "search");
    assert.equal(search.state, "pending");
    assert.equal(search.attempts, 1);
  });

  test("Stops retrying after the attempt limit", () => {
    const retryRun = engine.createWorkflowRun(workflow, {
      topic: "Testing",
    });
    const search = retryRun.steps.find(s => s.stepId === "search");
    search.maxAttempts = 1;

    engine.startStep(workflow, retryRun, "search");
    engine.recordStepFailure(retryRun, "search", "Permanent error");

    assert.equal(search.state, "failed");
  });

  test("Requires approval before a protected step", () => {
    const approvalWorkflow = {
      id: "approval-test",
      version: "1.0.0",
      inputs: [],
      allowedTools: ["safe_test_tool"],
      steps: [{
        id: "protected",
        tool: "safe_test_tool",
        dependsOn: [],
        approval: "required",
      }],
    };

    const approvalRun = engine.createWorkflowRun(approvalWorkflow);

    assert.deepEqual(engine.getReadySteps(approvalWorkflow, approvalRun), []);

    engine.requestStepApproval(approvalWorkflow, approvalRun, "protected");
    assert.equal(
      approvalRun.steps[0].state,
      "waiting_for_approval"
    );

    engine.resolveApproval(
      approvalWorkflow,
      approvalRun,
      "protected",
      true
    );

    assert.equal(approvalRun.steps[0].state, "pending");
    assert.equal(approvalRun.steps[0].approval, "approved");
  });

  test("Declined approval skips the protected step", () => {
    const approvalWorkflow = {
      id: "approval-decline-test",
      inputs: [],
      allowedTools: ["safe_test_tool"],
      steps: [{
        id: "protected",
        tool: "safe_test_tool",
        dependsOn: [],
        approval: "required",
      }],
    };

    const approvalRun = engine.createWorkflowRun(approvalWorkflow);
    engine.requestStepApproval(approvalWorkflow, approvalRun, "protected");
    engine.resolveApproval(
      approvalWorkflow,
      approvalRun,
      "protected",
      false
    );

    assert.equal(approvalRun.steps[0].state, "skipped");
    assert.equal(approvalRun.status, "completed_with_skips");
  });

  test("Recovers interrupted running steps", () => {
    const recoveryRun = engine.createWorkflowRun(workflow, {
      topic: "Recovery",
    });

    engine.startStep(workflow, recoveryRun, "search");
    engine.recoverRun(recoveryRun);

    assert.equal(
      recoveryRun.steps.find(s => s.stepId === "search").state,
      "pending"
    );
  });

  test("Persists and reloads workflow runs", () => {
    recorder.saveRun(run);
    const loaded = recorder.getRun(run.runId);

    assert.ok(loaded);
    assert.equal(loaded.workflowId, "research-study");
    assert.equal(loaded.runId, run.runId);
  });

  test("Records compact task events", () => {
    recorder.recordEvent({
      type: "test_event",
      workflowId: workflow.id,
      runId: run.runId,
      stepId: "search",
      secret: "must not be stored",
    });

    const events = recorder.listEvents(run.runId);
    const event = events.find(e => e.type === "test_event");

    assert.ok(event);
    assert.equal(Object.hasOwn(event, "secret"), false);
  });

  await asyncTest("Executes a workflow using simulated tools", async () => {
    const demoWorkflow = {
      id: "demo",
      version: "1.0.0",
      inputs: [{ name: "topic", type: "string", required: true }],
      allowedTools: ["demo_search", "demo_summarize"],
      steps: [
        {
          id: "search",
          tool: "demo_search",
          dependsOn: [],
          approval: "none",
        },
        {
          id: "summarize",
          tool: "demo_summarize",
          dependsOn: ["search"],
          approval: "none",
        },
      ],
    };

    const demoRun = engine.createWorkflowRun(demoWorkflow, {
      topic: "Test topic",
    });

    const result = await engine.executeWorkflow(demoWorkflow, demoRun, {
      executeTool: async (tool, context) => ({
        success: true,
        data: { tool, stepId: context.stepId },
      }),
      persist: async () => {},
      recordEvent: async () => {},
    });

    assert.equal(result.status, "completed");
    assert.ok(result.steps.every(s => s.state === "succeeded"));
  });

  await asyncTest("Verifies configured success criteria against actual step outputs", async () => {
    const checkedWorkflow = {
      id: "success-check-demo",
      inputs: [],
      allowedTools: ["evidence_tool"],
      successChecks: [{ id: "evidence-present", stepId: "collect", path: "items", type: "non_empty_array" }],
      steps: [{ id: "collect", tool: "evidence_tool", dependsOn: [], approval: "none" }],
    };
    const checkedRun = engine.createWorkflowRun(checkedWorkflow);
    const result = await engine.executeWorkflow(checkedWorkflow, checkedRun, {
      executeTool: async () => ({ success: true, data: { items: ["verified"] } }),
      persist: async () => {},
      recordEvent: async () => {},
    });
    assert.equal(result.status, "completed");
    assert.deepEqual(result.criteriaResults.map(item => [item.id, item.passed]), [["evidence-present", true]]);

    const failingRun = engine.createWorkflowRun(checkedWorkflow);
    const failed = await engine.executeWorkflow(checkedWorkflow, failingRun, {
      executeTool: async () => ({ success: true, data: { items: [] } }),
      persist: async () => {},
      recordEvent: async () => {},
    });
    assert.equal(failed.status, "failed");
    assert.equal(failed.criteriaResults[0].passed, false);
  });

  test("Approval requests include the exact preview from their configured predecessor", () => {
    const approvalWorkflow = {
      id: "approval-preview-demo", inputs: [], allowedTools: ["plan_tool", "apply_tool"],
      steps: [
        { id: "plan", tool: "plan_tool", dependsOn: [], approval: "none" },
        { id: "apply", tool: "apply_tool", dependsOn: ["plan"], approval: "required", approvalPreviewFrom: "plan" },
      ],
    };
    const approvalRun = engine.createWorkflowRun(approvalWorkflow);
    engine.startStep(approvalWorkflow, approvalRun, "plan");
    engine.recordStepResult(approvalRun, "plan", { moves: [{ from: "a.txt", to: "documents/a.txt" }] });
    engine.requestStepApproval(approvalWorkflow, approvalRun, "apply");
    assert.deepEqual(approvalRun.steps.find(step => step.stepId === "apply").approvalPreview, { moves: [{ from: "a.txt", to: "documents/a.txt" }] });
  });

  await asyncTest("Does not treat unsuccessful tools as successes", async () => {
    const demoWorkflow = {
      id: "failure-demo",
      inputs: [],
      allowedTools: ["demo_tool"],
      steps: [{
        id: "step",
        tool: "demo_tool",
        dependsOn: [],
        approval: "none",
      }],
    };

    const demoRun = engine.createWorkflowRun(demoWorkflow);

    const result = await engine.executeWorkflow(demoWorkflow, demoRun, {
      executeTool: async () => ({
        success: false,
        error: "Simulated tool failure",
      }),
      persist: async () => {},
      recordEvent: async () => {},
      retryDelayMs: 0,
    });

    assert.equal(result.steps[0].state, "failed");
    assert.equal(result.steps[0].attempts, 2);
    assert.match(result.steps[0].error, /Simulated tool failure/);
  });

  await asyncTest("Honors cancellation between workflow steps", async () => {
    const cancellableWorkflow = {
      id: "cancel-demo",
      inputs: [],
      allowedTools: ["first_tool", "second_tool"],
      steps: [
        { id: "first", tool: "first_tool", dependsOn: [], approval: "none" },
        { id: "second", tool: "second_tool", dependsOn: ["first"], approval: "none" },
      ],
    };
    const cancellableRun = engine.createWorkflowRun(cancellableWorkflow);
    const invoked = [];
    const result = await engine.executeWorkflow(cancellableWorkflow, cancellableRun, {
      executeTool: async tool => {
        invoked.push(tool);
        if (tool === "first_tool") engine.requestCancellation(cancellableRun);
        return { success: true, data: { tool } };
      },
      persist: async () => {},
      recordEvent: async () => {},
    });
    assert.equal(result.status, "cancelled");
    assert.deepEqual(invoked, ["first_tool"]);
    assert.equal(result.steps.find(step => step.stepId === "second").state, "skipped");
  });

  await asyncTest("Marks unsupported capabilities as failed and skips dependents", async () => {
    const unsupportedWorkflow = {
      id: "unsupported-demo",
      inputs: [],
      allowedTools: ["safe_tool", "missing_tool", "downstream_tool"],
      steps: [
        { id: "first", tool: "safe_tool", dependsOn: [], approval: "none" },
        { id: "missing", tool: "missing_tool", dependsOn: ["first"], approval: "none", capabilityStatus: "not_implemented" },
        { id: "downstream", tool: "downstream_tool", dependsOn: ["missing"], approval: "none" },
      ],
    };
    const unsupportedRun = engine.createWorkflowRun(unsupportedWorkflow);
    const result = await engine.executeWorkflow(unsupportedWorkflow, unsupportedRun, {
      executeTool: async tool => ({ success: true, data: { tool } }),
      persist: async () => {},
      recordEvent: async () => {},
    });
    assert.equal(result.status, "failed");
    assert.equal(result.steps.find(step => step.stepId === "missing").state, "failed");
    assert.equal(result.steps.find(step => step.stepId === "downstream").state, "skipped");
  });

  test("Rejects unsupported workflow input types", () => {
    assert.throws(() => engine.validateWorkflow({
      id: "bad-input-type",
      inputs: [{ name: "x", type: "function", required: true }],
      allowedTools: ["safe"],
      steps: [{ id: "step", tool: "safe", dependsOn: [] }],
    }), /Invalid workflow input definition/);
  });

  console.log(`\n${passed} tests passed.`);
}

main()
  .catch(error => {
    console.error("\nTest suite stopped:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  });
