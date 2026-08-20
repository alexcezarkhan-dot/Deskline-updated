// DeskAi — DeskTerminal's AI assistant. Tries multiple free-tier AI
// providers in order (see ai-providers.js) so a single provider running out
// of free quota never takes DeskAi offline. API keys live only in Netlify's
// environment variables — never sent to or visible in the website's
// front-end code.

const { callAIWithFallback } = require("./ai-providers");

const SYSTEM_PROMPTS = {
  market: "You are DeskAi, the AI assistant on a trading website called DeskTerminal. Explain price moves, trends, and general market context clearly and concisely for retail traders, using any context data given. Always make clear this is general information, not financial advice, and that exact real-time figures should be checked on the live chart. Keep responses under 150 words, plain language.",
  calculator: "You are DeskAi, a risk management assistant on a trading calculator. Explain what the given position size, risk amount, and stop-loss distance mean practically for the trader's risk management — is it conservative, reasonable, or aggressive, and why. Be honest and educational. Keep responses under 150 words. Not financial advice.",
  news: "You are DeskAi, a financial news assistant. Explain or summarize the given headline or topic in plain language for a retail trader, including why this type of news typically matters to markets. If you don't have specific real-time details, explain the general topic and its usual market relevance honestly rather than inventing specifics. Keep responses under 150 words. Not financial advice.",
  calendar: "You are DeskAi, an economic calendar assistant. Explain the given economic event: what it measures, why traders and markets watch it, and its typical historical market impact. Keep responses under 150 words, educational tone. Not financial advice.",
  general: "You are DeskAi, the helpful AI assistant built into DeskTerminal, a financial markets website covering forex, gold, crypto, stock indices, and futures. Answer questions clearly and concisely, in plain language for retail traders of any experience level. Always make clear you provide general information, not financial advice. Keep responses under 150 words.",
};

// Sections that return structured JSON fields instead of one free-text
// answer — used by the calendar's per-event detail panel (the "folder icon"
// breakdown: Measures, Usual Effect, Frequency, Why Traders Care). Written
// fresh by the AI each time in DeskTerminal's own words — not copied from
// any other site's editorial content.
const STRUCTURED_PROMPTS = {
  "calendar-detail":
    'You are an economic calendar reference assistant. For the given economic indicator, respond with ONLY valid JSON (no markdown fences), in your own original wording, in exactly this shape: {"measures": "1 sentence on what this indicator actually measures", "usualEffect": "1 short sentence on what a higher-than-forecast actual reading typically means for the currency — be correct about indicators where the relationship is inverted, e.g. a lower unemployment rate is typically positive for a currency, not negative", "frequency": "how often this is typically released, e.g. Released monthly, on the first or second Friday after the month ends", "whyTradersCare": "1-2 sentences on why this specific indicator matters to traders"}. Keep every field concise. Do not fabricate specific dates or numbers you were not given.',
  "news-impact":
    'You are a financial news triage assistant. You will be given a numbered list of headlines. For EACH headline, determine: (1) is it HIGH impact (would meaningfully move forex, gold, crypto, or major stock indices — e.g. central bank rate decisions, major geopolitical/war developments, surprise inflation or jobs data, market-wide crashes or shocks) or LOW impact (routine market commentary, minor company news, general analysis); (2) IF the headline clearly relates to a specific major currency (USD, EUR, GBP, JPY, AUD, CAD, CHF, NZD) or Gold, name it and say whether the news would typically STRENGTHEN or WEAKEN it — be honest and conservative: if the headline is too general, ambiguous, or does not clearly relate to one specific currency, leave currency and effect as null rather than guessing. Respond with ONLY valid JSON, no markdown fences, in exactly this shape: {"results": [{"index": 0, "highImpact": true, "currency": "USD", "effect": "strengthen"}, {"index": 1, "highImpact": false, "currency": null, "effect": null}]} — one entry per headline, in the same order given, using the 0-based index shown next to each headline. "effect" must be exactly "strengthen", "weaken", or null.',
};

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request." }) };
  }

  const { section, question, context, history } = payload;
  const isStructured = Object.prototype.hasOwnProperty.call(STRUCTURED_PROMPTS, section);
  const systemPrompt = isStructured
    ? STRUCTURED_PROMPTS[section]
    : SYSTEM_PROMPTS[section] || SYSTEM_PROMPTS.general;

  if (!question || typeof question !== "string" || question.length > 500) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing or invalid question." }) };
  }

  let userContent = question;
  if (context) {
    userContent += `\n\n(Context data from the site, may be partial: ${JSON.stringify(context).slice(0, 1000)})`;
  }

  try {
    const { text: rawText, provider } = await callAIWithFallback(systemPrompt, userContent, history);

    if (isStructured) {
      let cleaned = rawText.replace(/^```json\s*/i, "").replace(/```\s*$/, "");
      try {
        const parsed = JSON.parse(cleaned);
        return {
          statusCode: 200,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed),
        };
      } catch (e) {
        return {
          statusCode: 502,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "Could not parse structured response." }),
        };
      }
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer: rawText || "No response generated.", provider }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || "DeskAi request failed." }) };
  }
};

