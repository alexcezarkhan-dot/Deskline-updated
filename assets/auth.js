/* DeskTerminal — shared authentication dialog.
   Google-only sign in / sign up, one professional dialog on every page.
   Loaded immediately before the Supabase script so the dialog exists before
   each page's inline auth script looks for it. */
(function(){
  var DEFAULT_URL = 'https://odlyvhxhktdjrydpkmta.supabase.co';
  var DEFAULT_KEY = 'sb_publishable_zTpEf6S1XsS4JgPpjpXTFg_7atZZvFu';

  var script = document.currentScript;
  var prefix = '';
  var m = script && script.src ? script.src.match(/^(.*\/)assets\/auth\.js(?:[?#].*)?$/) : null;
  if(m) prefix = m[1];

  var COPY = {
    signin: {
      title: 'Sign in to DeskTerminal',
      sub: 'Welcome back. Continue with Google to reach your watchlist, saved settings, and journal.',
      btn: 'Continue with Google',
      switchText: 'New to DeskTerminal?',
      switchBtn: 'Create an account'
    },
    signup: {
      title: 'Create your DeskTerminal account',
      sub: 'One step with Google — no passwords to remember, no forms to fill in.',
      btn: 'Sign up with Google',
      switchText: 'Already have an account?',
      switchBtn: 'Sign in'
    }
  };

  var mode = 'signin';
  var lastFocus = null;
  var loading = false;

  var GOOGLE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>' +
    '<path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>' +
    '<path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>' +
    '<path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>';

  function markup(){
    return '' +
      '<div class="auth-modal" role="dialog" aria-modal="true" aria-labelledby="authModalTitle" aria-describedby="authModalSub">' +
        '<button type="button" class="auth-modal-close" id="authModalClose" aria-label="Close dialog">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
        '</button>' +
        '<div class="auth-brand" aria-hidden="true">' +
          '<span class="auth-brand-mark">DT</span>' +
          '<span class="auth-brand-word">Desk<span>Terminal</span></span>' +
        '</div>' +
        '<h2 class="auth-modal-title" id="authModalTitle">Sign in to DeskTerminal</h2>' +
        '<p class="auth-modal-sub" id="authModalSub"></p>' +
        '<button type="button" class="auth-google-btn" id="authGoogleBtn">' +
          '<span class="auth-google-icon">' + GOOGLE_SVG + '</span>' +
          '<span class="auth-google-label" id="authGoogleLabel">Continue with Google</span>' +
          '<span class="auth-spinner" aria-hidden="true"></span>' +
        '</button>' +
        '<p class="auth-error" id="authError" role="alert" hidden></p>' +
        '<p class="auth-legal">By continuing, you agree to our ' +
          '<a href="' + prefix + 'legal/terms.html">Terms of Service</a> and ' +
          '<a href="' + prefix + 'legal/privacy-policy.html">Privacy Policy</a>.</p>' +
        '<p class="auth-switch"><span id="authSwitchText">New to DeskTerminal?</span> ' +
          '<button type="button" class="auth-switch-btn" id="authSwitchBtn">Create an account</button></p>' +
      '</div>';
  }

  function ensureOverlay(){
    var overlay = document.getElementById('authModalOverlay');
    if(!overlay){
      overlay = document.createElement('div');
      overlay.id = 'authModalOverlay';
      overlay.className = 'auth-modal-overlay';
      document.body.appendChild(overlay);
    }
    overlay.setAttribute('role', 'presentation');
    if(overlay.getAttribute('data-dt-auth') !== '1'){
      overlay.innerHTML = markup();
      overlay.setAttribute('data-dt-auth', '1');
    }
    return overlay;
  }

  function el(id){ return document.getElementById(id); }

  function setMode(next){
    mode = next === 'signup' ? 'signup' : 'signin';
    var c = COPY[mode];
    if(el('authModalTitle')) el('authModalTitle').textContent = c.title;
    if(el('authModalSub')) el('authModalSub').textContent = c.sub;
    if(el('authGoogleLabel')) el('authGoogleLabel').textContent = c.btn;
    if(el('authSwitchText')) el('authSwitchText').textContent = c.switchText;
    if(el('authSwitchBtn')) el('authSwitchBtn').textContent = c.switchBtn;
    clearError();
  }

  function setLoading(state){
    loading = state;
    var btn = el('authGoogleBtn');
    var overlay = document.getElementById('authModalOverlay');
    if(btn){
      btn.disabled = state;
      btn.setAttribute('aria-busy', state ? 'true' : 'false');
    }
    if(overlay) overlay.setAttribute('data-loading', state ? 'true' : 'false');
    if(state){
      var label = el('authGoogleLabel');
      if(label) label.textContent = 'Redirecting to Google…';
    } else {
      var c = COPY[mode];
      if(el('authGoogleLabel')) el('authGoogleLabel').textContent = c.btn;
    }
  }

  function showError(message){
    var box = el('authError');
    if(!box) return;
    box.textContent = message;
    box.hidden = false;
  }
  function clearError(){
    var box = el('authError');
    if(!box) return;
    box.textContent = '';
    box.hidden = true;
  }

  function open(nextMode, trigger){
    ensureOverlay();
    setMode(nextMode || 'signin');
    setLoading(false);
    lastFocus = trigger || document.activeElement;
    var overlay = document.getElementById('authModalOverlay');
    overlay.classList.add('open');
    document.body.classList.add('auth-lock');
    var closeBtn = el('authModalClose');
    if(closeBtn) setTimeout(function(){ closeBtn.focus({ preventScroll: true }); }, 30);
  }

  function close(){
    var overlay = document.getElementById('authModalOverlay');
    if(!overlay || !overlay.classList.contains('open')) return;
    overlay.classList.remove('open');
    document.body.classList.remove('auth-lock');
    setLoading(false);
    clearError();
    if(lastFocus && lastFocus.focus) {
      try { lastFocus.focus({ preventScroll: true }); } catch(e){ lastFocus.focus(); }
    }
    lastFocus = null;
  }

  function getClient(){
    if(window.__dtAuthClient) return window.__dtAuthClient;
    try {
      if(typeof sb !== 'undefined' && sb && sb.auth){
        window.__dtAuthClient = sb;
        return sb;
      }
    } catch(e){ /* sb not initialised yet */ }
    if(window.supabase){
      var url = (typeof SUPABASE_URL !== 'undefined') ? SUPABASE_URL : DEFAULT_URL;
      var key = (typeof SUPABASE_KEY !== 'undefined') ? SUPABASE_KEY : DEFAULT_KEY;
      window.__dtAuthClient = window.supabase.createClient(url, key);
      return window.__dtAuthClient;
    }
    return null;
  }

  async function startGoogle(){
    if(loading) return;
    clearError();
    var client = getClient();
    if(!client){
      showError('Sign-in is temporarily unavailable. Please reload the page and try again.');
      return;
    }
    setLoading(true);
    try {
      var result = await client.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.href.split('#')[0],
          queryParams: { prompt: 'select_account' }
        }
      });
      if(result && result.error) throw result.error;
    } catch(err){
      setLoading(false);
      showError('We could not start Google sign-in. Please try again in a moment.');
      if(window.console && console.warn) console.warn('[auth] Google sign-in failed:', err && err.message ? err.message : err);
    }
  }

  var ready = false;
  function patchGlobals(){
    // Reapplied after the page's inline auth script runs, which assigns its
    // own (now redundant) openAuthModal on load.
    window.openAuthModal = function(){ open('signin'); };
    window.closeAuthModal = close;
    window.dtOpenAuth = open;
  }
  function bind(){
    patchGlobals();
    if(ready) return;
    ready = true;

    var overlay = document.getElementById('authModalOverlay');
    var closeBtn = el('authModalClose');
    var googleBtn = el('authGoogleBtn');
    var switchBtn = el('authSwitchBtn');

    if(closeBtn) closeBtn.addEventListener('click', close);
    if(googleBtn) googleBtn.addEventListener('click', startGoogle);
    if(switchBtn) switchBtn.addEventListener('click', function(){ setMode(mode === 'signin' ? 'signup' : 'signin'); });
    if(overlay){
      overlay.addEventListener('click', function(e){
        if(e.target === overlay) close();
      });
      overlay.addEventListener('keydown', function(e){
        if(e.key === 'Escape'){ e.preventDefault(); close(); return; }
        if(e.key !== 'Tab') return;
        var focusables = overlay.querySelectorAll('button:not([disabled]), a[href]');
        if(!focusables.length) return;
        var first = focusables[0];
        var last = focusables[focusables.length - 1];
        if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
        else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
      });
    }

  }

  // Capture phase beats each page's own click handlers, including buttons
  // re-rendered by showLoggedOutUI() after sign-out.
  document.addEventListener('click', function(e){
    var target = e.target && e.target.closest ? e.target.closest('#loginBtn, #signupBtn, [data-auth-open]') : null;
    if(!target) return;
    e.preventDefault();
    e.stopPropagation();
    var requested = target.getAttribute('data-auth-open') || (target.id === 'signupBtn' ? 'signup' : 'signin');
    open(requested === 'signup' ? 'signup' : 'signin', target);
  }, true);

  // Build the dialog before this script returns so the inline auth script
  // on each page always finds a real overlay element.
  if(document.body) ensureOverlay();
  bind();
  setMode('signin');

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
