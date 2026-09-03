// DeskTerminal Calendar — Today's Actuals Checker
// -----------------------------------------------------------------------
// The small, ongoing half of the real hybrid strategy: bulk-load-calendar.js
// handles the big, one-time 90-day pull (dates/names/forecasts, known
// well in advance). This handles the small, recurring job of checking
// whether TODAY's events have real "actual" results posted yet —
// genuinely small in scope (a handful of events, not 90 days of them),
// so it can run more frequently without meaningfully touching Trading
// Economics' limited guest budget.

exports.handler = async function () {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  const apiKey = process.env.TE_API_KEY || "guest:guest";

  if (!supabaseUrl || !serviceKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "Supabase service credentials not configured." }) };
  }

  try {
    const today = new Date().toISOString().slice(0, 10);
    const url = `https://api.tradingeconomics.com/calendar?d1=${today}&d2=${today}&c=${encodeURIComponent(apiKey)}&f=json`;
    const response = await fetch(url);
    const data = await response.json();

    if (!Array.isArray(data)) {
      return { statusCode: 502, body: JSON.stringify({ error: "Unexpected response from calendar provider.", raw: data }) };
    }

    const headers = {
      "Content-Type": "application/json",
      "apikey": serviceKey,
      "Authorization": `Bearer ${serviceKey}`,
    };

    // Only update rows where a real "Actual" value now exists — this is
    // genuinely just filling in results as they happen, not re-writing
    // events that were already fully captured by the bulk loader.
    let updated = 0;
    for (const e of data) {
      if (!e.Date || !e.Event || !e.Actual) continue;
      await fetch(
        `${supabaseUrl}/rest/v1/cached_calendar_events?event_date=eq.${encodeURIComponent(e.Date)}&event=eq.${encodeURIComponent(e.Event)}`,
        { method: "PATCH", headers, body: JSON.stringify({ actual: e.Actual }) }
      );
      updated++;
    }

    return { statusCode: 200, body: JSON.stringify({ checked: data.length, updated }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
