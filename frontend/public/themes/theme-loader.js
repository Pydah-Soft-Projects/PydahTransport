/**
 * Runtime Theme Loader
 * 
 * Lightweight, zero-dependency theme client for connected applications.
 * Automatically loads centralized theme CSS, polls for updates, and swaps stylesheets
 * seamlessly without page reload or FOUC (Flash of Unstyled Content).
 * Caches full active CSS to localStorage for robust offline resilience,
 * guaranteeing the last synced theme is displayed even when the central server is unavailable.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    var instance = factory();
    root.ThemeLoader = instance;
    // Backward compatibility for existing portals
    root.PydahThemeLoader = instance;
  }
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var STYLE_ID_ACTIVE = 'app-theme-active';
  var STYLE_ID_CACHED = 'app-theme-cached';
  var STYLE_ID_FALLBACK = 'app-theme-fallback';
  var STORAGE_VERSION_KEY = 'app_theme_version';
  var STORAGE_CSS_KEY = 'app_theme_css';

  // Fallback CSS variables if central server is completely unreachable and NO cache exists
  var FALLBACK_CSS = [
    ':root, :root:root {',
    '  --primary: #145A3A;',
    '  --primary-hover: #10452E;',
    '  --primary-light: #E5F2E9;',
    '  --primary-rgb: 20, 90, 58;',
    '  --secondary: #287A50;',
    '  --secondary-rgb: 40, 122, 80;',
    '  --accent: #0E8388;',
    '  --background: #F7F9F7;',
    '  --surface: #FFFFFF;',
    '  --sidebar: #145A3A;',
    '  --sidebar-text: #FFFFFF;',
    '  --sidebar-muted: #A1CBB7;',
    '  --navbar: #FFFFFF;',
    '  --navbar-border: #E5EAE6;',
    '  --text-primary: #252B27;',
    '  --text-secondary: #5B645E;',
    '  --text-muted: #8D9790;',
    '  --border: #E5EAE6;',
    '  --border-strong: #CBD5CE;',
    '  --success: #198754;',
    '  --warning: #F0AD4E;',
    '  --danger: #DC3545;',
    '  --info: #0D6EFD;',
    '}'
  ].join('\n');

  var state = {
    initialized: false,
    themeServer: 'https://ui-theme.pydah.edu.in',
    pollInterval: 30, // seconds
    currentVersion: null,
    pollTimer: null,
    status: 'idle', // 'idle' | 'loading' | 'active' | 'error'
    lastCheck: null,
    consecutiveFailures: 0
  };

  /**
   * Helper to convert HEX to RGB
   */
  function hexToRgb(hex) {
    if (!hex) return { r: 20, g: 90, b: 58 };
    var cleanHex = hex.replace('#', '').trim();
    if (cleanHex.length === 3) {
      cleanHex = cleanHex.split('').map(function (c) { return c + c; }).join('');
    }
    var num = parseInt(cleanHex, 16);
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255
    };
  }

  /**
   * Generates CSS from active theme JSON payload (used as fallback when theme.css is not directly accessible)
   */
  function generateCSSFromThemeJSON(theme) {
    var c = theme.colors;
    if (!c || !c.brand) return '';

    var primaryRgb = hexToRgb(c.brand.primary);
    var secondaryRgb = hexToRgb(c.brand.secondary || '#287A50');
    var accentRgb = hexToRgb(c.brand.accent || '#0E8388');
    var bgRgb = hexToRgb(c.backgrounds ? c.backgrounds.background : '#F7F9F7');
    var surfaceRgb = hexToRgb(c.backgrounds ? c.backgrounds.surface : '#FFFFFF');

    var css = ':root, :root:root {\n' +
      '  --primary: ' + c.brand.primary + ';\n' +
      '  --primary-hover: ' + (c.brand.primaryHover || c.brand.primary) + ';\n' +
      '  --primary-light: ' + (c.brand.primaryLight || c.brand.primary) + ';\n' +
      '  --primary-rgb: ' + primaryRgb.r + ', ' + primaryRgb.g + ', ' + primaryRgb.b + ';\n' +
      '  --secondary: ' + (c.brand.secondary || '#287A50') + ';\n' +
      '  --secondary-rgb: ' + secondaryRgb.r + ', ' + secondaryRgb.g + ', ' + secondaryRgb.b + ';\n' +
      '  --accent: ' + (c.brand.accent || '#0E8388') + ';\n' +
      '  --accent-rgb: ' + accentRgb.r + ', ' + accentRgb.g + ', ' + accentRgb.b + ';\n' +
      '  --background: ' + (c.backgrounds ? c.backgrounds.background : '#F7F9F7') + ';\n' +
      '  --background-rgb: ' + bgRgb.r + ', ' + bgRgb.g + ', ' + bgRgb.b + ';\n' +
      '  --surface: ' + (c.backgrounds ? c.backgrounds.surface : '#FFFFFF') + ';\n' +
      '  --surface-rgb: ' + surfaceRgb.r + ', ' + surfaceRgb.g + ', ' + surfaceRgb.b + ';\n' +
      '  --sidebar: ' + (c.backgrounds ? c.backgrounds.sidebar : c.brand.primary) + ';\n' +
      '  --sidebar-text: ' + (c.backgrounds ? c.backgrounds.sidebarText : '#FFFFFF') + ';\n' +
      '  --sidebar-muted: ' + (c.backgrounds ? c.backgrounds.sidebarMuted : '#A1CBB7') + ';\n' +
      '  --navbar: ' + (c.backgrounds ? c.backgrounds.navbar : '#FFFFFF') + ';\n' +
      '  --navbar-border: ' + (c.backgrounds ? (c.backgrounds.navbarBorder || c.borders.border) : '#E5EAE6') + ';\n' +
      '  --text-primary: ' + (c.typography ? c.typography.textPrimary : '#252B27') + ';\n' +
      '  --text-secondary: ' + (c.typography ? c.typography.textSecondary : '#5B645E') + ';\n' +
      '  --text-muted: ' + (c.typography ? c.typography.textMuted : '#8D9790') + ';\n' +
      '  --border: ' + (c.borders ? c.borders.border : '#E5EAE6') + ';\n' +
      '  --border-strong: ' + (c.borders ? c.borders.borderStrong : '#CBD5CE') + ';\n' +
      '  --success: ' + (c.semantic ? c.semantic.success : '#198754') + ';\n' +
      '  --warning: ' + (c.semantic ? c.semantic.warning : '#F0AD4E') + ';\n' +
      '  --danger: ' + (c.semantic ? c.semantic.danger : '#DC3545') + ';\n' +
      '  --info: ' + (c.semantic ? c.semantic.info : '#0D6EFD') + ';\n' +
      '  --success-light: ' + (c.semantic ? c.semantic.success : '#198754') + '1A;\n' +
      '  --warning-light: ' + (c.semantic ? c.semantic.warning : '#F0AD4E') + '1A;\n' +
      '  --danger-light: ' + (c.semantic ? c.semantic.danger : '#DC3545') + '1A;\n' +
      '  --info-light: ' + (c.semantic ? c.semantic.info : '#0D6EFD') + '1A;\n' +
      '}\n';

    return css;
  }

  /**
   * Enhances CSS specificity to ensure cached theme rules take precedence over any
   * bundled :root declarations during Vite hydration or page reload.
   */
  function enhanceSpecificity(css) {
    if (!css) return '';
    return css.replace(/:root\b/g, ':root, :root:root');
  }

  /**
   * Immediately applies cached CSS from localStorage
   */
  function applyCachedTheme() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return false;
    try {
      var cachedCss = localStorage.getItem(STORAGE_CSS_KEY);
      if (cachedCss) {
        var existing = document.getElementById(STYLE_ID_CACHED);
        var target = document.head || document.documentElement;
        if (!existing && target) {
          var style = document.createElement('style');
          style.id = STYLE_ID_CACHED;
          style.textContent = enhanceSpecificity(cachedCss);
          target.appendChild(style);
        } else if (existing) {
          existing.textContent = enhanceSpecificity(cachedCss);
          if (target && existing.parentNode === target) {
            target.appendChild(existing);
          }
        }
        return true;
      }
    } catch (e) {}
    return false;
  }

  // Attempt instant application synchronously as script evaluates
  applyCachedTheme();

  // Re-verify immediately on DOMContentLoaded in case head was modified during hydration
  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', applyCachedTheme);
  }

  /**
   * Helper to inspect current script element configuration
   */
  function detectScriptConfig() {
    if (typeof document === 'undefined') return {};
    var scripts = document.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i++) {
      var s = scripts[i];
      if (s.src && s.src.indexOf('theme-loader.js') !== -1) {
        var base = '';
        try {
          var url = new URL(s.src, window.location.href);
          base = url.origin;
        } catch (e) {
          base = '';
        }
        return {
          themeServer: s.getAttribute('data-theme-server') || base || 'https://ui-theme.pydah.edu.in',
          pollInterval: parseInt(s.getAttribute('data-poll-interval'), 10) || 30
        };
      }
    }
    return {};
  }

  /**
   * Dispatches theme lifecycle events
   */
  function dispatchEvent(name, detail) {
    if (typeof window !== 'undefined' && window.dispatchEvent) {
      try {
        var evt = new CustomEvent(name, { detail: detail });
        window.dispatchEvent(evt);
      } catch (e) {
        var legacyEvt = document.createEvent('CustomEvent');
        legacyEvt.initCustomEvent(name, false, false, detail);
        window.dispatchEvent(legacyEvt);
      }
    }
  }

  function broadcastUpdate(detail) {
    dispatchEvent('theme:updated', detail);
    dispatchEvent('pydah:theme-updated', detail);
  }

  /**
   * Injects fallback CSS ONLY if no theme has ever been cached in localStorage
   */
  function injectFallbackCSS() {
    // 1. If we have a cached theme, preserve it! Never override!
    if (applyCachedTheme()) {
      console.info('[ThemeLoader] Preserving last synced theme from cache.');
      return;
    }

    // 2. Only if no theme was ever synced (first visit offline), inject fallback tokens
    var existingFallback = document.getElementById(STYLE_ID_FALLBACK);
    if (!existingFallback) {
      var target = document.head || document.documentElement;
      if (target) {
        var style = document.createElement('style');
        style.id = STYLE_ID_FALLBACK;
        style.textContent = FALLBACK_CSS;
        target.appendChild(style);
        console.warn('[ThemeLoader] Central server unreachable and no cached theme found. Injected fallback theme CSS.');
      }
    }
  }

  function removeFallbackCSS() {
    var fallback = document.getElementById(STYLE_ID_FALLBACK);
    if (fallback && fallback.parentNode) {
      fallback.parentNode.removeChild(fallback);
    }
  }

  /**
   * Saves and injects active CSS string
   */
  function storeAndApplyCSS(cssText, version, onComplete) {
    var formatted = enhanceSpecificity(cssText);

    try {
      localStorage.setItem(STORAGE_CSS_KEY, cssText);
      localStorage.setItem(STORAGE_VERSION_KEY, version);
    } catch (e) {}

    var target = document.head || document.documentElement;
    var activeStyle = document.getElementById(STYLE_ID_CACHED);
    if (!activeStyle && target) {
      activeStyle = document.createElement('style');
      activeStyle.id = STYLE_ID_CACHED;
      target.appendChild(activeStyle);
    }
    if (activeStyle) {
      activeStyle.textContent = formatted;
      if (target && activeStyle.parentNode === target) {
        target.appendChild(activeStyle);
      }
    }

    removeFallbackCSS();

    state.currentVersion = version;
    state.status = 'active';
    state.consecutiveFailures = 0;

    console.info('[ThemeLoader] Successfully applied & cached theme version: ' + version);

    broadcastUpdate({
      version: version,
      timestamp: new Date().toISOString()
    });

    if (onComplete) onComplete(null, version);
  }

  /**
   * Fetches active theme: first tries theme.css; if 404, falls back to /api/theme/active
   */
  function applyThemeStylesheet(serverBase, version, onComplete) {
    var serverUrl = serverBase.replace(/\/$/, '');
    var cssUrl = serverUrl + '/themes/theme.css?v=' + encodeURIComponent(version) + '&_t=' + Date.now();

    var xhr = new XMLHttpRequest();
    xhr.open('GET', cssUrl, true);
    xhr.timeout = 5000;

    xhr.onload = function () {
      if (xhr.status >= 200 && xhr.status < 300 && xhr.responseText) {
        storeAndApplyCSS(xhr.responseText, version, onComplete);
      } else {
        // Fallback: Fetch directly from /api/theme/active (which is active on live backend)
        fetchActiveThemeApi(serverUrl, version, onComplete);
      }
    };

    xhr.onerror = function () {
      fetchActiveThemeApi(serverUrl, version, onComplete);
    };

    xhr.ontimeout = function () {
      fetchActiveThemeApi(serverUrl, version, onComplete);
    };

    try {
      xhr.send();
    } catch (err) {
      fetchActiveThemeApi(serverUrl, version, onComplete);
    }
  }

  /**
   * Fetches theme JSON from /api/theme/active and compiles CSS on client
   */
  function fetchActiveThemeApi(serverUrl, version, onComplete) {
    var apiUrl = serverUrl + '/api/theme/active?_t=' + Date.now();
    var xhr = new XMLHttpRequest();
    xhr.open('GET', apiUrl, true);
    xhr.timeout = 5000;

    xhr.onload = function () {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          var themeData = JSON.parse(xhr.responseText);
          var compiledCss = generateCSSFromThemeJSON(themeData);
          if (compiledCss) {
            storeAndApplyCSS(compiledCss, version || themeData.version || '1.0.0', onComplete);
            return;
          }
        } catch (e) {}
      }
      injectFallbackCSS();
      if (onComplete) onComplete(new Error('Failed to fetch theme from CSS or API'));
    };

    xhr.onerror = function (err) {
      injectFallbackCSS();
      if (onComplete) onComplete(err);
    };

    xhr.ontimeout = function () {
      injectFallbackCSS();
      if (onComplete) onComplete(new Error('Timeout fetching theme API'));
    };

    try {
      xhr.send();
    } catch (err) {
      injectFallbackCSS();
      if (onComplete) onComplete(err);
    }
  }

  /**
   * Fetches version.json from target serverUrl
   */
  function fetchVersionFromUrl(serverUrl, timeoutMs, callback) {
    var cleanBase = serverUrl.replace(/\/$/, '');
    var versionUrl = cleanBase + '/themes/version.json?_t=' + Date.now();

    var xhr = new XMLHttpRequest();
    xhr.open('GET', versionUrl, true);
    xhr.setRequestHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    xhr.setRequestHeader('Pragma', 'no-cache');
    xhr.timeout = timeoutMs || 3000;

    xhr.onload = function () {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          var data = JSON.parse(xhr.responseText);
          callback(null, data, cleanBase);
        } catch (e) {
          callback(new Error('Invalid version JSON response'));
        }
      } else {
        // Fallback to /version.json
        var fallbackVersionUrl = cleanBase + '/version.json?_t=' + Date.now();
        var xhrFallback = new XMLHttpRequest();
        xhrFallback.open('GET', fallbackVersionUrl, true);
        xhrFallback.onload = function () {
          if (xhrFallback.status >= 200 && xhrFallback.status < 300) {
            try {
              var fbData = JSON.parse(xhrFallback.responseText);
              callback(null, fbData, cleanBase);
              return;
            } catch (e) {}
          }
          callback(new Error('HTTP status ' + xhr.status));
        };
        xhrFallback.onerror = function () { callback(new Error('Network error')); };
        xhrFallback.send();
      }
    };

    xhr.onerror = function () {
      callback(new Error('Network error connecting to ' + cleanBase));
    };

    xhr.ontimeout = function () {
      callback(new Error('Timeout connecting to ' + cleanBase));
    };

    try {
      xhr.send();
    } catch (err) {
      callback(err);
    }
  }

  /**
   * Checks for remote version changes and swaps if updated
   */
  function checkAndSyncTheme(force, onComplete) {
    state.lastCheck = new Date();

    // Target: Central Theme Server (Production or configured server)
    fetchVersionFromUrl(state.themeServer, 3000, function (err, data, resolvedBase) {
      if (!err && data && data.version) {
        state.consecutiveFailures = 0;
        var remoteVersion = data.version;
        if (force || remoteVersion !== state.currentVersion) {
          console.log('[ThemeLoader] Syncing theme (' + state.currentVersion + ' -> ' + remoteVersion + ')...');
          applyThemeStylesheet(resolvedBase, remoteVersion, onComplete);
        } else {
          if (onComplete) onComplete(null, state.currentVersion);
        }
        return;
      }

      // If remote server check fails, preserve active cached theme
      injectFallbackCSS();
      if (onComplete) onComplete(err);
    });
  }

  /**
   * Starts background polling loop
   */
  function startPolling() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
    }

    var intervalMs = Math.max(5, state.pollInterval) * 1000;
    state.pollTimer = setInterval(function () {
      checkAndSyncTheme(false);
    }, intervalMs);
  }

  /**
   * Initialize Theme Loader
   */
  function init(options) {
    if (state.initialized) {
      return state;
    }

    var detected = detectScriptConfig();
    options = options || {};

    state.themeServer = options.themeServer || detected.themeServer || 'https://ui-theme.pydah.edu.in';
    state.pollInterval = options.pollInterval || detected.pollInterval || 30;
    state.initialized = true;

    try {
      var cachedVer = localStorage.getItem(STORAGE_VERSION_KEY);
      if (cachedVer) {
        state.currentVersion = cachedVer;
      }
    } catch (e) {}

    // Apply last synced theme from cache immediately
    applyCachedTheme();

    checkAndSyncTheme(true, function (err) {
      if (err) {
        console.warn('[ThemeLoader] Remote theme server offline. Operating in resilient cached mode with last synced theme.');
      }
      startPolling();
    });

    return state;
  }

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    var detected = detectScriptConfig();
    if (detected.themeServer) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
          init(detected);
        });
      } else {
        init(detected);
      }
    }
  }

  return {
    init: init,
    checkNow: function (callback) {
      checkAndSyncTheme(true, callback);
    },
    getVersion: function () {
      return state.currentVersion;
    },
    getState: function () {
      return {
        initialized: state.initialized,
        themeServer: state.themeServer,
        pollInterval: state.pollInterval,
        currentVersion: state.currentVersion,
        lastCheck: state.lastCheck,
        status: state.status,
        failures: state.consecutiveFailures
      };
    },
    setServer: function (url) {
      state.themeServer = url;
      checkAndSyncTheme(true);
    }
  };
});
