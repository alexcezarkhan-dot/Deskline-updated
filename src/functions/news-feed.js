// DeskTerminal News Feed — fetches real, live headlines from legitimate financial
// RSS feeds (not scraping, not X/Twitter — publishers publish RSS specifically
// for syndication like this). Parsed with a small dependency-free regex parser
// so no npm install step is needed for this function.
//
// Cloudflare version — identical logic to the Netlify original, only the
// env variable access (env.KEY instead of process.env.KEY) and the
// request/response wrapper differ.

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
// Each is skipped gracefully (returns []) if its key isn't configured, so
// the site keeps working on the free RSS sources alone until you add these.

async function fetchMarketaux(env) {
  const key = env.MARKETAUX_API_KEY;
  if (!key) return [];
  const res = await fetch(`https://api.marketaux.com/v1/news/all?api_token=${key}&language=en&limit=15`);
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

async function fetchFinnhub(env) {
  const key = env.FINNHUB_API_KEY;
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

async function fetchAlphaVantage(env) {
  const key = env.ALPHAVANTAGE_API_KEY;
  if (!key) return [];
  const res = await fetch(`https://www.alphavantage.co/query?function=NEWS_SENTIMENT&apikey=${key}&limit=15`);
  const data = await res.json();
  if (!data.feed) return [];
  return data.feed.map((a) => ({
    title: a.title,
    link: a.url,
    pubDate: a.time_published ? new Date(
      a.time_published.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/, "$1-$2-$3T$4:$5:$6")
    ).toISOString() : null,
    source: "Alpha Vantage",
    description: a.summary ? a.summary.slice(0, 400) : "",
    image: a.banner_image || "",
  }));
}

export async function handleNewsFeed(request, env) {
  const url = new URL(request.url);
  const filterParam = url.searchParams.get("filter") || "";
  const keywords = filterParam.split(",").map((k) => k.trim().toLowerCase()).filter(Boolean);

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

    const apiResults = await Promise.allSettled([
      fetchMarketaux(env),
      fetchFinnhub(env),
      fetchAlphaVantage(env),
    ]);

    let allItems = [];
    [...rssResults, ...apiResults].forEach((r) => {
      if (r.status === "fulfilled") allItems = allItems.concat(r.value);
    });

    const seen = new Set();
    allItems = allItems.filter((item) => {
      const key = item.title.toLowerCase().slice(0, 60);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (keywords.length) {
      allItems = allItems.filter((item) => {
        const title = item.title.toLowerCase();
        return keywords.some((kw) => title.includes(kw));
      });
    }

    allItems.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    allItems = allItems.slice(0, keywords.length ? 12 : 60);

    return new Response(JSON.stringify({ items: allItems }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=600" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Could not load news feed." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
