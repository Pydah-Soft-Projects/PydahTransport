export const CANONICAL_ACADEMIC_YEAR = '2025-2026';

/** Current academic year from calendar (June–May style: month >= June → year-(year+1)). */
export const getDefaultAcademicYear = () => {
    const envYear = import.meta.env.VITE_CURRENT_ACADEMIC_YEAR;
    if (envYear) return envYear;
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth(); // 0-indexed; June = 5
    if (month >= 5) {
        return `${year}-${year + 1}`;
    }
    return `${year - 1}-${year}`;
};

export const getPreviousAcademicYear = (currentYear = getDefaultAcademicYear()) => {
    const parts = String(currentYear || '').split('-').map(Number);
    if (parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
        return `${parts[0] - 1}-${parts[1] - 1}`;
    }
    const fallback = getDefaultAcademicYear();
    const fb = fallback.split('-').map(Number);
    return `${fb[0] - 1}-${fb[1] - 1}`;
};

export const getAcademicYearOptions = () => {
    const defaultYear = getDefaultAcademicYear();
    const startYear = Number(defaultYear.split('-')[0]);
    const options = new Set([defaultYear, CANONICAL_ACADEMIC_YEAR]);
    for (let offset = -3; offset <= 3; offset += 1) {
        const start = startYear + offset;
        options.add(`${start}-${start + 1}`);
    }
    return Array.from(options).sort((a, b) => Number(a.split('-')[0]) - Number(b.split('-')[0]));
};
