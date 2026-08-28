// DeskTerminal Calendar Cache — the ONE function that actually calls
// Trading Economics live.
// -----------------------------------------------------------------------
// Same real fix as cache-news.js: runs on a schedule, never triggered by
// a visitor's browser. Fetches the live calendar once, writes it into
// Supabase, and deletes events more than 2 days old. econ-calendar.js
// and render-calendar.js both read from this shared cache instead of
// hitting Trading Economics on every single request — cutting real
// Netlify function compute and bandwidth on every Calendar page view.

exports.handler = async function () {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  const apiKey = process.env.TE_API_KEY || "guest:guest";

  if (!supabaseUrl || !serviceKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "Supabase service credentials not configured." }) };
  }

  try {
    const url = `https://api.tradingeconomics.com/calendar?c=${encodeURIComponent(apiKey)}&f=json`;
    const response = await fetch(url);
    const data = await response.json();

    if (!Array.isArray(data)) {
      return { statusCode: 502, body: JSON.stringify({ error: "Unexpected response from calendar provider." }) };
    }

    const rows = data
      .filter((e) => e.Date && e.Event)
      .map((e) => ({
        event_date: e.Date,
        country: e.Country || null,
        currency: e.Currency || null,
        event: e.Event,
        category: e.Category || null,
        actual: e.Actual || null,
        forecast: e.Forecast || null,
        previous: e.Previous || null,
        importance: typeof e.Importance === "number" ? e.Importance : null,
        source: e.Source || null,
        source_url: e.SourceURL || null,
        reference: e.Reference || null,
      }));

    const headers = {
      "Content-Type": "application/json",
      "apikey": serviceKey,
      "Authorization": `Bearer ${serviceKey}`,
      "Prefer": "resolution=merge-duplicates",
    };

    if (rows.length) {
      await fetch(`${supabaseUrl}/rest/v1/cached_calendar_events?on_conflict=event_date,event,currency`, {
        method: "POST", headers, body: JSON.stringify(rows),
      });
    }

    // Real 2-day expiry, same pattern as News — keeps recent history
    // (for the past-year lookup feature) without growing unbounded.
    // Note: the event-history feature reads its own year of data
    // separately via event-history.js, not from this short-lived cache.
    const cutoff = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    await fetch(`${supabaseUrl}/rest/v1/cached_calendar_events?fetched_at=lt.${encodeURIComponent(cutoff)}`, {
      method: "DELETE", headers,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ fetched: rows.length }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
