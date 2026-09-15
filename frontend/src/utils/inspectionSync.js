import { apiFetch, API_BASE, isAuthenticated } from './api';
import { getDefaultAcademicYear } from './academicYear';

export function getLocalSessionsKey(academicYear, date) {
    const targetDate = date || new Date().toLocaleDateString('en-CA');
    const targetYear = academicYear || getDefaultAcademicYear();
    return `pydah_sessions_${targetYear}_${targetDate}`;
}

export function getLocalInspectedKey(academicYear, date) {
    const targetDate = date || new Date().toLocaleDateString('en-CA');
    const targetYear = academicYear || getDefaultAcademicYear();
    return `pydah_inspected_${targetYear}_${targetDate}`;
}

export function getLocalInspectionSessions(academicYear, date) {
    try {
        const key = getLocalSessionsKey(academicYear, date);
        const stored = localStorage.getItem(key);
        return stored ? JSON.parse(stored) : [];
    } catch {
        return [];
    }
}

export function getLocalInspectedMap(academicYear, date) {
    try {
        const key = getLocalInspectedKey(academicYear, date);
        const stored = localStorage.getItem(key);
        return stored ? JSON.parse(stored) : {};
    } catch {
        return {};
    }
}

export function saveLocalInspectionSessions(academicYear, date, sessions) {
    try {
        const key = getLocalSessionsKey(academicYear, date);
        localStorage.setItem(key, JSON.stringify(sessions || []));
    } catch (e) {
        console.error('Failed to save local inspection sessions', e);
    }
}

export function saveLocalInspectedMap(academicYear, date, inspectedMap) {
    try {
        const key = getLocalInspectedKey(academicYear, date);
        localStorage.setItem(key, JSON.stringify(inspectedMap || {}));
    } catch (e) {
        console.error('Failed to save local inspected map', e);
    }
}

/**
 * Sync offline inspection sessions & scanned passengers to backend when online.
 */
export async function syncOfflineInspectionReports(academicYear, targetDate) {
    if (typeof window === 'undefined' || !navigator.onLine || !isAuthenticated()) {
        return { synced: false, reason: 'offline_or_unauthenticated' };
    }

    const year = academicYear || getDefaultAcademicYear();
    const date = targetDate || new Date().toLocaleDateString('en-CA');

    const localSessions = getLocalInspectionSessions(year, date);
    const localInspectedMap = getLocalInspectedMap(year, date);

    const hasLocalSessions = Array.isArray(localSessions) && localSessions.length > 0;
    const hasLocalInspected = localInspectedMap && Object.keys(localInspectedMap).length > 0;

    if (!hasLocalSessions && !hasLocalInspected) {
        return { synced: false, reason: 'no_local_data' };
    }

    try {
        const response = await apiFetch(`${API_BASE}/inspection-sessions/sync`, {
            method: 'POST',
            body: JSON.stringify({
                academicYear: year,
                inspectionDate: date,
                sessions: localSessions,
                inspectedMap: localInspectedMap,
            }),
        });

        if (response.ok) {
            const data = await response.json();
            const serverSessions = data.sessions || [];

            // Merge scannedPassengers from server sessions into localInspectedMap
            const mergedInspectedMap = { ...localInspectedMap };
            serverSessions.forEach((s) => {
                if (s.scannedPassengers && typeof s.scannedPassengers === 'object') {
                    Object.assign(mergedInspectedMap, s.scannedPassengers);
                }
            });

            saveLocalInspectionSessions(year, date, serverSessions);
            saveLocalInspectedMap(year, date, mergedInspectedMap);

            window.dispatchEvent(new CustomEvent('pydah_inspection_synced', {
                detail: { academicYear: year, date, sessions: serverSessions, inspectedMap: mergedInspectedMap },
            }));

            return {
                synced: true,
                sessions: serverSessions,
                inspectedMap: mergedInspectedMap,
            };
        }
    } catch (err) {
        console.error('Error syncing offline inspection reports:', err);
    }

    return { synced: false, reason: 'request_failed' };
}
