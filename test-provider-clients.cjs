const assert = require("node:assert/strict");
const { callAI } = require("./electron/aiClient.cjs");
const { webSearch } = require("./tools/websearch.cjs");

async function main() {
  const originalFetch = global.fetch;
  const originalNvidiaKey = process.env.NVIDIA_API_KEY;
  const originalTavilyKey = process.env.TAVILY_API_KEY;
  try {
    delete process.env.NVIDIA_API_KEY;
    await assert.rejects(() => callAI([]), /NVIDIA_API_KEY is missing/i);
    process.env.NVIDIA_API_KEY = "test-nvapi-not-a-real-secret";
    let nvidiaRequest;
    global.fetch = async (url, options) => {
      nvidiaRequest = { url, options };
      return new Response(JSON.stringify({ choices: [{ message: { content: "verified answer" } }] }), { status: 200 });
    };
    assert.equal(await callAI([{ role: "user", content: "hello" }]), "verified answer");
    assert.equal(nvidiaRequest.options.signal instanceof AbortSignal, true);
    assert.match(nvidiaRequest.options.headers.Authorization, /^Bearer /);

    global.fetch = async () => new Response(JSON.stringify({ error: "invalid key nvapi-abcdefghijklmnopqrstuvwxyz123456" }), { status: 401 });
    await assert.rejects(() => callAI([{ role: "user", content: "hello" }]), error => {
      assert.match(error.message, /NVIDIA API error \(401\)/);
      assert.ok(!error.message.includes("nvapi-abcdefghijklmnopqrstuvwxyz123456"));
      return true;
    });

    delete process.env.TAVILY_API_KEY;
    await assert.rejects(() => webSearch("test"), /TAVILY_API_KEY is missing/i);
    process.env.TAVILY_API_KEY = "test-tavily-key";
    await assert.rejects(() => webSearch("   "), /non-empty search query/i);
    let tavilyRequest;
    global.fetch = async (url, options) => {
      tavilyRequest = { url, options };
      return new Response(JSON.stringify({ results: [{ title: "Example", url: "https://example.com", content: "A result" }] }), { status: 200 });
    };
    const results = await webSearch("safe query");
    assert.equal(results.length, 1);
    assert.equal(results[0].title, "Example");
    assert.equal(tavilyRequest.options.signal instanceof AbortSignal, true);

    global.fetch = async () => new Response("not json", { status: 200 });
    await assert.rejects(() => webSearch("safe query"), /invalid JSON/i);
    console.log("PASS: NVIDIA and Tavily clients validate configuration/responses, use request timeouts, and redact credential-like provider errors.");
  } finally {
    global.fetch = originalFetch;
    if (originalNvidiaKey === undefined) delete process.env.NVIDIA_API_KEY; else process.env.NVIDIA_API_KEY = originalNvidiaKey;
    if (originalTavilyKey === undefined) delete process.env.TAVILY_API_KEY; else process.env.TAVILY_API_KEY = originalTavilyKey;
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
