const express = require('express');
const router = express.Router();
const {
    getBuses,
    getBusesOverview,
    getBusDetails,
    getBusRouteHistory,
    getBusStaffHistory,
    getBusTaxHistory,
    autoAllocate,
    createBus,
    updateBus,
    deleteBus,
    addBusTax,
    updateBusTax,
    deleteBusTax
} = require('../controllers/busController');

router.get('/overview', getBusesOverview);
router.route('/').get(getBuses).post(createBus);
router.get('/:id/details', getBusDetails);
router.get('/:id/history/route', getBusRouteHistory);
router.get('/:id/history/staff', getBusStaffHistory);
router.get('/:id/taxes/history', getBusTaxHistory);
router.post('/:id/auto-allocate', autoAllocate);
router.post('/:id/taxes', addBusTax);
router.put('/:id/taxes/:taxId', updateBusTax);
router.delete('/:id/taxes/:taxId', deleteBusTax);
router.route('/:id').put(updateBus).delete(deleteBus);

module.exports = router;
