function validateAndNormalizePlan(
  tasks,
  durationDays = null
) {
  if (!Array.isArray(tasks)) {
    throw new Error(
      "Plan tasks must be an array."
    );
  }

  const normalizedTasks = tasks
    .filter(
      (task) =>
        task &&
        typeof task.title === "string" &&
        task.title.trim()
    )
    .map((task, index) => {
      let day =
        Number.isInteger(task.day) &&
        task.day >= 1
          ? task.day
          : index + 1;

      // If the goal has a known duration,
      // keep every task inside that duration.
      if (
        Number.isInteger(durationDays) &&
        durationDays > 0
      ) {
        day = Math.min(
          day,
          durationDays
        );
      }

      return {
        title: task.title.trim(),

        description:
          typeof task.description === "string"
            ? task.description.trim()
            : "",

        day,
      };
    });

  if (
    normalizedTasks.length === 0
  ) {
    throw new Error(
      "Plan contains no valid tasks."
    );
  }

  // Sort tasks chronologically.
  normalizedTasks.sort(
    (a, b) => a.day - b.day
  );

  return normalizedTasks;
}

module.exports = {
  validateAndNormalizePlan,
};