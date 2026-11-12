// DeskTerminal Scanner Snapshot Collector
// -----------------------------------------------------------------------
// Takes one real, current price snapshot per instrument and stores it in
// Supabase. Runs on a schedule (see .github/workflows) — never triggered
// by a visitor. scanner-data.js reads these stored snapshots afterward
// and computes candles/% change purely via math — no AI involved
// anywhere in this pipeline, and no dependency on any provider's
// restricted candle-specific endpoint, since this only ever needs a
// simple current price.
//
// Frankfurter (free, no key, ECB-sourced) covers the 7 real forex pairs
// completely unrestricted. Gold isn't a currency ECB publishes rates
// for, so it comes from gold-api.com's keyless live spot feed — the same
// source scanner-data.js and DeskAi already use. FCS stays as a backup.

const PAIRS = [
  { code: "EUR", base: "EUR", quote: "USD" },
  { code: "GBP", base: "GBP", quote: "USD" },
  { code: "JPY", base: "USD", quote: "JPY" },
  { code: "CHF", base: "USD", quote: "CHF" },
  { code: "CAD", base: "USD", quote: "CAD" },
  { code: "AUD", base: "AUD", quote: "USD" },
  { code: "NZD", base: "NZD", quote: "USD" },
];

async function fetchFrankfurterPrice(base, quote) {
  const res = await fetch(`https://api.frankfurter.dev/v1/latest?base=${base}&symbols=${quote}`);
  const data = await res.json();
  return data.rates ? data.rates[quote] : null;
}

async function fetchGoldSpot() {
  try {
    const res = await fetch("https://api.gold-api.com/price/XAU", {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const price = parseFloat(data?.price);
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch (err) {
    return null;
  }
}

async function fetchGoldPrice(apiKey) {
  if (!apiKey) return null;
  try {
    const res = await fetch(`https://api-v4.fcsapi.com/forex/latest?symbol=XAU/USD&access_key=${apiKey}`);
    const data = await res.json();
    if (data.status === false || !Array.isArray(data.response) || !data.response.length) return null;
    return parseFloat(data.response[0].c);
  } catch (err) {
    return null;
  }
}

exports.handler = async function () {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  const fcsKey = process.env.FCS_API_KEY;

  if (!supabaseUrl || !serviceKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "Supabase service credentials not configured." }) };
  }

  try {
    const results = await Promise.allSettled(PAIRS.map((p) => fetchFrankfurterPrice(p.base, p.quote)));
    const goldPrice = (await fetchGoldSpot()) ?? (await fetchGoldPrice(fcsKey));

    const rows = [];
    results.forEach((r, idx) => {
      if (r.status === "fulfilled" && r.value) {
        rows.push({ code: PAIRS[idx].code, price: r.value });
      }
    });
    if (goldPrice) rows.push({ code: "XAU", price: goldPrice });

    if (!rows.length) {
      return { statusCode: 502, body: JSON.stringify({ error: "Could not collect any real price snapshots this run." }) };
    }

    const headers = {
      "Content-Type": "application/json",
      "apikey": serviceKey,
      "Authorization": `Bearer ${serviceKey}`,
    };
    await fetch(`${supabaseUrl}/rest/v1/scanner_snapshots`, {
      method: "POST", headers, body: JSON.stringify(rows),
    });

    // Keep only the last 48 hours of snapshots — enough for a real 4-hour
    // and 24-hour change calculation, without growing unbounded.
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    await fetch(`${supabaseUrl}/rest/v1/scanner_snapshots?snapshot_at=lt.${encodeURIComponent(cutoff)}`, {
      method: "DELETE", headers,
    });

    return { statusCode: 200, body: JSON.stringify({ collected: rows.length }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
