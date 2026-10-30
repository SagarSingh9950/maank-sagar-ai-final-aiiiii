const fs = require('node:fs');
const path = require('node:path');

// Load simple KEY=value entries for local smoke tests without printing secrets.
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && process.env[match[1]] === undefined) {
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      process.env[match[1]] = value;
    }
  }
}

const { callAI } = require('./electron/aiClient.cjs');
const { webSearch } = require('./tools/websearch.cjs');

async function main() {
  let checked = 0;
  if (process.env.NVIDIA_API_KEY && process.env.NVIDIA_API_KEY.trim()) {
    const answer = await callAI([{ role: 'user', content: 'Reply with exactly: NVIDIA_OK' }], { temperature: 0, max_tokens: 20 });
    if (!answer || !answer.trim()) throw new Error('NVIDIA smoke test returned an empty answer.');
    console.log('PASS: NVIDIA Nemotron API responded (response content not logged).');
    checked += 1;
  } else {
    console.log('SKIP: NVIDIA API smoke test; NVIDIA_API_KEY is not configured.');
  }

  if (process.env.TAVILY_API_KEY && process.env.TAVILY_API_KEY.trim()) {
    const results = await webSearch('Nebius Token Factory API documentation');
    if (!Array.isArray(results)) throw new Error('Tavily smoke test did not return a results array.');
    console.log(`PASS: Tavily API responded (${results.length} result(s)); URLs/content not logged.`);
    checked += 1;
  } else {
    console.log('SKIP: Tavily API smoke test; TAVILY_API_KEY is not configured.');
  }
  if (checked === 0) console.log('No live API calls were made. Configure keys in .env and rerun npm run test:api-smoke.');
}

main().catch(error => {
  console.error(`API smoke test failed: ${String(error.message || error).slice(0, 500)}`);
  process.exitCode = 1;
});
