import { useState, useEffect } from 'react';

/**
 * Standard token getter reading from window.ThemeLoader or computed DOM styles.
 */
function getLiveTokens() {
  if (typeof window === 'undefined') return {};
  if (window.ThemeLoader && typeof window.ThemeLoader.getTokens === 'function') {
    const tokens = window.ThemeLoader.getTokens();
    if (tokens && Object.keys(tokens).length > 0) return tokens;
  }

  // Direct DOM computation fallback if ThemeLoader is still initializing
  try {
    const style = window.getComputedStyle(document.documentElement);
    const tokenKeys = [
      'primary', 'primary-hover', 'primary-light', 'primary-rgb',
      'secondary', 'accent', 'background', 'surface',
      'sidebar', 'sidebar-text', 'sidebar-muted',
      'navbar', 'navbar-border',
      'text-primary', 'text-secondary', 'text-muted',
      'border', 'border-strong',
      'success', 'warning', 'danger', 'info'
    ];
    const result = {};
    for (const k of tokenKeys) {
      const val = style.getPropertyValue('--' + k).trim();
      if (val) {
        result[k] = val;
        const camel = k.replace(/-([a-z0-9])/g, (_, letter) => letter.toUpperCase());
        result[camel] = val;
      }
    }
    return result;
  } catch (e) {
    return {};
  }
}

/**
 * Custom React Hook to consume centralized theme tokens in JavaScript (Charts, Canvas, SVG, dynamic styles).
 * Automatically updates when centralized theme changes are broadcasted.
 *
 * Usage:
 *   const { primary, surface, accent } = useThemeTokens();
 */
export function useThemeTokens() {
  const [tokens, setTokens] = useState(() => getLiveTokens());

  useEffect(() => {
    const handleUpdate = () => {
      setTokens(getLiveTokens());
    };

    window.addEventListener('theme:updated', handleUpdate);
    window.addEventListener('pydah:theme-updated', handleUpdate);
    return () => {
      window.removeEventListener('theme:updated', handleUpdate);
      window.removeEventListener('pydah:theme-updated', handleUpdate);
    };
  }, []);

  return tokens;
}

export default useThemeTokens;

