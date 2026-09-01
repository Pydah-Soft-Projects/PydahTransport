/**
 * Shared renewal statistics — used by Dashboard and Renewals page so counts match.
 */

function buildCourseYearsMap(coursesList) {
    const map = new Map();
    (coursesList || []).forEach((c) => {
        map.set(String(c.name).toLowerCase(), Number(c.total_years));
    });
    return map;
}

export const getTargetYearOfStudy = (req, coursesList) => {
    const courseYearsMap = coursesList instanceof Map
        ? coursesList
        : buildCourseYearsMap(coursesList);
    const maxYearsRaw = courseYearsMap.get(String(req.course || '').toLowerCase());
    const maxYears = maxYearsRaw != null && !Number.isNaN(maxYearsRaw) ? maxYearsRaw : null;
    const expiredYearOfStudy = req.year_of_study != null ? Number(req.year_of_study) : 1;
    const targetYearOfStudy = expiredYearOfStudy + 1;

    const isCompleted = maxYears !== null && targetYearOfStudy > maxYears;
    return {
        year: targetYearOfStudy,
        isCompleted,
        maxYears,
    };
};

/** Build set of admission numbers that already have a target-year request */
export const buildRenewedSet = (targetYearRequests = []) => {
    const set = new Set();
    targetYearRequests.forEach((r) => {
        if (r.admission_number && ['pending', 'approved'].includes(String(r.status || '').toLowerCase())) {
            set.add(String(r.admission_number).trim());
        }
    });
    return set;
};

/**
 * Mutually exclusive buckets (eligible = renewed + pending + notInterested):
 * - course-completed students are excluded from eligible
 */
export const computeRenewalStats = (requests = [], renewedSet, coursesList = []) => {
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
};

/** Course-wise breakdown (eligible passengers only — excludes course-completed) */
export const buildCourseRenewalBreakdown = (requests = [], renewedSet, coursesList = []) => {
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
};
