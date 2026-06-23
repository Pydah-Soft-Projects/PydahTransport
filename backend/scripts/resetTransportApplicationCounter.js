/* Reset course-wise transport application counters (v2 table).

 * Examples:

 *   node scripts/resetTransportApplicationCounter.js 2026-2027 --dry-run

 *   node scripts/resetTransportApplicationCounter.js 2026-2027 PCE BTECH

 *   node scripts/resetTransportApplicationCounter.js 2026-2027 PCE BTECH --dry-run

 */


const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });



const { mysqlPool, connectDB } = require('../config/db');

const EmployeeTransportRequest = require('../models/EmployeeTransportRequest');

const { COUNTERS_TABLE } = require('../utils/transportApplicationNumber');



const argv = process.argv.slice(2);

const dryRun = argv.includes('--dry-run');

const sync = argv.includes('--sync');

const args = argv.filter((a) => a !== '--dry-run' && a !== '--sync');

const academicYear = args[0] || process.env.CURRENT_ACADEMIC_YEAR;

const collegeCode = args[1] ? String(args[1]).trim().toUpperCase() : null;

const courseCode = args[2] ? String(args[2]).trim().toUpperCase() : null;



async function countStudentAssignments(pool, year, college, course) {

    const params = [year, year];

    let sql = `SELECT COUNT(*) AS cnt

               FROM transport_requests

               WHERE COALESCE(academic_year, ?) = ?

                 AND application_number IS NOT NULL`;

    if (college) {

        sql += ' AND application_college_code = ?';

        params.push(college);

    }

    if (course) {

        sql += ' AND application_course_code = ?';

        params.push(course);

    }

    const [rows] = await pool.query(sql, params);

    return Number(rows[0]?.cnt || 0);

}



async function countEmployeeAssignments(year, college, course) {

    const query = { application_number: { $ne: null } };

    if (college) query.application_college_code = college;

    if (course) query.application_course_code = course;



    const docs = await EmployeeTransportRequest.find(query)

        .select('academic_year application_college_code application_course_code')

        .lean();

    return docs.filter((d) => (d.academic_year || year) === year).length;

}



async function getCounters(pool, year, college, course) {

    const params = [year];

    let sql = `SELECT academic_year, college_code, course_code, last_serial, updated_at

               FROM ${COUNTERS_TABLE}

               WHERE academic_year = ?`;

    if (college) {

        sql += ' AND college_code = ?';

        params.push(college);

    }

    if (course) {

        sql += ' AND course_code = ?';

        params.push(course);

    }

    sql += ' ORDER BY college_code, course_code';

    const [rows] = await pool.query(sql, params);

    return rows;

}



async function resetCounters(pool, year, college, course) {

    const params = [year];

    let sql = `DELETE FROM ${COUNTERS_TABLE} WHERE academic_year = ?`;

    if (college) {

        sql += ' AND college_code = ?';

        params.push(college);

    }

    if (course) {

        sql += ' AND course_code = ?';

        params.push(course);

    }

    const [result] = await pool.query(sql, params);

    return result.affectedRows;

}



async function getUniqueCombinations(pool, year, college, course) {

    const combinations = new Set();

    const addCombo = (col, crs) => {

        const cCode = String(col || 'UNK').trim().toUpperCase();

        const crsCode = String(crs || 'GEN').trim().toUpperCase();

        combinations.add(`${cCode}|||${crsCode}`);

    };



    if (college && course) {

        addCombo(college, course);

        return [{ collegeCode: college, courseCode: course }];

    }



    // 1. From counters

    const counters = await getCounters(pool, year, college, course);

    counters.forEach((row) => addCombo(row.college_code, row.course_code));



    // 2. From student requests

    const params = [year, year];

    let studentSql = `SELECT DISTINCT application_college_code, application_course_code

                      FROM transport_requests

                      WHERE COALESCE(academic_year, ?) = ?

                        AND application_serial IS NOT NULL`;

    if (college) {

        studentSql += ' AND application_college_code = ?';

        params.push(college);

    }

    if (course) {

        studentSql += ' AND application_course_code = ?';

        params.push(course);

    }

    const [studentRows] = await pool.query(studentSql, params);

    studentRows.forEach((r) => addCombo(r.application_college_code, r.application_course_code));



    // 3. From employee requests

    const query = { application_serial: { $ne: null } };

    if (college) query.application_college_code = college;

    if (course) query.application_course_code = course;

    const empDocs = await EmployeeTransportRequest.find(query)

        .select('academic_year application_college_code application_course_code')

        .lean();

    empDocs

        .filter((d) => (d.academic_year || year) === year)

        .forEach((d) => addCombo(d.application_college_code, d.application_course_code));



    return Array.from(combinations).map((str) => {

        const [col, crs] = str.split('|||');

        return { collegeCode: col, courseCode: crs };

    });

}



async function getCombinationStats(pool, year, college, course) {

    // Current counter

    const [counterRows] = await pool.query(

        `SELECT last_serial FROM ${COUNTERS_TABLE}

         WHERE academic_year = ? AND college_code = ? AND course_code = ?`,

        [year, college, course]

    );

    const currentCounter = counterRows[0] ? Number(counterRows[0].last_serial) : null;



    // Max student serial

    const [studentRows] = await pool.query(

        `SELECT MAX(application_serial) AS max_serial

         FROM transport_requests

         WHERE COALESCE(academic_year, ?) = ?

           AND application_college_code = ?

           AND application_course_code = ?

           AND application_serial IS NOT NULL`,

        [year, year, college, course]

    );

    const maxStudent = studentRows[0]?.max_serial ? Number(studentRows[0].max_serial) : 0;



    // Max employee serial

    const empDocs = await EmployeeTransportRequest.find({

        application_college_code: college,

        application_course_code: course,

        application_serial: { $ne: null }

    })

    .select('academic_year application_serial')

    .lean();

    const filteredEmp = empDocs.filter((d) => (d.academic_year || year) === year);

    const maxEmployee = filteredEmp.reduce((max, d) => Math.max(max, d.application_serial || 0), 0);



    return {

        currentCounter,

        maxStudent,

        maxEmployee,

        maxAssigned: Math.max(maxStudent, maxEmployee)

    };

}



async function updateCounter(pool, year, college, course, value) {

    const [result] = await pool.query(

        `INSERT INTO ${COUNTERS_TABLE} (academic_year, college_code, course_code, last_serial)

         VALUES (?, ?, ?, ?)

         ON DUPLICATE KEY UPDATE last_serial = ?`,

        [year, college, course, value, value]

    );

    return result.affectedRows;

}



async function main() {

    if (!academicYear) {

        console.error('Academic year required. Example: node scripts/resetTransportApplicationCounter.js 2025-2026 PCE BTECH');

        process.exit(1);

    }

    if (!mysqlPool) {

        console.error('MySQL pool not available. Check MYSQL_* variables in backend/.env');

        process.exit(1);

    }



    const scopeLabel = collegeCode && courseCode

        ? `${collegeCode}-${courseCode}`

        : collegeCode

            ? `college ${collegeCode} (all courses)`

            : 'all college/course combinations';



    console.log(`Academic year: ${academicYear}`);

    console.log(`Scope: ${scopeLabel}`);

    if (sync) {

        console.log('Mode: sync (align counters to maximum assigned serials)');

    } else {

        console.log('Mode: reset (clear counters to 0)');

    }

    if (dryRun) console.log('Mode: dry-run (no changes will be made)\n');



    await connectDB();



    if (sync) {

        const combinations = await getUniqueCombinations(mysqlPool, academicYear, collegeCode, courseCode);

        console.log(`\nFound ${combinations.length} combination(s) to synchronize:\n`);



        let updatedCount = 0;

        for (const combo of combinations) {

            const stats = await getCombinationStats(mysqlPool, academicYear, combo.collegeCode, combo.courseCode);

            const comboLabel = `${combo.collegeCode}-${combo.courseCode}`;

            const currentStr = stats.currentCounter !== null ? stats.currentCounter : 'none';



            console.log(`  ${comboLabel}: current counter = ${currentStr}, max assigned = ${stats.maxAssigned}`);



            if (stats.currentCounter !== stats.maxAssigned) {

                if (dryRun) {

                    console.log(`    -> [Dry-Run] Would set counter to ${stats.maxAssigned}`);

                } else {

                    await updateCounter(mysqlPool, academicYear, combo.collegeCode, combo.courseCode, stats.maxAssigned);

                    console.log(`    -> Updated counter to ${stats.maxAssigned}`);

                }

                updatedCount++;

            } else {

                console.log(`    -> Already in sync.`);

            }

        }



        if (dryRun) {

            console.log(`\n[Dry-Run] Synchronization completed. Would update ${updatedCount} counter(s).`);

        } else {

            console.log(`\nSynchronization completed. Updated ${updatedCount} counter(s).`);

        }

        process.exit(0);

    }



    const studentCount = await countStudentAssignments(mysqlPool, academicYear, collegeCode, courseCode);

    const employeeCount = await countEmployeeAssignments(academicYear, collegeCode, courseCode);

    const countersBefore = await getCounters(mysqlPool, academicYear, collegeCode, courseCode);



    console.log(`Student requests with application number: ${studentCount}`);

    console.log(`Employee requests with application number: ${employeeCount}`);

    if (countersBefore.length) {

        console.log('Counters before:');

        countersBefore.forEach((row) => {

            console.log(`  ${row.college_code}-${row.course_code}: last_serial = ${row.last_serial} (updated ${row.updated_at})`);

        });

    } else {

        console.log('Counters before: none for this scope');

    }



    const totalAssigned = studentCount + employeeCount;

    if (totalAssigned > 0) {

        console.error(

            `\nAborted: ${totalAssigned} request(s) already have application numbers for ${academicYear} in this scope.`

        );

        console.error('Delete or reassign those records first, or narrow/change the scope.');

        process.exit(1);

    }



    const nextPreview = collegeCode && courseCode

        ? `${collegeCode}-${courseCode}-0001`

        : '0001 per college/course on next approval';



    if (dryRun) {

        console.log(`\nDry-run OK. Would reset counter(s) so the next approval gets ${nextPreview}.`);

        process.exit(0);

    }



    if (!countersBefore.length) {

        console.log(`\nNo counter row exists for this scope. Next approval will already start at ${nextPreview} — nothing to reset.`);

        process.exit(0);

    }



    const deleted = await resetCounters(mysqlPool, academicYear, collegeCode, courseCode);

    const countersAfter = await getCounters(mysqlPool, academicYear, collegeCode, courseCode);



    console.log(`\nReset complete. Deleted ${deleted} counter row(s).`);

    if (countersAfter.length) {

        console.log('Counters after:');

        countersAfter.forEach((row) => {

            console.log(`  ${row.college_code}-${row.course_code}: last_serial = ${row.last_serial}`);

        });

    } else {

        console.log(`Counters after: none (next approval → ${nextPreview})`);

    }

    process.exit(0);

}



main().catch((err) => {

    console.error('Error:', err.message);

    process.exit(1);

});


