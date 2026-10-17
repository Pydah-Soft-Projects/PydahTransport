import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { isSSOUser } from '../utils/api';

const SCRIPT_ID = 'pydah-portal-switcher-cdn';
const PORTAL_ID = 'transport-management';
const CDN_URL = 'https://crm.pydah.edu.in/portal-switcher.js';

export default function PortalSwitcher() {
  const location = useLocation();
  const [ssoActive, setSsoActive] = useState(() => isSSOUser());

  // Keep SSO state in sync with localStorage, route changes, and auth events
  useEffect(() => {
    const checkSSO = () => {
      setSsoActive(isSSOUser());
    };

    window.addEventListener('auth-change', checkSSO);
    window.addEventListener('storage', checkSSO);

    // Initial check on route change
    checkSSO();

    return () => {
      window.removeEventListener('auth-change', checkSSO);
      window.removeEventListener('storage', checkSSO);
    };
  }, [location.pathname]);

  useEffect(() => {
    // Only render on authenticated app routes for SSO users, never on public/login screens
    const isPublicPage =
      ['/login', '/', '/verify'].includes(location.pathname) ||
      location.pathname.startsWith('/verify-transport');

    const shouldShow = ssoActive && !isPublicPage;

    const cleanupSwitcher = () => {
      const switcher = window.PydahSwitcher || window.PydahPortalSwitcher;
      if (switcher?.close) {
        try {
          switcher.close();
        } catch (_) {}
      }

      // Hide and remove any custom web component elements created by the switcher
      const customElements = document.querySelectorAll(
        'pydah-portal-switcher, portal-switcher, [data-pydah-switcher], #pydah-portal-switcher'
      );
      customElements.forEach((el) => {
        el.style.display = 'none';
        el.remove();
      });

      // Remove the script tag so it doesn't linger for non-SSO sessions
      const hasSsoToken = typeof window !== 'undefined' && Boolean(new URLSearchParams(window.location.search).get('token'));
      if (!hasSsoToken) {
        const existingScript = document.getElementById(SCRIPT_ID);
        if (existingScript) {
          existingScript.remove();
        }
      }
    };

    if (!shouldShow) {
      cleanupSwitcher();
      return;
    }

    // SSO is active and user is on an authorized portal page: initialize switcher
    let adminInfo = {};
    try {
      adminInfo = JSON.parse(localStorage.getItem('adminInfo') || '{}');
    } catch (_) {}

    const token = adminInfo.token;
    const user = {
      id: adminInfo._id || adminInfo.id,
      username: adminInfo.username,
      name: adminInfo.name,
      role: adminInfo.role || (adminInfo.roles && adminInfo.roles[0]),
      roles: adminInfo.roles,
      permissions: adminInfo.permissions,
      campuses: adminInfo.campuses,
      isSSO: true
    };

    const initSwitcher = () => {
      const switcher = window.PydahSwitcher || window.PydahPortalSwitcher;
      if (switcher?.init) {
        switcher.init({
          currentPortal: PORTAL_ID,
          token: token,
          user: user,
          position: 'bottom-right'
        });
      } else if (switcher?.setSession) {
        switcher.setSession({
          token: token,
          user: user
        });
      }

      // Ensure any custom elements are visible
      const customElements = document.querySelectorAll(
        'pydah-portal-switcher, portal-switcher, [data-pydah-switcher], #pydah-portal-switcher'
      );
      customElements.forEach((el) => {
        el.style.display = '';
      });
    };

    let script = document.getElementById(SCRIPT_ID);
    if (!script) {
      script = document.createElement('script');
      script.id = SCRIPT_ID;
      script.src = CDN_URL;
      script.async = true;
      script.setAttribute('data-current-portal', PORTAL_ID);
      script.setAttribute(
        'data-api-base-url',
        import.meta.env.VITE_CRM_BACKEND_URL || 'https://pydah-crm-backend.pydah.edu.in'
      );
      script.setAttribute(
        'data-landing-url',
        import.meta.env.VITE_CRM_URL || 'https://crm.pydah.edu.in'
      );
      script.setAttribute('data-position', 'bottom-right');

      script.onload = () => {
        initSwitcher();
      };

      document.body.appendChild(script);
    } else {
      initSwitcher();
    }
  }, [ssoActive, location.pathname]);

  return null;
}
