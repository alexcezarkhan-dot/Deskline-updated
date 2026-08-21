// DeskTerminal Replay data — fetches real historical candlestick data from
// Binance's public klines API (free, no key required) server-side, to avoid
// any client-side CORS issues. Currently supports crypto pairs only, since
// there's no free, keyless historical OHLC source for forex/metals.

export async function handleReplayData(request) {
  const url = new URL(request.url);
  const symbol = (url.searchParams.get("symbol") || "").toUpperCase();
  const interval = url.searchParams.get("interval") || "1h";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "300", 10), 1000);

  if (!symbol) {
    return new Response(JSON.stringify({ error: "Missing symbol." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const apiUrl = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const res = await fetch(apiUrl);
    const raw = await res.json();

    if (!Array.isArray(raw)) {
      return new Response(JSON.stringify({ error: "Symbol not supported for replay." }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    const candles = raw.map((k) => ({
      time: Math.floor(k[0] / 1000),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
    }));

    return new Response(JSON.stringify({ candles }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Could not load replay data." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
