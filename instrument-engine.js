// DeskTerminal Instrument Engine — one shared engine for every /forex,
// /commodities, /crypto, /indices page. Reads window.CURRENT_INSTRUMENT_KEY
// (set inline in each page) plus window.INSTRUMENTS (instruments-data.js).
// Nothing here is per-instrument hardcoded text — everything is computed or
// fetched live.

(function () {
  const key = window.CURRENT_INSTRUMENT_KEY;
  const inst = window.INSTRUMENTS[key];
  if (!inst) { console.error('Unknown instrument key:', key); return; }

  /* ---------------- Market session / status (computed live, not hardcoded) ---------------- */
  function getForexStatus() {
    const now = new Date();
    const day = now.getUTCDay(); // 0=Sun..6=Sat
    const hour = now.getUTCHours();
    // Forex week: opens Sun 22:00 UTC, closes Fri 22:00 UTC
    const closed = (day === 6) || (day === 0 && hour < 22) || (day === 5 && hour >= 22);
    return closed ? 'Closed' : 'Open';
  }
  function getActiveForexSessions() {
    const h = new Date().getUTCHours();
    const sessions = [];
    if (h >= 22 || h < 7) sessions.push('Sydney');
    if (h >= 0 && h < 9) sessions.push('Tokyo');
    if (h >= 8 && h < 17) sessions.push('London');
    if (h >= 13 && h < 22) sessions.push('New York');
    return sessions.length ? sessions.join(' / ') : 'Between sessions';
  }
  function getIndexStatus() {
    // NYSE/Nasdaq cash session: 9:30–16:00 America/New_York, Mon–Fri (DST-aware via Intl)
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', hour12: false,
      weekday: 'short', hour: '2-digit', minute: '2-digit'
    }).formatToParts(new Date());
    const map = {};
    parts.forEach(p => map[p.type] = p.value);
    const weekday = map.weekday;
    const minutesSinceMidnight = parseInt(map.hour) * 60 + parseInt(map.minute);
    const isWeekday = !['Sat', 'Sun'].includes(weekday);
    const open = isWeekday && minutesSinceMidnight >= (9 * 60 + 30) && minutesSinceMidnight < (16 * 60);
    return open ? 'Open' : 'Closed';
  }

  function computeSessionInfo() {
    if (inst.session === 'crypto') return { status: 'Open', session: '24/7' };
    if (inst.session === 'indices') return { status: getIndexStatus(), session: 'NYSE / Nasdaq cash session' };
    if (inst.session === 'forex' || inst.session === 'commodities') {
      return { status: getForexStatus(), session: getActiveForexSessions() };
    }
    return { status: '—', session: '—' };
  }

  /* ---------------- Live price fetching ---------------- */
  async function fetchPrice() {
    try {
      if (inst.priceSource === 'goldapi') {
        const res = await fetch(`https://api.gold-api.com/price/${inst.goldApiCode}`);
        const data = await res.json();
        return { price: data.price, changePct: null, dayHigh: null, dayLow: null };
      }
      if (inst.priceSource === 'binance') {
        const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${inst.binanceSymbol}`);
        const data = await res.json();
        return {
          price: parseFloat(data.lastPrice),
          changePct: parseFloat(data.priceChangePercent),
          dayHigh: parseFloat(data.highPrice),
          dayLow: parseFloat(data.lowPrice),
        };
      }
      if (inst.priceSource === 'frankfurter') {
        const [latestRes, prevRes] = await Promise.all([
          fetch(`https://api.frankfurter.dev/v1/latest?base=${inst.base}&symbols=${inst.quote}`),
          fetch(`https://api.frankfurter.dev/v1/${isoDaysAgo(3)}..${isoDaysAgo(1)}?base=${inst.base}&symbols=${inst.quote}`),
        ]);
        const latest = await latestRes.json();
        const prevSeries = await prevRes.json();
        const price = latest.rates?.[inst.quote];
        const prevDates = prevSeries.rates ? Object.keys(prevSeries.rates).sort() : [];
        const prevRate = prevDates.length ? prevSeries.rates[prevDates[prevDates.length - 1]][inst.quote] : null;
        const changePct = (price && prevRate) ? ((price - prevRate) / prevRate) * 100 : null;
        return { price, changePct, dayHigh: null, dayLow: null };
      }
      return { price: null, changePct: null, dayHigh: null, dayLow: null };
    } catch (e) {
      return { price: null, changePct: null, dayHigh: null, dayLow: null };
    }
  }
  function isoDaysAgo(days) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  }
  function fmtPrice(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    const decimals = n < 10 ? 4 : 2;
    return Number(n).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }

  /* ---------------- Render hero ---------------- */
  async function renderHero() {
    document.getElementById('instTitle').textContent = inst.name;
    document.getElementById('instSubtitle').textContent = inst.fullName;
    const priceData = await fetchPrice();
    window.__priceData = priceData;

    document.getElementById('heroPrice').textContent = priceData.price !== null ? fmtPrice(priceData.price) : 'Loading…';
    const changeEl = document.getElementById('heroChange');
    if (priceData.changePct !== null) {
      const up = priceData.changePct >= 0;
      changeEl.textContent = (up ? '+' : '') + priceData.changePct.toFixed(2) + '%';
      changeEl.className = 'hero-change ' + (up ? 'up' : 'down');
    } else {
      changeEl.textContent = 'N/A';
    }

    document.getElementById('statHigh').textContent = priceData.dayHigh !== null ? fmtPrice(priceData.dayHigh) : 'N/A (free data limit)';
    document.getElementById('statLow').textContent = priceData.dayLow !== null ? fmtPrice(priceData.dayLow) : 'N/A (free data limit)';
    document.getElementById('statRange').textContent = (priceData.dayHigh !== null && priceData.dayLow !== null)
      ? fmtPrice(priceData.dayHigh - priceData.dayLow) : 'N/A';
    document.getElementById('statSpread').textContent = 'N/A (broker-specific)';

    const sessionInfo = computeSessionInfo();
    const statusEl = document.getElementById('statStatus');
    statusEl.textContent = sessionInfo.status;
    statusEl.className = 'hero-stat-value ' + (sessionInfo.status === 'Open' ? 'status-open' : 'status-closed');
    document.getElementById('statSession').textContent = sessionInfo.session;

    document.getElementById('statUpdated').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    updateSeo(priceData);
    return priceData;
  }

  /* ---------------- Dynamic SEO (title/description reflect live price) ---------------- */
  function updateSeo(priceData) {
    if (priceData.price === null) return;
    const priceStr = fmtPrice(priceData.price);
    const changeStr = priceData.changePct !== null ? `${priceData.changePct >= 0 ? '+' : ''}${priceData.changePct.toFixed(2)}%` : '';
    document.title = `${inst.name} Price Today: ${priceStr} ${changeStr} | Live Chart & Analysis | DeskTerminal`;
    const desc = document.querySelector('meta[name="description"]');
    if (desc) desc.setAttribute('content', `${inst.fullName} (${inst.name}) live price: ${priceStr} ${changeStr} today. Real-time chart, AI market analysis, news, and economic events for ${inst.name}.`);
  }

  /* ---------------- TradingView chart ---------------- */
  function loadChart() {
    const container = document.getElementById('chartContainer');
    container.innerHTML = '';
    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.async = true;
    script.text = JSON.stringify({
      autosize: true, symbol: inst.tvSymbol, interval: '60', timezone: 'Etc/UTC',
      theme: 'dark', style: '1', locale: 'en', toolbar_bg: '#151A22',
      enable_publishing: false, allow_symbol_change: false, hide_side_toolbar: false,
      withdateranges: true, calendar: false, support_host: 'https://www.tradingview.com',
    });
    const wrap = document.createElement('div');
    wrap.className = 'tradingview-widget-container';
    wrap.style.height = '100%';
    wrap.appendChild(script);
    container.appendChild(wrap);
  }

  /* ---------------- AI insight (summary, sentiment, trend, FAQ) ---------------- */
  async function loadInsight(priceData, headlines) {
    const mainEl = document.getElementById('insightMain');
    const sideEl = document.getElementById('insightSide');
    try {
      const res = await fetch('/.netlify/functions/instrument-insight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: inst.name, fullName: inst.fullName,
          price: priceData.price, changePct: priceData.changePct,
          dayHigh: priceData.dayHigh, dayLow: priceData.dayLow,
          recentHeadlines: headlines,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      mainEl.innerHTML = `
        <h3>Today's Market Summary</h3>
        <p>${data.summary || '—'}</p>
        <h3>Why ${inst.name} Is Moving Today</h3>
        <p>${data.whyMoving || '—'}</p>
        <h3>Technical Summary</h3>
        <p>${data.technicalSummary || '—'}</p>
      `;
      sideEl.innerHTML = `
        <div class="insight-stat"><div class="insight-stat-label">Sentiment</div><div class="insight-stat-value ${data.sentiment}">${data.sentiment || '—'}</div></div>
        <div class="insight-stat"><div class="insight-stat-label">Trend</div><div class="insight-stat-value ${data.trend}">${data.trend || '—'}</div></div>
        <div class="insight-stat"><div class="insight-stat-label">Volatility</div><div class="insight-stat-value">${data.volatility || '—'}</div></div>
        <div class="insight-stat"><div class="insight-stat-label">Est. Support</div><div class="insight-stat-value">${data.supportLevel || '—'}</div></div>
        <div class="insight-stat"><div class="insight-stat-label">Est. Resistance</div><div class="insight-stat-value">${data.resistanceLevel || '—'}</div></div>
      `;

      renderFaq(data.faq || []);
    } catch (e) {
      mainEl.innerHTML = `<p class="insight-loading">AI market analysis isn't available right now — it may not be set up on this site yet.</p>`;
      sideEl.innerHTML = '';
    }
  }

  /* ---------------- FAQ (visible + matching schema) ---------------- */
  function renderFaq(faqItems) {
    const container = document.getElementById('faqContainer');
    if (!faqItems.length) {
      container.innerHTML = '<p class="insight-loading">FAQ not available right now.</p>';
      return;
    }
    container.innerHTML = faqItems.map(item => `
      <div class="faq-item">
        <div class="faq-q">${item.q}</div>
        <div class="faq-a">${item.a}</div>
      </div>
    `).join('');

    // Inject matching FAQPage schema now that we have real content (see note
    // in project docs: dynamically-injected schema relies on Googlebot's JS
    // execution, which is generally reliable but not guaranteed instant).
    const schema = {
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: faqItems.map(item => ({
        '@type': 'Question', name: item.q,
        acceptedAnswer: { '@type': 'Answer', text: item.a },
      })),
    };
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(schema);
    document.head.appendChild(script);
  }

  /* ---------------- News (filtered for this instrument) ---------------- */
  async function loadNews() {
    const container = document.getElementById('newsGrid');
    try {
      const filter = inst.newsKeywords.join(',');
      const res = await fetch(`/.netlify/functions/news-feed?filter=${encodeURIComponent(filter)}`);
      const data = await res.json();
      if (data.error || !data.items) throw new Error('no items');
      if (!data.items.length) {
        container.innerHTML = '<p class="insight-loading">No recent headlines specifically matched to this instrument right now.</p>';
        return [];
      }
      container.innerHTML = data.items.slice(0, 9).map(item => `
        <a class="news-card" href="${item.link}" target="_blank" rel="noopener">
          ${item.image
            ? `<img class="news-card-img" src="${item.image}" alt="" onerror="this.outerHTML='<div class=&quot;news-card-img placeholder&quot;>📰</div>'">`
            : `<div class="news-card-img placeholder">📰</div>`}
          <div class="news-card-body">
            <div class="news-card-title">${item.title}</div>
            <div class="news-card-summary">${item.description || ''}</div>
            <div class="news-card-meta">${item.source} · ${item.pubDate ? new Date(item.pubDate).toLocaleString([], {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'}) : ''}</div>
          </div>
        </a>
      `).join('');
      return data.items.slice(0, 5).map(i => i.title);
    } catch (e) {
      container.innerHTML = '<p class="insight-loading">News is not available right now.</p>';
      return [];
    }
  }

  /* ---------------- Economic events (filtered for this instrument) ---------------- */
  async function loadEvents() {
    const container = document.getElementById('eventsBody');
    try {
      const res = await fetch('/.netlify/functions/econ-calendar');
      const data = await res.json();
      if (data.error || !data.events) throw new Error('no events');
      const filtered = data.events
        .filter(e => inst.calendarCountries.includes(e.currency))
        .filter(e => new Date(e.date) >= new Date(Date.now() - 86400000))
        .slice(0, 10);
      if (!filtered.length) {
        container.innerHTML = '<div class="event-row"><span class="insight-loading">No upcoming events found for this instrument\'s currencies.</span></div>';
        return;
      }
      container.innerHTML = filtered.map(e => `
        <div class="event-row">
          <span class="mono">${new Date(e.date).toLocaleDateString([], {month:'short', day:'numeric'})}</span>
          <span class="mono">${e.currency || ''}</span>
          <span class="event-impact" style="background:${e.importance===3?'#FB6B5B':e.importance===2?'#E8B15C':'#7C8598'}"></span>
          <span>${e.event}</span>
          <span class="event-val">${e.actual || '—'}</span>
          <span class="event-val">${e.forecast || '—'}</span>
          <span class="event-val">${e.previous || '—'}</span>
        </div>
      `).join('');
    } catch (e) {
      container.innerHTML = '<div class="event-row"><span class="insight-loading">Economic events are not available right now.</span></div>';
    }
  }

  /* ---------------- Historical performance ---------------- */
  async function loadHistoricalPerformance() {
    const container = document.getElementById('perfGrid');
    const periods = ['1D','1W','1M','3M','6M','1Y','5Y','Max'];

    if (inst.priceSource === 'frankfurter') {
      try {
        const res = await fetch(`/.netlify/functions/historical-fx?base=${inst.base}&quote=${inst.quote}`);
        const data = await res.json();
        renderPerf(periods.map(p => ({ label: p, value: data.performance?.[p] })));
      } catch (e) {
        renderPerf(periods.map(p => ({ label: p, value: null })));
      }
      return;
    }

    if (inst.priceSource === 'binance') {
      try {
        const res = await fetch(`/.netlify/functions/replay-data?symbol=${inst.binanceSymbol}&interval=1d&limit=1000`);
        const data = await res.json();
        const candles = data.candles || [];
        const current = candles[candles.length - 1]?.close;
        const daysBack = { '1D':1,'1W':7,'1M':30,'3M':90,'6M':182,'1Y':365,'5Y':1000,'Max':1000 };
        const perf = periods.map(p => {
          const idx = Math.max(0, candles.length - 1 - daysBack[p]);
          const past = candles[idx]?.close;
          const value = (current && past) ? ((current - past) / past) * 100 : null;
          return { label: p, value: value !== null ? Math.round(value*100)/100 : null };
        });
        renderPerf(perf);
      } catch (e) {
        renderPerf(periods.map(p => ({ label: p, value: null })));
      }
      return;
    }

    // No free historical source integrated for this instrument category yet.
    renderPerf(periods.map(p => ({ label: p, value: null })));
  }
  function renderPerf(items) {
    document.getElementById('perfGrid').innerHTML = items.map(i => `
      <div class="perf-cell">
        <div class="perf-label">${i.label}</div>
        <div class="perf-value ${i.value===null?'na':i.value>=0?'up':'down'}">${i.value===null?'N/A':(i.value>=0?'+':'')+i.value+'%'}</div>
      </div>
    `).join('');
  }

  /* ---------------- Related markets (internal linking) ---------------- */
  function renderRelated() {
    document.getElementById('relatedGrid').innerHTML = inst.related.map(r =>
      `<a class="related-chip" href="/${r.cat}/${r.key}/">${r.label}</a>`
    ).join('');
  }

  /* ---------------- Init ---------------- */
  async function init() {
    const priceData = await renderHero();
    loadChart();
    renderRelated();
    loadEvents();
    loadHistoricalPerformance();
    const headlines = await loadNews();
    await loadInsight(priceData, headlines);
  }
  init();
})();
