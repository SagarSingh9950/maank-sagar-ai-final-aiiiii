function getDateTime() {
  const now = new Date();

  return {
    date: now.toLocaleDateString("en-IN"),
    time: now.toLocaleTimeString("en-IN"),
    day: now.toLocaleDateString("en-IN", {
      weekday: "long",
    }),
    iso: now.toISOString(),
  };
}

module.exports = {
  getDateTime,
};