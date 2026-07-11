const express = require('express');
const router = express.Router();
const inventoryController = require('../controllers/inventoryController');
const { requirePermission } = require('../middleware/authMiddleware');

// Master Inventory
router.get('/', inventoryController.getItems);
router.post('/', inventoryController.createItem);

// Bill / Allocate to Bus (must be before /:id routes)
router.post('/raise-bill', inventoryController.raiseBill);
router.put('/update-bill', requirePermission('inventory_edit'), inventoryController.updateBill);
router.delete('/bills/:billNo', requirePermission('inventory_delete'), inventoryController.deleteBill);
router.post('/allocate', inventoryController.allocateItem);

router.put('/:id', inventoryController.updateItem);
router.delete('/:id', inventoryController.deleteItem);

// Vendors
router.get('/vendors', inventoryController.getVendors);
router.post('/vendors', inventoryController.createVendor);
router.put('/vendors/:id', inventoryController.updateVendor);
router.delete('/vendors/:id', inventoryController.deleteVendor);

router.get('/history/:busId?', inventoryController.getHistory);

// Tyre Registry
router.get('/tyre-registry/:busId?', inventoryController.getTyreRegistry);

module.exports = router;
