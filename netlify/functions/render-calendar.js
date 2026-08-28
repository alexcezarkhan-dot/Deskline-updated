// DeskTerminal — Server-rendered Calendar page
// -----------------------------------------------------------------------
// Same real fix as render-news.js. Reads from the shared Supabase cache
// (populated by cache-calendar.js on a schedule) instead of hitting
// Trading Economics directly on every single page load — genuinely
// cuts real Netlify function compute and external API calls on every
// visit, not just in principle.
//
// Reads the REAL calendar.html directly via included_files bundling —
// no duplicate template to drift out of sync.

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
  let htmlContent;
  try {
    const filePath = path.join(__dirname, "calendar.html");
    htmlContent = fs.readFileSync(filePath, "utf-8");
  } catch (err) {
    return { statusCode: 302, headers: { Location: "/calendar.html" } };
  }

  let realContentHtml = "";
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    if (supabaseUrl && anonKey) {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/cached_calendar_events?select=*&order=event_date.asc&limit=200`,
        { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } }
      );
      const rows = await res.json();

      if (Array.isArray(rows) && rows.length) {
        const today = new Date().toDateString();
        const todayEvents = rows.filter((e) => new Date(e.event_date).toDateString() === today).slice(0, 30);
        realContentHtml = todayEvents.map((e) => `
          <div class="ssr-cal-row">
            <span>${escapeHtml(e.currency || e.country)}</span>
            <span>${escapeHtml(e.event)}</span>
            <span>${escapeHtml(e.actual || "—")}</span>
            <span>${escapeHtml(e.forecast || "—")}</span>
            <span>${escapeHtml(e.previous || "—")}</span>
          </div>`).join("");
      }
    }
  } catch (err) {
    // A failed cache read here should never break the page — it just
    // means this specific request falls back to the client-side JS
    // path only, exactly like before this feature existed.
  }

  if (realContentHtml) {
    htmlContent = htmlContent.replace(
      '<div id="calendarBody">\n    <div class="cal-status">Loading calendar…</div>\n  </div>',
      `<div id="calendarBody">${realContentHtml}</div>`
    );
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=60" },
    body: htmlContent,
  };
};
