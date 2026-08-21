// DeskTerminal Replay data — Forex & Metals
// -----------------------------------------------------------------------
// Fetches real historical candlestick data from FCS API for forex pairs and
// metals (gold/silver), server-side, using the FCS_API_KEY environment
// variable. Separate from replay-data.js (which handles crypto via Binance's
// free public API) since this needs a real API key and has real, tight
// limits (FCS's free tier: 500 requests/month, 3/minute, 300 candles/request).

const METAL_SYMBOLS = new Set(["XAUUSD", "XAGUSD", "SILVER"]);

export async function handleReplayDataForex(request, env) {
  const url = new URL(request.url);
  const symbol = (url.searchParams.get("symbol") || "").toUpperCase();
  const interval = url.searchParams.get("interval") || "1h";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "300", 10), 300);

  if (!symbol) {
    return new Response(JSON.stringify({ error: "Missing symbol." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const apiKey = env.FCS_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Forex/metals replay isn't configured yet on this site." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const fcsSymbol = symbol === "XAGUSD" ? "SILVER" : symbol;
  const isMetal = METAL_SYMBOLS.has(symbol);

  try {
    let apiUrl =
      `https://api-v4.fcsapi.com/forex/history?symbol=${encodeURIComponent(fcsSymbol)}` +
      `&period=${encodeURIComponent(interval)}&length=${limit}&is_chart=1&access_key=${apiKey}`;
    if (isMetal) apiUrl += "&type=commodity";

    const res = await fetch(apiUrl);
    const data = await res.json();

    if (data.status === false) {
      return new Response(JSON.stringify({ error: data.msg || "Symbol not supported for replay." }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    const raw = data.response;
    if (!Array.isArray(raw)) {
      return new Response(JSON.stringify({ error: "Symbol not supported for replay." }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    const candles = raw
      .map((c) => ({
        time: c[0],
        open: parseFloat(c[1]),
        high: parseFloat(c[2]),
        low: parseFloat(c[3]),
        close: parseFloat(c[4]),
      }))
      .sort((a, b) => a.time - b.time);

    return new Response(JSON.stringify({ candles }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Could not load replay data." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
