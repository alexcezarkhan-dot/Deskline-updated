// DeskTerminal Event History — real historical occurrences of a specific
// economic event over the past year, from Trading Economics' actual
// historical calendar data. No AI, no estimation — every row here is a real
// past release with its real actual/forecast/previous values.

exports.handler = async function (event) {
  const params = event.queryStringParameters || {};
  const country = params.country;
  const eventName = params.event;

  if (!country || !eventName) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing country or event name." }) };
  }

  const apiKey = process.env.TE_API_KEY || "guest:guest";

  try {
    const today = new Date();
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(today.getFullYear() - 1);
    const d1 = oneYearAgo.toISOString().slice(0, 10);
    const d2 = today.toISOString().slice(0, 10);

    const url = `https://api.tradingeconomics.com/calendar/country/${encodeURIComponent(country)}/${d1}/${d2}?c=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url);
    const data = await response.json();

    if (!Array.isArray(data)) {
      return {
        statusCode: 502,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Unexpected response from calendar provider." }),
      };
    }

    // Match by exact event name — this is real filtering against real past
    // releases, not an approximation.
    const history = data
      .filter((e) => e.Event === eventName && e.Actual)
      .map((e) => ({
        date: e.Date,
        actual: e.Actual,
        forecast: e.Forecast,
        previous: e.Previous,
      }))
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 14);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        // Historical data doesn't change once published — safe to cache long.
        "Cache-Control": "public, max-age=86400",
      },
      body: JSON.stringify({ history }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Could not load event history." }),
    };
  }
};
