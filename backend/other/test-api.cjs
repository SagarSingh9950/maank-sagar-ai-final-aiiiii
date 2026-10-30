const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const { DatabaseSync } = require("node:sqlite");

function verifyLegacyGoalSchemaMigration(directory) {
  const legacyPath = path.join(directory, "legacy.sqlite");
  const legacyDb = new DatabaseSync(legacyPath);
  legacyDb.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE goals (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      deadline TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE goal_tasks (
      id TEXT PRIMARY KEY,
      goal_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      due_date TEXT,
      day INTEGER NOT NULL CHECK (day > 0),
      status TEXT NOT NULL DEFAULT 'pending',
      FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE
    );
    INSERT INTO goals (id, title, created_at) VALUES ('legacy-goal', 'Legacy goal', '2025-01-01T00:00:00.000Z');
    INSERT INTO goal_tasks (id, goal_id, title, day) VALUES ('legacy-task', 'legacy-goal', 'Legacy task', 2);
  `);
  legacyDb.close();

  const { openDatabase } = require("./database.cjs");
  const migrated = openDatabase(legacyPath);
  try {
    const goal = { ...migrated.prepare("SELECT status, updated_at AS updatedAt FROM goals WHERE id = 'legacy-goal'").get() };
    assert.deepEqual(goal, { status: "active", updatedAt: "2025-01-01T00:00:00.000Z" });
    const task = { ...migrated.prepare("SELECT day, created_at AS createdAt FROM goal_tasks WHERE id = 'legacy-task'").get() };
    assert.deepEqual(task, { day: 2, createdAt: "2025-01-01T00:00:00.000Z" });
    migrated.prepare(`
      INSERT INTO goal_tasks (id, goal_id, title, created_at) VALUES ('undated-task', 'legacy-goal', 'Undated task', ?)
    `).run(new Date().toISOString());
  } finally {
    migrated.close();
  }
}

function verifyLegacyChatSchemaMigration(directory) {
  const legacyPath = path.join(directory, "legacy-chat.sqlite");
  const legacyDb = new DatabaseSync(legacyPath);
  legacyDb.exec(`
    CREATE TABLE chat_messages (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    INSERT INTO chat_messages (id, role, content, created_at)
    VALUES ('legacy-user', 'user', 'Continue my old conversation', '2025-01-01T00:00:00.000Z');
    INSERT INTO chat_messages (id, role, content, created_at)
    VALUES ('legacy-assistant', 'assistant', 'Of course.', '2025-01-01T00:00:01.000Z');
  `);
  legacyDb.close();

  const { openDatabase } = require("./database.cjs");
  const migrated = openDatabase(legacyPath);
  try {
    assert.deepEqual(
      { ...migrated.prepare("SELECT id, title FROM chat_conversations WHERE id = 'legacy'").get() },
      { id: "legacy", title: "Continue my old conversation" },
    );
    assert.equal(
      migrated.prepare("SELECT COUNT(*) AS count FROM chat_messages WHERE conversation_id = 'legacy'").get().count,
      2,
    );
  } finally {
    migrated.close();
  }
}

async function main() {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "snabbler-api-test-"));
  verifyLegacyGoalSchemaMigration(tempDirectory);
  verifyLegacyChatSchemaMigration(tempDirectory);
  const databasePath = path.join(tempDirectory, "test.sqlite");
  let persistedText;
  process.env.DATABASE_PATH = databasePath;
  const originalApiKey = process.env.NVIDIA_API_KEY;
  delete process.env.NVIDIA_API_KEY;
  const originalLog = console.log;
  console.log = () => {};
  const { app, db } = require("./app.cjs");
  const server = app.listen(0, "127.0.0.1");

  try {
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}/api`;
    async function request(route, options) {
      const response = await fetch(`${baseUrl}${route}`, options);
      return {
        status: response.status,
        body: response.status === 204 ? null : await response.json(),
      };
    }

    const health = await request("/health");
    assert.equal(health.status, 200);
    assert.equal(health.body.database, "connected");

    const unavailableChat = await request("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Hello" }),
    });
    assert.equal(unavailableChat.status, 503);
    assert.match(unavailableChat.body.error, /NVIDIA API key/);
    assert.match(unavailableChat.body.error, /restart the backend/);

    const memoryText = `persistent-memory-${crypto.randomUUID()}`;
    const created = await request("/memories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: memoryText, category: "Testing", priority: "High" }),
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.text, memoryText);
    assert.equal(created.body.priority, "High");

    const updated = await request(`/memories/${created.body.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `${memoryText}-edited`, category: "Personal", priority: "Critical" }),
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.category, "Personal");
    assert.equal(updated.body.priority, "Critical");

    const listed = await request("/memories");
    assert.ok(listed.body.some(memory => memory.id === created.body.id));

    const sensitive = await request("/memories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "api key: never-save-this", category: "Testing" }),
    });
    assert.equal(sensitive.status, 400);

    const removed = await request(`/memories/${created.body.id}`, { method: "DELETE" });
    assert.equal(removed.status, 204);
    assert.equal((await request(`/memories/${created.body.id}`)).status, 404);

    const invalidGoal = await request("/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: " " }),
    });
    assert.equal(invalidGoal.status, 400);
    const createdGoal = await request("/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Test goal", description: "Persist a goal and its tasks." }),
    });
    assert.equal(createdGoal.status, 201);
    const createdTask = await request(`/goals/${createdGoal.body.id}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "First task", day: 1, dueDate: new Date().toISOString() }),
    });
    assert.equal(createdTask.status, 201);
    assert.equal(createdTask.body.status, "pending");
    const invalidTask = await request(`/goals/${createdGoal.body.id}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Invalid task", day: 0 }),
    });
    assert.equal(invalidTask.status, 400);
    const updatedTask = await request(`/goals/${createdGoal.body.id}/tasks/${createdTask.body.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "in_progress" }),
    });
    assert.equal(updatedTask.status, 200);
    assert.equal(updatedTask.body.status, "in_progress");
    const updatedGoal = await request(`/goals/${createdGoal.body.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Updated goal" }),
    });
    assert.equal(updatedGoal.status, 200);
    assert.equal(updatedGoal.body.title, "Updated goal");
    const dailyPlan = await request("/daily-plan");
    assert.ok(dailyPlan.body.inProgress.some(task => task.taskId === createdTask.body.id));
    const listedGoals = await request("/goals");
    assert.ok(listedGoals.body.some(goal => goal.id === createdGoal.body.id));
    const { executeGoalTool } = require("../services/goalService.cjs");
    const aiCreatedGoal = executeGoalTool(db, "goal_manager", { action: "create_goal", title: "AI-created goal" });
    assert.ok(executeGoalTool(db, "goal_manager", { action: "list_goals" })
      .some(goal => goal.id === aiCreatedGoal.id));
    assert.equal(executeGoalTool(db, "daily_planner", { action: "get_today_plan" }).goals.length >= 1, true);
    const deletedGoal = await request(`/goals/${createdGoal.body.id}`, { method: "DELETE" });
    assert.equal(deletedGoal.status, 204);
    assert.equal((await request(`/goals/${createdGoal.body.id}`)).status, 404);
    assert.equal(db.prepare("SELECT 1 FROM goal_tasks WHERE id = ?").get(createdTask.body.id), undefined);

    const definitions = await request("/workflows");
    assert.equal(definitions.status, 200);
    assert.equal(definitions.body.length, 7);
    assert.ok(definitions.body.every(workflow => workflow.valid));

    const chatTimestamp = new Date().toISOString();
    const secondChatTimestamp = new Date(Date.now() + 1).toISOString();
    db.prepare(`
      INSERT INTO chat_conversations (id, title, created_at, updated_at)
      VALUES (?, ?, ?, ?), (?, ?, ?, ?)
    `).run(
      "thread-a", "Thread A", chatTimestamp, chatTimestamp,
      "thread-b", "Thread B", chatTimestamp, chatTimestamp,
    );
    const insertChatMessage = db.prepare(`
      INSERT INTO chat_messages (id, role, content, created_at, conversation_id) VALUES (?, ?, ?, ?, ?)
    `);
    insertChatMessage.run(crypto.randomUUID(), "user", "test chat message", chatTimestamp, "thread-a");
    insertChatMessage.run(crypto.randomUUID(), "assistant", "test chat reply", secondChatTimestamp, "thread-a");
    insertChatMessage.run(crypto.randomUUID(), "user", "separate thread", chatTimestamp, "thread-b");
    assert.equal((await request("/chat/history")).body.length, 3);
    const conversations = await request("/conversations");
    assert.equal(conversations.status, 200);
    assert.equal(conversations.body.length, 2);
    assert.equal(conversations.body.find(item => item.id === "thread-a").messageCount, 2);
    assert.equal(conversations.body.find(item => item.id === "thread-a").preview, "test chat reply");
    const threadMessages = await request("/conversations/thread-a/messages");
    assert.equal(threadMessages.status, 200);
    assert.deepEqual(threadMessages.body.map(message => message.content), ["test chat message", "test chat reply"]);
    const { listRecentMessages } = require("../services/chatService.cjs");
    assert.deepEqual(
      listRecentMessages(db, 20, "thread-a").map(message => message.content),
      ["test chat message", "test chat reply"],
    );
    assert.equal((await request("/conversations/not-a-thread/messages")).status, 404);
    assert.equal((await request("/conversations/not-a-thread", { method: "DELETE" })).status, 404);
    assert.equal((await request("/conversations/thread-a", { method: "DELETE" })).status, 204);
    assert.equal((await request("/conversations/thread-a/messages")).status, 404);
    const remainingConversations = await request("/conversations");
    assert.deepEqual(remainingConversations.body.map(item => item.id), ["thread-b"]);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM chat_messages WHERE conversation_id = 'thread-a'").get().count,
      0,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM chat_messages WHERE conversation_id = 'thread-b'").get().count,
      1,
    );
    assert.equal((await request("/chat/history", { method: "DELETE" })).status, 204);
    assert.deepEqual((await request("/chat/history")).body, []);
    assert.deepEqual((await request("/conversations")).body, []);

    const invalidChat = await request("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "" }),
    });
    assert.equal(invalidChat.status, 400);
    const oversizedChat = await request("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "x".repeat(4001) }),
    });
    assert.equal(oversizedChat.status, 400);

    const invalidWorkflow = await request("/workflows/calculation-explainer/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inputs: {} }),
    });
    assert.equal(invalidWorkflow.status, 400);

    const projectDirectory = path.join(tempDirectory, "organization-project");
    fs.mkdirSync(projectDirectory);
    fs.writeFileSync(path.join(projectDirectory, "sample.txt"), "safe test content", "utf8");
    const started = await request("/workflows/file-organizer/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inputs: { directory: projectDirectory } }),
    });
    assert.equal(started.status, 202);

    let run = started.body;
    for (let attempt = 0; attempt < 50 && run.status !== "waiting_for_approval"; attempt += 1) {
      await delay(20);
      const refreshed = await request(`/workflow-runs/${run.runId}`);
      assert.equal(refreshed.status, 200);
      run = refreshed.body;
    }
    assert.equal(run.status, "waiting_for_approval");
    assert.equal(run.steps.find(step => step.stepId === "apply_changes").state, "waiting_for_approval");
    const events = await request(`/workflow-runs/${run.runId}/events`);
    assert.ok(events.body.some(event => event.type === "approval_requested"));

    const declined = await request(`/workflow-runs/${run.runId}/approval`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stepId: "apply_changes", approved: false }),
    });
    assert.equal(declined.status, 200);
    assert.equal(declined.body.status, "completed_with_skips");
    assert.equal(fs.existsSync(path.join(projectDirectory, "documents", "sample.txt")), false);

    async function projectToolRequest(route, body) {
      return request(route, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    const toolsRoot = path.join(tempDirectory, "project-tools");
    const toolsSource = path.join(toolsRoot, "sample-project");
    const toolsDestination = path.join(toolsRoot, "destination");
    const moveDestination = path.join(toolsRoot, "move-destination");
    fs.mkdirSync(path.join(toolsSource, "src"), { recursive: true });
    fs.mkdirSync(toolsDestination);
    fs.mkdirSync(moveDestination);
    fs.mkdirSync(path.join(toolsSource, "node_modules", "private-package"), { recursive: true });
    fs.writeFileSync(path.join(toolsSource, "README.md"), "project readme", "utf8");
    fs.writeFileSync(path.join(toolsSource, "src", "index.js"), "export default true;", "utf8");
    fs.writeFileSync(path.join(toolsSource, ".env"), "SECRET=do-not-copy", "utf8");
    fs.writeFileSync(path.join(toolsSource, "node_modules", "private-package", "index.js"), "ignored", "utf8");

    const createPreview = await projectToolRequest("/project-tools/preview", {
      operation: "create",
      projectPath: toolsSource,
      destination: "docs",
    });
    assert.equal(createPreview.status, 200, JSON.stringify(createPreview.body));
    assert.equal(fs.existsSync(path.join(toolsSource, "docs")), false);
    const createdFolder = await projectToolRequest("/project-tools/execute", { token: createPreview.body.token });
    assert.equal(createdFolder.status, 200, JSON.stringify(createdFolder.body));
    assert.equal(fs.statSync(path.join(toolsSource, "docs")).isDirectory(), true);
    const reusedPreview = await projectToolRequest("/project-tools/execute", { token: createPreview.body.token });
    assert.equal(reusedPreview.status, 410);

    const traversalPreview = await projectToolRequest("/project-tools/preview", {
      operation: "create",
      projectPath: toolsSource,
      destination: "..\\outside",
    });
    assert.equal(traversalPreview.status, 400);
    assert.equal(fs.existsSync(path.join(toolsRoot, "outside")), false);

    const copyPreview = await projectToolRequest("/project-tools/preview", {
      operation: "copy",
      projectPath: toolsSource,
      destination: toolsDestination,
    });
    assert.equal(copyPreview.status, 200, JSON.stringify(copyPreview.body));
    assert.match(copyPreview.body.details.join(" "), /2 file\(s\)/);
    const copiedProject = path.join(toolsDestination, path.basename(toolsSource));
    assert.equal(fs.existsSync(copiedProject), false);
    const copied = await projectToolRequest("/project-tools/execute", { token: copyPreview.body.token });
    assert.equal(copied.status, 200, JSON.stringify(copied.body));
    assert.equal(fs.readFileSync(path.join(copiedProject, "README.md"), "utf8"), "project readme");
    assert.equal(fs.readFileSync(path.join(copiedProject, "src", "index.js"), "utf8"), "export default true;");
    assert.equal(fs.existsSync(path.join(copiedProject, ".env")), false);
    assert.equal(fs.existsSync(path.join(copiedProject, "node_modules")), false);

    const changedSource = path.join(toolsRoot, "changed-project");
    fs.mkdirSync(changedSource);
    fs.writeFileSync(path.join(changedSource, "file.txt"), "before", "utf8");
    const changedPreview = await projectToolRequest("/project-tools/preview", {
      operation: "copy",
      projectPath: changedSource,
      destination: toolsDestination,
    });
    assert.equal(changedPreview.status, 200);
    fs.writeFileSync(path.join(changedSource, "file.txt"), "changed after preview", "utf8");
    const changedCopy = await projectToolRequest("/project-tools/execute", { token: changedPreview.body.token });
    assert.equal(changedCopy.status, 400);
    assert.equal(fs.existsSync(path.join(toolsDestination, "changed-project")), false);

    const movePreview = await projectToolRequest("/project-tools/preview", {
      operation: "move",
      projectPath: toolsSource,
      destination: moveDestination,
    });
    assert.equal(movePreview.status, 200, JSON.stringify(movePreview.body));
    const moved = await projectToolRequest("/project-tools/execute", { token: movePreview.body.token });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    assert.equal(fs.existsSync(toolsSource), false);
    const movedProject = path.join(moveDestination, path.basename(toolsSource));
    assert.equal(fs.existsSync(path.join(movedProject, "README.md")), true);

    const renamePreview = await projectToolRequest("/project-tools/preview", {
      operation: "rename",
      projectPath: movedProject,
      destination: "renamed-project",
    });
    assert.equal(renamePreview.status, 200, JSON.stringify(renamePreview.body));
    assert.match(renamePreview.body.description, /renamed-project/);
    const renamed = await projectToolRequest("/project-tools/execute", { token: renamePreview.body.token });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
    const renamedPath = path.join(moveDestination, "renamed-project");
    assert.equal(fs.existsSync(renamedPath), true);

    const invalidRename = await projectToolRequest("/project-tools/preview", {
      operation: "rename",
      projectPath: renamedPath,
      destination: "..\\outside",
    });
    assert.equal(invalidRename.status, 400);
    const sameNameRename = await projectToolRequest("/project-tools/preview", {
      operation: "rename",
      projectPath: renamedPath,
      destination: "renamed-project",
    });
    assert.equal(sameNameRename.status, 400);

    const absoluteRenamePath = path.join(moveDestination, "absolute-rename");
    const selfCopy = await projectToolRequest("/project-tools/preview", {
      operation: "copy",
      projectPath: renamedPath,
      destination: path.join(renamedPath, "src"),
    });
    assert.equal(selfCopy.status, 400);
    const absoluteRename = await projectToolRequest("/project-tools/preview", {
      operation: "rename",
      projectPath: renamedPath,
      destination: absoluteRenamePath,
    });
    assert.equal(absoluteRename.status, 200, JSON.stringify(absoluteRename.body));
    const absoluteRenamed = await projectToolRequest("/project-tools/execute", { token: absoluteRename.body.token });
    assert.equal(absoluteRenamed.status, 200, JSON.stringify(absoluteRenamed.body));
    assert.equal(fs.existsSync(absoluteRenamePath), true);

    const deletedRun = await request(`/workflow-runs/${run.runId}`, { method: "DELETE" });
    assert.equal(deletedRun.status, 204);
    assert.equal((await request(`/workflow-runs/${run.runId}`)).status, 404);

    persistedText = `restart-check-${crypto.randomUUID()}`;
    const persisted = await request("/memories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: persistedText }),
    });
    assert.equal(persisted.status, 201, JSON.stringify(persisted.body));
    assert.ok((await request("/memories")).body.some(memory => memory.text === persistedText));
  } finally {
    console.log = originalLog;
    if (originalApiKey === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = originalApiKey;
    await new Promise(resolve => server.close(resolve));
    db.close();
    const { openDatabase } = require("./database.cjs");
    try {
      const reopened = openDatabase(databasePath);
      try {
        if (persistedText) {
          assert.ok(reopened.prepare("SELECT 1 FROM memories WHERE text = ?").get(persistedText));
        }
      } finally {
        reopened.close();
      }
    } finally {
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  }
  console.log("Backend API tests passed.");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
