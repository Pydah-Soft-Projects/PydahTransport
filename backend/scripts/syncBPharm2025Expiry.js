/**
 * ---------------------------------------------------------------
 *  syncBPharm2025Expiry.js
 * ---------------------------------------------------------------
 *  Purpose
 *  -------
 *  • Safely updates and synchronizes expiry/semester dates in both
 *    MySQL and MongoDB databases for B.Pharm students in the
 *    academic year 2025-2026.
 *  • It targets ONLY B.Pharm students, leaving other courses untouched.
 *
 *  Usage:
 *  ------
 *  1️⃣ Dry-run mode (check what will be updated):
 *     node -r dotenv/config backend/scripts/syncBPharm2025Expiry.js --dry-run
 *
 *  2️⃣ Execute mode (apply updates to MySQL and MongoDB):
 *     node -r dotenv/config backend/scripts/syncBPharm2025Expiry.js
 * ---------------------------------------------------------------
 */

const path = require('path');
// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const mongoose = require('mongoose');
const db = require('../config/db');
const mysqlPool = db.mysqlPool;

// Load the TransportRequest model (MongoDB)
const TransportRequest = require('../models/TransportRequest');

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');

const fmt = (date) => (date ? new Date(date).toISOString().split('T')[0] : null);

(async () => {
  try {
    if (!mysqlPool) {
      console.error('❌ MySQL Pool is not initialized. Check your database configuration.');
      process.exit(1);
    }
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const academicYear = '2025-2026';
    const targetCourse = 'B.Pharm';

    console.log(`\n🔍 Scanning MongoDB for ${targetCourse} student transport requests in ${academicYear}...`);

    // 1. Fetch all student requests for the academic year 2025-2026 from MongoDB
    const mongoRequests = await TransportRequest.find({
      academic_year: academicYear,
      status: 'approved'
    }).lean();

    console.log(`📊 Found ${mongoRequests.length} total approved requests in MongoDB for AY ${academicYear}.`);

    // 2. Fetch all students details from MySQL to identify B.Pharm students
    const admissionNos = [...new Set(mongoRequests.map(r => r.admission_number).filter(Boolean))];
    let studentMap = new Map();
    if (admissionNos.length > 0) {
      const [studentRows] = await mysqlPool.query(
        `SELECT admission_number, admission_no, course, current_year, student_name, batch
         FROM students
         WHERE admission_number IN (?) OR admission_no IN (?)`,
        [admissionNos, admissionNos]
      );
      for (const s of studentRows) {
        if (s.admission_number) studentMap.set(String(s.admission_number).trim(), s);
        if (s.admission_no) studentMap.set(String(s.admission_no).trim(), s);
      }
    }

    // 3. Preload semesters, courses, and academic years from SQL to resolve dates
    const [courses] = await mysqlPool.query('SELECT id, name FROM courses');
    const coursesMap = new Map(courses.map(c => [c.name.toLowerCase().trim(), c.id]));
    
    const [ayRows] = await mysqlPool.query('SELECT id, year_label FROM academic_years');
    const academicYearsMap = new Map(ayRows.map(ay => [String(ay.year_label).trim(), ay.id]));

    const [semestersList] = await mysqlPool.query(
      'SELECT id, course_id, academic_year_id, batch, year_of_study, semester_number, end_date FROM semesters'
    );

    const courseId = coursesMap.get(targetCourse.toLowerCase());
    const academicYearId = academicYearsMap.get(academicYear);

    if (!courseId || !academicYearId) {
      console.error(`❌ Could not resolve SQL references for course ${targetCourse} or academic year ${academicYear}`);
      process.exit(1);
    }

    // Filter MongoDB requests to process ONLY B.Pharm
    const bPharmRequests = mongoRequests.filter(tr => {
      const student = studentMap.get(String(tr.admission_number).trim());
      return student && student.course && student.course.toLowerCase() === targetCourse.toLowerCase();
    });

    console.log(`📊 Found ${bPharmRequests.length} approved B.Pharm student requests in MongoDB.`);
    
    if (bPharmRequests.length === 0) {
      console.log('No B.Pharm requests found to update.');
      process.exit(0);
    }

    if (dryRun) {
      console.log('\n--- Running in DRY-RUN mode (No database writes) ---');
    } else {
      console.log('\n--- Running in EXECUTE mode (Applying updates directly to MySQL & MongoDB) ---');
    }

    let updatedCount = 0;
    let skippedCount = 0;
    let unchangedCount = 0;

    for (const tr of bPharmRequests) {
      const student = studentMap.get(String(tr.admission_number).trim());
      const batch = student.batch;
      const yearOfStudy = tr.year_of_study || student.current_year || 1;

      // Filter semesters matching this student's course, batch, academic year, and year of study
      const matchedSems = semestersList.filter(sem => 
        Number(sem.course_id) === Number(courseId) &&
        Number(sem.academic_year_id) === Number(academicYearId) &&
        String(sem.batch || '') === String(batch || '') &&
        Number(sem.year_of_study) === Number(yearOfStudy)
      );

      if (matchedSems.length === 0) {
        console.log(`⚠️ No semester configuration found in SQL for Admission No: ${tr.admission_number} (Batch: ${batch}, Year of Study: ${yearOfStudy}). Skipping.`);
        skippedCount++;
        continue;
      }

      // Sort by semester_number descending to find the latest active semester
      matchedSems.sort((a, b) => Number(b.semester_number || 0) - Number(a.semester_number || 0));
      const latestSem = matchedSems[0];

      const newSemesterId = latestSem.id;
      const newExpiryDate = fmt(latestSem.end_date); // format to YYYY-MM-DD

      const oldSemesterId = tr.semester_id;
      const oldExpiryDate = fmt(tr.expiry_date);
      const oldSemEndDate = fmt(tr.semester_end_date);

      const needsUpdate = 
        newSemesterId !== oldSemesterId || 
        newExpiryDate !== oldExpiryDate || 
        newExpiryDate !== oldSemEndDate;

      if (needsUpdate) {
        console.log(`✏️ [PENDING UPDATE] Student: ${student.student_name} (${tr.admission_number}):`);
        console.log(`  - Semester ID: ${oldSemesterId || 'NULL'} -> ${newSemesterId}`);
        console.log(`  - Expiry Date: ${oldExpiryDate || 'NULL'} -> ${newExpiryDate}`);
        console.log(`  - Semester End: ${oldSemEndDate || 'NULL'} -> ${newExpiryDate}`);

        if (!dryRun) {
          // 1. Update MongoDB document
          await TransportRequest.updateOne(
            { _id: tr._id },
            { 
              $set: {
                semester_id: newSemesterId,
                semester_end_date: latestSem.end_date,
                expiry_date: latestSem.end_date,
                updated_at: new Date()
              }
            }
          );

          // 2. Update MySQL table (to keep both in sync)
          await mysqlPool.query(
            `UPDATE transport_requests 
             SET semester_id = ?, expiry_date = ?, semester_end_date = ? 
             WHERE admission_number = ? AND status = 'approved' AND academic_year = ?`,
            [newSemesterId, newExpiryDate, newExpiryDate, tr.admission_number, academicYear]
          );
        }
        updatedCount++;
      } else {
        unchangedCount++;
      }
    }

    console.log('\n--- Sync Summary ---');
    console.log(`Total B.Pharm Requests: ${bPharmRequests.length}`);
    console.log(`Updated:               ${updatedCount}`);
    console.log(`Unchanged:             ${unchangedCount}`);
    console.log(`Skipped (No Config):    ${skippedCount}`);

    if (dryRun) {
      console.log('\nDry-run complete. No database changes were made.');
    } else {
      console.log('\nDatabase synchronization complete. Both MongoDB and MySQL have been updated.');
    }

  } catch (error) {
    console.error('❌ Error executing script:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
})();
