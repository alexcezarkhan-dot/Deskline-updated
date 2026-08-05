// DeskTerminal Economic Calendar proxy
// Fetches real calendar data from Trading Economics' public API server-side
// (avoids browser CORS restrictions). Uses the public "guest" tier by default;
// set TE_API_KEY as a Netlify environment variable to use a real developer key
// for fuller access once you have one.

exports.handler = async function (event) {
  const apiKey = process.env.TE_API_KEY || "guest:guest";

  try {
    const url = `https://api.tradingeconomics.com/calendar?c=${encodeURIComponent(apiKey)}&f=json`;
    const response = await fetch(url);
    const data = await response.json();

    if (!Array.isArray(data)) {
      return {
        statusCode: 502,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Unexpected response from calendar provider." }),
      };
    }

    // Normalize fields we actually need, keep payload small
    const events = data.map((e) => ({
      date: e.Date,
      country: e.Country,
      currency: e.Currency,
      event: e.Event,
      category: e.Category,
      actual: e.Actual,
      forecast: e.Forecast,
      previous: e.Previous,
      importance: e.Importance,
      source: e.Source,
      sourceUrl: e.SourceURL,
      reference: e.Reference,
    }));

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=180",
      },
      body: JSON.stringify({ events }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Could not load calendar data." }),
    };
  }
};
