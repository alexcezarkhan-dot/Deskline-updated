// DeskTerminal Market Scanner data
// -----------------------------------------------------------------------
// REBUILT again, properly this time: reads our own, self-collected price
// snapshots from Supabase (see collect-scanner-snapshot.js) and computes
// everything — candle direction, % change, pip change, currency
// strength — purely via math. No AI involved anywhere in this pipeline,
// and no dependency on any provider's candle-specific endpoint, since
// this only ever needed simple current prices, collected by us, over
// time, on our own schedule.
//
// "Hollow" candle = price closed higher than it opened (bullish).
// "Filled" candle = price closed lower than it opened (bearish) —
// matches standard real trading-platform candle convention.

const CODES = ["EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD", "XAU"];
const QUOTE_IS_USD = { EUR: true, GBP: true, JPY: false, CHF: false, CAD: false, AUD: true, NZD: true, XAU: true };
const LABELS = { EUR: "EUR/USD", GBP: "GBP/USD", JPY: "USD/JPY", CHF: "USD/CHF", CAD: "USD/CAD", AUD: "AUD/USD", NZD: "NZD/USD", XAU: "Gold" };

exports.handler = async function () {
  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Market Scanner isn't configured yet on this site." }),
    };
  }

  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/scanner_snapshots?select=*&order=snapshot_at.asc&limit=2000`,
      { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } }
    );
    const rows = await res.json();

    if (!Array.isArray(rows) || !rows.length) {
      return { statusCode: 502, body: JSON.stringify({ error: "No snapshot data collected yet — check back shortly." }) };
    }

    const now = Date.now();
    const fourHoursAgo = now - 4 * 60 * 60 * 1000;

    const pairs = [];
    const usdChange = { USD: 0 };

    CODES.forEach((code) => {
      const history = rows.filter((r) => r.code === code);
      if (!history.length) return; // this instrument has no snapshots yet — skip it, don't break the whole scanner

      const current = parseFloat(history[history.length - 1].price);
      const fourHourAgoEntry = history.find((r) => new Date(r.snapshot_at).getTime() >= fourHoursAgo) || history[0];
      const fourHourAgoPrice = parseFloat(fourHourAgoEntry.price);
      const dayOpenEntry = history[0]; // oldest snapshot within our 48h retention window
      const dayOpenPrice = parseFloat(dayOpenEntry.price);

      const pctChange = ((current - dayOpenPrice) / dayOpenPrice) * 100;
      const pipChange4h = code === "XAU" ? (current - fourHourAgoPrice) : (current - fourHourAgoPrice) * (code === "JPY" ? 100 : 10000);
      const candleDirection = current >= dayOpenPrice ? "hollow" : "filled"; // hollow = bullish, filled = bearish

      pairs.push({
        code,
        label: LABELS[code],
        price: current,
        pctChange: Math.round(pctChange * 1000) / 1000,
        pipChange4h: Math.round(pipChange4h * 10) / 10,
        candleDirection,
        snapshotCount: history.length,
      });

      if (code !== "XAU") {
        usdChange[code] = QUOTE_IS_USD[code] ? pctChange : -pctChange;
      }
    });

    if (!pairs.length) {
      return { statusCode: 502, body: JSON.stringify({ error: "No snapshot data collected yet — check back shortly." }) };
    }

    const allCodes = Object.keys(usdChange);
    const basketAverage = allCodes.reduce((sum, c) => sum + usdChange[c], 0) / allCodes.length;
    const strength = allCodes
      .map((code) => ({ code, score: Math.round((usdChange[code] - basketAverage) * 1000) / 1000 }))
      .sort((a, b) => b.score - a.score);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300",
      },
      body: JSON.stringify({ pairs, strength }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: "Could not load scanner data." }) };
  }
};
