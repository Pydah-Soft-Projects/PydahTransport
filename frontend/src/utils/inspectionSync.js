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
 * Check if there is any unsynced offline inspection data (local- IDs or unsynced scans).
 */
export function hasUnsyncedOfflineInspectionData(academicYear, targetDate) {
    const year = academicYear || getDefaultAcademicYear();
    const date = targetDate || new Date().toLocaleDateString('en-CA');

    const localSessions = getLocalInspectionSessions(year, date);
    const localInspectedMap = getLocalInspectedMap(year, date);

    const hasLocalUnsyncedSessions = Array.isArray(localSessions) && localSessions.some(
        (s) => (s._id && String(s._id).startsWith('local-')) ||
               (s.id && String(s.id).startsWith('local-')) ||
               s.synced === false
    );

    const hasLocalUnsyncedScans = localInspectedMap && Object.values(localInspectedMap).some(
        (rec) => rec && (rec.synced === false || rec.isOfflineScan === true)
    );

    return hasLocalUnsyncedSessions || hasLocalUnsyncedScans;
}

/**
 * Sync offline inspection sessions & scanned passengers to backend ONLY when unsynced data exists (or forceSync = true).
 */
export async function syncOfflineInspectionReports(academicYear, targetDate, forceSync = false) {
    if (typeof window === 'undefined' || !navigator.onLine || !isAuthenticated()) {
        return { synced: false, reason: 'offline_or_unauthenticated' };
    }

    const year = academicYear || getDefaultAcademicYear();
    const date = targetDate || new Date().toLocaleDateString('en-CA');

    if (!forceSync && !hasUnsyncedOfflineInspectionData(year, date)) {
        return { synced: false, reason: 'no_unsynced_data' };
    }

    const localSessions = getLocalInspectionSessions(year, date);
    const localInspectedMap = getLocalInspectedMap(year, date);

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

            // Merge scannedPassengers from server sessions into localInspectedMap and mark synced
            const mergedInspectedMap = { ...localInspectedMap };
            serverSessions.forEach((s) => {
                if (s.scannedPassengers && typeof s.scannedPassengers === 'object') {
                    Object.entries(s.scannedPassengers).forEach(([k, rec]) => {
                        mergedInspectedMap[k] = { ...rec, synced: true };
                    });
                }
            });

            // Mark all localInspectedMap items synced
            Object.keys(mergedInspectedMap).forEach((k) => {
                if (mergedInspectedMap[k] && typeof mergedInspectedMap[k] === 'object') {
                    mergedInspectedMap[k].synced = true;
                    delete mergedInspectedMap[k].isOfflineScan;
                }
            });

            const syncedSessions = serverSessions.map((s) => ({ ...s, synced: true }));

            saveLocalInspectionSessions(year, date, syncedSessions);
            saveLocalInspectedMap(year, date, mergedInspectedMap);

            window.dispatchEvent(new CustomEvent('pydah_inspection_synced', {
                detail: { academicYear: year, date, sessions: syncedSessions, inspectedMap: mergedInspectedMap },
            }));

            return {
                synced: true,
                sessions: syncedSessions,
                inspectedMap: mergedInspectedMap,
            };
        }
    } catch (err) {
        console.error('Error syncing offline inspection reports:', err);
    }

    return { synced: false, reason: 'request_failed' };
}
