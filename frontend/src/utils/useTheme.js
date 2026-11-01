import { useEffect, useState } from 'react';

/**
 * Custom React Hook to subscribe to Central Theme changes.
 * Emits whenever the Centralized Theme Server updates the active theme version.
 */
export function useTheme() {
  const [themeVersion, setThemeVersion] = useState(() => {
    return (typeof window !== 'undefined' && localStorage.getItem('app_theme_version')) || 'default';
  });

  useEffect(() => {
    const handleThemeChange = (event) => {
      if (event?.detail?.version) {
        setThemeVersion(event.detail.version);
      }
    };

    window.addEventListener('theme:updated', handleThemeChange);
    window.addEventListener('pydah:theme-updated', handleThemeChange);
    return () => {
      window.removeEventListener('theme:updated', handleThemeChange);
      window.removeEventListener('pydah:theme-updated', handleThemeChange);
    };
  }, []);

  return { themeVersion };
}

export default useTheme;

