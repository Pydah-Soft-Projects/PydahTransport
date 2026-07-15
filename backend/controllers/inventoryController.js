const InventoryItem = require('../models/InventoryItem');
const InventoryAllocation = require('../models/InventoryAllocation');
const Bus = require('../models/Bus');
const OtherVehicle = require('../models/OtherVehicle');
const Vendor = require('../models/Vendor');
const TyreRegistry = require('../models/TyreRegistry');
const MaintenanceBill = require('../models/MaintenanceBill');
const maintenanceBillController = require('./maintenanceBillController');

const parseBillQuantity = (value) => {
    const num = parseInt(value, 10);
    if (!Number.isInteger(num) || num < 1) {
        throw new Error('Quantity must be a whole number of at least 1');
    }
    return num;
};

const parseGstPercent = (value) => {
    const num = parseFloat(value);
    if (!Number.isFinite(num) || num < 0 || num > 100) {
        return 0;
    }
    return Math.round(num * 100) / 100;
};

const resolveVehicle = async (busId) => {
    let vehicle = await Bus.findOne({ busNumber: busId }).catch(() => null) ||
                  await Bus.findById(busId).catch(() => null);
    let vehicleType = 'Bus';

    if (!vehicle) {
        vehicle = await OtherVehicle.findOne({ vehicleNumber: busId }).catch(() => null) ||
                  await OtherVehicle.findById(busId).catch(() => null);
        vehicleType = 'OtherVehicle';
    }

    return vehicle ? { vehicle, vehicleType } : null;
};

const applyTyreRegistryUpdate = async ({ vehicle, vehicleType, item, variantName, tyrePosition, kmReading, tyreType }) => {
    if (!(item.category === 'Tires' || item.itemName === 'Tires') || !tyrePosition) return;

    await TyreRegistry.updateMany(
        { busId: vehicle._id, vehicleType, position: tyrePosition, status: 'Active' },
        { status: 'Replaced' }
    );

    const registryEntry = new TyreRegistry({
        busId: vehicle._id,
        vehicleType,
        position: tyrePosition,
        tyreType: tyreType || (`${item.itemName} ${variantName || item.variantName || ''}`.toLowerCase().includes('old') ? 'old tyre' : 'new tyre'),
        installKm: kmReading || 0,
        status: 'Active'
    });
    await registryEntry.save();
};

const normalizeInventoryItemPayload = ({ itemName, variantName, variantNames, variants, category, unit, description }) => ({
    itemName: String(itemName || '').trim(),
    variantName: String(variantName || '').trim(),
    variants: normalizeVariantList({ variantNames, variants, variantName }).map((name) => ({ name })),
    category: String(category || 'General').trim() || 'General',
    unit: String(unit || 'Pcs').trim() || 'Pcs',
    description: String(description || '').trim()
});

function normalizeVariantList({ variantNames, variants, variantName }) {
    const values = Array.isArray(variants)
        ? variants.map((variant) => typeof variant === 'string' ? variant : variant?.name)
        : Array.isArray(variantNames)
        ? variantNames
        : String(variantNames || variantName || '')
            .split(/\r?\n|,/);

    return [...new Set(
        values
            .map((value) => String(value || '').trim())
            .filter(Boolean)
    )];
}

// Master Inventory
exports.getItems = async (req, res) => {
    try {
        const items = await InventoryItem.find().sort({ itemName: 1, variantName: 1 });
        res.status(200).json(items);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching inventory items', error: error.message });
    }
};

exports.createItem = async (req, res) => {
    try {
        const payload = normalizeInventoryItemPayload(req.body);
        if (!payload.itemName) {
            return res.status(400).json({ message: 'Item group / category is required' });
        }
        if (payload.variants.length > 0) {
            payload.variantName = '';
        }

        // Check if an item with the same itemName (case-insensitive) already exists
        const existingItem = await InventoryItem.findOne({
            itemName: { $regex: new RegExp(`^${payload.itemName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}$`, 'i') }
        });

        if (existingItem) {
            // Merge variants avoiding duplicates
            const existingNames = existingItem.variants.map(v => v.name.toLowerCase());
            const newVariants = payload.variants.filter(v => !existingNames.includes(v.name.toLowerCase()));
            
            existingItem.variants.push(...newVariants);
            
            if (payload.category) existingItem.category = payload.category;
            if (payload.unit) existingItem.unit = payload.unit;
            if (payload.description) existingItem.description = payload.description;
            existingItem.variantName = '';

            await existingItem.save();
            return res.status(201).json({ message: 'Variants added to existing item group successfully', item: existingItem });
        }

        const newItem = new InventoryItem(payload);
        await newItem.save();
        res.status(201).json({ message: 'Item created successfully', item: newItem });
    } catch (error) {
        res.status(400).json({ message: 'Error creating inventory item', error: error.message });
    }
};

exports.updateItem = async (req, res) => {
    try {
        const { id } = req.params;
        const currentItem = await InventoryItem.findById(id);
        if (!currentItem) return res.status(404).json({ message: 'Item not found' });

        const payload = normalizeInventoryItemPayload(req.body);
        if (!payload.itemName) {
            return res.status(400).json({ message: 'Item group / category is required' });
        }
        if (payload.variants.length > 0) {
            payload.variantName = '';
        }

        // Find sibling documents that share the same item group name
        const siblings = await InventoryItem.find({
            itemName: currentItem.itemName,
            _id: { $ne: id }
        });

        // Update the main document
        const updatedItem = await InventoryItem.findByIdAndUpdate(id, payload, { new: true });

        // Update allocations, bills, and delete siblings
        for (const sibling of siblings) {
            // Update Allocations
            await InventoryAllocation.updateMany(
                { itemId: sibling._id },
                { itemId: id }
            );

            // Update Bills
            await MaintenanceBill.updateMany(
                { "lines.itemId": sibling._id },
                { $set: { "lines.$[elem].itemId": id } },
                { arrayFilters: [{ "elem.itemId": sibling._id }] }
            );

            // Delete Sibling
            await InventoryItem.findByIdAndDelete(sibling._id);
        }

        res.status(200).json({ message: 'Item updated successfully', item: updatedItem });
    } catch (error) {
        res.status(400).json({ message: 'Error updating inventory item', error: error.message });
    }
};

exports.deleteItem = async (req, res) => {
    try {
        const { id } = req.params;
        const allocations = await InventoryAllocation.countDocuments({ itemId: id });
        if (allocations > 0) return res.status(400).json({ message: 'Cannot delete item with active allocations' });
        await InventoryItem.findByIdAndDelete(id);
        res.status(200).json({ message: 'Item deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting inventory item', error: error.message });
    }
};

// Vendor Controllers
exports.getVendors = async (req, res) => {
    try {
        const vendors = await Vendor.find().sort({ name: 1 });
        res.status(200).json(vendors);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching vendors', error: error.message });
    }
};

exports.createVendor = async (req, res) => {
    try {
        const newVendor = new Vendor(req.body);
        await newVendor.save();
        res.status(201).json({ message: 'Vendor created successfully', vendor: newVendor });
    } catch (error) {
        res.status(400).json({ message: 'Error creating vendor', error: error.message });
    }
};

exports.updateVendor = async (req, res) => {
    try {
        const updatedVendor = await Vendor.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!updatedVendor) return res.status(404).json({ message: 'Vendor not found' });
        res.status(200).json({ message: 'Vendor updated successfully', vendor: updatedVendor });
    } catch (error) {
        res.status(400).json({ message: 'Error updating vendor', error: error.message });
    }
};

exports.deleteVendor = async (req, res) => {
    try {
        const { id } = req.params;
        const allocations = await InventoryAllocation.countDocuments({ vendorId: id });
        if (allocations > 0) {
            return res.status(400).json({ message: 'Cannot delete vendor with existing bills or allocations' });
        }
        const deletedVendor = await Vendor.findByIdAndDelete(id);
        if (!deletedVendor) return res.status(404).json({ message: 'Vendor not found' });
        res.status(200).json({ message: 'Vendor deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting vendor', error: error.message });
    }
};

// Raise / update / delete bill — hybrid MaintenanceBill + allocation sync
exports.raiseBill = maintenanceBillController.createBill;
exports.allocateItem = maintenanceBillController.createBill;
exports.updateBill = maintenanceBillController.updateBillByNumber;
exports.deleteBill = maintenanceBillController.deleteBillByNumber;

exports.createBill = maintenanceBillController.createBill;
exports.updateBillById = maintenanceBillController.updateBillById;
exports.deleteBillById = maintenanceBillController.deleteBillById;
exports.getBills = maintenanceBillController.getBills;
exports.getBillById = maintenanceBillController.getBillById;
exports.addBillAttachments = maintenanceBillController.addAttachments;
exports.deleteBillAttachment = maintenanceBillController.deleteAttachment;

// Get allocation/bill history
exports.getHistory = async (req, res) => {
    try {
        const { busId } = req.params;
        const query = {};
        
        if (busId && busId !== 'all') {
            const bus = await Bus.findOne({ busNumber: busId }).catch(() => null) || await Bus.findById(busId).catch(() => null);
            if (bus) {
                query.busId = bus._id;
                query.vehicleType = 'Bus';
            } else {
                const vehicle = await OtherVehicle.findOne({ vehicleNumber: busId }).catch(() => null) || await OtherVehicle.findById(busId).catch(() => null);
                if (vehicle) {
                    query.busId = vehicle._id;
                    query.vehicleType = 'OtherVehicle';
                } else {
                    return res.status(200).json([]);
                }
            }
        }

        const history = await InventoryAllocation.find(query)
            .populate('itemId', 'itemName variantName variants category unit')
            .populate('busId', 'busNumber vehicleNumber type')
            .populate('vendorId', 'name')
            .sort({ allocatedDate: -1 });

        res.status(200).json(history);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching history', error: error.message });
    }
};

// Tyre Registry
exports.getTyreRegistry = async (req, res) => {
    try {
        const { busId } = req.params;
        const query = { status: 'Active' };
        if (busId && busId !== 'all') {
            const bus = await Bus.findOne({ busNumber: busId }).catch(() => null) || await Bus.findById(busId).catch(() => null);
            if (bus) {
                query.busId = bus._id;
                query.vehicleType = 'Bus';
            } else {
                const vehicle = await OtherVehicle.findOne({ vehicleNumber: busId }).catch(() => null) || await OtherVehicle.findById(busId).catch(() => null);
                if (vehicle) {
                    query.busId = vehicle._id;
                    query.vehicleType = 'OtherVehicle';
                } else {
                    return res.status(200).json([]);
                }
            }
        }

        const registry = await TyreRegistry.find(query)
            .populate('busId', 'busNumber vehicleNumber type')
            .sort({ updatedAt: -1 });
        
        res.status(200).json(registry);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching tyre registry', error: error.message });
    }
};
