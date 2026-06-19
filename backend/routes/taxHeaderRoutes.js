const express = require('express');
const router = express.Router();
const {
    getTaxHeaders,
    createTaxHeader,
    updateTaxHeader,
    deleteTaxHeader
} = require('../controllers/taxHeaderController');

router.route('/').get(getTaxHeaders).post(createTaxHeader);
router.route('/:id').put(updateTaxHeader).delete(deleteTaxHeader);

module.exports = router;
