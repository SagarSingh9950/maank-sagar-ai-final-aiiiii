const crypto = require("node:crypto");
const express = require("express");
const cors = require("cors");
const { openDatabase } = require("./database.cjs");
const chatService = require("../services/chatService.cjs");
const workflowService = require("../services/workflowService.cjs");
const goalService = require("../services/goalService.cjs");
const projectToolsService = require("../services/projectToolsService.cjs");
const { isSensitiveMemoryText } = require("../../electron/memory.cjs");

const app = express();
const db = openDatabase();
const defaultOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
];
const configuredOrigins = String(process.env.FRONTEND_URL || "")
  .split(",")
  .map(origin => origin.trim())
  .filter(Boolean);
const allowedOrigins = new Set([...defaultOrigins, ...configuredOrigins]);
const chatRequestWindows = new Map();
const CHAT_REQUEST_LIMIT = 30;
const CHAT_WINDOW_MS = 5 * 60 * 1000;

app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    const error = new Error("This frontend origin is not allowed.");
    error.status = 403;
    return callback(error);
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
}));
app.use(express.json({ limit: "64kb" }));

app.use((req, res, next) => {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  res.setHeader("X-Request-Id", requestId);
  res.on("finish", () => {
    console.log(JSON.stringify({
      level: "info",
      requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
    }));
  });
  next();
});

function requireObjectBody(req, _res, next) {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    const error = new Error("Request body must be a JSON object.");
    error.status = 400;
    return next(error);
  }
  return next();
}

function requireId(value, label) {
  if (typeof value !== "string" || !value.trim() || value.length > 200) {
    const error = new Error(`${label} is invalid.`);
    error.status = 400;
    throw error;
  }
  return value.trim();
}

function sqliteConflict(error) {
  if (error?.code === "ERR_SQLITE_ERROR" && /UNIQUE constraint failed/i.test(error.message)) {
    error.status = 409;
  }
}

app.get("/api/health", (_req, res) => {
  res.json({ success: true, message: "Snabbler AI backend is running", database: "connected" });
});

app.post("/api/chat", requireObjectBody, async (req, res) => {
  const now = Date.now();
  const window = chatRequestWindows.get(req.ip);
  if (!window || now - window.startedAt >= CHAT_WINDOW_MS) {
    chatRequestWindows.set(req.ip, { startedAt: now, count: 1 });
  } else {
    window.count += 1;
    if (window.count > CHAT_REQUEST_LIMIT) {
      return res.status(429).json({ error: "Chat request limit reached. Try again in a few minutes." });
    }
  }
  const message = req.body.message;
  if (typeof message !== "string" || !message.trim() || message.length > 4000) {
    return res.status(400).json({ error: "Message must contain between 1 and 4000 characters." });
  }
  const conversationId = req.body.conversationId === undefined
    ? undefined
    : requireId(req.body.conversationId, "Conversation ID");
  const result = await chatService.sendMessage(db, message.trim(), conversationId);
  return res.json(result);
});

app.get("/api/conversations", (req, res) => {
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
  const conversations = db.prepare(`
    SELECT
      conversation.id,
      conversation.title,
      conversation.created_at AS createdAt,
      conversation.updated_at AS updatedAt,
      (SELECT content FROM chat_messages
       WHERE conversation_id = conversation.id
       ORDER BY created_at DESC, rowid DESC LIMIT 1) AS preview,
      (SELECT COUNT(*) FROM chat_messages
       WHERE conversation_id = conversation.id) AS messageCount
    FROM chat_conversations AS conversation
    ORDER BY conversation.updated_at DESC, conversation.id
    LIMIT ?
  `).all(limit);
  return res.json(conversations);
});

app.get("/api/conversations/:id/messages", (req, res) => {
  const conversationId = requireId(req.params.id, "Conversation ID");
  const conversation = db.prepare("SELECT id FROM chat_conversations WHERE id = ?").get(conversationId);
  if (!conversation) return res.status(404).json({ error: "Conversation not found." });
  const limit = Math.min(500, Math.max(1, Number.parseInt(req.query.limit, 10) || 500));
  const messages = db.prepare(`
    SELECT id, role, content, created_at AS createdAt
    FROM chat_messages
    WHERE conversation_id = ?
    ORDER BY created_at, rowid
    LIMIT ?
  `).all(conversationId, limit);
  return res.json(messages);
});

app.delete("/api/conversations/:id", (req, res) => {
  const conversationId = requireId(req.params.id, "Conversation ID");
  const conversation = db.prepare("SELECT id FROM chat_conversations WHERE id = ?").get(conversationId);
  if (!conversation) return res.status(404).json({ error: "Conversation not found." });

  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM chat_messages WHERE conversation_id = ?").run(conversationId);
    db.prepare("DELETE FROM chat_conversations WHERE id = ?").run(conversationId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return res.status(204).end();
});

app.get("/api/chat/history", (req, res) => {
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 40));
  const messages = db.prepare(`
    SELECT id, role, content, created_at AS createdAt
    FROM chat_messages
    ORDER BY created_at DESC, rowid DESC
    LIMIT ?
  `).all(limit).reverse();
  return res.json(messages);
});

app.delete("/api/chat/history", (_req, res) => {
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM chat_messages").run();
    db.prepare("DELETE FROM chat_conversations").run();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return res.status(204).end();
});

app.get("/api/memories", (_req, res) => {
  const memories = db.prepare(`
    SELECT id, text, category, priority, created_at AS createdAt, updated_at AS updatedAt
    FROM memories ORDER BY created_at DESC
  `).all();
  return res.json(memories);
});

app.post("/api/memories", requireObjectBody, (req, res, next) => {
  const text = typeof req.body.text === "string" ? req.body.text.trim() : "";
  const category = typeof req.body.category === "string" && req.body.category.trim()
    ? req.body.category.trim()
    : "General";
  const priorities = new Set(["Low", "Normal", "High", "Critical"]);
  const priority = priorities.has(req.body.priority) ? req.body.priority : "Normal";
  if (!text || text.length > 1000) {
    return res.status(400).json({ error: "Memory text must contain between 1 and 1000 characters." });
  }
  if (category.length > 80) return res.status(400).json({ error: "Category must not exceed 80 characters." });
  if (isSensitiveMemoryText(text)) return res.status(400).json({ error: "Memory appears to contain a secret or credential and was not saved." });
  const now = new Date().toISOString();
  try {
    db.prepare(`
      INSERT INTO memories (id, text, category, priority, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), text, category, priority, now, now);
  } catch (error) {
    sqliteConflict(error);
    return next(error);
  }
  const memory = db.prepare(`
    SELECT id, text, category, priority, created_at AS createdAt, updated_at AS updatedAt
    FROM memories WHERE text = ?
  `).get(text);
  return res.status(201).json(memory);
});

app.put("/api/memories/:id", requireObjectBody, (req, res, next) => {
  const id = requireId(req.params.id, "Memory ID");
  const text = typeof req.body.text === "string" ? req.body.text.trim() : "";
  const category = typeof req.body.category === "string" && req.body.category.trim()
    ? req.body.category.trim()
    : "General";
  const priorities = new Set(["Low", "Normal", "High", "Critical"]);
  const priority = priorities.has(req.body.priority) ? req.body.priority : "Normal";
  if (!text || text.length > 1000) return res.status(400).json({ error: "Memory text must contain between 1 and 1000 characters." });
  if (category.length > 80) return res.status(400).json({ error: "Category must not exceed 80 characters." });
  if (isSensitiveMemoryText(text)) return res.status(400).json({ error: "Memory appears to contain a secret or credential and was not saved." });
  const now = new Date().toISOString();
  try {
    const result = db.prepare(`
      UPDATE memories SET text = ?, category = ?, priority = ?, updated_at = ? WHERE id = ?
    `).run(text, category, priority, now, id);
    if (!result.changes) return res.status(404).json({ error: "Memory not found." });
  } catch (error) {
    sqliteConflict(error);
    return next(error);
  }
  return res.json(db.prepare(`
    SELECT id, text, category, priority, created_at AS createdAt, updated_at AS updatedAt
    FROM memories WHERE id = ?
  `).get(id));
});

app.delete("/api/memories/:id", (req, res) => {
  const id = requireId(req.params.id, "Memory ID");
  const result = db.prepare("DELETE FROM memories WHERE id = ?").run(id);
  if (!result.changes) return res.status(404).json({ error: "Memory not found." });
  return res.status(204).end();
});

app.get("/api/goals", (_req, res) => res.json(goalService.listGoals(db)));

app.post("/api/goals", requireObjectBody, (req, res, next) => {
  try {
    return res.status(201).json(goalService.createGoal(db, req.body));
  } catch (error) {
    return next(error);
  }
});

app.get("/api/goals/:id", (req, res) => {
  const goal = goalService.getGoal(db, requireId(req.params.id, "Goal ID"));
  if (!goal) return res.status(404).json({ error: "Goal not found." });
  return res.json(goal);
});

app.put("/api/goals/:id", requireObjectBody, (req, res, next) => {
  try {
    return res.json(goalService.updateGoal(db, requireId(req.params.id, "Goal ID"), req.body));
  } catch (error) {
    return next(error);
  }
});

app.delete("/api/goals/:id", (req, res) => {
  const deleted = goalService.deleteGoal(db, requireId(req.params.id, "Goal ID"));
  if (!deleted) return res.status(404).json({ error: "Goal not found." });
  return res.status(204).end();
});

app.post("/api/goals/:id/tasks", requireObjectBody, (req, res, next) => {
  try {
    const task = goalService.addTask(db, requireId(req.params.id, "Goal ID"), req.body);
    return res.status(201).json(task);
  } catch (error) {
    return next(error);
  }
});

app.patch("/api/goals/:id/tasks/:taskId", requireObjectBody, (req, res, next) => {
  try {
    const task = goalService.updateTask(
      db,
      requireId(req.params.id, "Goal ID"),
      requireId(req.params.taskId, "Task ID"),
      req.body,
    );
    return res.json(task);
  } catch (error) {
    return next(error);
  }
});

app.delete("/api/goals/:id/tasks/:taskId", (req, res, next) => {
  try {
    goalService.deleteTask(db, requireId(req.params.id, "Goal ID"), requireId(req.params.taskId, "Task ID"));
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

app.get("/api/daily-plan", (_req, res) => res.json(goalService.getTodayPlan(db)));

app.get("/api/workflows", (_req, res) => res.json(workflowService.listDefinitions()));
app.get("/api/workflow-runs", (_req, res) => res.json(workflowService.listRuns(db)));

app.post("/api/project-tools/preview", requireObjectBody, (req, res, next) => {
  try {
    const { operation, projectPath, destination } = req.body;
    return res.json(projectToolsService.previewOperation({ operation, projectPath, destination }));
  } catch (error) {
    error.status = error.status || 400;
    return next(error);
  }
});

app.post("/api/project-tools/execute", requireObjectBody, (req, res, next) => {
  try {
    return res.json(projectToolsService.executeOperation(req.body.token));
  } catch (error) {
    error.status = error.status || 400;
    return next(error);
  }
});

app.post("/api/workflows/:id/runs", requireObjectBody, (req, res, next) => {
  try {
    const workflowId = requireId(req.params.id, "Workflow ID");
    const inputs = req.body.inputs === undefined ? {} : req.body.inputs;
    const run = workflowService.startRun(db, workflowId, inputs);
    return res.status(202).json(run);
  } catch (error) {
    error.status = error.status || (/Workflow not found/i.test(error.message) ? 404 : 400);
    return next(error);
  }
});

app.get("/api/workflow-runs/:id", (req, res) => {
  const run = workflowService.getRun(db, requireId(req.params.id, "Workflow run ID"));
  if (!run) return res.status(404).json({ error: "Workflow run not found." });
  return res.json(run);
});

app.get("/api/workflow-runs/:id/events", (req, res) => {
  const runId = requireId(req.params.id, "Workflow run ID");
  if (!workflowService.getRun(db, runId)) return res.status(404).json({ error: "Workflow run not found." });
  return res.json(workflowService.listEvents(db, runId));
});

app.post("/api/workflow-runs/:id/approval", requireObjectBody, (req, res, next) => {
  try {
    const runId = requireId(req.params.id, "Workflow run ID");
    if (typeof req.body.stepId !== "string" || !req.body.stepId.trim() || typeof req.body.approved !== "boolean") {
      return res.status(400).json({ error: "A step ID and boolean approval decision are required." });
    }
    const run = workflowService.approveStep(db, runId, req.body.stepId.trim(), req.body.approved);
    if (!run) return res.status(404).json({ error: "Workflow run not found." });
    return res.json(run);
  } catch (error) {
    error.status = error.status || 400;
    return next(error);
  }
});

app.post("/api/workflow-runs/:id/resume", (req, res) => {
  const run = workflowService.resumeRun(db, requireId(req.params.id, "Workflow run ID"));
  if (!run) return res.status(404).json({ error: "Workflow run not found." });
  return res.status(202).json(run);
});

app.post("/api/workflow-runs/:id/cancel", (req, res, next) => {
  try {
    const run = workflowService.cancelRun(db, requireId(req.params.id, "Workflow run ID"));
    if (!run) return res.status(404).json({ error: "Workflow run not found." });
    return res.json(run);
  } catch (error) {
    error.status = error.status || 409;
    return next(error);
  }
});

app.delete("/api/workflow-runs/:id", (req, res, next) => {
  try {
    const deleted = workflowService.deleteRun(db, requireId(req.params.id, "Workflow run ID"));
    if (!deleted) return res.status(404).json({ error: "Workflow run not found." });
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

app.use((_req, res) => res.status(404).json({ error: "API endpoint not found." }));

app.use((error, req, res, _next) => {
  const status = Number.isInteger(error.status) ? error.status : 500;
  if (status >= 500) {
    console.error(JSON.stringify({
      level: "error",
      requestId: res.getHeader("X-Request-Id"),
      method: req.method,
      path: req.path,
      error: String(error.message || "Internal server error").slice(0, 300),
    }));
  }
  if (res.headersSent) return;
  return res.status(status).json({
    error: error.publicMessage || (status >= 500 ? "The request could not be completed." : error.message),
    requestId: res.getHeader("X-Request-Id"),
  });
});

module.exports = { app, db };
