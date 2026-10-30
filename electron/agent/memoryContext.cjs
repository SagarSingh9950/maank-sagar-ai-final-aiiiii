const STOP_WORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "your", "you", "are", "was", "were", "have", "has", "had", "about", "please", "help", "want", "need", "make", "can", "could", "would", "should", "what", "when", "where", "how", "why", "use", "using", "tell", "show", "give", "does", "did", "not", "but", "then", "than", "also", "just", "like", "its", "their", "them", "they", "our", "out", "all", "any", "who", "which", "while", "been", "being", "more", "most", "very", "much", "some", "such", "only", "over", "under", "after", "before", "between", "through", "each", "other", "same", "here", "there", "is", "am", "my", "me", "i", "a", "an", "in", "to", "of", "on", "at", "it", "as", "or", "by", "be", "up", "do", "if", "we", "he", "she"
]);
const CONCEPT_GROUPS = [
  ["project", "app", "application", "repo", "repository", "codebase", "software", "program"],
  ["preference", "prefer", "likes", "like", "style", "favorite", "favourite"],
  ["remember", "memory", "recall", "saved", "persistent", "remembered"],
  ["task", "workflow", "process", "automation", "steps", "procedure"],
  ["study", "learn", "learning", "education", "course", "student", "academic"],
  ["goal", "target", "objective", "aim", "milestone", "plan", "planning"],
  ["build", "building", "develop", "developing", "implement", "implementation", "create", "creating", "make", "making"],
  ["debug", "debugging", "fix", "repair", "troubleshoot", "error", "bug", "issue", "problem"],
  ["deadline", "due", "timeline", "schedule", "date", "timeframe", "duration"],
  ["api", "integration", "connect", "endpoint", "provider", "service", "interface"],
  ["interface", "ui", "frontend", "screen", "layout", "design", "visual"],
  ["test", "testing", "verify", "verification", "validate", "validation", "check", "checks"],
  ["secure", "security", "privacy", "sensitive", "credential", "secret", "protect", "safety"],
  ["file", "files", "document", "documents", "folder", "directory", "organize", "organizer"],
  ["fast", "speed", "quick", "performance", "latency", "efficient", "optimize", "optimization"],
  ["reliable", "reliability", "robust", "stability", "stable", "dependable", "resilient"]
];
const CONCEPT_LOOKUP = new Map();
for (const group of CONCEPT_GROUPS) for (const word of group) CONCEPT_LOOKUP.set(word, group);

function normalizeToken(token) {
  let value = token.toLowerCase();
  if (value.length > 5 && value.endsWith("ies")) value = `${value.slice(0, -3)}y`;
  else if (value.length > 5 && value.endsWith("ing")) value = value.slice(0, -3);
  else if (value.length > 4 && value.endsWith("ed")) value = value.slice(0, -2);
  else if (value.length > 4 && value.endsWith("es") && !value.endsWith("ses")) value = value.slice(0, -2);
  else if (value.length > 4 && value.endsWith("s") && !value.endsWith("ss")) value = value.slice(0, -1);
  return value;
}

function collectStrings(value, output, depth = 0) {
  if (output.length >= 80 || depth > 4) return;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) output.push(trimmed.slice(0, 2000));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output, depth + 1);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (/^(?:api[_-]?key|token|password|secret|authorization|credential)$/i.test(key)) continue;
      collectStrings(item, output, depth + 1);
    }
  }
}

function tokenize(text) {
  const raw = String(text || "").toLowerCase().split(/[^a-z0-9+#.-]+/)
    .filter(token => token.length >= 2 && !STOP_WORDS.has(token));
  const expanded = [];
  const seen = new Set();
  for (const token of raw) {
    const normalized = normalizeToken(token);
    if (!seen.has(normalized)) { expanded.push(normalized); seen.add(normalized); }
    for (const related of CONCEPT_LOOKUP.get(token) || CONCEPT_LOOKUP.get(normalized) || []) {
      const alias = normalizeToken(related);
      if (!seen.has(alias)) { expanded.push(alias); seen.add(alias); }
    }
  }
  return expanded;
}

function vectorize(text) {
  const vector = new Map();
  for (const token of tokenize(text)) {
    vector.set(`w:${token}`, (vector.get(`w:${token}`) || 0) + 1);
    const padded = `^${token}$`;
    for (let index = 0; index <= padded.length - 3; index += 1) {
      const gram = padded.slice(index, index + 3);
      vector.set(`c:${gram}`, (vector.get(`c:${gram}`) || 0) + 0.08);
    }
  }
  return vector;
}

function cosineSimilarity(left, right) {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (const value of left.values()) leftNorm += value * value;
  for (const value of right.values()) rightNorm += value * value;
  for (const [key, value] of left) dot += value * (right.get(key) || 0);
  if (!leftNorm || !rightNorm) return 0;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

function freshnessBonus(fact) {
  const stamp = Date.parse(fact?.updatedAt || fact?.createdAt || "");
  if (!Number.isFinite(stamp)) return 0;
  const ageDays = Math.max(0, (Date.now() - stamp) / 86400000);
  return 0.08 * Math.exp(-ageDays / 180);
}

// Local hybrid retrieval combines BM25, sparse word/character vectors, a small
// concept dictionary, and freshness. It works offline and does not send private
// memories to an embedding service. It is not a neural dense-embedding model.
function selectRelevantMemoryFacts(inputs, facts, limit = 8) {
  if (!Array.isArray(facts) || facts.length === 0) return [];
  const queryParts = [];
  collectStrings(inputs || {}, queryParts);
  const query = queryParts.join(" ").slice(0, 12000);
  const queryTokens = tokenize(query);
  if (!queryTokens.length) return [];
  const querySet = new Set(queryTokens);
  const queryVector = vectorize(query);
  const documents = facts.map((fact, index) => {
    const text = String(fact?.text || "");
    const tokens = tokenize(`${text} ${fact?.category || ""}`);
    const counts = new Map();
    for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
    return { fact, index, text, tokens, counts, vector: vectorize(`${text} ${fact?.category || ""}`) };
  });
  const averageLength = documents.reduce((sum, doc) => sum + doc.tokens.length, 0) / Math.max(1, documents.length);
  const documentFrequency = new Map();
  for (const doc of documents) {
    for (const token of new Set(doc.tokens)) documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
  }

  return documents.map(doc => {
    let score = 0;
    for (const token of querySet) {
      const frequency = doc.counts.get(token) || 0;
      if (!frequency) continue;
      const df = documentFrequency.get(token) || 0;
      const idf = Math.log(1 + (documents.length - df + 0.5) / (df + 0.5));
      const k1 = 1.2;
      const b = 0.72;
      const lengthNorm = 1 - b + b * (doc.tokens.length / Math.max(1, averageLength));
      score += idf * (frequency * (k1 + 1)) / (frequency + k1 * lengthNorm);
    }
    score += cosineSimilarity(queryVector, doc.vector) * 0.75;
    const normalizedQuery = query.toLowerCase().replace(/\s+/g, " ").trim();
    const normalizedText = doc.text.toLowerCase().replace(/\s+/g, " ").trim();
    if (normalizedQuery && normalizedText.includes(normalizedQuery)) score += 4;
    const categoryTokens = tokenize(doc.fact?.category || "");
    if (categoryTokens.some(token => querySet.has(token))) score += 0.25;
    return {
      text: doc.text,
      category: doc.fact?.category || "general",
      score,
      freshness: freshnessBonus(doc.fact),
      index: doc.index,
    };
  }).filter(item => item.text && item.score >= 0.08)
    .sort((a, b) => b.score - a.score || b.freshness - a.freshness || a.index - b.index)
    .slice(0, Math.max(1, Math.min(Number(limit) || 8, 20)))
    .map(({ text, category }) => ({ text, category }));
}

module.exports = { selectRelevantMemoryFacts, tokenize, vectorize, cosineSimilarity };
