export const CANONICAL_ACADEMIC_YEAR = '2025-2026';

export const getDefaultAcademicYear = () => {
    const envYear = import.meta.env.VITE_CURRENT_ACADEMIC_YEAR;
    if (envYear) return envYear;
    return CANONICAL_ACADEMIC_YEAR;
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
