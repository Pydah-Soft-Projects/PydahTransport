export const API_BASE = import.meta.env.VITE_API_URL || '';

export const getAuthHeaders = (extraHeaders = {}) => {
    const headers = { ...extraHeaders };
    try {
        const adminInfo = JSON.parse(localStorage.getItem('adminInfo') || '{}');
        if (adminInfo.token) {
            headers.Authorization = `Bearer ${adminInfo.token}`;
        }
    } catch {
        // ignore invalid localStorage
    }
    return headers;
};

/** Authenticated fetch — attaches Bearer token from login when present. */
export const apiFetch = (url, options = {}) => {
    const headers = getAuthHeaders(options.headers || {});
    if (
        options.body &&
        typeof options.body === 'string' &&
        !headers['Content-Type'] &&
        !headers['content-type']
    ) {
        headers['Content-Type'] = 'application/json';
    }
    return fetch(url, { ...options, headers });
};

export const isAuthenticated = () => {
    try {
        const adminInfo = JSON.parse(localStorage.getItem('adminInfo') || '{}');
        return Boolean(adminInfo.token);
    } catch {
        return false;
    }
};

export const isSSOUser = () => {
    try {
        const adminInfo = JSON.parse(localStorage.getItem('adminInfo') || '{}');
        const isSSO = Boolean(
            adminInfo.isSSO === true ||
            adminInfo.isSSO === 'true' ||
            localStorage.getItem('isSSO') === 'true'
        );
        return Boolean(adminInfo.token) && isSSO;
    } catch {
        return false;
    }
};
