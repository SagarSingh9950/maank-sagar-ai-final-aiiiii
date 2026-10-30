const goalManager = require("./goalManager.cjs");

function startOfDay(date) {
  const result = new Date(date);

  result.setHours(0, 0, 0, 0);

  return result;
}

function isSameDay(dateA, dateB) {
  return (
    startOfDay(dateA).getTime() ===
    startOfDay(dateB).getTime()
  );
}

function getDaysDifference(dateA, dateB) {
  const a = startOfDay(dateA).getTime();
  const b = startOfDay(dateB).getTime();

  return Math.round(
    (a - b) /
      (24 * 60 * 60 * 1000)
  );
}

function getTodayPlan() {
  const goals = goalManager.getGoals();

  const now = new Date();

  const today = startOfDay(now);

  const result = {
    date: today.toISOString(),

    overdue: [],

    dueToday: [],

    inProgress: [],

    upcoming: [],

    goals: [],
  };

  for (const goal of goals) {
    if (
      !goal ||
      goal.status !== "active"
    ) {
      continue;
    }

    const goalTasks = Array.isArray(
      goal.tasks
    )
      ? goal.tasks
      : [];

    const activeTasks =
      goalTasks.filter(
        (task) =>
          task &&
          task.status !== "completed"
      );

    if (activeTasks.length === 0) {
      continue;
    }

    const goalSummary = {
      goalId: goal.id,
      title: goal.title,
      deadline:
        goal.deadline || null,
      totalTasks: goalTasks.length,
      completedTasks:
        goalTasks.filter(
          (task) =>
            task.status === "completed"
        ).length,
      remainingTasks:
        activeTasks.length,
    };

    result.goals.push(
      goalSummary
    );

    for (const task of activeTasks) {
      const taskInfo = {
        goalId: goal.id,
        goalTitle: goal.title,
        taskId: task.id,
        title: task.title,
        description:
          task.description || "",
        status: task.status,
        dueDate:
          task.dueDate || null,
      };

      if (!task.dueDate) {
        // Tasks without a due date are not
        // automatically considered overdue.
        continue;
      }

      const dueDate =
        new Date(task.dueDate);

      if (
        Number.isNaN(
          dueDate.getTime()
        )
      ) {
        continue;
      }

      const difference =
        getDaysDifference(
          dueDate,
          today
        );

      if (difference < 0) {
        result.overdue.push(
          taskInfo
        );
      } else if (
        isSameDay(dueDate, today)
      ) {
        result.dueToday.push(
          taskInfo
        );
      } else {
        result.upcoming.push({
          ...taskInfo,
          daysUntil: difference,
        });
      }

      if (
        task.status === "in_progress"
      ) {
        result.inProgress.push(
          taskInfo
        );
      }
    }
  }

  return result;
}

module.exports = {
  getTodayPlan,
};