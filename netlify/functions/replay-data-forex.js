// DeskTerminal Replay data — Forex & Metals
// -----------------------------------------------------------------------
// Fetches real historical candlestick data from FCS API for forex pairs and
// metals (gold/silver), server-side, using the FCS_API_KEY environment
// variable. Separate from replay-data.js (which handles crypto via Binance's
// free public API) since this needs a real API key and has real, tight
// limits (FCS's free tier: 500 requests/month, 3/minute, 300 candles/request).
//
// Because of that tight free-tier budget, this caches aggressively (1 hour) —
// historical candles for a past period never change once published, so long
// caching is both safe and necessary here, not just a nice-to-have.

const METAL_SYMBOLS = new Set(["XAUUSD", "XAGUSD", "SILVER"]);

exports.handler = async function (event) {
  const params = event.queryStringParameters || {};
  const symbol = (params.symbol || "").toUpperCase();
  const interval = params.interval || "1h";
  const limit = Math.min(parseInt(params.limit || "300", 10), 300); // free tier hard cap

  if (!symbol) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing symbol." }) };
  }

  const apiKey = process.env.FCS_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Forex/metals replay isn't configured yet on this site." }),
    };
  }

  // FCS API's Silver ticker is "SILVER", not "XAGUSD" — normalize that one
  // real naming quirk without affecting anything else.
  const fcsSymbol = symbol === "XAGUSD" ? "SILVER" : symbol;
  const isMetal = METAL_SYMBOLS.has(symbol);

  try {
    let url =
      `https://api-v4.fcsapi.com/forex/history?symbol=${encodeURIComponent(fcsSymbol)}` +
      `&period=${encodeURIComponent(interval)}&length=${limit}&is_chart=1&access_key=${apiKey}`;
    if (isMetal) url += "&type=commodity";

    const res = await fetch(url);
    const data = await res.json();

    if (data.status === false) {
      return {
        statusCode: 502,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: data.msg || "Symbol not supported for replay." }),
      };
    }

    // is_chart=1 returns simple arrays: [timestamp, open, high, low, close, volume]
    const raw = data.response;
    if (!Array.isArray(raw)) {
      return {
        statusCode: 502,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Symbol not supported for replay." }),
      };
    }

    const candles = raw
      .map((c) => ({
        time: c[0], // already in seconds, matches Lightweight Charts' expected format
        open: parseFloat(c[1]),
        high: parseFloat(c[2]),
        low: parseFloat(c[3]),
        close: parseFloat(c[4]),
      }))
      .sort((a, b) => a.time - b.time); // FCS returns newest-first; charts need oldest-first

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        // Deliberately long — protects FCS API's tight free-tier budget
        // (500 requests/month total) since past candles never change.
        "Cache-Control": "public, max-age=3600",
      },
      body: JSON.stringify({ candles }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Could not load replay data." }),
    };
  }
};
