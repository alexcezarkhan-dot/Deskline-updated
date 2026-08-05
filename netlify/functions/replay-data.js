// DeskTerminal Replay data — fetches real historical candlestick data from
// Binance's public klines API (free, no key required) server-side, to avoid
// any client-side CORS issues. Currently supports crypto pairs only, since
// there's no free, keyless historical OHLC source for forex/metals.

exports.handler = async function (event) {
  const params = event.queryStringParameters || {};
  const symbol = (params.symbol || "").toUpperCase();
  const interval = params.interval || "1h";
  const limit = Math.min(parseInt(params.limit || "300", 10), 1000);

  if (!symbol) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing symbol." }) };
  }

  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const res = await fetch(url);
    const raw = await res.json();

    if (!Array.isArray(raw)) {
      return {
        statusCode: 502,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Symbol not supported for replay." }),
      };
    }

    const candles = raw.map((k) => ({
      time: Math.floor(k[0] / 1000), // seconds, for Lightweight Charts
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
    }));

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60",
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
