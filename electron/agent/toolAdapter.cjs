const goalManager = require("./goalManager.cjs");
const dailyPlanner = require("./dailyPlanner.cjs");
const path = require("node:path");
const fs = require("node:fs");

const { calculate } = require("../../tools/calculator.cjs");
const { getDateTime } = require("../../tools/dateTime.cjs");
const { getSystemInfo } = require("../../tools/systemInfo.cjs");
const { webSearch } = require("../../tools/websearch.cjs");
const fileManager = require("../../tools/fileManager.cjs");

const PROJECT_ROOT = fs.realpathSync(
  path.resolve(__dirname, "../..")
);

const BLOCKED_NAMES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  "credentials.json",
  "secrets.json",
  "id_rsa",
  "id_ed25519",
]);

function validateString(value, label, maxLength = 500) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  if (value.length > maxLength) {
    throw new Error(`${label} is too long.`);
  }

  return value.trim();
}

function ensureSafePath(inputPath, { mustExist = true } = {}) {
  const suppliedPath = validateString(inputPath, "Path", 1000);

  const absolutePath = path.resolve(
    PROJECT_ROOT,
    suppliedPath
  );

  const relativePath = path.relative(
    PROJECT_ROOT,
    absolutePath
  );

  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(
      "Access outside the project directory is not allowed."
    );
  }

  if (
    mustExist &&
    !fs.existsSync(absolutePath)
  ) {
    throw new Error(
      "The requested path does not exist."
    );
  }

  if (mustExist) {
    const realPath =
      fs.realpathSync(absolutePath);

    const realRelative =
      path.relative(
        PROJECT_ROOT,
        realPath
      );

    if (
      realRelative === ".." ||
      realRelative.startsWith(
        `..${path.sep}`
      ) ||
      path.isAbsolute(realRelative)
    ) {
      throw new Error(
        "The requested path resolves outside the project."
      );
    }
  }

  const segments =
    relativePath.split(path.sep);

  for (const segment of segments) {
    if (
      BLOCKED_NAMES.has(
        segment.toLowerCase()
      )
    ) {
      throw new Error(
        "Access to this sensitive path is blocked."
      );
    }

    if (
      /\.(pem|key|p12|pfx)$/i.test(segment) ||
      /^\.env(?:\.|$)/i.test(segment)
    ) {
      throw new Error(
        "Access to this sensitive path is blocked."
      );
    }
  }

  return absolutePath;
}

function requireObject(args) {
  if (
    args === null ||
    typeof args !== "object" ||
    Array.isArray(args)
  ) {
    throw new Error(
      "Tool arguments must be an object."
    );
  }

  return args;
}

const toolDefinitions = {
  calculator: {
    description:
      "Evaluate a mathematical expression.",

    execute(args) {
      requireObject(args);

      const expression =
        validateString(
          args.expression,
          "Expression",
          300
        );

      return calculate(expression);
    },
  },

  date_time: {
    description:
      "Get the current date and time.",

    execute(args) {
      requireObject(args);

      return getDateTime();
    },
  },

  system_info: {
    description:
      "Get computer system information.",

    execute(args) {
      requireObject(args);

      const query =
        args.query === undefined
          ? "all"
          : validateString(
              args.query,
              "Query",
              100
            );

      return getSystemInfo(query);
    },
  },

  web_search: {
    description:
      "Search the web for information.",

    async execute(args) {
      requireObject(args);

      const query =
        validateString(
          args.query,
          "Search query",
          500
        );

      return await webSearch(query);
    },
  },

  file_manager: {
    description:
      "Safely inspect files and folders within the project.",

    execute(args) {
      requireObject(args);

      const action =
        validateString(
          args.action,
          "File action",
          30
        );

      if (action === "list") {
        const target =
          ensureSafePath(
            args.path || "."
          );

        return fileManager.listFolder(
          target
        );
      }

      if (action === "find") {
        const target =
          ensureSafePath(
            args.path || "."
          );

        const fileName =
          validateString(
            args.fileName,
            "File name",
            255
          );

        if (
          fileName.includes("/") ||
          fileName.includes("\\") ||
          fileName === "." ||
          fileName === ".."
        ) {
          throw new Error(
            "Enter a file name, not a path."
          );
        }

        const results =
          fileManager.findFile(
            target,
            fileName
          );

        return results.map(
          (result) =>
            ensureSafePath(result)
        );
      }

      if (action === "read") {
        const target =
          ensureSafePath(args.path);

        const stats =
          fs.statSync(target);

        if (!stats.isFile()) {
          throw new Error(
            "Only files can be read."
          );
        }

        if (stats.size > 200_000) {
          throw new Error(
            "File is too large to read through this tool."
          );
        }

        return fileManager.readFile(
          target
        );
      }

      if (action === "info") {
        const target =
          ensureSafePath(args.path);

        return fileManager.getFileInfo(
          target
        );
      }

      throw new Error(
        "Unsupported file action. Allowed actions: list, find, read, info."
      );
    },
  },

  // ------------------------------------
  // GOAL MANAGER
  // ------------------------------------

  goal_manager: {
    description:
      "Create, view, plan, and update persistent personal goals and tasks.",

    execute(args) {
      requireObject(args);

      const action =
        validateString(
          args.action,
          "Goal action",
          30
        );

      if (action === "create_goal") {
        const title =
          validateString(
            args.title,
            "Goal title",
            200
          );

        const description =
          typeof args.description === "string"
            ? args.description.trim()
            : "";

        return goalManager.createGoal(
          title,
          description
        );
      }

      if (action === "list_goals") {
        return goalManager.getGoals();
      }

      if (action === "get_goal") {
        const goalId =
          validateString(
            args.goalId,
            "Goal ID",
            100
          );

        return goalManager.getGoal(
          goalId
        );
      }

      if (action === "add_task") {
        const goalId =
          validateString(
            args.goalId,
            "Goal ID",
            100
          );

        const title =
          validateString(
            args.title,
            "Task title",
            200
          );

        const description =
          typeof args.description === "string"
            ? args.description.trim()
            : "";

        const dueDate =
          args.dueDate === undefined ||
          args.dueDate === null
            ? null
            : validateString(
                args.dueDate,
                "Task due date",
                100
              );

        const day =
          args.day === undefined ||
          args.day === null
            ? null
            : Number(args.day);

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

        return goalManager.addTask(
          goalId,
          title,
          description,
          dueDate,
          day
        );
      }

      if (action === "update_task") {
        const goalId =
          validateString(
            args.goalId,
            "Goal ID",
            100
          );

        const taskId =
          validateString(
            args.taskId,
            "Task ID",
            100
          );

        const status =
          validateString(
            args.status,
            "Task status",
            30
          );

        return goalManager.updateTaskStatus(
          goalId,
          taskId,
          status
        );
      }

      if (action === "schedule_tasks") {
        const goalId =
          validateString(
            args.goalId,
            "Goal ID",
            100
          );

        if (
          !Array.isArray(
            args.taskSchedule
          )
        ) {
          throw new Error(
            "Task schedule must be an array."
          );
        }

        return goalManager.scheduleGoalTasks(
          goalId,
          args.taskSchedule
        );
      }

      throw new Error(
        "Unsupported goal action."
      );
    },
  },

  // ------------------------------------
  // DAILY PLANNER
  // ------------------------------------

  daily_planner: {
    description:
      "View today's tasks, overdue tasks, upcoming tasks, and active goal progress.",

    execute(args) {
      requireObject(args);

      const action =
        validateString(
          args.action,
          "Daily planner action",
          30
        );

      if (
        action === "get_today_plan"
      ) {
        return dailyPlanner.getTodayPlan();
      }

      throw new Error(
        "Unsupported daily planner action."
      );
    },
  },
};

function listTools() {
  return Object.entries(
    toolDefinitions
  ).map(
    ([name, definition]) => ({
      name,
      description:
        definition.description,
    })
  );
}

async function executeTool(
  name,
  args = {}
) {
  try {
    if (
      typeof name !== "string" ||
      !Object.hasOwn(
        toolDefinitions,
        name
      )
    ) {
      throw new Error(
        `Unknown or unavailable tool: ${String(name)}`
      );
    }

    const result =
      await toolDefinitions[
        name
      ].execute(args);

    return {
      success: true,
      tool: name,
      result,
    };
  } catch (error) {
    return {
      success: false,
      tool:
        typeof name === "string"
          ? name
          : "unknown",
      error:
        error.message ||
        "Tool execution failed.",
    };
  }
}

module.exports = {
  listTools,
  executeTool,
};



