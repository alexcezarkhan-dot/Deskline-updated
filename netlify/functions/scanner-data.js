// DeskTerminal Market Scanner data
// -----------------------------------------------------------------------
// Two real-data modes, in order of preference:
//
// 1. "6h" mode — real intraday candles from Yahoo Finance's public chart
//    API (30-min OHLC, no API key, no cost). This is what makes the
//    homepage chart behave like an industry terminal: real wicks, real
//    bodies, real 6-hour pip/% change. Gold uses COMEX front-month futures
//    (GC=F) — the standard live stand-in for spot, since Yahoo delisted
//    its spot gold ticker.
//
// 2. "48h" fallback — our own self-collected price snapshots from Supabase
//    (see collect-scanner-snapshot.js), one candle per snapshot step over
//    the full 48h retention window. Used whenever Yahoo is unreachable or
//    incomplete, so the scanner never shows fake or estimated figures.
//
// Hollow candle = closed higher than it opened (bullish); filled = closed
// lower (bearish) — standard trading-platform candle convention.
// Currency strength is computed purely via math from the same changes:
// each currency's % move vs USD, minus the basket average. No AI anywhere
// in this pipeline.

const CODES = ["XAU", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD"];
const QUOTE_IS_USD = { EUR: true, GBP: true, JPY: false, CHF: false, CAD: false, AUD: true, NZD: true, XAU: true };
const LABELS = { EUR: "EUR/USD", GBP: "GBP/USD", JPY: "USD/JPY", CHF: "USD/CHF", CAD: "USD/CAD", AUD: "AUD/USD", NZD: "NZD/USD", XAU: "Gold" };
const NAMES = { USD: "US Dollar", EUR: "Euro", GBP: "British Pound", JPY: "Japanese Yen", CHF: "Swiss Franc", CAD: "Canadian Dollar", AUD: "Australian Dollar", NZD: "New Zealand Dollar" };
const YAHOO_SYMBOLS = { EUR: "EURUSD=X", GBP: "GBPUSD=X", JPY: "JPY=X", CHF: "CHF=X", CAD: "CAD=X", AUD: "AUDUSD=X", NZD: "NZDUSD=X", XAU: "GC=F" };

const INTRADAY_CANDLES = 12; // 12 x 30min = the last 6 hours, Forex Factory style
const WINDOW_MS = 48 * 60 * 60 * 1000; // snapshot fallback retention window
const MAX_CANDLES = 8; // snapshot fallback chart density

function pipSize(code) {
  return code === "JPY" ? 100 : 10000;
}

function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
    },
    body: JSON.stringify(payload),
  };
}

async function fetchIntradayCandles(code) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(YAHOO_SYMBOLS[code])}?range=1d&interval=30m`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
  });
  if (!res.ok) throw new Error(`yahoo responded ${res.status}`);
  const j = await res.json();
  const r0 = j?.chart?.result?.[0];
  if (!r0) throw new Error("yahoo: empty chart result");
  const q = r0.indicators?.quote?.[0] || {};
  const candles = [];
  const ts = r0.timestamp || [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
    if (![o, h, l, c].every((n) => Number.isFinite(n))) continue;
    candles.push({ o, h, l, c });
  }
  if (candles.length < INTRADAY_CANDLES + 1) throw new Error("yahoo: not enough candles");
  const ref = candles[candles.length - INTRADAY_CANDLES - 1].c; // close ~6h ago
  const recent = candles.slice(-INTRADAY_CANDLES);
  const price = Number.isFinite(r0.meta?.regularMarketPrice)
    ? r0.meta.regularMarketPrice
    : recent[recent.length - 1].c;
  const change = price - ref;
  return {
    price,
    candles: recent,
    pipChange: code === "XAU" ? change : change * pipSize(code),
    pctChange: (change / ref) * 100,
  };
}

function buildStrength(usdChange) {
  const allCodes = Object.keys(usdChange);
  const basketAverage = allCodes.reduce((sum, c) => sum + usdChange[c], 0) / allCodes.length;
  return allCodes
    .map((code) => ({
      code,
      name: NAMES[code],
      score: Math.round((usdChange[code] - basketAverage) * 1000) / 1000,
      pct: Math.round(usdChange[code] * 1000) / 1000,
    }))
    .sort((a, b) => b.score - a.score);
}

function buildFromSnapshots(rows) {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  const pairs = [];
  const usdChange = { USD: 0 };

  CODES.forEach((code) => {
    const history = rows.filter((r) => r.code === code);
    if (!history.length) return; // this instrument has no snapshots yet — skip it, don't break the whole scanner

    const current = parseFloat(history[history.length - 1].price);
    const inWindow = history.filter((r) => new Date(r.snapshot_at).getTime() >= windowStart);
    const windowEntries = inWindow.length ? inWindow : history;
    const windowOpenPrice = parseFloat(windowEntries[0].price);

    // One candle per snapshot step: open = previous snapshot, close =
    // current. Degrades gracefully if collector runs miss.
    const candles = [];
    for (let i = 1; i < windowEntries.length; i++) {
      const o = parseFloat(windowEntries[i - 1].price);
      const c = parseFloat(windowEntries[i].price);
      candles.push({ o, c, h: Math.max(o, c), l: Math.min(o, c) });
    }

    const pctChange = ((current - windowOpenPrice) / windowOpenPrice) * 100;
    const pipChange = code === "XAU" ? (current - windowOpenPrice) : (current - windowOpenPrice) * pipSize(code);

    pairs.push({
      code,
      label: LABELS[code],
      price: current,
      pctChange: Math.round(pctChange * 1000) / 1000,
      pipChange: Math.round(pipChange * 10) / 10,
      candles: candles.slice(-MAX_CANDLES),
      snapshotCount: history.length,
    });

    if (code !== "XAU") {
      usdChange[code] = QUOTE_IS_USD[code] ? pctChange : -pctChange;
    }
  });

  return { pairs, strength: buildStrength(usdChange) };
}

exports.handler = async function () {
  const intradayResults = await Promise.allSettled(CODES.map((code) => fetchIntradayCandles(code)));
  const intraday = {};
  intradayResults.forEach((r, i) => {
    if (r.status === "fulfilled") intraday[CODES[i]] = r.value;
  });

  if (CODES.every((code) => intraday[code])) {
    const usdChange = { USD: 0 };
    const pairs = CODES.map((code) => {
      const s = intraday[code];
      if (code !== "XAU") usdChange[code] = QUOTE_IS_USD[code] ? s.pctChange : -s.pctChange;
      return {
        code,
        label: LABELS[code],
        price: s.price,
        pctChange: Math.round(s.pctChange * 1000) / 1000,
        pipChange: Math.round(s.pipChange * 10) / 10,
        candles: s.candles,
      };
    });
    return json(200, { pairs, strength: buildStrength(usdChange), window: "6h" });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return json(500, { error: "Market Scanner isn't configured yet on this site." });
  }

  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/scanner_snapshots?select=*&order=snapshot_at.asc&limit=2000`,
      { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } }
    );
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) {
      return json(502, { error: "No snapshot data collected yet — check back shortly." });
    }
    const built = buildFromSnapshots(rows);
    if (!built.pairs.length) {
      return json(502, { error: "No snapshot data collected yet — check back shortly." });
    }
    return json(200, { ...built, window: "48h" });
  } catch (err) {
    return json(500, { error: "Could not load scanner data." });
  }
};
