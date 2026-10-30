const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const projectRoot = path.resolve(__dirname, "..", "..");
const defaultDatabasePath = path.join(__dirname, "..", "data", "snabbler.sqlite");

function openDatabase(databasePath = process.env.DATABASE_PATH || defaultDatabasePath) {
  const resolvedPath = path.resolve(databasePath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

  const db = new DatabaseSync(resolvedPath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL COLLATE NOCASE UNIQUE,
      category TEXT NOT NULL DEFAULT 'General',
      priority TEXT NOT NULL DEFAULT 'Normal' CHECK (priority IN ('Low', 'Normal', 'High', 'Critical')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      conversation_id TEXT NOT NULL DEFAULT 'legacy'
    );
    CREATE TABLE IF NOT EXISTS chat_conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workflow_runs (
      run_id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      status TEXT NOT NULL,
      run_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_runs_updated_at ON workflow_runs(updated_at DESC);
    CREATE TABLE IF NOT EXISTS workflow_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      type TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      event_json TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES workflow_runs(run_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_events_run_id ON workflow_events(run_id, id);
    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      deadline TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS goal_tasks (
      id TEXT PRIMARY KEY,
      goal_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      due_date TEXT,
      day INTEGER CHECK (day IS NULL OR day > 0),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'blocked')),
      created_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_goal_tasks_goal_id ON goal_tasks(goal_id);
  `);

  migrateGoalSchema(db);
  migrateChatSchema(db);
  migrateLegacyData(db);
  migrateLegacyGoals(db);
  return db;
}

function migrateChatSchema(db) {
  const columns = new Set(db.prepare("PRAGMA table_info(chat_messages)").all().map(column => column.name));
  if (!columns.has("conversation_id")) {
    db.exec("ALTER TABLE chat_messages ADD COLUMN conversation_id TEXT NOT NULL DEFAULT 'legacy'");
  }

  const legacyMessages = db.prepare(`
    SELECT MIN(created_at) AS createdAt, MAX(created_at) AS updatedAt
    FROM chat_messages
    WHERE conversation_id = 'legacy'
  `).get();
  if (legacyMessages?.createdAt) {
    const firstUserMessage = db.prepare(`
      SELECT content FROM chat_messages
      WHERE conversation_id = 'legacy' AND role = 'user'
      ORDER BY created_at, id
      LIMIT 1
    `).get();
    const title = String(firstUserMessage?.content || "Previous conversation").trim().slice(0, 80);
    db.prepare(`
      INSERT OR IGNORE INTO chat_conversations (id, title, created_at, updated_at)
      VALUES ('legacy', ?, ?, ?)
    `).run(title || "Previous conversation", legacyMessages.createdAt, legacyMessages.updatedAt);
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_created_at
      ON chat_messages(conversation_id, created_at);
  `);
}

function migrateGoalSchema(db) {
  const goalColumns = new Set(db.prepare("PRAGMA table_info(goals)").all().map(column => column.name));
  if (!goalColumns.has("status")) db.exec("ALTER TABLE goals ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
  if (!goalColumns.has("updated_at")) db.exec("ALTER TABLE goals ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''");

  const taskColumns = new Set(db.prepare("PRAGMA table_info(goal_tasks)").all().map(column => column.name));
  if (!taskColumns.has("created_at")) db.exec("ALTER TABLE goal_tasks ADD COLUMN created_at TEXT NOT NULL DEFAULT ''");
  if (!taskColumns.has("completed_at")) db.exec("ALTER TABLE goal_tasks ADD COLUMN completed_at TEXT");
  const dayColumn = db.prepare("PRAGMA table_info(goal_tasks)").all().find(column => column.name === "day");
  if (dayColumn?.notnull) {
    db.exec(`
      BEGIN;
      DROP INDEX IF EXISTS idx_goal_tasks_goal_id;
      ALTER TABLE goal_tasks RENAME TO goal_tasks_legacy;
      CREATE TABLE goal_tasks (
        id TEXT PRIMARY KEY,
        goal_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        due_date TEXT,
        day INTEGER CHECK (day IS NULL OR day > 0),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'blocked')),
        created_at TEXT NOT NULL,
        completed_at TEXT,
        FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE
      );
      INSERT INTO goal_tasks (id, goal_id, title, description, due_date, day, status, created_at, completed_at)
      SELECT id, goal_id, title, description, due_date, day, status, created_at, completed_at
      FROM goal_tasks_legacy;
      DROP TABLE goal_tasks_legacy;
      CREATE INDEX idx_goal_tasks_goal_id ON goal_tasks(goal_id);
      COMMIT;
    `);
  }

  db.prepare("UPDATE goals SET updated_at = created_at WHERE updated_at = ''").run();
  db.prepare("UPDATE goal_tasks SET created_at = (SELECT created_at FROM goals WHERE goals.id = goal_tasks.goal_id) WHERE created_at = ''").run();
}

function migrateLegacyData(db) {
  const marker = db.prepare("SELECT 1 FROM schema_migrations WHERE name = ?").get("legacy-json-import");
  if (marker) return;

  const insertMemory = db.prepare(`
    INSERT OR IGNORE INTO memories (id, text, category, priority, created_at, updated_at)
    VALUES (?, ?, ?, 'Normal', ?, ?)
  `);
  const insertRun = db.prepare(`
    INSERT OR IGNORE INTO workflow_runs (run_id, workflow_id, status, run_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertEvent = db.prepare(`
    INSERT INTO workflow_events (run_id, type, timestamp, event_json)
    VALUES (?, ?, ?, ?)
  `);
  db.exec("BEGIN");
  try {
    const memoryFile = path.join(projectRoot, "memory", "memory.json");
    if (fs.existsSync(memoryFile)) {
      const memory = JSON.parse(fs.readFileSync(memoryFile, "utf8"));
      for (const fact of Array.isArray(memory?.facts) ? memory.facts : []) {
        if (typeof fact?.text !== "string" || !fact.text.trim()) continue;
        const now = new Date().toISOString();
        insertMemory.run(
          crypto.randomUUID(),
          fact.text.trim(),
          typeof fact.category === "string" && fact.category.trim() ? fact.category.trim().slice(0, 80) : "General",
          typeof fact.createdAt === "string" ? fact.createdAt : now,
          typeof fact.updatedAt === "string" ? fact.updatedAt : now,
        );
      }
    }

    const runsFile = path.join(projectRoot, "data", "workflow-runs.json");
    if (fs.existsSync(runsFile)) {
      const runs = JSON.parse(fs.readFileSync(runsFile, "utf8"));
      if (!Array.isArray(runs)) throw new Error("Legacy workflow runs must be a JSON array.");
      for (const run of runs) {
        if (typeof run?.runId !== "string" || typeof run.workflowId !== "string") continue;
        const createdAt = run.createdAt || new Date().toISOString();
        insertRun.run(
          run.runId,
          run.workflowId,
          String(run.status || "unknown"),
          JSON.stringify(run),
          createdAt,
          run.updatedAt || createdAt,
        );
      }
    }

    const eventsFile = path.join(projectRoot, "data", "task-events.json");
    if (fs.existsSync(eventsFile)) {
      const events = JSON.parse(fs.readFileSync(eventsFile, "utf8"));
      if (!Array.isArray(events)) throw new Error("Legacy workflow events must be a JSON array.");
      const existingRuns = new Set(
        db.prepare("SELECT run_id FROM workflow_runs").all().map(row => row.run_id),
      );
      for (const event of events) {
        if (typeof event?.runId !== "string" || !existingRuns.has(event.runId)) continue;
        insertEvent.run(
          event.runId,
          String(event.type || "unknown"),
          event.timestamp || new Date().toISOString(),
          JSON.stringify(event),
        );
      }
    }

    db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(
      "legacy-json-import",
      new Date().toISOString(),
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw new Error(`Could not import legacy application data: ${error.message}`, { cause: error });
  }
}

function migrateLegacyGoals(db) {
  if (db.prepare("SELECT 1 FROM schema_migrations WHERE name = ?").get("legacy-goals-import")) return;
  const goalsFile = path.join(projectRoot, "data", "goals", "goals.json");
  const insertGoal = db.prepare(`
    INSERT OR IGNORE INTO goals (id, title, description, deadline, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertGoalTask = db.prepare(`
    INSERT OR IGNORE INTO goal_tasks
      (id, goal_id, title, description, due_date, day, status, created_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.exec("BEGIN");
  try {
    if (fs.existsSync(goalsFile)) {
      const legacyGoals = JSON.parse(fs.readFileSync(goalsFile, "utf8"));
      if (!Array.isArray(legacyGoals?.goals)) throw new Error("Legacy goals must contain a goals array.");
      for (const goal of legacyGoals.goals) {
        if (typeof goal?.id !== "string" || typeof goal.title !== "string" || !goal.title.trim()) continue;
        const now = new Date().toISOString();
        const createdAt = typeof goal.createdAt === "string" ? goal.createdAt : now;
        insertGoal.run(
          goal.id,
          goal.title.trim(),
          typeof goal.description === "string" ? goal.description : "",
          typeof goal.deadline === "string" ? goal.deadline : null,
          typeof goal.status === "string" ? goal.status : "active",
          createdAt,
          typeof goal.updatedAt === "string" ? goal.updatedAt : createdAt,
        );
        for (const task of Array.isArray(goal.tasks) ? goal.tasks : []) {
          if (typeof task?.id !== "string" || typeof task.title !== "string" || !task.title.trim()) continue;
          insertGoalTask.run(
            task.id,
            goal.id,
            task.title.trim(),
            typeof task.description === "string" ? task.description : "",
            typeof task.dueDate === "string" ? task.dueDate : null,
            Number.isInteger(task.day) && task.day > 0 ? task.day : null,
            ["pending", "in_progress", "completed", "blocked"].includes(task.status) ? task.status : "pending",
            typeof task.createdAt === "string" ? task.createdAt : createdAt,
            typeof task.completedAt === "string" ? task.completedAt : null,
          );
        }
      }
    }
    db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(
      "legacy-goals-import",
      new Date().toISOString(),
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

module.exports = {
  openDatabase,
  defaultDatabasePath,
};
