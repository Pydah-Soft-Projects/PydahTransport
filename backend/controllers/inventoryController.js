const InventoryItem = require('../models/InventoryItem');
const InventoryAllocation = require('../models/InventoryAllocation');
const Bus = require('../models/Bus');
const OtherVehicle = require('../models/OtherVehicle');
const Vendor = require('../models/Vendor');
const TyreRegistry = require('../models/TyreRegistry');

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
        const payload = normalizeInventoryItemPayload(req.body);
        if (!payload.itemName) {
            return res.status(400).json({ message: 'Item group / category is required' });
        }
        if (payload.variants.length > 0) {
            payload.variantName = '';
        }
        const updatedItem = await InventoryItem.findByIdAndUpdate(id, payload, { new: true });
        if (!updatedItem) return res.status(404).json({ message: 'Item not found' });
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

// Raise Bill (Allocation to Bus)
exports.raiseBill = async (req, res) => {
    try {
        const { vendorId, adminName, busId, billNo, items } = req.body;
        
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ message: 'No items provided for the bill' });
        }

        const results = [];

        // Find the vehicle (Bus or OtherVehicle)
        let vehicle = await Bus.findOne({ busNumber: busId }).catch(() => null) || 
                      await Bus.findById(busId).catch(() => null);
        let vehicleType = 'Bus';
        
        if (!vehicle) {
            vehicle = await OtherVehicle.findOne({ vehicleNumber: busId }).catch(() => null) || 
                      await OtherVehicle.findById(busId).catch(() => null);
            vehicleType = 'OtherVehicle';
        }
        if (!vehicle) return res.status(404).json({ message: 'Vehicle not found' });

        for (const lineItem of items) {
            const { 
                itemIds, quantity, price, remarks, variantName,
                tyrePosition, kmReading, tyreType 
            } = lineItem;
            
            const targetItems = Array.isArray(itemIds) ? itemIds : [itemIds];
            
            for (const itemId of targetItems) {
                const item = await InventoryItem.findById(itemId);
                if (!item) continue;

                const allocation = new InventoryAllocation({
                    busId: vehicle._id,
                    vehicleType,
                    itemId,
                    variantName: variantName || '',
                    vendorId,
                    billNo, // Add Bill Number
                    quantity: quantity || 1,
                    price: price || 0,
                    remarks,
                    adminName,
                    tyrePosition,
                    kmReading: kmReading || 0
                });

                await allocation.save();

                // If it's a tyre, update Registry
                if ((item.category === 'Tires' || item.itemName === 'Tires') && tyrePosition) {
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
                }
                results.push(allocation);
            }
        }

        res.status(201).json({ message: 'Bill(s) raised and assigned successfully', count: results.length });
    } catch (error) {
        res.status(400).json({ message: 'Error raising bill', error: error.message });
    }
};

// Internal allocation (legacy/backward compatibility)
exports.allocateItem = exports.raiseBill;

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
