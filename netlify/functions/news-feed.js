// DeskTerminal News Feed — fetches real, live headlines from legitimate financial
// RSS feeds (not scraping, not X/Twitter — publishers publish RSS specifically
// for syndication like this). Parsed with a small dependency-free regex parser
// so no npm install step is needed for this function.

const FEEDS = [
  { url: "https://www.forexlive.com/feed/", source: "InvestingLive" },
  { url: "https://feeds.content.dowjones.io/public/rss/mw_topstories", source: "MarketWatch" },
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
    description = description ? stripHtml(description).slice(0, 200) : "";

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

exports.handler = async function (event) {
  const params = (event && event.queryStringParameters) || {};
  const filterParam = params.filter || "";
  const keywords = filterParam
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);

  try {
    const results = await Promise.allSettled(
      FEEDS.map(async (feed) => {
        const res = await fetch(feed.url, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; DeskTerminalBot/1.0)" },
        });
        const xml = await res.text();
        return parseRSS(xml, feed.source);
      })
    );

    let allItems = [];
    results.forEach((r) => {
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
        "Cache-Control": "public, max-age=120",
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
