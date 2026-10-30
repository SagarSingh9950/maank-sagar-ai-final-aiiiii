
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PROJECT_ROOT = path.resolve(__dirname, "../..");

let GOALS_DIRECTORY = path.join(PROJECT_ROOT, "data", "goals");
let GOALS_FILE = path.join(GOALS_DIRECTORY, "goals.json");

function configureGoalsFile(filePath, options = {}) {
  if (typeof filePath !== "string" || !filePath.trim()) throw new Error("A valid goals file path is required.");
  GOALS_FILE = path.resolve(filePath);
  GOALS_DIRECTORY = path.dirname(GOALS_FILE);
  fs.mkdirSync(GOALS_DIRECTORY, { recursive: true });
  if (!fs.existsSync(GOALS_FILE) && typeof options.migrateFrom === "string" && fs.existsSync(options.migrateFrom)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(options.migrateFrom, "utf8"));
      if (parsed && Array.isArray(parsed.goals)) {
        fs.writeFileSync(GOALS_FILE, JSON.stringify(parsed, null, 2), { encoding: "utf8", flag: "wx", mode: 0o600 });
      }
    } catch (error) {
      console.error("Could not migrate legacy goals file:", error.message);
    }
  }
  ensureStorage();
  return GOALS_FILE;
}

function ensureStorage() {
  fs.mkdirSync(GOALS_DIRECTORY, {
    recursive: true,
  });

  if (!fs.existsSync(GOALS_FILE)) {
    fs.writeFileSync(
      GOALS_FILE,
      JSON.stringify(
        {
          goals: [],
        },
        null,
        2
      ),
      "utf8"
    );
  }
}

function loadGoals() {
  ensureStorage();

  try {
    const data = JSON.parse(
      fs.readFileSync(GOALS_FILE, "utf8")
    );

    if (
      !data ||
      !Array.isArray(data.goals)
    ) {
      return {
        goals: [],
      };
    }

    return data;
  } catch (error) {
    throw new Error(
      `Could not read goals: ${error.message}`
    );
  }
}

function saveGoals(data) {
  ensureStorage();
  const temporary = `${GOALS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, GOALS_FILE);
}

function createGoal(
  title,
  description = "",
  deadline = null,
  options = {}
) {
  if (
    typeof title !== "string" ||
    !title.trim()
  ) {
    throw new Error(
      "Goal title must be a non-empty string."
    );
  }

  if (
    deadline !== null &&
    (
      typeof deadline !== "string" ||
      Number.isNaN(
        new Date(deadline).getTime()
      )
    )
  ) {
    throw new Error(
      "Goal deadline must be a valid date."
    );
  }

  const data = loadGoals();
  const requestedId = typeof options?.id === "string" ? options.id.trim() : "";
  if (requestedId) {
    if (requestedId.length > 120 || !/^[a-zA-Z0-9_-]+$/.test(requestedId)) {
      throw new Error("Goal ID must contain only letters, numbers, hyphens, or underscores.");
    }
    const existing = data.goals.find(item => item.id === requestedId);
    if (existing) {
      if (existing.title !== title.trim()) throw new Error("The idempotency key is already used by a different goal.");
      return existing;
    }
  }

  const now = new Date().toISOString();

  const goal = {
    id: requestedId || `goal-${crypto.randomUUID()}`,
    title: title.trim(),
    description:
      typeof description === "string"
        ? description.trim()
        : "",
    status: "active",
    createdAt: now,
    updatedAt: now,
    deadline:
      deadline !== null
        ? new Date(deadline).toISOString()
        : null,
    tasks: [],
  };

  data.goals.push(goal);

  saveGoals(data);

  return goal;
}

function getGoals() {
  return loadGoals().goals;
}

function getGoal(goalId) {
  const goals = getGoals();

  return (
    goals.find(
      (goal) => goal.id === goalId
    ) || null
  );
}

function addTask(
  goalId,
  title,
  description = "",
  dueDate = null,
  day = null
) {
  if (
    typeof title !== "string" ||
    !title.trim()
  ) {
    throw new Error(
      "Task title must be a non-empty string."
    );
  }

  if (
    dueDate !== null &&
    (
      typeof dueDate !== "string" ||
      Number.isNaN(
        new Date(dueDate).getTime()
      )
    )
  ) {
    throw new Error(
      "Task due date must be a valid date."
    );
  }

  if (
    day !== null &&
    (
      !Number.isInteger(day) ||
      day < 1
    )
  ) {
    throw new Error(
      "Task day must be a positive integer."
    );
  }

  const data = loadGoals();

  const goal = data.goals.find(
    (item) => item.id === goalId
  );

  if (!goal) {
    throw new Error(
      "Goal not found."
    );
  }

  const task = {
    id: `task-${crypto.randomUUID()}`,
    title: title.trim(),
    description:
      typeof description === "string"
        ? description.trim()
        : "",
    status: "pending",
    createdAt: new Date().toISOString(),
    completedAt: null,
  };

  // Only add scheduling information when provided.
  // This keeps old task creation behavior working.
  if (day !== null) {
    task.day = day;
  }

  if (dueDate !== null) {
    task.dueDate =
      new Date(dueDate).toISOString();
  }

  goal.tasks.push(task);

  goal.updatedAt =
    new Date().toISOString();

  saveGoals(data);

  return task;
}

function updateTaskStatus(
  goalId,
  taskId,
  status
) {
  const allowedStatuses = new Set([
    "pending",
    "in_progress",
    "completed",
    "blocked",
  ]);

  if (!allowedStatuses.has(status)) {
    throw new Error(
      "Invalid task status."
    );
  }

  const data = loadGoals();

  const goal = data.goals.find(
    (item) => item.id === goalId
  );

  if (!goal) {
    throw new Error(
      "Goal not found."
    );
  }

  const task = goal.tasks.find(
    (item) => item.id === taskId
  );

  if (!task) {
    throw new Error(
      "Task not found."
    );
  }

  task.status = status;

  task.completedAt =
    status === "completed"
      ? new Date().toISOString()
      : null;

  goal.updatedAt =
    new Date().toISOString();

  saveGoals(data);

  return task;
}

/**
 * Assign scheduling information to
 * existing tasks without recreating them.
 *
 * taskSchedule format:
 *
 * [
 *   {
 *     taskId: "task-123",
 *     day: 1,
 *     dueDate: "2026-10-19T..."
 *   }
 * ]
 */
function scheduleGoalTasks(
  goalId,
  taskSchedule,
  deadline = null
) {
  if (
    typeof goalId !== "string" ||
    !goalId.trim()
  ) {
    throw new Error(
      "Goal ID is required."
    );
  }

  if (!Array.isArray(taskSchedule)) {
    throw new Error(
      "Task schedule must be an array."
    );
  }

  if (
    deadline !== null &&
    (
      typeof deadline !== "string" ||
      Number.isNaN(
        new Date(deadline).getTime()
      )
    )
  ) {
    throw new Error(
      "Goal deadline must be a valid date."
    );
  }

  const data = loadGoals();

  const goal = data.goals.find(
    (item) => item.id === goalId
  );

  if (!goal) {
    throw new Error(
      "Goal not found."
    );
  }

  for (const scheduledTask of taskSchedule) {
    if (
      !scheduledTask ||
      typeof scheduledTask.taskId !== "string"
    ) {
      continue;
    }

    const task = goal.tasks.find(
      (item) =>
        item.id === scheduledTask.taskId
    );

    if (!task) {
      continue;
    }

    if (
      scheduledTask.day !== undefined &&
      scheduledTask.day !== null
    ) {
      if (
        !Number.isInteger(
          scheduledTask.day
        ) ||
        scheduledTask.day < 1
      ) {
        throw new Error(
          `Invalid day for task: ${task.title}`
        );
      }

      task.day =
        scheduledTask.day;
    }

    if (
      scheduledTask.dueDate !== undefined &&
      scheduledTask.dueDate !== null
    ) {
      if (
        typeof scheduledTask.dueDate !==
          "string" ||
        Number.isNaN(
          new Date(
            scheduledTask.dueDate
          ).getTime()
        )
      ) {
        throw new Error(
          `Invalid due date for task: ${task.title}`
        );
      }

      task.dueDate =
        new Date(
          scheduledTask.dueDate
        ).toISOString();
    }
  }

  // Update the goal deadline only when
  // a deadline was explicitly provided.
  if (deadline !== null) {
    goal.deadline =
      new Date(deadline).toISOString();
  }

  goal.updatedAt =
    new Date().toISOString();

  saveGoals(data);

  return goal;
}

module.exports = {
  configureGoalsFile,
  createGoal,
  getGoals,
  getGoal,
  addTask,
  updateTaskStatus,
  scheduleGoalTasks,
};
