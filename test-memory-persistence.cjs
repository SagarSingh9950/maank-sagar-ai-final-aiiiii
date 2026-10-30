const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "friday-pai-memory-test-"));
const memoryFile = path.join(tempDir, "memory.json");
process.env.PERSONAL_AI_MEMORY_FILE = memoryFile;

const memory = require("./electron/memory.cjs");
const { selectRelevantMemoryFacts } = require("./electron/agent/memoryContext.cjs");

try {
  memory.addMemory({ text: "The user is building a Personal AI workflow engine", category: "project" });
  memory.addMemory({ text: "The user is learning JavaScript", category: "skills" });

  // Start a genuinely separate Node process to verify the JSON survives process exit.
  const childEnv = { ...process.env, PERSONAL_AI_MEMORY_FILE: memoryFile };
  const readScript = 'const m=require("./electron/memory.cjs"); process.stdout.write(JSON.stringify(m.getMemory()));';
  const afterRestart = JSON.parse(execFileSync(process.execPath, ["-e", readScript], {
    cwd: __dirname,
    env: childEnv,
    encoding: "utf8",
  }));
  assert.equal(afterRestart.facts.length, 2);
  assert.ok(afterRestart.facts.some(fact => fact.text.includes("workflow engine")));
  console.log("PASS: memory survives a separate process restart");

  const addDuplicateScript = 'const m=require("./electron/memory.cjs"); m.addMemory({text:"The user is learning JavaScript",category:"skills"});';
  execFileSync(process.execPath, ["-e", addDuplicateScript], { cwd: __dirname, env: childEnv });
  assert.equal(memory.getMemory().facts.length, 2);
  console.log("PASS: duplicate memory facts are not added");

  const relevant = selectRelevantMemoryFacts(
    { topics: ["Improve my Personal AI workflow engine"] },
    afterRestart.facts,
  );
  assert.ok(relevant.some(fact => fact.text.includes("workflow engine")));
  assert.ok(!relevant.some(fact => fact.text === "The user is learning JavaScript"));
  console.log("PASS: workflows receive only relevant memory facts");

  assert.throws(() => memory.addMemory({ text: "API_KEY=nvapi-example-secret", category: "general" }), /secret or credential/i);
  assert.throws(() => memory.addMemory({ text: "OTP: 123456", category: "general" }), /secret or credential/i);
  assert.throws(() => memory.addMemory({ text: "password is super-secret-value", category: "general" }), /secret or credential/i);
  assert.throws(() => memory.addMemory({ text: "GitHub token ghp_abcdefghijklmnopqrstuvwxyz123456", category: "general" }), /secret or credential/i);
  memory.addMemory({ text: "The user lives in Jodhpur", category: "personal" });
  memory.addMemory({ text: "The user lives in Jaipur", category: "personal" });
  const currentLocationFacts = memory.getMemory().facts.filter(fact => /lives in/i.test(fact.text));
  assert.equal(currentLocationFacts.length, 1);
  assert.match(currentLocationFacts[0].text, /Jaipur/);
  assert.ok(currentLocationFacts[0].updatedAt);
  console.log("PASS: sensitive codes are rejected and singular current-state facts replace outdated values");

  memory.addMemory({ text: "The user is building a desktop application", category: "project" });
  const conceptMatch = selectRelevantMemoryFacts({ goal: "Improve my app" }, memory.getMemory().facts);
  assert.ok(conceptMatch.some(fact => fact.text.includes("desktop application")));
  assert.ok(!conceptMatch.some(fact => fact.text.includes("learning JavaScript")));
  console.log("PASS: related concepts can match without exact keyword overlap");

  const contextAware = selectRelevantMemoryFacts(
    { inputs: { goal: "make this reliable" }, previousResults: { inspect: { summary: "workflow engine reliability and retry handling" } } },
    memory.getMemory().facts,
  );
  assert.ok(contextAware.some(fact => /workflow engine/i.test(fact.text)));
  console.log("PASS: memory retrieval considers nested workflow evidence as well as user inputs");

  const updated = memory.updateMemory("The user is learning JavaScript", { text: "The user is learning TypeScript", category: "skills" });
  assert.ok(updated.facts.some(fact => fact.text === "The user is learning TypeScript"));
  memory.deleteMemory("The user is learning TypeScript");
  assert.ok(!memory.getMemory().facts.some(fact => fact.text === "The user is learning TypeScript"));
  console.log("PASS: memory facts can be edited and deleted");

  assert.ok(fs.existsSync(memoryFile));
  console.log("PASS: memory is written to the configured persistent data path");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
