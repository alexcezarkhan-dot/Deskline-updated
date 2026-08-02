// DeskAi — Deskline's AI assistant, powered by Google Gemini.
// The Gemini API key lives only in Netlify's environment variables — it is
// never sent to or visible in the website's front-end code.

const SYSTEM_PROMPTS = {
  market: "You are DeskAi, the AI assistant on a trading website called Deskline. Explain price moves, trends, and general market context clearly and concisely for retail traders, using any context data given. Always make clear this is general information, not financial advice, and that exact real-time figures should be checked on the live chart. Keep responses under 150 words, plain language.",
  calculator: "You are DeskAi, a risk management assistant on a trading calculator. Explain what the given position size, risk amount, and stop-loss distance mean practically for the trader's risk management — is it conservative, reasonable, or aggressive, and why. Be honest and educational. Keep responses under 150 words. Not financial advice.",
  news: "You are DeskAi, a financial news assistant. Explain or summarize the given headline or topic in plain language for a retail trader, including why this type of news typically matters to markets. If you don't have specific real-time details, explain the general topic and its usual market relevance honestly rather than inventing specifics. Keep responses under 150 words. Not financial advice.",
  calendar: "You are DeskAi, an economic calendar assistant. Explain the given economic event: what it measures, why traders and markets watch it, and its typical historical market impact. Keep responses under 150 words, educational tone. Not financial advice.",
  general: "You are DeskAi, the helpful AI assistant built into Deskline, a financial markets website covering forex, gold, crypto, stock indices, and futures. Answer questions clearly and concisely, in plain language for retail traders of any experience level. Always make clear you provide general information, not financial advice. Keep responses under 150 words.",
};

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "DeskAi is not configured yet on this site." }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request." }) };
  }

  const { section, question, context, history } = payload;
  const systemPrompt = SYSTEM_PROMPTS[section] || SYSTEM_PROMPTS.general;

  if (!question || typeof question !== "string" || question.length > 500) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing or invalid question." }) };
  }

  let userContent = question;
  if (context) {
    userContent += `\n\n(Context data from the site, may be partial: ${JSON.stringify(context).slice(0, 1000)})`;
  }

  // Build short conversation history (last few turns) for continuity
  const contents = [];
  if (Array.isArray(history)) {
    history.slice(-6).forEach((turn) => {
      contents.push({
        role: turn.role === "assistant" ? "model" : "user",
        parts: [{ text: String(turn.text).slice(0, 500) }],
      });
    });
  }
  contents.push({ role: "user", parts: [{ text: userContent }] });

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents,
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: { maxOutputTokens: 300, temperature: 0.6 },
        }),
      }
    );

    const data = await response.json();

    if (data.error) {
      return { statusCode: 500, body: JSON.stringify({ error: data.error.message }) };
    }

    const answer =
      data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "No response generated.";

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: "DeskAi request failed." }) };
  }
};
