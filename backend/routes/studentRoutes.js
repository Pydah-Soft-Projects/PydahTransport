const express = require('express');
const router = express.Router();
const {
    searchStudents,
    getStudentProfile,
    getCourses,
    getCourseExpiry,
    setCourseExpiry,
    deleteCourseExpiry,
    getAcademicYears,
    getAcademicValidation,
    getColleges,
} = require('../controllers/studentController');
const { protect } = require('../middleware/authMiddleware');

router.get('/search', protect, searchStudents);
router.get('/academic-years', getAcademicYears);
router.get('/academic-validation', getAcademicValidation);
router.get('/profile', protect, getStudentProfile);
router.get('/courses', protect, getCourses);
router.get('/colleges', protect, getColleges);
router.get('/course-expiry', getCourseExpiry);
router.put('/course-expiry', setCourseExpiry);
router.delete('/course-expiry/:courseId', deleteCourseExpiry);

module.exports = router;
