const express = require('express');
const router = express.Router();
const {
    getOtherVehicles,
    getOtherVehicleById,
    createOtherVehicle,
    updateOtherVehicle,
    deleteOtherVehicle,
    addOtherVehicleTax,
    updateOtherVehicleTax,
    deleteOtherVehicleTax,
    getOtherVehicleTaxHistory
} = require('../controllers/otherVehicleController');

router.route('/')
    .get(getOtherVehicles)
    .post(createOtherVehicle);

router.get('/:id/taxes/history', getOtherVehicleTaxHistory);
router.post('/:id/taxes', addOtherVehicleTax);
router.put('/:id/taxes/:taxId', updateOtherVehicleTax);
router.delete('/:id/taxes/:taxId', deleteOtherVehicleTax);

router.route('/:id')
    .get(getOtherVehicleById)
    .put(updateOtherVehicle)
    .delete(deleteOtherVehicle);

module.exports = router;
