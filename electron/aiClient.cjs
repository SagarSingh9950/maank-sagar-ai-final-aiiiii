const NVIDIA_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b";
const NVIDIA_ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";

async function callAI(messages, options = {}) {
  if (!Array.isArray(messages)) {
    throw new Error("Messages must be an array.");
  }

  const apiKey = process.env.NVIDIA_API_KEY;

  if (!apiKey) {
    throw new Error("NVIDIA_API_KEY is missing from the environment.");
  }

  const body = {
    model: NVIDIA_MODEL,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.max_tokens ?? 1024,
    stream: false,
  };

  // Preserve the request options used by main.cjs for routing and memory extraction.
  if (options.response_format) {
    body.response_format = options.response_format;
  }

  if (options.chat_template_kwargs) {
    body.chat_template_kwargs = options.chat_template_kwargs;
  }

  if (options.seed !== undefined) {
    body.seed = options.seed;
  }

  let response;
  try {
    response = await fetch(NVIDIA_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45000),
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new Error("NVIDIA API request timed out after 45 seconds.");
    }
    throw new Error(`Could not reach NVIDIA API: ${String(error?.message || error).slice(0, 250)}`);
  }

  if (!response.ok) {
    // Keep provider diagnostics useful without dumping an unbounded response
    // body into logs or renderer-facing error messages.
    const errorText = (await response.text()).slice(0, 500)
      .replace(/(?:nvapi-[A-Za-z0-9_-]{12,}|sk-[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/-]{20,})/gi, "[REDACTED]");
    throw new Error(`NVIDIA API error (${response.status}): ${errorText}`);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("NVIDIA API returned invalid JSON.");
  }
  const answer = data?.choices?.[0]?.message?.content;

  if (typeof answer !== "string" || !answer.trim()) {
    throw new Error("NVIDIA returned an empty response.");
  }

  return answer;
}

module.exports = {
  callAI,
};
