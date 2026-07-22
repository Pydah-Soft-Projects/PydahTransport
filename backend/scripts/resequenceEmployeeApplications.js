/**
 * Resequence application serials and numbers for approved employee transport requests in MongoDB.
 *
 * Usage:
 *   node scripts/resequenceEmployeeApplications.js --dry-run
 *   node scripts/resequenceEmployeeApplications.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const EmployeeTransportRequest = require('../models/EmployeeTransportRequest');
const { formatTransportApplicationNumber } = require('../utils/transportApplicationNumber');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run') || args.length === 0; // default to dry-run if no arguments to be safe

function getDefaultAcademicYear() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    return month >= 5 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

async function main() {
    if (!process.env.MONGO_URI) {
        console.error('MONGO_URI is not configured in backend/.env.');
        process.exit(1);
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB.');

    if (dryRun) {
        console.log('\n--- RUNNING IN DRY-RUN MODE (no updates will be saved to MongoDB) ---');
        console.log('To apply changes, run: node scripts/resequenceEmployeeApplications.js --apply\n');
    } else {
        console.log('\n--- RUNNING IN WRITE/APPLY MODE ---');
    }

    // Fetch all approved employee requests
    const requests = await EmployeeTransportRequest.find({ status: 'approved' }).lean();
    console.log(`Found ${requests.length} approved employee transport requests.`);

    if (requests.length === 0) {
        console.log('No requests to process.');
        await mongoose.connection.close();
        process.exit(0);
    }

    const fallbackAY = process.env.CURRENT_ACADEMIC_YEAR || getDefaultAcademicYear();
    const fallbackCollege = process.env.TRANSPORT_EMPLOYEE_COLLEGE_CODE || process.env.TRANSPORT_DEFAULT_COLLEGE_CODE || 'PYD';
    const courseCode = process.env.TRANSPORT_EMPLOYEE_COURSE_CODE || 'EMP';

    // Group requests by academic_year and college_code
    const groups = {};
    for (const r of requests) {
        const ay = r.academic_year || fallbackAY;
        const college = r.application_college_code || fallbackCollege;
        const key = `${ay}_${college}`;

        if (!groups[key]) {
            groups[key] = [];
        }
        groups[key].push(r);
    }

    let totalUpdated = 0;

    for (const [groupKey, groupRequests] of Object.entries(groups)) {
        const [ay, college] = groupKey.split('_');
        console.log(`\nProcessing group: Academic Year = ${ay}, College = ${college} (${groupRequests.length} requests)`);
        console.log('-'.repeat(60));

        // Sort chronologically by request_date or created_at
        groupRequests.sort((a, b) => {
            const dateA = new Date(a.request_date || a.created_at || 0);
            const dateB = new Date(b.request_date || b.created_at || 0);
            return dateA - dateB;
        });

        let serial = 1;
        for (const req of groupRequests) {
            const newAppNum = formatTransportApplicationNumber(college, courseCode, serial);
            const oldAppNum = req.application_number;
            const oldSerial = req.application_serial;

            const needsUpdate = oldAppNum !== newAppNum || oldSerial !== serial || req.application_college_code !== college || req.application_course_code !== courseCode;

            if (needsUpdate) {
                console.log(`[UPDATE] Request ID: ${req._id} | Employee: ${req.employee_name}`);
                console.log(`  - College Code   : ${req.application_college_code || 'NULL'} -> ${college}`);
                console.log(`  - Course Code    : ${req.application_course_code || 'NULL'} -> ${courseCode}`);
                console.log(`  - Serial         : ${oldSerial || 'NULL'} -> ${serial}`);
                console.log(`  - App Number     : ${oldAppNum || 'NULL'} -> ${newAppNum}`);

                if (!dryRun) {
                    await EmployeeTransportRequest.updateOne(
                        { _id: req._id },
                        {
                            $set: {
                                application_number: newAppNum,
                                application_serial: serial,
                                application_college_code: college,
                                application_course_code: courseCode,
                                academic_year: ay
                            }
                        }
                    );
                }
                totalUpdated++;
            } else {
                console.log(`[NO CHANGE] Request ID: ${req._id} | Employee: ${req.employee_name} already correct (${newAppNum})`);
            }

            serial++;
        }
    }

    console.log('\n======================================');
    if (dryRun) {
        console.log(`Dry-run complete. ${totalUpdated} employee records would be updated.`);
    } else {
        console.log(`Update complete. ${totalUpdated} employee records have been updated.`);
    }
    console.log('======================================');

    await mongoose.connection.close();
}

main().catch(async (err) => {
    console.error('Fatal error during execution:', err);
    await mongoose.connection.close();
    process.exit(1);
});
