// DeskTerminal AI Provider Fallback Chain — Cloudflare version
// -----------------------------------------------------------------------
// Same real 5-provider fallback logic as the Netlify original, including
// the 6-model NVIDIA rotation. The one structural difference: Cloudflare
// Workers pass environment variables via an `env` object parameter, not
// Node's process.env — so every provider function here accepts `env`
// explicitly and reads keys from it, instead of reaching for a global.
//
// Required environment variables (only providers with a key set are used —
// missing keys are skipped silently, not treated as errors):
//   GEMINI_API_KEY, GROQ_API_KEY, NVIDIA_API_KEY, MISTRAL_API_KEY, COHERE_API_KEY

async function callGemini(env, systemPrompt, userContent, contents) {
  const apiKey = env.GEMINI_API_KEY;
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

async function callGroq(env, systemPrompt, userContent, historyMessages) {
  const apiKey = env.GROQ_API_KEY;
  if (!apiKey) return null;
  return callOpenAICompatible(
    "https://api.groq.com/openai/v1",
    apiKey,
    "llama-3.3-70b-versatile",
    systemPrompt, userContent, historyMessages
  );
}

// NVIDIA's free tier hosts many models, each with its own separate ~40
// requests/minute limit. Rather than one model, we rotate through several —
// so if one is being hit hard, the others still have room. Same
// time-based rotation approach as the Netlify version (no persistent
// storage needed) — Cloudflare Workers don't share memory between
// invocations any more than Netlify Functions do.
const NVIDIA_MODELS = [
  "nvidia/nemotron-3-ultra-550b-a55b",
  "deepseek-ai/deepseek-v3.1-terminus",
  "zhipuai/glm-5.1",
  "minimaxai/minimax-m2.5",
  "moonshotai/kimi-k2.5",
  "openai/gpt-oss-120b",
];

async function callNvidia(env, systemPrompt, userContent, historyMessages) {
  const apiKey = env.NVIDIA_API_KEY;
  if (!apiKey) return null;

  const startIndex = Math.floor(Date.now() / 60000) % NVIDIA_MODELS.length;
  const rotationOrder = [...NVIDIA_MODELS.slice(startIndex), ...NVIDIA_MODELS.slice(0, startIndex)];

  let lastError = null;
  for (const model of rotationOrder) {
    try {
      const text = await callOpenAICompatible(
        "https://integrate.api.nvidia.com/v1",
        apiKey,
        model,
        systemPrompt, userContent, historyMessages
      );
      if (text) return text;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("All NVIDIA models in rotation failed");
}

async function callMistral(env, systemPrompt, userContent, historyMessages) {
  const apiKey = env.MISTRAL_API_KEY;
  if (!apiKey) return null;
  return callOpenAICompatible(
    "https://api.mistral.ai/v1",
    apiKey,
    "mistral-small-latest",
    systemPrompt, userContent, historyMessages
  );
}

async function callCohere(env, systemPrompt, userContent, historyMessages) {
  const apiKey = env.COHERE_API_KEY;
  if (!apiKey) return null;

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

const PROVIDER_CHAIN = [
  { name: "gemini", call: (env, sys, user, history, geminiContents) => callGemini(env, sys, user, geminiContents) },
  { name: "groq", call: (env, sys, user, history) => callGroq(env, sys, user, history) },
  { name: "nvidia", call: (env, sys, user, history) => callNvidia(env, sys, user, history) },
  { name: "mistral", call: (env, sys, user, history) => callMistral(env, sys, user, history) },
  { name: "cohere", call: (env, sys, user, history) => callCohere(env, sys, user, history) },
];

// Tries each configured provider in order. Returns { text, provider } on
// success. Throws only if every single configured provider failed.
export async function callAIWithFallback(env, systemPrompt, userContent, history) {
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
      const text = await provider.call(env, systemPrompt, userContent, openAiHistory, geminiContents);
      if (text === null) continue;
      return { text, provider: provider.name };
    } catch (err) {
      errors.push(`${provider.name}: ${err.message}`);
    }
  }

  throw new Error(
    errors.length
      ? `All configured AI providers failed — ${errors.join(" | ")}`
      : "No AI provider is configured yet on this site."
  );
}
