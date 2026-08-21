// DeskTerminal Economic Calendar proxy
// Fetches real calendar data from Trading Economics' public API server-side
// (avoids browser CORS restrictions). Uses the public "guest" tier by default;
// set TE_API_KEY in Cloudflare's environment variables to use a real
// developer key for fuller access once you have one.

export async function handleEconCalendar(request, env) {
  const apiKey = env.TE_API_KEY || "guest:guest";

  try {
    const url = `https://api.tradingeconomics.com/calendar?c=${encodeURIComponent(apiKey)}&f=json`;
    const response = await fetch(url);
    const data = await response.json();

    if (!Array.isArray(data)) {
      return new Response(JSON.stringify({ error: "Unexpected response from calendar provider." }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    const events = data.map((e) => ({
      date: e.Date,
      country: e.Country,
      currency: e.Currency,
      event: e.Event,
      category: e.Category,
      actual: e.Actual,
      forecast: e.Forecast,
      previous: e.Previous,
      importance: e.Importance,
      source: e.Source,
      sourceUrl: e.SourceURL,
      reference: e.Reference,
    }));

    return new Response(JSON.stringify({ events }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=180" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Could not load calendar data." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
