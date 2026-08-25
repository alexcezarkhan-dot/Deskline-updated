// DeskTerminal — Server-rendered News page
// -----------------------------------------------------------------------
// This solves a real, confirmed gap from tonight's AEO audit: News's
// actual headlines only existed after client-side JS fetched them,
// invisible to crawlers that don't execute JavaScript.
//
// This function reads the REAL news.html file directly (via Netlify's
// included_files bundling — see netlify.toml), fetches the same real,
// already-cached headlines news-feed.js serves, and injects them as
// genuine, real <article> markup directly into the page's initial HTML,
// inside the exact same #newsContainer the client-side JS already
// targets. A crawler that never runs JS now sees real content
// immediately. A real visitor's browser still runs the exact same JS as
// before — which replaces this content the moment it loads (via the
// existing renderNewsList() → container.innerHTML pattern), so nothing
// about the live, interactive experience changes at all.
//
// Genuinely no duplicate copy of news.html to drift out of sync — this
// reads the real file directly, every time.

const fs = require("fs");
const path = require("path");

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

exports.handler = async function () {
  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  let htmlContent;
  try {
    // Reads the real, actual news.html — bundled alongside this function
    // by netlify.toml's included_files, not a separate maintained copy.
    const filePath = path.join(__dirname, "news.html");
    htmlContent = fs.readFileSync(filePath, "utf-8");
  } catch (err) {
    // If the file genuinely can't be read for any reason, this must not
    // break the site — fall through to a redirect to the real static
    // page rather than showing an error.
    return { statusCode: 302, headers: { Location: "/news.html" } };
  }

  let realContentHtml = "";
  try {
    if (supabaseUrl && anonKey) {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/cached_news?select=*&order=pub_date.desc.nullslast&limit=30`,
        { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } }
      );
      const rows = await res.json();
      if (Array.isArray(rows) && rows.length) {
        realContentHtml = rows.map((r) => `
          <article class="ssr-news-row">
            <span>${escapeHtml(r.source)}</span>
            <a href="${escapeHtml(r.link)}" rel="noopener">${escapeHtml(r.title)}</a>
          </article>`).join("");
      }
    }
  } catch (err) {
    // A failed Supabase read here should never break the page — it just
    // means this specific request falls back to the client-side JS
    // path only, exactly like before this feature existed.
  }

  // Inject the real content directly into the exact container the
  // client-side JS already targets — genuinely visible in the raw HTML
  // now, and the existing JS harmlessly overwrites it once it runs.
  if (realContentHtml) {
    htmlContent = htmlContent.replace(
      '<div id="newsContainer"></div>',
      `<div id="newsContainer">${realContentHtml}</div>`
    );
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=60" },
    body: htmlContent,
  };
};
