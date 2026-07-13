const express = require('express');
const router = express.Router();
const {
    getTransportRequests,
    getRouteBusVacancy,
    getSemesterOptions,
    updateTransportRequest,
    approveTransportRequest,
    rejectTransportRequest,
    cancelTransportRequest,
    createTransportRequest,
    getConcessions,
    getDashboardStats,
    updateConcession,
    deleteConcession,
    getApprovedPassengers,
    submitRouteChangeRequest,
    getPassengerFullDetails,
    getIdCardsForPrint,
    getIdCardApplicationNumbers
} = require('../controllers/transportRequestController');

router.get('/', getTransportRequests);
router.post('/', createTransportRequest);
router.get('/route-buses', getRouteBusVacancy);
router.get('/approved-passengers', getApprovedPassengers);
router.get('/id-cards-print', getIdCardsForPrint);
router.get('/id-card-application-numbers', getIdCardApplicationNumbers);
router.post('/change-request', submitRouteChangeRequest);
router.get('/concessions', getConcessions);
router.get('/stats', getDashboardStats);
router.patch('/:id/concession', updateConcession);
router.get('/:id/semester-options', getSemesterOptions);
router.get('/:id/full-details', getPassengerFullDetails);
router.patch('/:id/approve', approveTransportRequest);
router.patch('/:id/reject', rejectTransportRequest);
router.patch('/:id/cancel', cancelTransportRequest);
router.patch('/:id', updateTransportRequest);

router.delete('/:id/concession', deleteConcession);
router.delete('/:id', deleteConcession);

module.exports = router;
