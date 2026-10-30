async function webSearch(query) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    throw new Error("TAVILY_API_KEY is missing from the environment.");
  }
  if (typeof query !== "string" || !query.trim()) {
    throw new Error("A non-empty search query is required.");
  }

  let response;
  try {
    response = await fetch(
      "https://api.tavily.com/search",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          query: query.trim().slice(0, 1500),
          search_depth: "basic",
          max_results: 5,
          include_answer: false,
        }),
        signal: AbortSignal.timeout(30000),
      }
    );
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new Error("Tavily search timed out after 30 seconds.");
    }
    throw new Error(`Could not reach Tavily API: ${String(error?.message || error).slice(0, 250)}`);
  }

  if (!response.ok) {
    const errorText = (await response.text()).slice(0, 500)
      .replace(/(?:tvly-[A-Za-z0-9_-]{12,}|nvapi-[A-Za-z0-9_-]{12,}|sk-[A-Za-z0-9_-]{16,})/gi, "[REDACTED]");
    throw new Error(`Tavily API error (${response.status}): ${errorText}`);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("Tavily API returned invalid JSON.");
  }
  if (!data || !Array.isArray(data.results)) {
    throw new Error("Tavily API response did not contain a results array.");
  }
  return data.results.slice(0, 10);
}

module.exports = {
  webSearch,
};