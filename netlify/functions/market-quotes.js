// DeskTerminal market quotes — indicative live quotes for the Market terminal.
// Yahoo Finance's public spark endpoint (batched, no key) covers FX, indices,
// stocks, futures and crypto; gold/silver spot come from gold-api.com (already
// used across the site) and are anchored to the futures OHLC so change, high
// and low stay consistent with the spot level.

const YAHOO_MAP = {
  "FX:EURUSD": "EURUSD=X",
  "FX:GBPUSD": "GBPUSD=X",
  "FX:USDJPY": "JPY=X",
  "FX:AUDUSD": "AUDUSD=X",
  "FX:USDCAD": "CAD=X",
  "FX:USDCHF": "CHF=X",
  "FX:NZDUSD": "NZDUSD=X",
  "FX:EURGBP": "EURGBP=X",
  "FX:EURJPY": "EURJPY=X",
  "FX:GBPJPY": "GBPJPY=X",
  "FX_IDC:USDPKR": "PKR=X",
  "FX_IDC:USDINR": "INR=X",
  // Also used by the dedicated /forex instrument pages.
  "FX:USDHKD": "HKD=X",
  "FX:USDSGD": "SGD=X",
  "FX_IDC:USDCNH": "CNH=X",

  "TVC:PLATINUM": "PL=F",
  "TVC:PALLADIUM": "PA=F",
  "COMEX:GC1!": "GC=F",
  "COMEX:SI1!": "SI=F",

  "BITSTAMP:BTCUSD": "BTC-USD",
  "BITSTAMP:ETHUSD": "ETH-USD",
  "BINANCE:SOLUSDT": "SOL-USD",
  "BINANCE:XRPUSDT": "XRP-USD",
  "BINANCE:BNBUSDT": "BNB-USD",
  "BINANCE:DOGEUSDT": "DOGE-USD",
  "BINANCE:ADAUSDT": "ADA-USD",
  "BINANCE:LTCUSDT": "LTC-USD",
  "BINANCE:DOTUSDT": "DOT-USD",

  "FOREXCOM:SPXUSD": "^GSPC",
  "FOREXCOM:NSXUSD": "^NDX",
  "FOREXCOM:DJI": "^DJI",
  "TVC:UKX": "^FTSE",
  "TVC:DAX": "^GDAXI",
  "TVC:NI225": "^N225",
  "TVC:CAC40": "^FCHI",
  "HSI:HSI": "^HSI",

  "NASDAQ:AAPL": "AAPL",
  "NASDAQ:MSFT": "MSFT",
  "NASDAQ:GOOGL": "GOOGL",
  "NASDAQ:AMZN": "AMZN",
  "NASDAQ:TSLA": "TSLA",
  "NASDAQ:META": "META",
  "NASDAQ:NVDA": "NVDA",
  "NASDAQ:NFLX": "NFLX",
  "NYSE:JPM": "JPM",
  "NYSE:V": "V",

  "TVC:USOIL": "CL=F",
  "TVC:UKOIL": "BZ=F",
  "TVC:NATURALGAS": "NG=F",
  "CBOT:ZC1!": "ZC=F",
  "CBOT:ZW1!": "ZW=F",
  "COMEX:HG1!": "HG=F",
};

const SPOT_MAP = {
  "OANDA:XAUUSD": { code: "XAU", futures: "GC=F" },
  "OANDA:XAGUSD": { code: "XAG", futures: "SI=F" },
};

const BATCH_SIZE = 20;
const CACHE_TTL = 60 * 1000;
let cache = null;

function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=30, s-maxage=60",
    },
    body: JSON.stringify(payload),
  };
}

async function getJson(url, timeoutMs) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  return res.json();
}

async function fetchSparkBatch(symbols) {
  const url =
    "https://query1.finance.yahoo.com/v7/finance/spark?symbols=" +
    encodeURIComponent(symbols.join(",")) +
    "&range=1d&interval=1d";
  const data = await getJson(url, 7000);
  const out = {};
  (data?.spark?.result || []).forEach((row) => {
    const meta = row?.response?.[0]?.meta;
    if (meta && Number.isFinite(meta.regularMarketPrice)) out[row.symbol] = meta;
  });
  return out;
}

function toQuote(meta) {
  if (!meta || !Number.isFinite(meta.regularMarketPrice)) return null;
  const price = meta.regularMarketPrice;
  const prev = Number.isFinite(meta.chartPreviousClose) ? meta.chartPreviousClose : null;
  let changePct = Number.isFinite(meta.regularMarketChangePercent)
    ? meta.regularMarketChangePercent
    : prev
      ? ((price - prev) / prev) * 100
      : null;
  return {
    price,
    prevClose: prev,
    changePct: changePct === null ? null : Math.round(changePct * 100) / 100,
    high: Number.isFinite(meta.regularMarketDayHigh) ? meta.regularMarketDayHigh : null,
    low: Number.isFinite(meta.regularMarketDayLow) ? meta.regularMarketDayLow : null,
    time: Number.isFinite(meta.regularMarketTime) ? meta.regularMarketTime : null,
  };
}

exports.handler = async function () {
  if (cache && Date.now() - cache.at < CACHE_TTL) {
    return json(200, cache.payload);
  }

  const yahooSymbols = [...new Set(Object.values(YAHOO_MAP))];
  const batches = [];
  for (let i = 0; i < yahooSymbols.length; i += BATCH_SIZE) {
    batches.push(yahooSymbols.slice(i, i + BATCH_SIZE));
  }

  const [metaResults, spotResults] = await Promise.all([
    Promise.allSettled(batches.map(fetchSparkBatch)),
    Promise.allSettled(
      Object.values(SPOT_MAP).map((s) =>
        getJson(`https://api.gold-api.com/price/${s.code}`, 5000)
      )
    ),
  ]);

  const metas = {};
  metaResults.forEach((r) => {
    if (r.status === "fulfilled") Object.assign(metas, r.value);
  });

  const quotes = {};
  Object.entries(YAHOO_MAP).forEach(([tvSymbol, yahooSymbol]) => {
    const quote = toQuote(metas[yahooSymbol]);
    if (quote) quotes[tvSymbol] = quote;
  });

  // Spot metals: real spot price with the futures series' OHLC shifted by the
  // spot-futures basis, the same approach scanner-data.js uses for gold.
  Object.entries(SPOT_MAP).forEach(([tvSymbol, cfg], i) => {
    const spotRes = spotResults[i];
    const spot = spotRes.status === "fulfilled" ? parseFloat(spotRes.value?.price) : null;
    if (!Number.isFinite(spot) || spot <= 0) return;

    const future = metas[cfg.futures];
    const futurePrice = future && Number.isFinite(future.regularMarketPrice) ? future.regularMarketPrice : null;
    const basis = futurePrice ? spot - futurePrice : 0;
    const prev = future && Number.isFinite(future.chartPreviousClose) ? future.chartPreviousClose + basis : null;
    const high = future && Number.isFinite(future.regularMarketDayHigh) ? future.regularMarketDayHigh + basis : null;
    const low = future && Number.isFinite(future.regularMarketDayLow) ? future.regularMarketDayLow + basis : null;

    quotes[tvSymbol] = {
      price: spot,
      prevClose: prev,
      changePct: prev ? Math.round(((spot - prev) / prev) * 10000) / 100 : null,
      high,
      low,
      time: Math.floor(Date.now() / 1000),
    };
  });

  if (!Object.keys(quotes).length) {
    return json(502, { error: "Quotes are unavailable right now." });
  }

  const payload = { updatedAt: new Date().toISOString(), quotes };
  cache = { at: Date.now(), payload };
  return json(200, payload);
};
