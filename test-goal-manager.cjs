const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "friday-pai-goals-"));
const goalsFile = path.join(tempDir, "goals.json");
const manager = require("./electron/agent/goalManager.cjs");
try {
  const legacyFile = path.join(tempDir, "legacy-goals.json");
  const migratedFile = path.join(tempDir, "migrated", "goals.json");
  fs.writeFileSync(legacyFile, JSON.stringify({ goals: [{ id: "legacy-goal", title: "Legacy goal", description: "keep", status: "active", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), deadline: null, tasks: [] }] }));
  manager.configureGoalsFile(migratedFile, { migrateFrom: legacyFile });
  assert.equal(manager.getGoal("legacy-goal").title, "Legacy goal");
  manager.configureGoalsFile(goalsFile);
  const goal = manager.createGoal("Build reliable Personal AI", "Workflow reliability", null, { id: "workflow-test-run" });
  const duplicate = manager.createGoal("Build reliable Personal AI", "Workflow reliability", null, { id: "workflow-test-run" });
  assert.equal(duplicate.id, goal.id);
  const first = manager.addTask(goal.id, "Add retries", "Bounded retries", null, 1);
  const second = manager.addTask(goal.id, "Verify results", "Check success criteria", null, 2);
  assert.notEqual(first.id, second.id, "tasks created in the same millisecond must have distinct IDs");
  assert.equal(manager.getGoal(goal.id).tasks.length, 2);

  const childScript = `const m=require('./electron/agent/goalManager.cjs');m.configureGoalsFile(${JSON.stringify(goalsFile)});process.stdout.write(JSON.stringify(m.getGoals()));`;
  const persisted = JSON.parse(execFileSync(process.execPath, ["-e", childScript], { cwd: __dirname, encoding: "utf8" }));
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].tasks.length, 2);
  assert.throws(() => manager.createGoal("Different goal", "", null, { id: "workflow-test-run" }), /different goal/i);
  console.log("PASS: goals persist across process restarts, deterministic workflow IDs prevent duplicate goals, and task IDs remain unique.");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
