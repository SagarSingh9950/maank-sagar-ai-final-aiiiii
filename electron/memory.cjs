const fs = require("node:fs");
const path = require("node:path");

// In development this defaults to the project memory file. Electron startup
// switches it to app.getPath("userData") so packaged installs remain writable
// and memory survives application upgrades/restarts.
let memoryFile = process.env.PERSONAL_AI_MEMORY_FILE
  ? path.resolve(process.env.PERSONAL_AI_MEMORY_FILE)
  : path.join(
      process.env.PERSONAL_AI_DATA_DIR
        ? path.resolve(process.env.PERSONAL_AI_DATA_DIR)
        : path.join(__dirname, "..", "memory"),
      "memory.json"
    );

function normalizeMemory(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.facts)) {
    return { facts: [] };
  }
  return {
    facts: value.facts.filter(fact => fact && typeof fact.text === "string" && fact.text.trim())
      .map(fact => ({
        text: fact.text.trim(),
        category: typeof fact.category === "string" && fact.category.trim()
          ? fact.category.trim().slice(0, 80)
          : "general",
        ...(typeof fact.createdAt === "string" ? { createdAt: fact.createdAt } : {}),
        ...(typeof fact.updatedAt === "string" ? { updatedAt: fact.updatedAt } : {}),
      })),
  };
}

function configureMemoryFile(file, options = {}) {
  if (typeof file !== "string" || !file.trim()) {
    throw new Error("A valid memory file path is required.");
  }
  memoryFile = path.resolve(file);
  fs.mkdirSync(path.dirname(memoryFile), { recursive: true });

  // Migrate the shipped/development memory once, but never overwrite user data.
  const migrateFrom = options.migrateFrom;
  if (!fs.existsSync(memoryFile) && typeof migrateFrom === "string" && fs.existsSync(migrateFrom)) {
    try {
      const legacy = normalizeMemory(JSON.parse(fs.readFileSync(migrateFrom, "utf8")));
      writeMemory(legacy);
    } catch (error) {
      console.error("Could not migrate legacy memory file:", error.message);
    }
  }
  return memoryFile;
}

function loadMemory() {
  try {
    if (!fs.existsSync(memoryFile)) return { facts: [] };
    return normalizeMemory(JSON.parse(fs.readFileSync(memoryFile, "utf8")));
  } catch (error) {
    // Do not silently overwrite a malformed file with an empty memory store.
    console.error("Could not read persistent memory:", error.message);
    return { facts: [] };
  }
}

function writeMemory(memory) {
  fs.mkdirSync(path.dirname(memoryFile), { recursive: true });
  const temporary = `${memoryFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(normalizeMemory(memory), null, 2), "utf8");
  fs.renameSync(temporary, memoryFile);
}

function saveMemory(memory) {
  const normalized = normalizeMemory(memory);
  writeMemory(normalized);
  return normalized;
}

function isSensitiveMemoryText(text) {
  const value = String(text || "");
  const labeledSecret = /(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|bearer token|password|passphrase|secret key|private key|client secret|one[- ]time code|verification code|\botp\b|cvv|cvc|card number|bank account number|aadhaar number|pan number)\s*(?::|=|\bis\b|\bof\b)\s*[^\s,;]+/i;
  const tokenPattern = /(?:nvapi-[A-Za-z0-9_-]{12,}|sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{12,}|AKIA[0-9A-Z]{16}|AIza[A-Za-z0-9_-]{25,}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----|Bearer\s+[A-Za-z0-9._~+/-]{20,})/i;
  return labeledSecret.test(value) || tokenPattern.test(value);
}

// Only facts explicitly phrased as singular/current state are auto-replaced.
// Ambiguous statements such as "I use JavaScript" are left alone because
// multiple tools/languages can be true at once.
function getSingularFactKey(text) {
  const normalized = String(text || "").trim().toLowerCase().replace(/[.!?]+$/, "").replace(/\s+/g, " ");
  const patterns = [
    /^(?:the user|user|i) (?:currently )?live(?:s)? in (.+)$/,
    /^(?:the user|user|i) (?:is )?majoring in (.+)$/,
    /^(?:the user|user|i) (?:currently )?work(?:s|ing) at (.+)$/,
    /^(?:the user|user|i)(?:'s)? (?:current goal is|primary goal is) (.+)$/,
    /^(?:the user|user|i)(?:'s)? (?:current project is) (.+)$/,
    /^(?:the user|user|i) is currently studying (.+)$/,
    /^(?:the user|user|i) is currently enrolled in (.+)$/,
  ];
  for (let index = 0; index < patterns.length; index += 1) {
    const match = normalized.match(patterns[index]);
    if (match) return { key: String(index), value: match[1].trim() };
  }
  return null;
}

function addMemory(fact) {
  if (!fact || typeof fact.text !== "string" || !fact.text.trim()) {
    throw new Error("Memory fact must contain non-empty text.");
  }
  const memory = loadMemory();
  const text = fact.text.trim();
  if (isSensitiveMemoryText(text)) throw new Error("Memory appears to contain a secret or credential and was not saved.");
  if (text.length > 1000) throw new Error("Memory text must not exceed 1000 characters.");
  const alreadyExists = memory.facts.some(existing => existing.text.toLowerCase() === text.toLowerCase());
  if (!alreadyExists) {
    const incomingState = getSingularFactKey(text);
    const conflictIndex = incomingState
      ? memory.facts.findIndex(existing => {
          const existingState = getSingularFactKey(existing.text);
          return existingState && existingState.key === incomingState.key && existingState.value !== incomingState.value;
        })
      : -1;
    const nextFact = {
      text,
      category: typeof fact.category === "string" && fact.category.trim() ? fact.category.trim().slice(0, 80) : "general",
      createdAt: fact.createdAt || new Date().toISOString(),
      ...(conflictIndex >= 0 ? { updatedAt: new Date().toISOString() } : {}),
    };
    if (conflictIndex >= 0) {
      nextFact.createdAt = memory.facts[conflictIndex].createdAt || nextFact.createdAt;
      memory.facts[conflictIndex] = nextFact;
    } else {
      memory.facts.push(nextFact);
    }
    saveMemory(memory);
  }
  return loadMemory();
}

function updateMemory(oldText, replacement) {
  if (typeof oldText !== "string" || !oldText.trim()) throw new Error("The existing memory text is required.");
  if (!replacement || typeof replacement.text !== "string" || !replacement.text.trim()) throw new Error("Replacement memory text is required.");
  if (replacement.text.trim().length > 1000) throw new Error("Memory text must not exceed 1000 characters.");
  if (isSensitiveMemoryText(replacement.text)) throw new Error("Memory appears to contain a secret or credential and was not saved.");
  const memory = loadMemory();
  const index = memory.facts.findIndex(fact => fact.text === oldText.trim());
  if (index < 0) throw new Error("Memory fact not found. Refresh the list and try again.");
  const duplicate = memory.facts.some((fact, i) => i !== index && fact.text.toLowerCase() === replacement.text.trim().toLowerCase());
  if (duplicate) throw new Error("That memory already exists.");
  memory.facts[index] = {
    text: replacement.text.trim(),
    category: typeof replacement.category === "string" && replacement.category.trim() ? replacement.category.trim().slice(0, 80) : "general",
    createdAt: memory.facts[index].createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return saveMemory(memory);
}

function deleteMemory(text) {
  if (typeof text !== "string" || !text.trim()) throw new Error("The memory text is required.");
  const memory = loadMemory();
  const filtered = memory.facts.filter(fact => fact.text !== text.trim());
  if (filtered.length === memory.facts.length) throw new Error("Memory fact not found. Refresh the list and try again.");
  return saveMemory({ facts: filtered });
}

function getMemory() {
  return loadMemory();
}

function getMemoryFilePath() {
  return memoryFile;
}

module.exports = {
  configureMemoryFile,
  getMemoryFilePath,
  loadMemory,
  saveMemory,
  addMemory,
  isSensitiveMemoryText,
  updateMemory,
  deleteMemory,
  getMemory,
};
