const path = require("node:path");
require("dotenv").config({
  path: path.join(__dirname, ".env"),
});
const {
  listTools,
  executeTool,
} = require("./electron/agent/toolRegistry.cjs");

async function main() {
  console.log("\n--- Registered tools ---");
  console.log(listTools());

  const tests = [
    ["calculator", { expression: "25 * 48" }],
    ["date_time", {}],
    ["system_info", { query: "all" }],
    ["file_manager", { action: "list", path: "tools" }],
    ["file_manager", { action: "read", path: "package.json" }],
    ["unknown_tool", {}],
    ["file_manager", { action: "read", path: "../.env" }],
  ];

  for (const [name, args] of tests) {
    console.log(`\n--- Testing ${name} ---`);
    console.log(await executeTool(name, args));
  }

  console.log("\n--- Testing web search ---");
  console.log(
    await executeTool("web_search", {
      query: "Official NVIDIA AI announcements",
    })
  );
}

main().catch((error) => {
  console.error("Registry test failed:", error.message);
  process.exitCode = 1;
});
