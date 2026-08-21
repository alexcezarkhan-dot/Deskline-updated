// DeskTerminal Market Scanner data
// -----------------------------------------------------------------------
// Real intraday data from Finnhub's Forex Candles endpoint (OANDA-sourced),
// using the same FINNHUB_API_KEY already set up for News. Cloudflare
// version — identical real logic to the Netlify original, only env access
// and the request/response wrapper differ.

const PAIRS = [
  { code: "EUR", oanda: "OANDA:EUR_USD", label: "EUR/USD", quoteIsUSD: true },
  { code: "GBP", oanda: "OANDA:GBP_USD", label: "GBP/USD", quoteIsUSD: true },
  { code: "JPY", oanda: "OANDA:USD_JPY", label: "USD/JPY", quoteIsUSD: false },
  { code: "CHF", oanda: "OANDA:USD_CHF", label: "USD/CHF", quoteIsUSD: false },
  { code: "CAD", oanda: "OANDA:USD_CAD", label: "USD/CAD", quoteIsUSD: false },
  { code: "AUD", oanda: "OANDA:AUD_USD", label: "AUD/USD", quoteIsUSD: true },
  { code: "NZD", oanda: "OANDA:NZD_USD", label: "NZD/USD", quoteIsUSD: true },
];

const GOLD = { code: "XAU", oanda: "OANDA:XAU_USD", label: "Gold" };

async function fetchCandles(oandaSymbol, apiKey) {
  const to = Math.floor(Date.now() / 1000);
  const from = to - 48 * 60 * 60;
  const url = `https://finnhub.io/api/v1/forex/candle?symbol=${encodeURIComponent(oandaSymbol)}&resolution=60&from=${from}&to=${to}&token=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.s !== "ok" || !Array.isArray(data.c) || !data.c.length) return null;
  return data;
}

export async function handleScannerData(request, env) {
  const apiKey = env.FINNHUB_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Market Scanner isn't configured yet on this site." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const [results, goldCandles] = await Promise.all([
      Promise.all(PAIRS.map((p) => fetchCandles(p.oanda, apiKey))),
      fetchCandles(GOLD.oanda, apiKey),
    ]);

    const pairs = [];
    const usdChange = { USD: 0 };

    results.forEach((candles, idx) => {
      const p = PAIRS[idx];
      if (!candles) return;

      const closes = candles.c;
      const currentPrice = closes[closes.length - 1];

      const todayStartUnix = Math.floor(Date.now() / 1000 / 86400) * 86400;
      let todayOpenIdx = candles.t.findIndex((t) => t >= todayStartUnix);
      if (todayOpenIdx === -1) todayOpenIdx = 0;
      const todayOpen = candles.o[todayOpenIdx];

      const pctChange = ((currentPrice - todayOpen) / todayOpen) * 100;
      const trend = candles.t.slice(-24).map((t, i) => {
        const sliceStart = candles.t.length - 24;
        const j = sliceStart + i;
        return { o: candles.o[j], h: candles.h[j], l: candles.l[j], c: candles.c[j] };
      });

      pairs.push({
        code: p.code,
        label: p.label,
        price: currentPrice,
        pctChange: Math.round(pctChange * 1000) / 1000,
        trend,
      });

      usdChange[p.code] = p.quoteIsUSD ? pctChange : -pctChange;
    });

    if (goldCandles) {
      const closes = goldCandles.c;
      const currentPrice = closes[closes.length - 1];
      const todayStartUnix = Math.floor(Date.now() / 1000 / 86400) * 86400;
      let todayOpenIdx = goldCandles.t.findIndex((t) => t >= todayStartUnix);
      if (todayOpenIdx === -1) todayOpenIdx = 0;
      const todayOpen = goldCandles.o[todayOpenIdx];
      const pctChange = ((currentPrice - todayOpen) / todayOpen) * 100;
      const trend = goldCandles.t.slice(-24).map((t, i) => {
        const j = goldCandles.t.length - 24 + i;
        return { o: goldCandles.o[j], h: goldCandles.h[j], l: goldCandles.l[j], c: goldCandles.c[j] };
      });
      pairs.push({
        code: GOLD.code,
        label: GOLD.label,
        price: currentPrice,
        pctChange: Math.round(pctChange * 1000) / 1000,
        trend,
      });
    }

    if (!pairs.length) {
      return new Response(JSON.stringify({ error: "Could not load any scanner data right now." }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    const allCodes = Object.keys(usdChange);
    const basketAverage = allCodes.reduce((sum, c) => sum + usdChange[c], 0) / allCodes.length;
    const strength = allCodes
      .map((code) => ({ code, score: Math.round((usdChange[code] - basketAverage) * 1000) / 1000 }))
      .sort((a, b) => b.score - a.score);

    return new Response(JSON.stringify({ pairs, strength }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Could not load scanner data." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
