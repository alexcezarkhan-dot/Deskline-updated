// DeskTerminal — main Cloudflare Worker entry point.
//
// This is the single script Cloudflare's static-assets model requires.
// It checks the requested URL: if it matches a known API route, that
// specific function's logic runs; otherwise, the request falls through to
// serving your actual site's static HTML/CSS/JS files untouched.
//
// Each real function's logic lives in its own file under src/functions/,
// imported here — this keeps the code organized without needing the
// separate-file-per-route structure that only the older Pages Functions
// model supported automatically.

import { handleHistoricalFx } from "./functions/historical-fx.js";
import { handleEventHistory } from "./functions/event-history.js";
import { handleNewsFeed } from "./functions/news-feed.js";
import { handleEconCalendar } from "./functions/econ-calendar.js";
import { handleReplayData } from "./functions/replay-data.js";
import { handleReplayDataForex } from "./functions/replay-data-forex.js";
import { handleScannerData } from "./functions/scanner-data.js";
import { handleDeskAi } from "./functions/deskai.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Your existing pages still call the old Netlify-style path
    // (/.netlify/functions/name) since we haven't updated all 82 site
    // files individually — instead, we normalize that prefix away here,
    // so both /.netlify/functions/news-feed and /news-feed reach the
    // exact same real function.
    const routeName = url.pathname.replace(/^\/\.netlify\/functions\//, "/");

    // Route API requests to their real handler.
    if (routeName === "/historical-fx") {
      return handleHistoricalFx(request);
    }
    if (routeName === "/event-history") {
      return handleEventHistory(request, env);
    }
    if (routeName === "/news-feed") {
      return handleNewsFeed(request, env);
    }
    if (routeName === "/econ-calendar") {
      return handleEconCalendar(request, env);
    }
    if (routeName === "/replay-data") {
      return handleReplayData(request);
    }
    if (routeName === "/replay-data-forex") {
      return handleReplayDataForex(request, env);
    }
    if (routeName === "/scanner-data") {
      return handleScannerData(request, env);
    }
    if (routeName === "/deskai") {
      return handleDeskAi(request, env);
    }

    // Everything else — your actual site's pages — served as static files,
    // completely unchanged.
    return env.ASSETS.fetch(request);
  },
};
