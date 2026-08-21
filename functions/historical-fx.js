// DeskTerminal Forex Historical — real historical performance (% change) for
// a forex pair across standard lookback periods, using Frankfurter's free ECB
// exchange rate data (no key, ECB-sourced, daily rates back to 1999).
// Note: ECB data has no weekend/holiday entries, so dates are nudged back a
// few days when needed to land on the nearest published rate.
//
// Cloudflare Pages Functions version — same real logic and data source as
// the original Netlify function, only the request/response wrapper differs
// (Cloudflare uses standard Web API Request/Response objects, not Netlify's
// event/statusCode object shape).

function isoDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

const PERIODS = [
  { key: "1D", days: 1 },
  { key: "1W", days: 7 },
  { key: "1M", days: 30 },
  { key: "3M", days: 90 },
  { key: "6M", days: 182 },
  { key: "1Y", days: 365 },
  { key: "5Y", days: 365 * 5 },
  { key: "Max", days: 365 * 25 }, // Frankfurter's practical history depth
];

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const base = (url.searchParams.get("base") || "").toUpperCase();
  const quote = (url.searchParams.get("quote") || "").toUpperCase();

  if (!base || !quote) {
    return new Response(JSON.stringify({ error: "Missing base/quote currency." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const currentRes = await fetch(`https://api.frankfurter.dev/v1/latest?base=${base}&symbols=${quote}`);
    const currentData = await currentRes.json();
    const currentRate = currentData.rates?.[quote];
    if (!currentRate) {
      return new Response(JSON.stringify({ error: "Currency pair not supported." }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    const results = await Promise.allSettled(
      PERIODS.map(async (p) => {
        // Try the exact date, then step back a few days to find a published rate
        // (ECB doesn't publish for weekends/holidays).
        for (let attempt = 0; attempt < 5; attempt++) {
          const date = isoDaysAgo(p.days + attempt);
          const res = await fetch(`https://api.frankfurter.dev/v1/${date}?base=${base}&symbols=${quote}`);
          const data = await res.json();
          const rate = data.rates?.[quote];
          if (rate) {
            const pctChange = ((currentRate - rate) / rate) * 100;
            return { period: p.key, pctChange: Math.round(pctChange * 100) / 100 };
          }
        }
        return { period: p.key, pctChange: null };
      })
    );

    const performance = {};
    results.forEach((r, i) => {
      const key = PERIODS[i].key;
      performance[key] = r.status === "fulfilled" ? r.value.pctChange : null;
    });

    return new Response(JSON.stringify({ currentRate, performance }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Could not load historical data." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
