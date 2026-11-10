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
  
  function rgbToHex(r, g, b) {
    var clamp = function (v) { return Math.max(0, Math.min(255, Math.round(v))); };
    var toHex = function (v) { return clamp(v).toString(16).padStart(2, '0'); };
    return ('#' + toHex(r) + toHex(g) + toHex(b)).toUpperCase();
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h, s, l = (max + min) / 2;
    if (max === min) {
      h = s = 0;
    } else {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
  }

  function hslToRgb(h, s, l) {
    h /= 360; s /= 100; l /= 100;
    var r, g, b;
    if (s === 0) {
      r = g = b = l;
    } else {
      var hue2rgb = function (p, q, t) {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };
      var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      var p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }
    return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
  }

  function generateShades(baseHex) {
    if (!baseHex) return {};
    var rgb = hexToRgb(baseHex);
    var hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
    var lightnessMap = {
      50: 96, 100: 92, 200: 84, 300: 72, 400: 60,
      500: Math.max(25, Math.min(52, hsl.l)),
      600: 42, 700: 32, 800: 22, 900: 14
    };
    var shades = {};
    for (var weight in lightnessMap) {
      var targetL = lightnessMap[weight];
      var sat = hsl.s;
      if (weight === '50') sat = Math.max(15, sat * 0.45);
      else if (weight === '100') sat = Math.max(20, sat * 0.65);
      else if (weight === '200') sat = Math.max(25, sat * 0.85);
      else if (weight === '900') sat = Math.min(95, sat * 0.95);
      var shadeRgb = hslToRgb(hsl.h, sat, targetL);
      shades[weight] = rgbToHex(shadeRgb.r, shadeRgb.g, shadeRgb.b);
    }
    return shades;
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

    var primaryShades = generateShades(c.brand.primary);
    var secondaryShades = generateShades(c.brand.secondary || '#287A50');

    var css = ':root, :root:root {\n' +
      '  --primary: ' + c.brand.primary + ';\n' +
      '  --primary-hover: ' + (c.brand.primaryHover || c.brand.primary) + ';\n' +
      '  --primary-light: ' + (c.brand.primaryLight || c.brand.primary) + ';\n' +
      '  --primary-rgb: ' + primaryRgb.r + ', ' + primaryRgb.g + ', ' + primaryRgb.b + ';\n' +
      '  --secondary: ' + (c.brand.secondary || '#287A50') + ';\n' +
      '  --secondary-rgb: ' + secondaryRgb.r + ', ' + secondaryRgb.g + ', ' + secondaryRgb.b + ';\n' +
      '  --accent: ' + (c.brand.accent || '#0E8388') + ';\n' +
      '  --accent-rgb: ' + accentRgb.r + ', ' + accentRgb.g + ', ' + accentRgb.b + ';\n';

    for (var pW in primaryShades) {
      css += '  --primary-' + pW + ': ' + primaryShades[pW] + ';\n';
    }
    for (var sW in secondaryShades) {
      css += '  --secondary-' + sW + ': ' + secondaryShades[sW] + ';\n';
    }

    css += '  --background: ' + (c.backgrounds ? c.backgrounds.background : '#F7F9F7') + ';\n' +
      '  --background-rgb: ' + bgRgb.r + ', ' + bgRgb.g + ', ' + bgRgb.b + ';\n' +
      '  --surface: ' + (c.backgrounds ? c.backgrounds.surface : '#FFFFFF') + ';\n' +
      '  --surface-rgb: ' + surfaceRgb.r + ', ' + surfaceRgb.g + ', ' + surfaceRgb.b + ';\n' +
      '  --sidebar: ' + (c.backgrounds ? c.backgrounds.sidebar : c.brand.primary) + ';\n' +
      '  --sidebar-text: ' + (c.backgrounds ? c.backgrounds.sidebarText : '#FFFFFF') + ';\n' +
      '  --sidebar-muted: ' + (c.backgrounds ? c.backgrounds.sidebarMuted : '#A1CBB7') + ';\n' +
      '  --navbar: ' + (c.backgrounds ? c.backgrounds.navbar : '#FFFFFF') + ';\n' +
      '  --navbar-border: ' + (c.backgrounds ? (c.backgrounds.navbarBorder || (c.borders && c.borders.border)) : '#E5EAE6') + ';\n' +
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
    /**
   * Checks for remote version changes and swaps if updated
   */
  function checkAndSyncTheme(force, onComplete) {
    state.lastCheck = new Date();
    var cleanBase = (state.themeServer || 'https://ui-theme.pydah.edu.in').replace(/\/$/, '');

    // 1. Authoritative check: fetch live active theme directly from /api/theme/active
    var apiUrl = cleanBase + '/api/theme/active?_t=' + Date.now();
    var xhr = new XMLHttpRequest();
    xhr.open('GET', apiUrl, true);
    xhr.timeout = 4000;

    xhr.onload = function () {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          var activeData = JSON.parse(xhr.responseText);
          var activeVersion = activeData.version || '1.0.0';
          var lastPub = activeData.lastPublished || '';

          if (force || activeVersion !== state.currentVersion || (lastPub && lastPub !== state.lastPublished)) {
            console.info('[ThemeLoader] Live theme update detected (' + state.currentVersion + ' -> ' + activeVersion + '). Applying...');
            var compiledCss = generateCSSFromThemeJSON(activeData);
            if (compiledCss) {
              state.lastPublished = lastPub;
              storeAndApplyCSS(compiledCss, activeVersion, onComplete);
              return;
            }
          } else {
            // Already on latest version
            if (onComplete) onComplete(null, state.currentVersion);
            return;
          }
        } catch (e) {}
      }

      // 2. Fallback: if /api/theme/active is unreachable, try static version.json and theme.css
      fetchVersionAndStylesheetFallback(cleanBase, force, onComplete);
    };

    xhr.onerror = function () {
      fetchVersionAndStylesheetFallback(cleanBase, force, onComplete);
    };

    xhr.ontimeout = function () {
      fetchVersionAndStylesheetFallback(cleanBase, force, onComplete);
    };

    try {
      xhr.send();
    } catch (e) {
      fetchVersionAndStylesheetFallback(cleanBase, force, onComplete);
    }
  }

  function fetchVersionAndStylesheetFallback(cleanBase, force, onComplete) {
    fetchVersionFromUrl(cleanBase, 3000, function (err, data, resolvedBase) {
      if (!err && data && data.version) {
        state.consecutiveFailures = 0;
        var remoteVersion = data.version;
        if (force || remoteVersion !== state.currentVersion) {
          applyThemeStylesheet(resolvedBase, remoteVersion, onComplete);
        } else {
          if (onComplete) onComplete(null, state.currentVersion);
        }
        return;
      }
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
    },
    getToken: function (name) {
      if (!name || typeof window === 'undefined') return '';
      var varName = name;
      if (varName.indexOf('--') !== 0) {
        varName = '--' + varName.replace(/([A-Z])/g, '-$1').toLowerCase();
      }
      try {
        var val = window.getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
        if (val) return val;
      } catch (e) {}
      return '';
    },
    getTokens: function () {
      if (typeof window === 'undefined') return {};
      var style = window.getComputedStyle(document.documentElement);
      var tokenKeys = [
        'primary', 'primary-hover', 'primary-light', 'primary-rgb',
        'primary-50', 'primary-100', 'primary-200', 'primary-300', 'primary-400',
        'primary-500', 'primary-600', 'primary-700', 'primary-800', 'primary-900',
        'secondary', 'secondary-rgb',
        'secondary-50', 'secondary-100', 'secondary-200', 'secondary-300', 'secondary-400',
        'secondary-500', 'secondary-600', 'secondary-700', 'secondary-800', 'secondary-900',
        'accent', 'accent-rgb',
        'background', 'background-rgb',
        'surface', 'surface-rgb',
        'sidebar', 'sidebar-text', 'sidebar-muted',
        'navbar', 'navbar-border',
        'text-primary', 'text-secondary', 'text-muted',
        'border', 'border-strong',
        'success', 'warning', 'danger', 'info',
        'success-light', 'warning-light', 'danger-light', 'info-light'
      ];
      var result = {};
      for (var i = 0; i < tokenKeys.length; i++) {
        var k = tokenKeys[i];
        var val = style.getPropertyValue('--' + k).trim();
        if (val) {
          result[k] = val;
          var camel = k.replace(/-([a-z0-9])/g, function (g) { return g[1].toUpperCase(); });
          result[camel] = val;
        }
      }
      return result;
    }
  };
});
