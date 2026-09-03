// DeskTerminal Calendar Bulk Loader — 90-day one-time pull.
// -----------------------------------------------------------------------
// The real, smart idea behind this: Trading Economics' guest access has
// a small TOTAL budget, not a generous recurring one — we were wasting
// it on repeated 5-minute polls of mostly-unchanged data. Event dates,
// names, and forecasts are known well in advance anyway, so one large,
// single pull covering 90 days captures almost everything useful in one
// efficient shot, instead of many wasteful overlapping ones.
//
// This is meant to be triggered manually (or very rarely — like once a
// week) via workflow_dispatch, NOT on a frequent schedule. The daily
// "actuals" checker (see check-todays-actuals.js) handles the small,
// ongoing job of filling in results as events actually happen.

exports.handler = async function () {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  const apiKey = process.env.TE_API_KEY || "guest:guest";

  if (!supabaseUrl || !serviceKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "Supabase service credentials not configured." }) };
  }

  try {
    const today = new Date();
    const in90Days = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    const d1 = today.toISOString().slice(0, 10);
    const d2 = in90Days.toISOString().slice(0, 10);

    const url = `https://api.tradingeconomics.com/calendar?d1=${d1}&d2=${d2}&c=${encodeURIComponent(apiKey)}&f=json`;
    const response = await fetch(url);
    const data = await response.json();

    if (!Array.isArray(data)) {
      return { statusCode: 502, body: JSON.stringify({ error: "Unexpected response from calendar provider.", raw: data }) };
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
        source: "Trading Economics",
        source_url: e.SourceURL || null,
        reference: e.Reference || null,
      }));

    const headers = {
      "Content-Type": "application/json",
      "apikey": serviceKey,
      "Authorization": `Bearer ${serviceKey}`,
      "Prefer": "resolution=merge-duplicates",
    };

    // Batch the insert — 90 days of global events can genuinely be a
    // large number of rows, safer to write in smaller chunks than one
    // massive request.
    const BATCH_SIZE = 200;
    let written = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      await fetch(`${supabaseUrl}/rest/v1/cached_calendar_events?on_conflict=event_date,event,currency`, {
        method: "POST", headers, body: JSON.stringify(batch),
      });
      written += batch.length;
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ fetched: rows.length, written, range: `${d1} to ${d2}` }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
