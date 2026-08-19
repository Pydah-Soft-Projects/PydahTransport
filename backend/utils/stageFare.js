function normalizeAcademicYear(value) {
    if (!value) return '';
    const text = String(value).trim();
    const shortMatch = text.match(/^(\d{2})-(\d{2})$/);
    if (shortMatch) {
        const start = Number(shortMatch[1]);
        const century = start >= 90 ? 1900 : 2000;
        return `${century + start}-${century + start + 1}`;
    }
    return text;
}

function normalizeAcademicYearFares(academicYearFares) {
    if (!Array.isArray(academicYearFares)) return [];
    return academicYearFares
        .filter((entry) => entry && entry.academicYear)
        .map((entry) => ({
            academicYear: normalizeAcademicYear(entry.academicYear),
            fare: Number(entry.fare),
        }))
        .filter((entry) => entry.academicYear && Number.isFinite(entry.fare));
}

function getCanonicalAcademicYear() {
    return normalizeAcademicYear(process.env.CURRENT_ACADEMIC_YEAR || '2025-2026');
}

function resolveStageFare(stage, academicYear) {
    if (!stage) return 0;
    const fares = normalizeAcademicYearFares(stage.academicYearFares);
    const normalizedYear = normalizeAcademicYear(academicYear);
    if (normalizedYear) {
        const override = fares.find((entry) => entry.academicYear === normalizedYear);
        if (override) return override.fare;
    }
    return Number(stage.fare) || 0;
}

function resolveStageForAcademicYear(stage, academicYear) {
    const baseFare = Number(stage.fare) || 0;
    const academicYearFares = normalizeAcademicYearFares(stage.academicYearFares);
    const normalizedYear = normalizeAcademicYear(academicYear);
    const yearEntry = normalizedYear
        ? academicYearFares.find((entry) => entry.academicYear === normalizedYear)
        : null;
    const resolvedFare = yearEntry ? yearEntry.fare : baseFare;

    return {
        stageName: stage.stageName,
        distanceFromStart: stage.distanceFromStart,
        fare: resolvedFare,
        baseFare,
        academicYearFares,
        hasYearOverride: Boolean(yearEntry),
        fareSource: yearEntry ? 'year-override' : 'base-fare',
        latitude: stage.latitude !== undefined ? stage.latitude : null,
        longitude: stage.longitude !== undefined ? stage.longitude : null,
        radius: stage.radius !== undefined ? stage.radius : 100,
    };
}

function applyStageFareForYear(stage, academicYear, fare) {
    const nextFare = Number(fare);
    const normalizedYear = normalizeAcademicYear(academicYear);
    const academicYearFares = normalizeAcademicYearFares(stage.academicYearFares);
    const index = academicYearFares.findIndex((entry) => entry.academicYear === normalizedYear);

    if (index >= 0) {
        academicYearFares[index] = { academicYear: normalizedYear, fare: nextFare };
    } else {
        academicYearFares.push({ academicYear: normalizedYear, fare: nextFare });
    }

    return {
        stageName: stage.stageName,
        distanceFromStart: Number(stage.distanceFromStart),
        fare: Number(stage.fare) || nextFare,
        academicYearFares,
    };
}

function normalizeStagesForSave(stages, editingAcademicYear = null) {
    const canonicalYear = getCanonicalAcademicYear();
    const editingYear = normalizeAcademicYear(editingAcademicYear);

    return (stages || []).map((stage) => {
        const editedFare = Number(stage.fare);
        if (!Number.isFinite(editedFare)) {
            throw new Error(`Invalid fare for stage "${stage.stageName || 'unknown'}"`);
        }

        let academicYearFares = normalizeAcademicYearFares(stage.academicYearFares);

        if (editingYear) {
            const index = academicYearFares.findIndex((entry) => entry.academicYear === editingYear);
            if (index >= 0) {
                academicYearFares[index] = { academicYear: editingYear, fare: editedFare };
            } else {
                academicYearFares.push({ academicYear: editingYear, fare: editedFare });
            }
        }

        const canonicalEntry = academicYearFares.find((entry) => entry.academicYear === canonicalYear);
        const baseFare = editingYear === canonicalYear
            ? editedFare
            : (canonicalEntry?.fare ?? 
               (stage.baseFare != null && Number.isFinite(Number(stage.baseFare)) ? Number(stage.baseFare) : null) ?? 
               (stage.fare != null && Number.isFinite(Number(stage.fare)) ? Number(stage.fare) : null) ?? 
               editedFare);

        return {
            stageName: String(stage.stageName || '').trim(),
            distanceFromStart: Number(stage.distanceFromStart),
            fare: baseFare,
            academicYearFares,
            latitude: stage.latitude !== undefined ? (stage.latitude === '' || stage.latitude === null ? null : Number(stage.latitude)) : null,
            longitude: stage.longitude !== undefined ? (stage.longitude === '' || stage.longitude === null ? null : Number(stage.longitude)) : null,
            radius: stage.radius !== undefined ? (stage.radius === '' || stage.radius === null ? 100 : Number(stage.radius)) : 100,
        };
    });
}

async function resolveRouteStageFare(Route, routeId, stageName, academicYear) {
    if (!routeId || !stageName) return null;
    const route = await Route.findOne({ routeId }).lean();
    if (!route) return null;
    const stage = (route.stages || []).find((item) => item.stageName === stageName);
    if (!stage) return null;
    return resolveStageFare(stage, academicYear);
}

module.exports = {
    normalizeAcademicYear,
    normalizeAcademicYearFares,
    getCanonicalAcademicYear,
    resolveStageFare,
    resolveStageForAcademicYear,
    applyStageFareForYear,
    normalizeStagesForSave,
    resolveRouteStageFare,
};
