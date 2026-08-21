// DeskTerminal Event History — real historical occurrences of a specific
// economic event over the past year, from Trading Economics' actual
// historical calendar data. No AI, no estimation — every row here is a real
// past release with its real actual/forecast/previous values.
//
// Cloudflare Workers pass environment variables via the `env` parameter,
// not Node's process.env — that's the one real difference from the
// Netlify version's logic, everything else is identical.

export async function handleEventHistory(request, env) {
  const url = new URL(request.url);
  const country = url.searchParams.get("country");
  const eventName = url.searchParams.get("event");

  if (!country || !eventName) {
    return new Response(JSON.stringify({ error: "Missing country or event name." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const apiKey = env.TE_API_KEY || "guest:guest";

  try {
    const today = new Date();
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(today.getFullYear() - 1);
    const d1 = oneYearAgo.toISOString().slice(0, 10);
    const d2 = today.toISOString().slice(0, 10);

    const apiUrl = `https://api.tradingeconomics.com/calendar/country/${encodeURIComponent(country)}/${d1}/${d2}?c=${encodeURIComponent(apiKey)}`;
    const response = await fetch(apiUrl);
    const data = await response.json();

    if (!Array.isArray(data)) {
      return new Response(JSON.stringify({ error: "Unexpected response from calendar provider." }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    const history = data
      .filter((e) => e.Event === eventName && e.Actual)
      .map((e) => ({
        date: e.Date,
        actual: e.Actual,
        forecast: e.Forecast,
        previous: e.Previous,
      }))
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 14);

    return new Response(JSON.stringify({ history }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Could not load event history." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
