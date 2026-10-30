
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", "..", ".env") });
dotenv.config({ path: path.join(__dirname, "..", ".env") });
dotenv.config({ path: path.join(__dirname, ".env") });

const { app, db } = require("../other/app.cjs");
const port = Number.parseInt(process.env.PORT || "5000", 10);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

const server = app.listen(port, "127.0.0.1", () => {
  console.log(JSON.stringify({
    level: "info",
    message: "Snabbler AI backend listening",
    host: "127.0.0.1",
    port,
  }));
});

server.on("error", error => {
  console.error(JSON.stringify({ level: "error", message: "Backend could not start", error: error.message }));
  process.exitCode = 1;
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
