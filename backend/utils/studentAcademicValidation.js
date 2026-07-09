function getExpectedYearForBatch(academicYearLabel, batch) {
    const startYear = Number(String(academicYearLabel).split('-')[0]);
    const batchYear = Number(String(batch).trim());
    if (Number.isNaN(startYear) || Number.isNaN(batchYear)) {
        return null;
    }
    return startYear - batchYear + 1;
}

async function resolveCourseDuration(mysqlPool, course, branch) {
    const [courseRows] = await mysqlPool.query(
        'SELECT id, name, total_years FROM courses WHERE name = ? LIMIT 1',
        [course]
    );
    const courseRow = courseRows[0];
    if (!courseRow) {
        return { courseRow: null, totalYears: null };
    }

    let totalYears = courseRow.total_years != null ? Number(courseRow.total_years) : null;

    if (branch) {
        const [branchRows] = await mysqlPool.query(
            `SELECT total_years, metadata FROM course_branches
             WHERE course_id = ? AND (name = ? OR code = ?)
             LIMIT 1`,
            [courseRow.id, branch, branch]
        );
        const branchRow = branchRows[0];
        if (branchRow?.total_years != null) {
            totalYears = Number(branchRow.total_years);
        }
        // If the branch has an additional year, additionalYear in metadata holds the year
        // *number* of that extra year (e.g. AGRD: total_years=3, additionalYear=4 → effective 4).
        // Use Math.max so we always end up with the highest year in the programme.
        if (branchRow?.metadata) {
            try {
                const config = typeof branchRow.metadata === 'string'
                    ? JSON.parse(branchRow.metadata)
                    : branchRow.metadata;
                if (config?.hasAdditionalYear === true && Number(config?.additionalYear) > 0) {
                    totalYears = Math.max(totalYears ?? 0, Number(config.additionalYear));
                }
            } catch {
                // malformed JSON — ignore and use total_years as-is
            }
        }
    }

    return { courseRow, totalYears };
}

function buildInvalidResult(base, reason, message) {
    return {
        ...base,
        valid: false,
        reason,
        message,
    };
}

/**
 * Validates that a student's batch and current_year align with the semesters table
 * for the selected academic year and course. Uses courses / course_branches for duration.
 */
async function validateStudentAcademicContext(mysqlPool, student, academicYearLabel) {
    const batch = student?.batch != null ? String(student.batch).trim() : '';
    const course = student?.course;
    const branch = student?.branch || null;
    const currentYear = student?.current_year != null ? Number(student.current_year) : null;

    const base = {
        batch: batch || null,
        current_year: currentYear,
        expected_year: null,
        academic_year: academicYearLabel || null,
        course: course || null,
        branch,
        total_years: null,
        reason: null,
    };

    if (!batch) {
        return buildInvalidResult(base, 'missing_data', 'Student batch is missing. Update the student record before raising a transport request.');
    }

    if (!course) {
        return buildInvalidResult(base, 'missing_data', 'Student course is missing. Update the student record before raising a transport request.');
    }

    if (!currentYear || currentYear < 1) {
        return buildInvalidResult(base, 'missing_data', 'Student current year is missing. Update the student record before raising a transport request.');
    }

    if (!academicYearLabel) {
        return buildInvalidResult(base, 'missing_data', 'Please select an academic year.');
    }

    const [ayRows] = await mysqlPool.query(
        'SELECT id, year_label FROM academic_years WHERE year_label = ? LIMIT 1',
        [academicYearLabel]
    );
    const academicYear = ayRows[0];
    if (!academicYear) {
        return buildInvalidResult(
            base,
            'missing_data',
            `Academic year "${academicYearLabel}" is not set up yet. Add it in Academic Years first.`
        );
    }

    const { courseRow, totalYears } = await resolveCourseDuration(mysqlPool, course, branch);
    if (!courseRow) {
        return buildInvalidResult(base, 'missing_data', `Course "${course}" was not found in the course master.`);
    }

    base.total_years = totalYears;
    const formulaYear = getExpectedYearForBatch(academicYearLabel, batch);
    base.expected_year = formulaYear;

    if (totalYears != null && formulaYear != null && formulaYear > totalYears) {
        return buildInvalidResult(
            base,
            'course_completed',
            `This student has completed the course. ${course} is a ${totalYears}-year program, so batch ${batch} is not eligible for transport in academic year ${academicYearLabel}.`
        );
    }

    if (totalYears != null && currentYear > totalYears) {
        return buildInvalidResult(
            base,
            'course_completed',
            `This student has completed the course. ${course} is a ${totalYears}-year program and the student is recorded as Year ${currentYear}.`
        );
    }

    const [semRows] = await mysqlPool.query(
        `SELECT DISTINCT year_of_study
         FROM semesters
         WHERE course_id = ? AND academic_year_id = ? AND batch = ?
         ORDER BY year_of_study ASC`,
        [courseRow.id, academicYear.id, batch]
    );

    if (!semRows.length) {
        if (formulaYear != null && totalYears != null && formulaYear > totalYears) {
            return buildInvalidResult(
                base,
                'course_completed',
                `This student has completed the course. ${course} is a ${totalYears}-year program, so batch ${batch} is not eligible for transport in academic year ${academicYearLabel}.`
            );
        }

        if (formulaYear != null && totalYears != null) {
            return buildInvalidResult(
                base,
                'missing_semester_config',
                `Semester setup is not done for batch ${batch}, Year ${formulaYear}, academic year ${academicYearLabel}. Please configure semesters in the student database.`
            );
        }

        return buildInvalidResult(
            base,
            'missing_semester_config',
            `Semester setup is not done for batch ${batch}, ${course}, academic year ${academicYearLabel}. Please configure semesters in the student database.`
        );
    }

    const expectedYears = [...new Set(semRows.map((r) => Number(r.year_of_study)))];
    const expectedYear = expectedYears[0];
    base.expected_year = expectedYear;

    if (expectedYears.length > 1) {
        return buildInvalidResult(
            base,
            'missing_semester_config',
            `Semester setup has conflicting years for batch ${batch} in ${academicYearLabel}. Please fix it in the student database.`
        );
    }

    if (totalYears != null && expectedYear > totalYears) {
        return buildInvalidResult(
            base,
            'course_completed',
            `This student has completed the course. ${course} is a ${totalYears}-year program, so batch ${batch} is not eligible for transport in academic year ${academicYearLabel}.`
        );
    }

    if (currentYear !== expectedYear) {
        return buildInvalidResult(
            base,
            'year_mismatch',
            `Student year does not match. For batch ${batch} in ${academicYearLabel}, the expected year is Year ${expectedYear}, but this student is recorded as Year ${currentYear}. Update the student year or choose a different academic year.`
        );
    }

    return {
        valid: true,
        reason: 'aligned',
        batch,
        current_year: currentYear,
        expected_year: expectedYear,
        academic_year: academicYearLabel,
        course,
        branch,
        total_years: totalYears,
        message: `Batch ${batch}, Year ${currentYear}, and academic year ${academicYearLabel} are aligned.`,
    };
}

module.exports = {
    validateStudentAcademicContext,
    getExpectedYearForBatch,
    resolveCourseDuration,
};
