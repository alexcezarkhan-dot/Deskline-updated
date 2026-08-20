// DeskTerminal Market Scanner data
// -----------------------------------------------------------------------
// Real intraday data from Finnhub's Forex Candles endpoint (OANDA-sourced),
// using the same FINNHUB_API_KEY already set up for News. Free tier: 60
// calls/minute — 7 pairs per refresh is well within budget even refreshed
// often, unlike the much tighter FCS API used for Replay.
//
// Provides, for the 7 major forex pairs: current price, today's % change
// (vs the candle closest to midnight UTC), and a real hourly trend array
// for the sparkline — genuine OHLC-derived data, not daily-only estimates.
// Plus a Currency Strength ranking across all 8 majors, computed from the
// same real candles.

const PAIRS = [
  { code: "EUR", oanda: "OANDA:EUR_USD", label: "EUR/USD", quoteIsUSD: true },
  { code: "GBP", oanda: "OANDA:GBP_USD", label: "GBP/USD", quoteIsUSD: true },
  { code: "JPY", oanda: "OANDA:USD_JPY", label: "USD/JPY", quoteIsUSD: false },
  { code: "CHF", oanda: "OANDA:USD_CHF", label: "USD/CHF", quoteIsUSD: false },
  { code: "CAD", oanda: "OANDA:USD_CAD", label: "USD/CAD", quoteIsUSD: false },
  { code: "AUD", oanda: "OANDA:AUD_USD", label: "AUD/USD", quoteIsUSD: true },
  { code: "NZD", oanda: "OANDA:NZD_USD", label: "NZD/USD", quoteIsUSD: true },
];

// Gold, tried via the same OANDA-sourced endpoint — kept separate from the
// currency strength calculation (it's not a currency), included in the
// scanner display only if Finnhub genuinely returns real data for it.
const GOLD = { code: "XAU", oanda: "OANDA:XAU_USD", label: "Gold" };

async function fetchCandles(oandaSymbol, apiKey) {
  const to = Math.floor(Date.now() / 1000);
  const from = to - 48 * 60 * 60; // last 48 hours of hourly candles
  const url = `https://finnhub.io/api/v1/forex/candle?symbol=${encodeURIComponent(oandaSymbol)}&resolution=60&from=${from}&to=${to}&token=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.s !== "ok" || !Array.isArray(data.c) || !data.c.length) return null;
  return data; // { o:[], h:[], l:[], c:[], t:[], s:"ok" }
}

exports.handler = async function () {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Market Scanner isn't configured yet on this site." }),
    };
  }

  try {
    const [results, goldCandles] = await Promise.all([
      Promise.all(PAIRS.map((p) => fetchCandles(p.oanda, apiKey))),
      fetchCandles(GOLD.oanda, apiKey),
    ]);

    const pairs = [];
    // usdChange[code]: how much that currency moved vs USD today, positive =
    // strengthened. Derived from the same real candles, not a separate fetch.
    const usdChange = { USD: 0 };

    results.forEach((candles, idx) => {
      const p = PAIRS[idx];
      if (!candles) return; // this pair failed — skip it, don't break the whole scanner

      const closes = candles.c;
      const currentPrice = closes[closes.length - 1];

      // "Today" = candles from the most recent UTC midnight onward.
      const todayStartUnix = Math.floor(Date.now() / 1000 / 86400) * 86400;
      let todayOpenIdx = candles.t.findIndex((t) => t >= todayStartUnix);
      if (todayOpenIdx === -1) todayOpenIdx = 0;
      const todayOpen = candles.o[todayOpenIdx];

      const pctChange = ((currentPrice - todayOpen) / todayOpen) * 100;
      // Real OHLC per hour, not just close — genuine mini candlesticks are
      // possible with this data, not just a line/area sparkline.
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

      // Convert to "how much did this currency move vs USD" regardless of
      // which side of the pair USD is quoted on.
      usdChange[p.code] = p.quoteIsUSD ? pctChange : -pctChange;
    });

    // Gold, processed with the exact same real logic as the forex pairs —
    // added to the display list only if Finnhub genuinely returned data.
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
      return { statusCode: 502, body: JSON.stringify({ error: "Could not load any scanner data right now." }) };
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
        "Cache-Control": "public, max-age=300", // 5 min — Finnhub's generous limit allows frequent refresh
      },
      body: JSON.stringify({ pairs, strength }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: "Could not load scanner data." }) };
  }
};

