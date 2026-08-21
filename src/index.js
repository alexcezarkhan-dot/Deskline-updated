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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Route API requests to their real handler.
    if (url.pathname === "/historical-fx") {
      return handleHistoricalFx(request);
    }

    // Everything else — your actual site's pages — served as static files,
    // completely unchanged.
    return env.ASSETS.fetch(request);
  },
};
