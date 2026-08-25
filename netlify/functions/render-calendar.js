// DeskTerminal — Server-rendered Calendar page
// -----------------------------------------------------------------------
// Same real fix as render-news.js, adapted for Calendar's data source:
// Calendar reads live from Trading Economics via econ-calendar.js (not a
// Supabase cache like News), so this calls that same live source
// directly, then injects real event rows into the page's initial HTML —
// visible to any crawler that doesn't run JavaScript, while the existing
// client-side JS still takes over normally for real visitors.
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
    const apiKey = process.env.TE_API_KEY || "guest:guest";
    const url = `https://api.tradingeconomics.com/calendar?c=${encodeURIComponent(apiKey)}&f=json`;
    const res = await fetch(url);
    const data = await res.json();

    if (Array.isArray(data) && data.length) {
      const today = new Date().toDateString();
      const todayEvents = data.filter((e) => new Date(e.Date).toDateString() === today).slice(0, 30);
      realContentHtml = todayEvents.map((e) => `
        <div class="ssr-cal-row">
          <span>${escapeHtml(e.Currency || e.Country)}</span>
          <span>${escapeHtml(e.Event)}</span>
          <span>${escapeHtml(e.Actual || "—")}</span>
          <span>${escapeHtml(e.Forecast || "—")}</span>
          <span>${escapeHtml(e.Previous || "—")}</span>
        </div>`).join("");
    }
  } catch (err) {
    // A failed live fetch here should never break the page — it just
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
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=180" },
    body: htmlContent,
  };
};
