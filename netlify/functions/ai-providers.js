// DeskTerminal AI Provider Fallback Chain
// -----------------------------------------------------------------------
// Tries multiple free-tier AI providers in order. If one is rate-limited,
// out of quota, or errors for any reason, it automatically falls through
// to the next — keeping DeskAi working even if a single provider's free
// tier is temporarily exhausted.
//
// Order matters: providers are tried top to bottom. Gemini stays first
// since it's the most tested. Each provider function is fully isolated —
// one failing can never throw an unhandled error that breaks the chain.
//
// Required environment variables (only providers with a key set are used —
// missing keys are skipped silently, not treated as errors):
//   GEMINI_API_KEY, GROQ_API_KEY, NVIDIA_API_KEY, MISTRAL_API_KEY, COHERE_API_KEY

async function callGemini(systemPrompt, userContent, contents) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const geminiContents = [...contents, { role: "user", parts: [{ text: userContent }] }];
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: geminiContents,
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { maxOutputTokens: 300, temperature: 0.5 },
      }),
    }
  );
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || "Gemini error");
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) throw new Error("Gemini returned no text");
  return text;
}

// Shared caller for OpenAI-compatible chat completion APIs — Groq, NVIDIA
// NIM, and Mistral all use this same request/response shape.
async function callOpenAICompatible(baseUrl, apiKey, model, systemPrompt, userContent, historyMessages) {
  if (!apiKey) return null;

  const messages = [
    { role: "system", content: systemPrompt },
    ...historyMessages,
    { role: "user", content: userContent },
  ];

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 300,
      temperature: 0.5,
    }),
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || `${baseUrl} error`);
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error(`${baseUrl} returned no text`);
  return text;
}

async function callGroq(systemPrompt, userContent, historyMessages) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  return callOpenAICompatible(
    "https://api.groq.com/openai/v1",
    apiKey,
    "llama-3.3-70b-versatile",
    systemPrompt, userContent, historyMessages
  );
}

async function callNvidia(systemPrompt, userContent, historyMessages) {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) return null;
  return callOpenAICompatible(
    "https://integrate.api.nvidia.com/v1",
    apiKey,
    "meta/llama-3.1-70b-instruct",
    systemPrompt, userContent, historyMessages
  );
}

async function callMistral(systemPrompt, userContent, historyMessages) {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) return null;
  return callOpenAICompatible(
    "https://api.mistral.ai/v1",
    apiKey,
    "mistral-small-latest",
    systemPrompt, userContent, historyMessages
  );
}

async function callCohere(systemPrompt, userContent, historyMessages) {
  const apiKey = process.env.COHERE_API_KEY;
  if (!apiKey) return null;

  // Cohere uses its own distinct request/response shape, not OpenAI-style.
  const chatHistory = historyMessages.map((m) => ({
    role: m.role === "assistant" ? "CHATBOT" : "USER",
    message: m.content,
  }));

  const response = await fetch("https://api.cohere.com/v1/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "command-r",
      preamble: systemPrompt,
      chat_history: chatHistory,
      message: userContent,
      max_tokens: 300,
      temperature: 0.5,
    }),
  });
  const data = await response.json();
  if (data.message && !data.text) throw new Error(data.message);
  const text = data.text?.trim();
  if (!text) throw new Error("Cohere returned no text");
  return text;
}

// Providers tried in this order. Gemini first (most tested), then the
// fastest/most generous free tiers, Cohere last since its free trial is
// typically the most limited.
const PROVIDER_CHAIN = [
  { name: "gemini", call: (sys, user, history, geminiContents) => callGemini(sys, user, geminiContents) },
  { name: "groq", call: (sys, user, history) => callGroq(sys, user, history) },
  { name: "nvidia", call: (sys, user, history) => callNvidia(sys, user, history) },
  { name: "mistral", call: (sys, user, history) => callMistral(sys, user, history) },
  { name: "cohere", call: (sys, user, history) => callCohere(sys, user, history) },
];

// Tries each configured provider in order. Returns { text, provider } on
// success. Throws only if every single configured provider failed — the
// caller can then show a real "unavailable" message instead of silently
// breaking.
async function callAIWithFallback(systemPrompt, userContent, history) {
  const geminiContents = [];
  (history || []).forEach((turn) => {
    geminiContents.push({
      role: turn.role === "assistant" ? "model" : "user",
      parts: [{ text: String(turn.text).slice(0, 500) }],
    });
  });

  const openAiHistory = (history || []).slice(-6).map((turn) => ({
    role: turn.role === "assistant" ? "assistant" : "user",
    content: String(turn.text).slice(0, 500),
  }));

  const errors = [];
  for (const provider of PROVIDER_CHAIN) {
    try {
      const text = await provider.call(systemPrompt, userContent, openAiHistory, geminiContents);
      if (text === null) continue; // no API key configured for this provider — skip silently
      return { text, provider: provider.name };
    } catch (err) {
      errors.push(`${provider.name}: ${err.message}`);
      // fall through to the next provider
    }
  }

  throw new Error(
    errors.length
      ? `All configured AI providers failed — ${errors.join(" | ")}`
      : "No AI provider is configured yet on this site."
  );
}

module.exports = { callAIWithFallback };
