// DeskTerminal Instrument Insight — generates the market summary, sentiment,
// technical overview, trend, volatility read, and FAQ answers for a given
// instrument landing page. Nothing here is hardcoded: it's built fresh, every
// request, from the real live price data the page sends in. Reuses the same
// Gemini setup as netlify/functions/deskai.js.

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Insight generation is not configured yet on this site." }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request." }) };
  }

  const { name, fullName, price, changePct, dayHigh, dayLow, recentHeadlines } = payload;
  if (!name || price === undefined) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing instrument data." }) };
  }

  const systemPrompt = `You are a financial market analyst generating a structured JSON analysis for a trading website page. Base everything strictly on the real data given to you — never invent specific numbers you weren't given. Respond with ONLY valid JSON, no markdown fences, matching exactly this shape:
{
  "summary": "2-3 sentence plain-language market summary for today, written for retail traders",
  "whyMoving": "1-2 sentences on likely drivers, grounded in the headlines given if any, otherwise general context — be clear if this is general context rather than a confirmed cause",
  "sentiment": "Bullish" | "Bearish" | "Neutral",
  "sentimentReason": "one short sentence justifying the sentiment call",
  "supportLevel": "an estimated near-term support level as a plain number or range, clearly framed as an estimate",
  "resistanceLevel": "an estimated near-term resistance level as a plain number or range, clearly framed as an estimate",
  "technicalSummary": "1-2 sentences of general technical read (trend structure, momentum) based on the price/change given",
  "trend": "Uptrend" | "Downtrend" | "Sideways",
  "volatility": "Low" | "Medium" | "High",
  "faq": [
    {"q": "Why is {name} moving today?", "a": "..."},
    {"q": "Is {name} bullish or bearish today?", "a": "..."},
    {"q": "What affects {name}?", "a": "..."},
    {"q": "What is today's high and low for {name}?", "a": "..."},
    {"q": "What is the current trend for {name}?", "a": "..."}
  ]
}
Always end summary/whyMoving/technicalSummary content with an implicit understanding this is general information, not financial advice — but don't add a disclaimer sentence inside the JSON fields themselves, the page shows that separately.`;

  const userContent = `Instrument: ${fullName || name} (${name})
Current price: ${price}
Change today: ${changePct !== undefined ? changePct + '%' : 'unknown'}
Day high: ${dayHigh || 'unknown'}
Day low: ${dayLow || 'unknown'}
Recent headlines: ${Array.isArray(recentHeadlines) && recentHeadlines.length ? recentHeadlines.slice(0,5).join(' | ') : 'none provided'}`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: userContent }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: { maxOutputTokens: 700, temperature: 0.5 },
        }),
      }
    );
    const data = await response.json();
    if (data.error) {
      return { statusCode: 500, body: JSON.stringify({ error: data.error.message }) };
    }
    let text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "{}";
    text = text.replace(/^```json\s*/i, "").replace(/```\s*$/, "");

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return { statusCode: 502, body: JSON.stringify({ error: "Could not parse insight output." }) };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
      body: JSON.stringify(parsed),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: "Insight request failed." }) };
  }
};
