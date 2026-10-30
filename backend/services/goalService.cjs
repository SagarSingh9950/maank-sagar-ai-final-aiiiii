const crypto = require("node:crypto");

const taskStatuses = new Set(["pending", "in_progress", "completed", "blocked"]);

function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function notFound(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

function normalizeOptionalDate(value, label) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || Number.isNaN(new Date(value).getTime())) {
    throw invalid(`${label} must be a valid date.`);
  }
  return new Date(value).toISOString();
}

function getGoal(db, id) {
  const goal = db.prepare(`
    SELECT id, title, description, deadline, status, created_at AS createdAt, updated_at AS updatedAt
    FROM goals WHERE id = ?
  `).get(id);
  if (!goal) return null;
  goal.tasks = db.prepare(`
    SELECT id, title, description, status, due_date AS dueDate, day,
      created_at AS createdAt, completed_at AS completedAt
    FROM goal_tasks WHERE goal_id = ? ORDER BY created_at, id
  `).all(id);
  return goal;
}

function listGoals(db) {
  return db.prepare("SELECT id FROM goals ORDER BY created_at DESC LIMIT 500")
    .all().map(row => getGoal(db, row.id));
}

function createGoal(db, input) {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (!title || title.length > 200) throw invalid("Goal title must contain between 1 and 200 characters.");
  if (description.length > 2000) throw invalid("Goal description must not exceed 2000 characters.");
  const deadline = normalizeOptionalDate(input.deadline, "Goal deadline");
  const now = new Date().toISOString();
  const id = `goal-${crypto.randomUUID()}`;
  db.prepare(`
    INSERT INTO goals (id, title, description, deadline, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'active', ?, ?)
  `).run(id, title, description, deadline, now, now);
  return getGoal(db, id);
}

function updateGoal(db, id, input) {
  const current = getGoal(db, id);
  if (!current) throw notFound("Goal not found.");
  if (input.title !== undefined && typeof input.title !== "string") throw invalid("Goal title must be a string.");
  if (input.description !== undefined && typeof input.description !== "string") throw invalid("Goal description must be a string.");
  const title = input.title === undefined ? current.title : input.title.trim();
  const description = input.description === undefined ? current.description : input.description.trim();
  const deadline = input.deadline === undefined ? current.deadline : normalizeOptionalDate(input.deadline, "Goal deadline");
  const status = input.status === undefined ? current.status : input.status;
  if (!title || title.length > 200) throw invalid("Goal title must contain between 1 and 200 characters.");
  if (description.length > 2000) throw invalid("Goal description must not exceed 2000 characters.");
  if (typeof status !== "string" || !["active", "completed", "paused"].includes(status)) {
    throw invalid("Goal status must be active, completed, or paused.");
  }
  db.prepare(`
    UPDATE goals SET title = ?, description = ?, deadline = ?, status = ?, updated_at = ? WHERE id = ?
  `).run(title, description, deadline, status, new Date().toISOString(), id);
  return getGoal(db, id);
}

function deleteGoal(db, id) {
  return db.prepare("DELETE FROM goals WHERE id = ?").run(id).changes > 0;
}

function addTask(db, goalId, input) {
  if (!getGoal(db, goalId)) throw notFound("Goal not found.");
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  const dueDate = normalizeOptionalDate(input.dueDate, "Task due date");
  const day = input.day === undefined || input.day === null ? null : Number(input.day);
  if (!title || title.length > 200) throw invalid("Task title must contain between 1 and 200 characters.");
  if (description.length > 2000) throw invalid("Task description must not exceed 2000 characters.");
  if (day !== null && (!Number.isInteger(day) || day < 1)) throw invalid("Task day must be a positive integer.");
  const id = `task-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO goal_tasks (id, goal_id, title, description, due_date, day, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(id, goalId, title, description, dueDate, day, now);
  db.prepare("UPDATE goals SET updated_at = ? WHERE id = ?").run(now, goalId);
  return getGoal(db, goalId).tasks.find(task => task.id === id);
}

function updateTask(db, goalId, taskId, input) {
  const task = db.prepare(`
    SELECT id, status, due_date AS dueDate, day FROM goal_tasks WHERE id = ? AND goal_id = ?
  `).get(taskId, goalId);
  if (!task) throw notFound("Task not found.");
  const status = input.status === undefined ? task.status : input.status;
  const dueDate = input.dueDate === undefined ? task.dueDate : normalizeOptionalDate(input.dueDate, "Task due date");
  const day = input.day === undefined ? task.day : input.day === null ? null : Number(input.day);
  if (!taskStatuses.has(status)) throw invalid("Task status is invalid.");
  if (day !== null && (!Number.isInteger(day) || day < 1)) throw invalid("Task day must be a positive integer.");
  const completedAt = status === "completed" ? new Date().toISOString() : null;
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE goal_tasks SET status = ?, due_date = ?, day = ?, completed_at = ? WHERE id = ? AND goal_id = ?
  `).run(status, dueDate, day, completedAt, taskId, goalId);
  db.prepare("UPDATE goals SET updated_at = ? WHERE id = ?").run(now, goalId);
  return getGoal(db, goalId).tasks.find(item => item.id === taskId);
}

function deleteTask(db, goalId, taskId) {
  const result = db.prepare("DELETE FROM goal_tasks WHERE id = ? AND goal_id = ?").run(taskId, goalId);
  if (!result.changes) throw notFound("Task not found.");
  db.prepare("UPDATE goals SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), goalId);
  return true;
}

function scheduleTasks(db, goalId, taskSchedule, deadline) {
  if (!getGoal(db, goalId)) throw notFound("Goal not found.");
  if (!Array.isArray(taskSchedule)) throw invalid("Task schedule must be an array.");
  const normalizedDeadline = deadline === undefined ? undefined : normalizeOptionalDate(deadline, "Goal deadline");
  const update = db.prepare("UPDATE goal_tasks SET day = ?, due_date = ? WHERE id = ? AND goal_id = ?");
  db.exec("BEGIN");
  try {
    for (const item of taskSchedule) {
      if (!item || typeof item.taskId !== "string" || !item.taskId.trim()) {
        throw invalid("Each scheduled task must contain a task ID.");
      }
      const currentTask = db.prepare(`
        SELECT day, due_date AS dueDate FROM goal_tasks WHERE id = ? AND goal_id = ?
      `).get(item.taskId, goalId);
      if (!currentTask) throw notFound(`Task not found: ${item.taskId}`);
      const day = item.day === undefined || item.day === null ? currentTask.day : item.day;
      if (day !== null && (!Number.isInteger(day) || day < 1)) {
        throw invalid(`Invalid day for task: ${item.taskId}`);
      }
      const dueDate = item.dueDate === undefined || item.dueDate === null
        ? currentTask.dueDate
        : normalizeOptionalDate(item.dueDate, "Task due date");
      update.run(day, dueDate, item.taskId, goalId);
    }
    if (normalizedDeadline !== undefined) {
      db.prepare("UPDATE goals SET deadline = ? WHERE id = ?").run(normalizedDeadline, goalId);
    }
    db.prepare("UPDATE goals SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), goalId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getGoal(db, goalId);
}

function getTodayPlan(db) {
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const plan = { date: new Date(dayStart).toISOString(), overdue: [], dueToday: [], inProgress: [], upcoming: [], goals: [] };
  for (const goal of listGoals(db).filter(item => item.status === "active")) {
    const activeTasks = goal.tasks.filter(task => task.status !== "completed");
    if (!activeTasks.length) continue;
    plan.goals.push({
      goalId: goal.id,
      title: goal.title,
      deadline: goal.deadline,
      totalTasks: goal.tasks.length,
      completedTasks: goal.tasks.filter(task => task.status === "completed").length,
      remainingTasks: activeTasks.length,
    });
    for (const task of activeTasks) {
      if (!task.dueDate || Number.isNaN(new Date(task.dueDate).getTime())) continue;
      const due = new Date(task.dueDate);
      const dueStart = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
      const difference = Math.round((dueStart - dayStart) / 86400000);
      const item = {
        goalId: goal.id, goalTitle: goal.title, taskId: task.id, title: task.title,
        description: task.description, status: task.status, dueDate: task.dueDate,
      };
      if (difference < 0) plan.overdue.push(item);
      else if (difference === 0) plan.dueToday.push(item);
      else plan.upcoming.push({ ...item, daysUntil: difference });
      if (task.status === "in_progress") plan.inProgress.push(item);
    }
  }
  return plan;
}

function executeGoalTool(db, name, args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw invalid("Goal tool arguments must be an object.");
  if (name === "daily_planner") {
    if (args.action !== "get_today_plan") throw invalid("Unsupported daily planner action.");
    return getTodayPlan(db);
  }
  const action = args.action;
  if (action === "create_goal") return createGoal(db, args);
  if (action === "list_goals") return listGoals(db);
  if (action === "get_goal") {
    if (typeof args.goalId !== "string" || !args.goalId.trim()) throw invalid("Goal ID is required.");
    return getGoal(db, args.goalId.trim());
  }
  if (action === "add_task") {
    if (typeof args.goalId !== "string" || !args.goalId.trim()) throw invalid("Goal ID is required.");
    return addTask(db, args.goalId.trim(), args);
  }
  if (action === "update_task") {
    if (typeof args.goalId !== "string" || typeof args.taskId !== "string") throw invalid("Goal and task IDs are required.");
    return updateTask(db, args.goalId.trim(), args.taskId.trim(), { status: args.status });
  }
  if (action === "schedule_tasks") {
    if (typeof args.goalId !== "string" || !args.goalId.trim()) throw invalid("Goal ID is required.");
    return scheduleTasks(db, args.goalId.trim(), args.taskSchedule, args.deadline);
  }
  throw invalid("Unsupported goal action.");
}

module.exports = {
  getGoal,
  listGoals,
  createGoal,
  updateGoal,
  deleteGoal,
  addTask,
  updateTask,
  deleteTask,
  scheduleTasks,
  getTodayPlan,
  executeGoalTool,
};
