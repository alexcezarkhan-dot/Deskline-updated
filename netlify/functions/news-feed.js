// DeskTerminal News Feed — the function visitors' browsers actually call.
// -----------------------------------------------------------------------
// This no longer fetches RSS feeds itself — it just reads whatever
// cache-news.js already stored in Supabase. Every visitor gets the same
// shared, pre-fetched data instantly; no RSS source is ever polled
// per-visitor, and this function is genuinely fast since it's just one
// database read.

exports.handler = async function (event) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "News cache isn't configured yet on this site." }),
    };
  }

  const filterParam = (event.queryStringParameters && event.queryStringParameters.filter) || "";
  const keywords = filterParam.split(",").map((k) => k.trim().toLowerCase()).filter(Boolean);

  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/cached_news?select=*&order=pub_date.desc.nullslast&limit=100`,
      { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } }
    );
    const rows = await res.json();
    if (!Array.isArray(rows)) {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: "Unexpected response from news cache." }),
      };
    }

    let items = rows.map((r) => ({
      title: r.title, link: r.link, pubDate: r.pub_date,
      source: r.source, description: r.description || "", image: r.image || "",
      impact: r.impact || null, currency: r.currency || null, effect: r.effect || null,
    }));

    if (keywords.length) {
      items = items.filter((item) => {
        const title = item.title.toLowerCase();
        return keywords.some((kw) => title.includes(kw));
      });
      items = items.slice(0, 12);
    } else {
      items = items.slice(0, 60);
    }

    return {
      statusCode: 200,
      headers: { "Cache-Control": "public, max-age=30" },
      body: JSON.stringify({ items }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: "Could not load news feed." }) };
  }
};
