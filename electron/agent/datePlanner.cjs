const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Parse a natural-language duration such as:
 * "in 2 weeks"
 * "2 weeks"
 * "in 10 days"
 * "3 months"
 *
 * Returns the number of days, or null if no supported
 * duration can be detected.
 */
function parseDuration(text) {
  if (
    typeof text !== "string" ||
    !text.trim()
  ) {
    return null;
  }

  const normalized =
    text.toLowerCase().trim();

  // Days
  const dayMatch =
    normalized.match(
      /(?:in\s+)?(\d+)\s*days?/
    );

  if (dayMatch) {
    const days =
      Number(dayMatch[1]);

    if (
      Number.isInteger(days) &&
      days > 0
    ) {
      return days;
    }
  }

  // Weeks
  const weekMatch =
    normalized.match(
      /(?:in\s+)?(\d+)\s*weeks?/
    );

  if (weekMatch) {
    const weeks =
      Number(weekMatch[1]);

    if (
      Number.isInteger(weeks) &&
      weeks > 0
    ) {
      return weeks * 7;
    }
  }

  // Months
  const monthMatch =
    normalized.match(
      /(?:in\s+)?(\d+)\s*months?/
    );

  if (monthMatch) {
    const months =
      Number(monthMatch[1]);

    if (
      Number.isInteger(months) &&
      months > 0
    ) {
      return months * 30;
    }
  }

  return null;
}

/**
 * Calculate a deadline from today's date and
 * a duration in days.
 */
function calculateDeadline(
  startDate,
  durationDays
) {
  if (
    !(startDate instanceof Date) ||
    Number.isNaN(
      startDate.getTime()
    )
  ) {
    throw new Error(
      "Invalid start date."
    );
  }

  if (
    !Number.isInteger(durationDays) ||
    durationDays <= 0
  ) {
    throw new Error(
      "Duration must be a positive number of days."
    );
  }

  return new Date(
    startDate.getTime() +
      durationDays * DAY_MS
  );
}

/**
 * Calculate an individual task date.
 *
 * day 1 = start date
 * day 2 = start date + 1 day
 * day 3 = start date + 2 days
 * etc.
 */
function calculateTaskDueDate(
  startDate,
  day
) {
  if (
    !(startDate instanceof Date) ||
    Number.isNaN(
      startDate.getTime()
    )
  ) {
    throw new Error(
      "Invalid start date."
    );
  }

  if (
    !Number.isInteger(day) ||
    day < 1
  ) {
    throw new Error(
      "Task day must be a positive integer."
    );
  }

  return new Date(
    startDate.getTime() +
      (day - 1) * DAY_MS
  );
}

function toISOString(date) {
  if (
    !(date instanceof Date) ||
    Number.isNaN(
      date.getTime()
    )
  ) {
    throw new Error(
      "Invalid date."
    );
  }

  return date.toISOString();
}

module.exports = {
  parseDuration,
  calculateDeadline,
  calculateTaskDueDate,
  toISOString,
};