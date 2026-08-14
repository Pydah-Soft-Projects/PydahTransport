/**
 * ---------------------------------------------------------------
 *  checkAcademicYearExpiry.js
 * ---------------------------------------------------------------
 *  Purpose
 *  -------
 *  • Fetch all *student* transport requests that belong to the
 *    academic year **2025-2026**, course **B.Pharm**, first year.
 *  • For each request display:
 *        – The expiry date that is stored in MongoDB
 *        – The “official” expiry date that comes from the SQL
 *          table `course_transport_expiry` (the same logic the
 *          back‑end uses for the academic‑year fallback).
 *  • This script performs a **dry‑run only** – it never writes
 *    anything to the database.
 *
 *  How to run (dry‑run)
 *  ---------------------
 *  1️⃣  Ensure the environment variables from `.env` are loaded
 *      (e.g. using a library like dotenv, or if you run from the backend directory).
 *  2️⃣  From the project root execute:
 *
 *          node -r dotenv/config backend/scripts/checkAcademicYearExpiry.js
 *
 *  The script will print a nicely formatted table to the console.
 *
 *  ---------------------------------------------------------------
 */

const path = require('path');
// Load environment variables from .env
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const mongoose = require('mongoose');

// Ensure database connections are initialized
const db = require('../config/db');
const mysqlPool = db.mysqlPool;

// Load the TransportRequest model (MongoDB)
const TransportRequest = require('../models/TransportRequest');
const { resolveStudentExpiries } = require('../utils/expiryResolver');

// Helper to format dates nicely
const fmt = (date) => (date ? new Date(date).toISOString().split('T')[0] : '—');

(async () => {
  try {
    // Connect to MongoDB using the MONGO_URI from env
    if (!process.env.MONGO_URI) {
      console.error('❌ MONGO_URI environment variable is missing.');
      process.exit(1);
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const academicYear = '2025-2026';
    const targetCourse = 'B.Pharm';
    const targetYear = 1; // 1st year

    console.log(`\n🔍 Fetching MongoDB records for Academic Year: ${academicYear}...`);

    // Fetch matching student requests from MongoDB by academic year first
    const mongoDocs = await TransportRequest.find({
      academic_year: academicYear
    })
    .select('admission_number student_name expiry_date semester_end_date status year_of_study')
    .lean();

    console.log(`📊 Found ${mongoDocs.length} total requests for ${academicYear} in MongoDB.`);

    // 1. Resolve course_id and academic_year_id from MySQL
    let courseId = null;
    let academicYearId = null;
    if (mysqlPool) {
      const [courseRows] = await mysqlPool.query('SELECT id FROM courses WHERE name = ? LIMIT 1', [targetCourse]);
      if (courseRows.length > 0) courseId = courseRows[0].id;

      const [ayRows] = await mysqlPool.query('SELECT id FROM academic_years WHERE year_label = ? LIMIT 1', [academicYear]);
      if (ayRows.length > 0) academicYearId = ayRows[0].id;
      
      console.log(`🔍 Resolved in SQL - Course ID: ${courseId || 'Not Found'}, Academic Year ID: ${academicYearId || 'Not Found'}`);
    }

    // Fetch student info from MySQL students table to get course, student_name, current_year, and batch
    const admissionNos = [...new Set(mongoDocs.map(r => r.admission_number).filter(Boolean))];
    let studentMap = {};
    if (mysqlPool && admissionNos.length > 0) {
      console.log(`🔍 Querying MySQL students table for ${admissionNos.length} admission numbers...`);
      const [studentRows] = await mysqlPool.query(
        `SELECT admission_number, admission_no, course, current_year, student_name, batch
         FROM students
         WHERE admission_number IN (?) OR admission_no IN (?)`,
        [admissionNos, admissionNos]
      );
      for (const s of studentRows) {
        if (s.admission_number) studentMap[s.admission_number] = s;
        if (s.admission_no) studentMap[s.admission_no] = s;
      }
    }

    // Filter in-memory by course and year of study
    const filteredDocs = mongoDocs.filter((r) => {
      const student = studentMap[r.admission_number] || {};
      const itemCourse = student.course || 'N/A';
      const itemYear = r.year_of_study || student.current_year || 1;
      return (
        itemCourse.toLowerCase() === targetCourse.toLowerCase() &&
        Number(itemYear) === Number(targetYear)
      );
    });

    console.log(`📊 Found ${filteredDocs.length} matching requests after filtering for Course: ${targetCourse}, Year: ${targetYear}.`);

    // Fetch SQL Course Expiry settings and pre-load semesters
    console.log('🔍 Fetching SQL Course Expiry settings & Semesters...');
    let sqlCourseExpiry = '—';
    let semestersList = [];
    
    if (mysqlPool) {
      const [sqlRows] = await mysqlPool.query(
        `
          SELECT cte.expiry_date
          FROM course_transport_expiry cte
          JOIN courses c ON c.id = cte.course_id
          JOIN academic_years ay ON ay.year_label = ?
          WHERE c.name = ?
            AND cte.year_of_study = ?
          LIMIT 1;
        `,
        [academicYear, targetCourse, targetYear]
      );
      
      if (sqlRows.length > 0 && sqlRows[0].expiry_date) {
        sqlCourseExpiry = fmt(sqlRows[0].expiry_date);
      }

      const [semRows] = await mysqlPool.query(
        'SELECT id, course_id, academic_year_id, batch, year_of_study, semester_number, end_date FROM semesters'
      );
      semestersList = semRows;
    }

    // Call the newly implemented helper on a clone of the filtered requests to test it
    const testDocs = JSON.parse(JSON.stringify(filteredDocs));
    await resolveStudentExpiries(testDocs, mysqlPool);
    const testMap = new Map(testDocs.map(d => [d.admission_number, d]));

    // Display results in a formatted table
    const col = (w, txt) => String(txt || '').padEnd(w).substring(0, w);
    const header = [
      col(12, 'Admission No'),
      col(18, 'Student Name'),
      col(6, 'Batch'),
      col(8, 'Status'),
      col(12, 'Mongo Expiry'),
      col(12, 'Mongo SemEnd'),
      col(15, 'Dynamic Expiry'),
      col(12, 'SQL SemLink'),
      col(15, 'SQL SemLatest'),
      col(12, 'SQL CourseExp'),
    ].join(' | ');

    console.log('\n' + '='.repeat(header.length));
    console.log(header);
    console.log('='.repeat(header.length));

    filteredDocs.forEach((doc) => {
      const student = studentMap[doc.admission_number] || {};
      const studentName = doc.student_name || student.student_name || '—';
      const batch = student.batch || '—';
      
      // 1. End Date of the Linked Semester ID (from MongoDB) in SQL
      let sqlSemLinkEnd = '—';
      if (doc.semester_id && semestersList.length > 0) {
        const linkedSem = semestersList.find(s => Number(s.id) === Number(doc.semester_id));
        if (linkedSem) sqlSemLinkEnd = fmt(linkedSem.end_date);
      }

      // 2. Latest Configured Semester End Date in SQL matching (course, academic year, batch, year of study)
      let sqlSemLatestEnd = '—';
      if (courseId && academicYearId && semestersList.length > 0) {
        const matchedSems = semestersList.filter(sem => 
          Number(sem.course_id) === Number(courseId) &&
          Number(sem.academic_year_id) === Number(academicYearId) &&
          String(sem.batch || '') === String(batch || '') &&
          Number(sem.year_of_study) === Number(targetYear)
        );

        if (matchedSems.length > 0) {
          // Sort by semester_number descending to get the latest
          matchedSems.sort((a, b) => Number(b.semester_number || 0) - Number(a.semester_number || 0));
          sqlSemLatestEnd = fmt(matchedSems[0].end_date);
        }
      }

      // 3. Date resolved dynamically by the new expiry resolver
      let resolvedExpiry = '—';
      const resolvedDoc = testMap.get(doc.admission_number);
      if (resolvedDoc) {
        resolvedExpiry = fmt(resolvedDoc.expiry_date);
      }

      console.log([
        col(12, doc.admission_number || '—'),
        col(18, studentName),
        col(6, batch),
        col(8, doc.status || '—'),
        col(12, fmt(doc.expiry_date)),
        col(12, fmt(doc.semester_end_date)),
        col(15, resolvedExpiry),
        col(12, sqlSemLinkEnd),
        col(15, sqlSemLatestEnd),
        col(12, sqlCourseExpiry),
      ].join(' | '));
    });

    console.log('='.repeat(header.length));
    console.log('✅ Dry-run complete. No database changes were made.\n');

  } catch (error) {
    console.error('❌ Error executing script:', error);
  } finally {
    // Close DB connections
    try {
      await mongoose.disconnect();
      console.log('Disconnected MongoDB.');
    } catch (e) {}
    
    // We do not end the mysqlPool here as it might be a shared pool, 
    // but since this is a standalone script process, exiting will clean it up.
    process.exit(0);
  }
})();
