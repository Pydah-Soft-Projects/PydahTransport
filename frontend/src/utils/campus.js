export const getCampusId = (campus) => {
    if (campus === null || campus === undefined) return '';
    if (typeof campus === 'object') return campus._id ?? campus.id ?? '';
    return campus;
};

export const campusIdsMatch = (left, right) => String(left) === String(right);

export const userHasCampus = (userCampuses = [], campusId) => (
    userCampuses.some((id) => campusIdsMatch(id, campusId))
);

export const filterCampusesForUser = (campuses = [], userCampuses = [], isSuperAdmin = false) => (
    isSuperAdmin ? campuses : campuses.filter((campus) => userHasCampus(userCampuses, getCampusId(campus)))
);
