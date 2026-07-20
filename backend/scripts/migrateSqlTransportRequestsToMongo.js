const dotenv = require('dotenv');
dotenv.config();

const { connectDB, mysqlPool } = require('../config/db');
const TransportRequest = require('../models/TransportRequest');
const { resolveApplicationNumberContext } = require('../utils/applicationNumberContext');
const { formatTransportApplicationNumber, getLastTransportApplicationSerial } = require('../utils/transportApplicationNumber');

const migrateTransportRequests = async () => {
    try {
        await connectDB();
        console.log('Fetching transport requests from MySQL...');

        if (!mysqlPool) {
            console.error('MySQL Pool is not initialized. Check your database configuration.');
            process.exit(1);
        }

        const [rows] = await mysqlPool.query('SELECT * FROM transport_requests ORDER BY id ASC');
        console.log(`Found ${rows.length} records in MySQL transport_requests table.`);

        if (rows.length === 0) {
            console.log('No records to migrate.');
            process.exit(0);
        }

        // Cache serial counters per group (academicYear_collegeCode_courseCode)
        const serialMap = {};

        async function getNextSerial(academicYear, collegeCode, courseCode) {
            const key = `${academicYear}_${collegeCode}_${courseCode}`;
            if (serialMap[key] === undefined) {
                const maxInDb = await getLastTransportApplicationSerial(mysqlPool, {
                    academicYear,
                    collegeCode,
                    courseCode
                });
                serialMap[key] = maxInDb;
            }
            serialMap[key] += 1;
            return serialMap[key];
        }

        let migratedCount = 0;
        let generatedAppNumCount = 0;

        for (const row of rows) {
            // Check if document already exists in Mongo
            const existingMongoDoc = await TransportRequest.findOne({ id: row.id }).lean();

            let appNumber = row.application_number || existingMongoDoc?.application_number || null;
            let appSerial = row.application_serial || existingMongoDoc?.application_serial || null;
            let collegeCode = row.application_college_code || existingMongoDoc?.application_college_code || null;
            let courseCode = row.application_course_code || existingMongoDoc?.application_course_code || null;

            const academicYear = row.academic_year || process.env.CURRENT_ACADEMIC_YEAR || '2025-2026';

            // Auto-generate application number if missing and request has admission_number
            if (!appNumber && row.admission_number) {
                try {
                    const context = await resolveApplicationNumberContext(mysqlPool, {
                        admissionNumber: row.admission_number,
                        userType: 'student'
                    });
                    collegeCode = context.collegeCode || 'PYD';
                    courseCode = context.courseCode || 'GEN';
                    appSerial = await getNextSerial(academicYear, collegeCode, courseCode);
                    appNumber = formatTransportApplicationNumber(collegeCode, courseCode, appSerial);
                    generatedAppNumCount++;
                } catch (err) {
                    console.warn(`Could not resolve student context for admission_number ${row.admission_number}: ${err.message}`);
                }
            }

            const doc = {
                id: row.id,
                admission_number: row.admission_number || null,
                student_name: row.student_name || null,
                route_id: row.route_id,
                route_name: row.route_name || null,
                stage_name: row.stage_name || null,
                bus_id: row.bus_id || null,
                fare: row.fare ? Number(row.fare) : 0,
                status: row.status || 'pending',
                cancellation_reason: row.cancellation_reason || null,
                cancelled_at: row.cancelled_at ? new Date(row.cancelled_at) : null,
                request_date: row.request_date ? new Date(row.request_date) : new Date(),
                updated_at: row.updated_at ? new Date(row.updated_at) : new Date(),
                semester_id: row.semester_id || null,
                semester_start_date: row.semester_start_date ? new Date(row.semester_start_date) : null,
                semester_end_date: row.semester_end_date ? new Date(row.semester_end_date) : null,
                expiry_date: row.expiry_date ? new Date(row.expiry_date) : null,
                academic_year_id: row.academic_year_id || null,
                year_of_study: row.year_of_study || null,
                academic_year: academicYear,
                application_number: appNumber,
                application_serial: appSerial,
                application_college_code: collegeCode,
                application_course_code: courseCode,
                semester_number: row.semester_number || null,
                raised_by: row.raised_by || 'student',
                raised_by_id: row.raised_by_id || null
            };

            await TransportRequest.updateOne(
                { id: row.id },
                { $set: doc },
                { upsert: true }
            );

            // Also update MySQL table if missing application details in SQL
            if (appNumber && !row.application_number) {
                try {
                    await mysqlPool.query(
                        `UPDATE transport_requests 
                         SET application_number = ?,
                             application_serial = ?,
                             application_college_code = ?,
                             application_course_code = ?,
                             academic_year = COALESCE(academic_year, ?)
                         WHERE id = ?`,
                        [appNumber, appSerial, collegeCode, courseCode, academicYear, row.id]
                    );
                } catch (sqlErr) {
                    // Ignore if MySQL table columns do not exist
                }
            }

            migratedCount++;
        }

        console.log(`Migration complete: ${migratedCount} records upserted into MongoDB 'transport_requests' collection.`);
        console.log(`Generated and updated application numbers for ${generatedAppNumCount} records missing application numbers in SQL & Mongo.`);
        process.exit(0);
    } catch (error) {
        console.error('Migration failed with error:', error);
        process.exit(1);
    }
};

migrateTransportRequests();
