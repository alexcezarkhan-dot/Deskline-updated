// DeskTerminal Forex Historical — real historical performance (% change) for
// a forex pair across standard lookback periods, using Frankfurter's free ECB
// exchange rate data (no key, ECB-sourced, daily rates back to 1999).
// Note: ECB data has no weekend/holiday entries, so dates are nudged back a
// few days when needed to land on the nearest published rate.

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

exports.handler = async function (event) {
  const params = (event && event.queryStringParameters) || {};
  const base = (params.base || "").toUpperCase();
  const quote = (params.quote || "").toUpperCase();

  if (!base || !quote) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing base/quote currency." }) };
  }

  try {
    const currentRes = await fetch(`https://api.frankfurter.dev/v1/latest?base=${base}&symbols=${quote}`);
    const currentData = await currentRes.json();
    const currentRate = currentData.rates?.[quote];
    if (!currentRate) {
      return { statusCode: 502, body: JSON.stringify({ error: "Currency pair not supported." }) };
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

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" },
      body: JSON.stringify({ currentRate, performance }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: "Could not load historical data." }) };
  }
};
