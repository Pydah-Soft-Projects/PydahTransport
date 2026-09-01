/**
 * Shared renewal statistics — mirrors frontend/src/utils/renewalStats.js
 */

function getPreviousAcademicYear(currentYear) {
    const parts = String(currentYear || '').split('-').map(Number);
    if (parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
        return `${parts[0] - 1}-${parts[1] - 1}`;
    }
    return currentYear;
}

function buildCourseYearsMap(coursesList) {
    const map = new Map();
    (coursesList || []).forEach((c) => {
        map.set(String(c.name).toLowerCase(), Number(c.total_years));
    });
    return map;
}

function getTargetYearOfStudy(req, coursesList) {
    const courseYearsMap = coursesList instanceof Map
        ? coursesList
        : buildCourseYearsMap(coursesList);
    const maxYearsRaw = courseYearsMap.get(String(req.course || '').toLowerCase());
    const maxYears = maxYearsRaw != null && !Number.isNaN(maxYearsRaw) ? maxYearsRaw : null;
    const expiredYearOfStudy = req.year_of_study != null ? Number(req.year_of_study) : 1;
    const targetYearOfStudy = expiredYearOfStudy + 1;
    const isCompleted = maxYears !== null && targetYearOfStudy > maxYears;
    return { year: targetYearOfStudy, isCompleted, maxYears };
}

function buildRenewedSet(targetYearRequests = []) {
    const set = new Set();
    targetYearRequests.forEach((r) => {
        if (r.admission_number && ['pending', 'approved'].includes(String(r.status || '').toLowerCase())) {
            set.add(String(r.admission_number).trim());
        }
    });
    return set;
}

function computeRenewalStats(requests = [], renewedSet, coursesList = []) {
    const courseYearsMap = buildCourseYearsMap(coursesList);
    let renewed = 0;
    let pending = 0;
    let notInterested = 0;
    let completed = 0;

    requests.forEach((r) => {
        const isRenewed = renewedSet.has(String(r.admission_number || '').trim());
        const { isCompleted } = getTargetYearOfStudy(r, courseYearsMap);

        if (isRenewed) {
            renewed += 1;
            return;
        }
        if (r.not_interested) {
            notInterested += 1;
            return;
        }
        if (isCompleted) {
            completed += 1;
            return;
        }
        pending += 1;
    });

    const eligible = renewed + pending + notInterested;
    return {
        allExpired: requests.length,
        eligible,
        renewed,
        pending,
        notInterested,
        completed,
    };
}

function buildCourseRenewalBreakdown(requests = [], renewedSet, coursesList = []) {
    const courseYearsMap = buildCourseYearsMap(coursesList);
    const courseMap = new Map();

    requests.forEach((r) => {
        const { isCompleted } = getTargetYearOfStudy(r, courseYearsMap);
        if (isCompleted) return;

        const course = (r.course && String(r.course).trim()) || 'N/A';
        const isRenewed = renewedSet.has(String(r.admission_number || '').trim());
        const isNotInterested = !!r.not_interested;

        if (!courseMap.has(course)) {
            courseMap.set(course, {
                course,
                eligible: 0,
                renewed: 0,
                pending: 0,
                notInterested: 0,
            });
        }
        const row = courseMap.get(course);
        row.eligible += 1;
        if (isRenewed) row.renewed += 1;
        else if (isNotInterested) row.notInterested += 1;
        else row.pending += 1;
    });

    return Array.from(courseMap.values()).sort((a, b) => b.eligible - a.eligible);
}

function buildAcademicYearMongoFilter(academicYear, fallbackAcademicYear) {
    if (!academicYear) return null;
    if (academicYear === fallbackAcademicYear) {
        return {
            $or: [
                { academic_year: academicYear },
                { academic_year: { $exists: false } },
                { academic_year: null },
                { academic_year: '' },
            ],
        };
    }
    return { academic_year: academicYear };
}

function mergeMongoFilters(base, extra) {
    if (!extra) return base;
    if (!base || Object.keys(base).length === 0) return { ...extra };
    return { $and: [base, extra] };
}

module.exports = {
    getPreviousAcademicYear,
    getTargetYearOfStudy,
    buildRenewedSet,
    computeRenewalStats,
    buildCourseRenewalBreakdown,
    buildAcademicYearMongoFilter,
    mergeMongoFilters,
};
