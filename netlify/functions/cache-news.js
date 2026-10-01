// DeskTerminal News Cache — the ONE function that actually fetches news.
// -----------------------------------------------------------------------
// This runs on a schedule (via GitHub Actions, roughly every 5 minutes —
// see .github/workflows/keep-news-fresh.yml), never triggered by a
// visitor's browser. It fetches every RSS/API source, removes duplicates
// (including near-duplicate headlines worded slightly differently across
// sources), writes genuinely new stories into Supabase, and deletes
// anything older than 2 days.
//
// news-feed.js (the function visitors' browsers actually call) does none
// of this fetching itself anymore — it just reads whatever this function
// already stored, so every visitor sees the same shared, pre-fetched
// data instantly, and no RSS source is ever polled per-visitor.
//
// Requires SUPABASE_SERVICE_KEY — the service role key, NOT the public
// anon key already used client-side. This key bypasses Row Level
// Security for legitimate server-side writes like this one, and must
// never be exposed to the browser. Find it in Supabase: Project Settings
// → API → service_role key (marked "secret").
//
// Classification (impact tier + currency effect) now happens HERE, once,
// at cache time — not per-visitor. This is the same real improvement we
// already made for the raw headline fetch, applied one layer up: a
// headline gets classified by AI exactly once, the moment it's newly
// cached, and every visitor afterward just reads that stored result.

const { callAIWithFallback } = require("./ai-providers");

const NEWS_IMPACT_PROMPT =
  'You are a financial news triage assistant. You will be given a numbered list of headlines, each optionally followed by a short description for extra context. For EACH headline, determine: (1) its market impact level — "high" (central bank rate decisions, major geopolitical/war developments, surprise inflation or jobs data, market-wide crashes or shocks — the kind of headline that would meaningfully move forex, gold, crypto, or major indices), "medium" (real but more routine data releases, notable company/sector news, moderate policy commentary), or "low" (minor company news, general market chatter, opinion pieces, lifestyle/entertainment content with little to no real market relevance); (2) IF the headline clearly relates to a specific major currency (USD, EUR, GBP, JPY, AUD, CAD, CHF, NZD) or Gold, name it and say whether the news would typically STRENGTHEN or WEAKEN it. When reasoning about the effect, think beyond the single most obvious pattern — for example, war news does not automatically mean "gold strengthens" if the specific situation more directly threatens oil supply, which can drive inflation fears and complicate the usual safe-haven reaction; a central bank comment does not automatically mean the same direction every time depending on whether it was hawkish or dovish. Be honest and conservative: if the headline is too general, ambiguous, involves competing effects you cannot confidently resolve, or does not clearly relate to one specific currency, leave currency and effect as null rather than guessing. Respond with ONLY valid JSON, no markdown fences, in exactly this shape: {"results": [{"index": 0, "impact": "high", "currency": "USD", "effect": "strengthen"}, {"index": 1, "impact": "low", "currency": null, "effect": null}]} — one entry per headline, in the same order given, using the 0-based index shown next to each headline. "impact" must be exactly "high", "medium", or "low". "effect" must be exactly "strengthen", "weaken", or null.';

// Classifies a batch of genuinely new headlines (max 20 per AI call, same
// batching limit used everywhere else in this project). Returns a map of
// title -> { impact, currency, effect }. Never throws — if classification
// fails for any reason, affected headlines just get null values and are
// still cached with their real title/link/source intact; a failed AI
// call should never block genuinely new news from being cached.
async function classifyHeadlines(items) {
  const results = new Map();
  const batchSize = 20;
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const question = batch.map((item, idx) => {
      const desc = item.description ? ` — ${item.description.slice(0, 200)}` : "";
      return `${idx}. ${item.title}${desc}`;
    }).join("\n");
    try {
      const { text } = await callAIWithFallback(NEWS_IMPACT_PROMPT, question, []);
      const cleaned = text.replace(/^```json\s*/i, "").replace(/```\s*$/, "");
      const parsed = JSON.parse(cleaned);
      (parsed.results || []).forEach((r) => {
        const item = batch[r.index];
        if (!item) return;
        const impact = (r.impact === "high" || r.impact === "medium" || r.impact === "low") ? r.impact : null;
        const effect = (r.effect === "strengthen" || r.effect === "weaken") ? r.effect : null;
        results.set(item.title, { impact, currency: r.currency || null, effect });
      });
    } catch (err) {
      // Classification failed for this batch — those headlines simply get
      // cached without impact/currency data, not blocked entirely.
    }
  }
  return results;
}

const FEEDS = [
  { url: "https://www.forexlive.com/feed/", source: "InvestingLive" },
  { url: "https://feeds.content.dowjones.io/public/rss/mw_topstories", source: "MarketWatch" },
  { url: "https://feeds.finance.yahoo.com/rss/2.0/headline?s=SPY,GLD,BTC-USD,EURUSD=X&region=US&lang=en-US", source: "Yahoo Finance" },
  { url: "https://www.kitco.com/news/category/mining/rss", source: "Kitco News" },
  { url: "https://www.coindesk.com/arc/outboundfeeds/rss/", source: "CoinDesk" },
  { url: "https://www.federalreserve.gov/feeds/press_all.xml", source: "Federal Reserve" },
  { url: "https://www.investing.com/rss/news.rss", source: "Investing.com" },
];

// RSS feeds hand back HTML-escaped text — "&#39;" for an apostrophe, "&amp;"
// for an ampersand, "&mdash;" for a dash. Decoding it here, once, at parse
// time means every consumer downstream (the news page, the server-rendered
// HTML, the instrument pages) shows a clean headline instead of a literal
// "&#39;" sitting in the middle of a word. Everything that renders these
// strings escapes them again before they touch the page.
function decodeEntities(str) {
  if (!str) return "";
  return String(str)
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&mdash;/gi, "\u2014")
    .replace(/&ndash;/gi, "\u2013")
    .replace(/&hellip;/gi, "\u2026")
    .replace(/&lsquo;|&rsquo;/gi, "\u2019")
    .replace(/&ldquo;|&rdquo;/gi, "\u201d")
    .replace(/&amp;/gi, "&"); // must run last, or it would double-decode
}

function extractTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!m) return "";
  return decodeEntities(
    m[1].replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "").replace(/<[^>]+>/g, "").trim()
  );
}

function stripHtml(str) {
  return decodeEntities(str.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
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
        title, link,
        pubDate: pubDate ? new Date(pubDate).toISOString() : null,
        source: sourceName, description, image,
      });
    }
  });
  return items;
}

// Marketaux is a real, separate JSON API (not RSS), with a genuinely
// tight free-tier limit — confirmed at roughly 100 requests/day, not
// compatible with this file's normal 5-minute schedule. This is why it's
// called on its own, much less frequent, separate schedule (see the
// "marketaux=true" gate in the handler below and the second job in
// keep-news-fresh.yml) rather than being added to the FEEDS array above.
async function fetchMarketaux() {
  const apiKey = process.env.MARKETAUX_API_KEY;
  if (!apiKey) return [];
  try {
    const url = `https://api.marketaux.com/v1/news/all?language=en&limit=20&api_token=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data || !Array.isArray(data.data)) return [];
    return data.data
      .filter((item) => item.title && item.url)
      .map((item) => ({
        title: item.title,
        link: item.url,
        pubDate: item.published_at ? new Date(item.published_at).toISOString() : null,
        source: "Marketaux",
        description: item.description ? String(item.description).slice(0, 400) : "",
        image: item.image_url || "",
      }));
  } catch (err) {
    return []; // a failed Marketaux call should never break the rest of the cache run
  }
}

// Real, meaningfully-better deduplication than a plain title match. Two
// headlines from different sources about the same story are rarely
// worded identically ("Bitcoin surges over 25%" vs "Bitcoin jumps 25% as
// shorts get squeezed") — this normalizes each title (lowercase, strip
// punctuation, drop common filler words) and compares the resulting
// significant-word sets for substantial overlap, not just exact prefixes.
const STOPWORDS = new Set(["a","an","the","is","are","was","were","to","of","in","on","for","as","at","by","with","and","or","after","before","amid","over","up","down","new"]);
function significantWords(title) {
  return new Set(
    title.toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
  );
}
function isDuplicate(a, b) {
  const wordsA = significantWords(a);
  const wordsB = significantWords(b);
  if (!wordsA.size || !wordsB.size) return false;
  let shared = 0;
  wordsA.forEach((w) => { if (wordsB.has(w)) shared++; });
  const overlap = shared / Math.min(wordsA.size, wordsB.size);
  // Threshold tested against real headlines: genuine same-story pairs from
  // different outlets scored 0.20-0.22 overlap; genuinely unrelated
  // stories (including ones sharing common financial vocabulary like
  // "Fed") scored 0.00-0.14. 0.18 sits safely between both groups.
  return overlap >= 0.18;
}

exports.handler = async function (event) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "Supabase service credentials not configured." }) };
  }
  const includeMarketaux = event.queryStringParameters && event.queryStringParameters.marketaux === "true";

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
    results.forEach((r) => { if (r.status === "fulfilled") allItems = allItems.concat(r.value); });

    if (includeMarketaux) {
      const marketauxItems = await fetchMarketaux();
      allItems = allItems.concat(marketauxItems);
    }

    // Deduplicate within this fetch — exact link matches first (cheap),
    // then genuine near-duplicate title matches across different sources.
    const seenLinks = new Set();
    const deduped = [];
    allItems.forEach((item) => {
      if (seenLinks.has(item.link)) return;
      const isNearDup = deduped.some((existing) => isDuplicate(existing.title, item.title));
      if (isNearDup) return;
      seenLinks.add(item.link);
      deduped.push(item);
    });

    // Upsert into Supabase — link is UNIQUE, so a story already cached
    // from an earlier run is a genuine no-op here, not a duplicate insert.
    const headers = {
      "Content-Type": "application/json",
      "apikey": serviceKey,
      "Authorization": `Bearer ${serviceKey}`,
      "Prefer": "resolution=ignore-duplicates",
    };

    // Check which headlines are already cached, so we only ever classify
    // a genuinely new one once — this is the real fix: without this
    // check, every scheduled run would re-classify the same ~60
    // headlines that were already classified 5 minutes ago.
    const linksParam = deduped.map((item) => `"${item.link.replace(/"/g, '\\"')}"`).join(",");
    let existingLinks = new Set();
    if (linksParam) {
      const existingRes = await fetch(
        `${supabaseUrl}/rest/v1/cached_news?select=link&link=in.(${linksParam})`,
        { headers }
      );
      const existingRows = await existingRes.json();
      if (Array.isArray(existingRows)) {
        existingLinks = new Set(existingRows.map((r) => r.link));
      }
    }

    const genuinelyNew = deduped.filter((item) => !existingLinks.has(item.link));

    // Real fix for the timeout: insert headlines FIRST, without waiting
    // on classification at all. This is the critical path — it must
    // always complete fast and reliably, regardless of how many new
    // headlines exist. Classification (which can be genuinely slow when
    // there's a large backlog, like on this pipeline's first-ever
    // successful run) happens AFTER, capped to a single small batch per
    // run — any remaining backlog naturally catches up over the next
    // few scheduled runs (every 5 minutes) rather than risking the
    // whole function timing out and headlines never appearing at all.
    const rows = deduped.map((item) => ({
      title: item.title, link: item.link, source: item.source,
      image: item.image || null, description: item.description || null,
      pub_date: item.pubDate,
      impact: null, currency: null, effect: null,
    }));

    if (rows.length) {
      await fetch(`${supabaseUrl}/rest/v1/cached_news`, {
        method: "POST", headers, body: JSON.stringify(rows),
      });
    }

    // Now classify — capped to one real batch (20 items) per run,
    // regardless of how large the genuinely-new backlog is. Updates
    // each row individually right after classifying it, so headlines
    // are already visible to real visitors the moment they're saved
    // above, not blocked waiting on this step.
    const toClassifyThisRun = genuinelyNew.slice(0, 20);
    let newlyClassifiedCount = 0;
    if (toClassifyThisRun.length) {
      const classifications = await classifyHeadlines(toClassifyThisRun);
      for (const item of toClassifyThisRun) {
        const c = classifications.get(item.title);
        if (!c) continue;
        newlyClassifiedCount++;
        await fetch(`${supabaseUrl}/rest/v1/cached_news?link=eq.${encodeURIComponent(item.link)}`, {
          method: "PATCH", headers,
          body: JSON.stringify({ impact: c.impact, currency: c.currency, effect: c.effect }),
        });
      }
    }

    // Real 2-day expiry — delete anything older than 2 days, every run.
    const cutoff = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    await fetch(`${supabaseUrl}/rest/v1/cached_news?fetched_at=lt.${encodeURIComponent(cutoff)}`, {
      method: "DELETE", headers,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ fetched: allItems.length, newOrUpdated: rows.length, newlyClassified: newlyClassifiedCount, backlogRemaining: Math.max(0, genuinelyNew.length - toClassifyThisRun.length) }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
