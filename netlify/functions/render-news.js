// DeskTerminal — Server-rendered News page
// -----------------------------------------------------------------------
// This solves a real, confirmed gap from tonight's AEO audit: News's
// actual headlines only existed after client-side JS fetched them,
// invisible to crawlers that don't execute JavaScript.
//
// This function reads the REAL news.html file directly (via Netlify's
// included_files bundling — see netlify.toml), fetches the same real,
// already-cached headlines news-feed.js serves, and injects them as
// genuine markup directly into the page's initial HTML, inside the exact
// same #newsContainer the client-side JS already targets. A crawler that
// never runs JS now sees real content immediately. A real visitor's
// browser still runs the exact same JS as before — which replaces this
// content the moment it loads (via the existing renderNewsList() →
// container.innerHTML pattern), so nothing about the live, interactive
// experience changes at all.
//
// The injected rows deliberately use the SAME classes as the client-side
// renderer (.feed-row / .feed-main / .feed-badge / .feed-title / .feed-meta),
// so the first paint is already the finished ForexFactory-style feed —
// no unstyled flash of plain links before JS takes over.
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

// Mirrors timeAgo() / dayLabel() in news.html so the server-rendered feed
// reads exactly like the one the browser builds a moment later.
function timeAgo(iso) {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (isNaN(then)) return "—";
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + " min ago";
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + " hr ago";
  const days = Math.floor(hrs / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return days + " days ago";
  return new Date(then).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function dayLabel(date) {
  const d = new Date(date);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(d); that.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today - that) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return d.toLocaleDateString("en-US", { weekday: "long" });
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function sourceDomain(link) {
  try { return new URL(link).hostname.replace(/^www\./, ""); } catch (e) { return ""; }
}

function renderRow(r) {
  const domain = sourceDomain(r.link);
  const favicon = domain
    ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`
    : "";
  const letter = (r.source || "?").trim().charAt(0).toUpperCase() || "?";
  const impact = r.impact === "high"
    ? '<span class="feed-tags"><span class="nr-impact-badge high">HIGH</span></span>'
    : r.impact === "medium"
      ? '<span class="feed-tags"><span class="nr-impact-badge medium">MED</span></span>'
      : "";

  return `
      <div class="feed-row${r.impact === "high" ? " is-high" : r.impact === "medium" ? " is-med" : ""}">
        <a class="feed-main" href="${escapeHtml(r.link)}" target="_blank" rel="noopener">
          <span class="feed-badge"><span class="fb-letter">${escapeHtml(letter)}</span>${favicon ? `<img src="${escapeHtml(favicon)}" alt="" loading="lazy" onerror="this.remove()">` : ""}</span>
          <span class="feed-content">
            <span class="feed-title">${escapeHtml(r.title)}</span>
            <span class="feed-meta">
              <span class="feed-src">${escapeHtml(r.source || "Wire")}</span>
              <span>·</span>
              <span>${escapeHtml(timeAgo(r.pub_date))}</span>
            </span>
          </span>
          ${impact}
        </a>
      </div>`;
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
        // Same sticky day dividers the client renderer produces, so the
        // raw HTML shows a real, grouped wire feed.
        const dayKeyOf = (r) => {
          const d = r.pub_date ? new Date(r.pub_date) : null;
          return d && !isNaN(d) ? d.toDateString() : "unknown";
        };

        let lastDayKey = null;
        realContentHtml = rows.map((r) => {
          const dayKey = dayKeyOf(r);
          let out = "";
          if (dayKey !== lastDayKey) {
            lastDayKey = dayKey;
            const dayCount = rows.filter((x) => dayKeyOf(x) === dayKey).length;
            const label = r.pub_date && !isNaN(new Date(r.pub_date)) ? dayLabel(r.pub_date) : "Undated";
            out += `<div class="feed-day">${escapeHtml(label)}<span class="feed-day-count">· ${dayCount} ${dayCount === 1 ? "story" : "stories"}</span></div>`;
          }
          return out + renderRow(r);
        }).join("");
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
