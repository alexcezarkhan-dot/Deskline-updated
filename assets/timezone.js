/* Site-wide display timezone.
   Follows the visitor's apparent location (IP, so a VPN changes it), re-checks
   at most once a minute, and falls back to the cached/device zone if the lookup
   fails. Every Date#toLocale* call on the site inherits the zone from here. */
(function(){
  var KEY = 'dt_tz_v1';
  var RECHECK = 60 * 1000;
  var state = { tz: '', src: 'device' };

  function deviceTz(){
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch(e){ return ''; }
  }
  function validTz(tz){
    if(!tz) return false;
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch(e){ return false; }
  }
  state.tz = deviceTz();

  // ?tz=America/New_York pins the zone (used for QA and manual overrides)
  var pinned = '';
  try {
    var q = new URLSearchParams(location.search).get('tz');
    if(validTz(q)) pinned = q;
  } catch(e){}

  var cached = null;
  try { cached = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch(e){}
  if(!cached || !validTz(cached.tz)) cached = null;

  if(pinned){
    state.tz = pinned; state.src = 'ip';
  } else if(cached){
    state.tz = cached.tz; state.src = 'ip';
  }

  function setZone(tz, src){
    if(!validTz(tz)) return;
    var changed = tz !== state.tz;
    state.tz = tz; state.src = src;
    if(changed){
      try { window.dispatchEvent(new CustomEvent('dt:timezonechange', { detail: { timeZone: tz } })); } catch(e){}
    }
  }

  var ready;
  if(pinned){
    ready = Promise.resolve(state.tz);
  } else if(cached && Date.now() - cached.at < RECHECK){
    ready = Promise.resolve(state.tz);
  } else {
    ready = fetch('https://ipwho.is/?fields=success,timezone', {
      signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(2500) : undefined
    })
      .then(function(r){ return r.json(); })
      .then(function(d){
        var tz = d && d.success !== false && d.timezone && d.timezone.id;
        if(tz && validTz(tz)){
          try { localStorage.setItem(KEY, JSON.stringify({ tz: tz, at: Date.now() })); } catch(e){}
          setZone(tz, 'ip');
        }
        return state.tz;
      })
      .catch(function(){ return state.tz; });
  }

  /* ---------- formatting: default every locale call to the chosen zone ---------- */
  function withZone(options){
    if(options && options.timeZone) return options;
    var out = {};
    if(options) for(var k in options) out[k] = options[k];
    if(state.tz) out.timeZone = state.tz;
    return out;
  }
  var proto = Date.prototype;
  var toLocaleString = proto.toLocaleString;
  var toLocaleDateString = proto.toLocaleDateString;
  var toLocaleTimeString = proto.toLocaleTimeString;
  proto.toLocaleString = function(locales, options){ return toLocaleString.call(this, locales, withZone(options)); };
  proto.toLocaleDateString = function(locales, options){ return toLocaleDateString.call(this, locales, withZone(options)); };
  proto.toLocaleTimeString = function(locales, options){ return toLocaleTimeString.call(this, locales, withZone(options)); };

  /* ---------- zone-aware day math (calendar grouping and filters) ---------- */
  var partsFmt = {};
  function partsIn(date){
    var key = state.tz || 'device';
    var f = partsFmt[key];
    if(!f){
      var opts = {
        hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      };
      if(state.tz) opts.timeZone = state.tz;
      f = partsFmt[key] = new Intl.DateTimeFormat('en-US', opts);
    }
    var out = {};
    f.formatToParts(date).forEach(function(x){ if(x.type !== 'literal') out[x.type] = x.value; });
    return out;
  }
  function offsetAt(date){
    var p = partsIn(date);
    var asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    return asUTC - Math.floor(date.getTime() / 1000) * 1000;
  }
  function toInstant(y, m, d, hh, mm, ss, ms){
    var target = Date.UTC(y, m - 1, d, hh, mm, ss, ms);
    var guess = target;
    for(var i = 0; i < 3; i++){
      var next = target - offsetAt(new Date(guess));
      if(next === guess) break;
      guess = next;
    }
    return new Date(guess);
  }
  function utcDate(y, m, d, hh){
    return new Date(Date.UTC(y, m - 1, d, hh || 12));
  }

  function zoneCity(){
    if(!state.tz) return '';
    var c = state.tz.split('/').pop();
    return c === 'UTC' || c === 'GMT' ? c : c.replace(/_/g, ' ');
  }
  function zoneAbbr(){
    if(!state.tz) return '';
    try {
      var out = '';
      new Intl.DateTimeFormat('en-US', { timeZone: state.tz, timeZoneName: 'short' })
        .formatToParts(new Date()).forEach(function(p){ if(p.type === 'timeZoneName') out = p.value; });
      return out;
    } catch(e){ return ''; }
  }

  window.DTTime = {
    ready: ready,
    tz: function(){ return state.tz; },
    source: function(){ return state.src; },
    city: zoneCity,
    abbr: zoneAbbr,
    label: function(){
      var city = zoneCity(), abbr = zoneAbbr();
      return city ? city + (abbr && abbr !== city ? ' (' + abbr + ')' : '') : (state.tz || '');
    },
    parts: function(d){ return partsIn(d || new Date()); },
    dateKey: function(d){
      var p = partsIn(d || new Date());
      return p.year + '-' + p.month + '-' + p.day;
    },
    dateInZone: function(y, m, d){ return toInstant(y, m, d, 12, 0, 0, 0); },
    startOfDay: function(d){ var p = partsIn(d); return toInstant(+p.year, +p.month, +p.day, 0, 0, 0, 0); },
    endOfDay: function(d){ var p = partsIn(d); return toInstant(+p.year, +p.month, +p.day, 23, 59, 59, 999); },
    addDays: function(d, n){
      var p = partsIn(d);
      var t = utcDate(+p.year, +p.month, +p.day + n);
      return toInstant(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate(), 12, 0, 0, 0);
    },
    startOfWeek: function(d){
      var p = partsIn(d);
      var wd = utcDate(+p.year, +p.month, +p.day).getUTCDay();
      var t = utcDate(+p.year, +p.month, +p.day - wd);
      return toInstant(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate(), 0, 0, 0, 0);
    },
    endOfWeek: function(d){
      var p = partsIn(d);
      var wd = utcDate(+p.year, +p.month, +p.day).getUTCDay();
      var t = utcDate(+p.year, +p.month, +p.day - wd + 6);
      return toInstant(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate(), 23, 59, 59, 999);
    },
    startOfMonth: function(d){
      var p = partsIn(d);
      return toInstant(+p.year, +p.month, 1, 0, 0, 0, 0);
    },
    endOfMonth: function(d){
      var p = partsIn(d);
      var last = new Date(Date.UTC(+p.year, +p.month, 0)).getUTCDate();
      return toInstant(+p.year, +p.month, last, 23, 59, 59, 999);
    },
    startOfMonthOffset: function(d, n){
      var p = partsIn(d);
      var t = new Date(Date.UTC(+p.year, +p.month - 1 + n, 1, 12));
      return toInstant(t.getUTCFullYear(), t.getUTCMonth() + 1, 1, 12, 0, 0, 0);
    }
  };

  // Explain the zone on hover without altering the nav layout
  function labelClock(){
    var el = document.getElementById('navClock');
    if(el && state.tz) el.title = 'Times shown in your local timezone';
  }
  ready.then(labelClock);
  window.addEventListener('dt:timezonechange', labelClock);
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', labelClock);
})();
