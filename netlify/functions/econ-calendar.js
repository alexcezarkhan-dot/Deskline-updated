// DeskTerminal Economic Calendar — the function visitors' browsers call.
// -----------------------------------------------------------------------
// This no longer hits Trading Economics directly — cache-calendar.js does
// that, on a schedule. This just reads whatever's already cached in
// Supabase, so every visitor gets the same shared, pre-fetched data
// instantly, and Trading Economics is never called per-visitor.
//
// The one real exception: the fast-poll countdown feature on the
// Calendar page (checking every 10 seconds right before an event
// releases) deliberately calls this same function — reading the cache
// is still fast and cheap even at that frequency, since it's a database
// read, not a live external API call each time.

exports.handler = async function (event) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const wantsLive = event.queryStringParameters && event.queryStringParameters.live === "true";

  // The fast-poll countdown feature (checking every 10 seconds right
  // before a high-importance event releases) explicitly requests live
  // data here, bypassing the cache — this is the one legitimate case
  // where reading a cache that might be several minutes stale would
  // defeat the entire point of fast-polling. Normal browsing never sets
  // this, and uses the cheap, shared cache below instead.
  if (wantsLive) {
    try {
      const apiKey = process.env.TE_API_KEY || "guest:guest";
      const url = `https://api.tradingeconomics.com/calendar?c=${encodeURIComponent(apiKey)}&f=json`;
      const response = await fetch(url);
      const data = await response.json();
      if (!Array.isArray(data)) {
        return { statusCode: 502, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Unexpected response from calendar provider." }) };
      }
      const events = data.map((e) => ({
        date: e.Date, country: e.Country, currency: e.Currency, event: e.Event,
        category: e.Category, actual: e.Actual, forecast: e.Forecast, previous: e.Previous,
        importance: e.Importance, source: e.Source, sourceUrl: e.SourceURL, reference: e.Reference,
      }));
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        body: JSON.stringify({ events }),
      };
    } catch (err) {
      return { statusCode: 500, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Could not load live calendar data." }) };
    }
  }

  if (!supabaseUrl || !anonKey) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Calendar cache isn't configured yet on this site." }),
    };
  }

  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/cached_calendar_events?select=*&order=event_date.asc&limit=500`,
      { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } }
    );
    const rows = await res.json();

    if (!Array.isArray(rows)) {
      return {
        statusCode: 502,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Unexpected response from calendar cache." }),
      };
    }

    const events = rows.map((r) => ({
      date: r.event_date,
      country: r.country,
      currency: r.currency,
      event: r.event,
      category: r.category,
      actual: r.actual,
      forecast: r.forecast,
      previous: r.previous,
      importance: r.importance,
      source: r.source,
      sourceUrl: r.source_url,
      reference: r.reference,
    }));

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60",
      },
      body: JSON.stringify({ events }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Could not load calendar data." }),
    };
  }
};
