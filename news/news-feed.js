// DeskTerminal News Feed — fetches real, live headlines from legitimate financial
// RSS feeds (not scraping, not X/Twitter — publishers publish RSS specifically
// for syndication like this). Parsed with a small dependency-free regex parser
// so no npm install step is needed for this function.

const FEEDS = [
  { url: "https://www.forexlive.com/feed/", source: "InvestingLive" },
  { url: "https://feeds.content.dowjones.io/public/rss/mw_topstories", source: "MarketWatch" },
  { url: "https://feeds.finance.yahoo.com/rss/2.0/headline?s=SPY,GLD,BTC-USD,EURUSD=X&region=US&lang=en-US", source: "Yahoo Finance" },
  { url: "https://www.kitco.com/news/category/mining/rss", source: "Kitco News" },
  { url: "https://www.coindesk.com/arc/outboundfeeds/rss/", source: "CoinDesk" },
];

function extractTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!m) return "";
  return m[1]
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function stripHtml(str) {
  return str.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function parseRSS(xml, sourceName) {
  const items = [];
  const itemMatches = xml.match(/<item[\s\S]*?<\/item>/g) || [];
  itemMatches.forEach((itemXml) => {
    const title = extractTag(itemXml, "title");
    const link = extractTag(itemXml, "link");
    const pubDate = extractTag(itemXml, "pubDate");
    let description = extractTag(itemXml, "description");
    description = description ? stripHtml(description).slice(0, 400) : "";

    let image = "";
    const enclosureMatch = itemXml.match(/<enclosure[^>]*url="([^"]+)"/i);
    const mediaMatch = itemXml.match(/<media:(?:thumbnail|content)[^>]*url="([^"]+)"/i);
    if (enclosureMatch) image = enclosureMatch[1];
    else if (mediaMatch) image = mediaMatch[1];

    if (title && link) {
      items.push({
        title,
        link,
        pubDate: pubDate ? new Date(pubDate).toISOString() : null,
        source: sourceName,
        description,
        image,
      });
    }
  });
  return items;
}

// ---------------- API-key-based sources ----------------
// Unlike the RSS feeds above, these require a free API key (set as a Netlify
// environment variable) and have real daily/per-minute rate limits. Each is
// skipped gracefully — not an error — if its key isn't configured yet, so the
// site keeps working on the free RSS sources alone until you add these.

async function fetchMarketaux() {
  const key = process.env.MARKETAUX_API_KEY;
  if (!key) return [];
  const res = await fetch(
    `https://api.marketaux.com/v1/news/all?api_token=${key}&language=en&limit=15`
  );
  const data = await res.json();
  if (!data.data) return [];
  return data.data.map((a) => ({
    title: a.title,
    link: a.url,
    pubDate: a.published_at ? new Date(a.published_at).toISOString() : null,
    source: "Marketaux",
    description: a.snippet ? a.snippet.slice(0, 400) : "",
    image: a.image_url || "",
  }));
}

async function fetchFinnhub() {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return [];
  const res = await fetch(`https://finnhub.io/api/v1/news?category=general&token=${key}`);
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  return data.slice(0, 15).map((a) => ({
    title: a.headline,
    link: a.url,
    pubDate: a.datetime ? new Date(a.datetime * 1000).toISOString() : null,
    source: "Finnhub",
    description: a.summary ? a.summary.slice(0, 400) : "",
    image: a.image || "",
  }));
}

async function fetchAlphaVantage() {
  const key = process.env.ALPHAVANTAGE_API_KEY;
  if (!key) return [];
  // Alpha Vantage's free tier is capped at ~25 requests/day total — the
  // longer overall cache on this function (see Cache-Control below) exists
  // specifically to keep this source within that limit.
  const res = await fetch(`https://www.alphavantage.co/query?function=NEWS_SENTIMENT&apikey=${key}&limit=15`);
  const data = await res.json();
  if (!data.feed) return [];
  return data.feed.map((a) => ({
    title: a.title,
    link: a.url,
    pubDate: a.time_published ? new Date(
      a.time_published.replace(
        /(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/,
        "$1-$2-$3T$4:$5:$6"
      )
    ).toISOString() : null,
    source: "Alpha Vantage",
    description: a.summary ? a.summary.slice(0, 400) : "",
    image: a.banner_image || "",
  }));
}

exports.handler = async function (event) {
  const params = (event && event.queryStringParameters) || {};
  const filterParam = params.filter || "";
  const keywords = filterParam
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);

  try {
    const rssResults = await Promise.allSettled(
      FEEDS.map(async (feed) => {
        const res = await fetch(feed.url, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; DeskTerminalBot/1.0)" },
        });
        const xml = await res.text();
        return parseRSS(xml, feed.source);
      })
    );

    // API-key sources — each resolves to [] on its own if not configured or
    // if it errors, so one failing source never breaks the whole feed.
    const apiResults = await Promise.allSettled([
      fetchMarketaux(),
      fetchFinnhub(),
      fetchAlphaVantage(),
    ]);

    let allItems = [];
    [...rssResults, ...apiResults].forEach((r) => {
      if (r.status === "fulfilled") allItems = allItems.concat(r.value);
    });

    // Dedupe near-identical titles (some feeds post the same story twice)
    const seen = new Set();
    allItems = allItems.filter((item) => {
      const key = item.title.toLowerCase().slice(0, 60);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Optional instrument-specific filtering (used by /forex, /commodities,
    // /crypto, /indices landing pages) — leaves the main News page untouched
    // since it never sends a filter param.
    if (keywords.length) {
      allItems = allItems.filter((item) => {
        const title = item.title.toLowerCase();
        return keywords.some((kw) => title.includes(kw));
      });
    }

    allItems.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    allItems = allItems.slice(0, keywords.length ? 12 : 60);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        // Longer than before (was 120s) — protects Marketaux (100/day),
        // Finnhub (60/min), and especially Alpha Vantage (25/day) from being
        // exhausted by normal site traffic, since every visitor within this
        // window is served the same cached response instead of triggering
        // fresh calls to those rate-limited APIs.
        "Cache-Control": "public, max-age=600",
      },
      body: JSON.stringify({ items: allItems }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Could not load news feed." }),
    };
  }
};
