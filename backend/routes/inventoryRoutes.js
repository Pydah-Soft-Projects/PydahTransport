const express = require('express');
const router = express.Router();
const inventoryController = require('../controllers/inventoryController');
const { requirePermission } = require('../middleware/authMiddleware');
const { uploadBillAttachments } = require('../middleware/billUpload');

// Master Inventory
router.get('/', inventoryController.getItems);
router.post('/', inventoryController.createItem);

// Hybrid bills (must be before /:id routes)
router.get('/bills', inventoryController.getBills);
router.get('/bills/by-id/:id', inventoryController.getBillById);
router.post('/bills', inventoryController.createBill);
router.put('/bills/by-id/:id', requirePermission('inventory_edit'), inventoryController.updateBillById);
router.delete('/bills/by-id/:id', requirePermission('inventory_delete'), inventoryController.deleteBillById);
router.post('/bills/by-id/:id/attachments', (req, res) => {
    uploadBillAttachments(req, res, (err) => {
        if (err) return res.status(400).json({ message: err.message || 'Upload failed' });
        return inventoryController.addBillAttachments(req, res);
    });
});
router.delete(
    '/bills/by-id/:id/attachments/:attachmentId',
    requirePermission('inventory_edit'),
    inventoryController.deleteBillAttachment
);

// Legacy raise / update / delete paths (adapters)
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
