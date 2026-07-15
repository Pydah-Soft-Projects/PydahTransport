const path = require('path');
const fs = require('fs');
const MaintenanceBill = require('../models/MaintenanceBill');
const InventoryItem = require('../models/InventoryItem');
const InventoryAllocation = require('../models/InventoryAllocation');
const Bus = require('../models/Bus');
const OtherVehicle = require('../models/OtherVehicle');
const TyreRegistry = require('../models/TyreRegistry');
const { computeBillTotals, normalizeTaxEntries, toNumber } = require('../utils/billCalculations');
const { uploadDir } = require('../middleware/billUpload');

const parseBillQuantity = (value) => {
    const num = parseInt(value, 10);
    if (!Number.isInteger(num) || num < 1) {
        throw new Error('Quantity must be a whole number of at least 1');
    }
    return num;
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

const rollbackTyreOnDelete = async (alloc) => {
    const item = alloc.itemId;
    const isTyreItem = item && (item.category === 'Tires' || item.itemName === 'Tires');
    if (isTyreItem && alloc.tyrePosition) {
        await TyreRegistry.updateMany(
            {
                busId: alloc.busId,
                vehicleType: alloc.vehicleType,
                position: alloc.tyrePosition,
                installKm: alloc.kmReading || 0,
                status: 'Active'
            },
            { status: 'Replaced' }
        );
    }
};

const deleteAttachmentFiles = (attachments = []) => {
    for (const att of attachments) {
        if (!att?.url) continue;
        const fileName = path.basename(att.url);
        const fullPath = path.join(uploadDir, fileName);
        if (fs.existsSync(fullPath)) {
            try {
                fs.unlinkSync(fullPath);
            } catch (_) {
                /* ignore missing files */
            }
        }
    }
};

const normalizeIncomingLines = (items = []) => {
    if (!Array.isArray(items) || items.length === 0) {
        throw new Error('No items provided for the bill');
    }

    return items.map((raw) => {
        const itemIds = Array.isArray(raw.itemIds) ? raw.itemIds : [raw.itemId || raw.itemIds];
        const itemId = itemIds.find(Boolean);
        if (!itemId) throw new Error('Each line must include an inventory item');

        const pricingMode = raw.pricingMode === 'lumpSum' ? 'lumpSum' : 'unitRate';
        const quantity = parseBillQuantity(raw.quantity);
        const unitPrice = toNumber(raw.unitPrice ?? raw.price, 0);
        const amount = pricingMode === 'lumpSum'
            ? toNumber(raw.amount ?? raw.price, 0)
            : 0;

        if (pricingMode === 'unitRate' && unitPrice < 0) {
            throw new Error('Each unit-rate line must have a valid unit price');
        }
        if (pricingMode === 'lumpSum' && amount < 0) {
            throw new Error('Each lump-sum line must have a valid amount');
        }

        const subDescriptions = Array.isArray(raw.subDescriptions)
            ? raw.subDescriptions.map((s) => String(s || '').trim()).filter(Boolean)
            : String(raw.subDescriptions || '')
                .split(/\r?\n/)
                .map((s) => s.trim())
                .filter(Boolean);

        return {
            allocationId: raw.allocationId || null,
            itemId,
            variantName: raw.variantName || '',
            description: raw.description || '',
            subDescriptions,
            pricingMode,
            quantity,
            unitPrice,
            amount,
            uom: raw.uom || '',
            discountAmount: toNumber(raw.discountAmount, 0),
            discountPercent: toNumber(raw.discountPercent, 0),
            gstPercent: toNumber(raw.gstPercent, 0),
            taxes: normalizeTaxEntries(raw.taxes, raw.gstPercent),
            tyrePosition: raw.tyrePosition || null,
            kmReading: raw.kmReading || 0,
            tyreType: raw.tyreType || '',
            remarks: raw.remarks || ''
        };
    });
};

const buildBillDocument = async ({ body, vehicle, vehicleType, existingAttachments = [] }) => {
    const taxMode = ['none', 'billLevel', 'lineLevel'].includes(body.taxMode) ? body.taxMode : 'lineLevel';
    const discountMode = ['none', 'billLevel', 'lineLevel'].includes(body.discountMode)
        ? body.discountMode
        : 'none';

    const incomingLines = normalizeIncomingLines(body.items || body.lines);
    const totals = computeBillTotals({
        taxMode,
        discountMode,
        discountAmount: body.discountAmount,
        discountPercent: body.discountPercent,
        taxes: body.taxes,
        gstPercent: body.gstPercent,
        grandTotalOverride: body.grandTotalOverride,
        lines: incomingLines
    });

    const lines = [];
    for (let i = 0; i < incomingLines.length; i += 1) {
        const line = incomingLines[i];
        const computed = totals.lines[i];
        const item = await InventoryItem.findById(line.itemId);
        if (!item) throw new Error(`Inventory item not found: ${line.itemId}`);

        lines.push({
            allocationId: line.allocationId || null,
            itemId: item._id,
            variantName: line.variantName || '',
            description: line.description || '',
            subDescriptions: line.subDescriptions,
            pricingMode: computed.pricingMode,
            quantity: computed.quantity,
            unitPrice: computed.unitPrice,
            amount: computed.amount,
            uom: line.uom || item.unit || 'Pcs',
            discountAmount: computed.discountAmount,
            discountPercent: computed.discountPercent,
            gstPercent: computed.gstPercent,
            taxes: computed.taxes,
            taxableAmount: computed.taxableAmount,
            taxAmount: computed.taxAmount,
            lineTotal: computed.lineTotal,
            tyrePosition: line.tyrePosition,
            kmReading: line.kmReading || 0,
            tyreType: line.tyreType || '',
            remarks: line.remarks || ''
        });
    }

    return {
        billNo: String(body.billNo || '').trim(),
        date: body.date ? new Date(body.date) : new Date(),
        busId: vehicle._id,
        vehicleType,
        vendorId: body.vendorId || null,
        adminName: body.adminName || '',
        taxMode,
        discountMode,
        taxes: totals.billTaxes,
        discountAmount: toNumber(body.discountAmount, 0),
        discountPercent: toNumber(body.discountPercent, 0),
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        taxTotal: totals.taxTotal,
        computedGrandTotal: totals.computedGrandTotal,
        grandTotalOverride: totals.grandTotalOverride,
        grandTotal: totals.grandTotal,
        notes: body.notes || '',
        rawDescription: body.rawDescription || '',
        lines,
        attachments: existingAttachments
    };
};

const syncAllocationsForBill = async (bill, { vehicle, vehicleType, previousAllocationIds = [] }) => {
    const keptIds = new Set();
    const updatedLines = [];

    for (const line of bill.lines) {
        const item = await InventoryItem.findById(line.itemId);
        if (!item) continue;

        const allocData = {
            busId: vehicle._id,
            vehicleType,
            itemId: item._id,
            variantName: line.variantName || '',
            vendorId: bill.vendorId,
            billNo: bill.billNo,
            maintenanceBillId: bill._id,
            quantity: line.quantity,
            price: line.pricingMode === 'lumpSum'
                ? (line.quantity > 0 ? line.amount / line.quantity : line.amount)
                : line.unitPrice,
            pricingMode: line.pricingMode,
            amount: line.amount,
            gstPercent: line.gstPercent || 0,
            discountAmount: line.discountAmount || 0,
            discountPercent: line.discountPercent || 0,
            remarks: line.remarks,
            adminName: bill.adminName,
            tyrePosition: line.tyrePosition,
            kmReading: line.kmReading || 0
        };

        let allocation;
        if (line.allocationId) {
            allocation = await InventoryAllocation.findByIdAndUpdate(line.allocationId, allocData, { new: true });
        }

        if (!allocation) {
            allocation = new InventoryAllocation(allocData);
            await allocation.save();

            await applyTyreRegistryUpdate({
                vehicle,
                vehicleType,
                item,
                variantName: line.variantName,
                tyrePosition: line.tyrePosition,
                kmReading: line.kmReading,
                tyreType: line.tyreType
            });
        } else {
            const isTyreItem = item.category === 'Tires' || item.itemName === 'Tires';
            if (isTyreItem && line.tyrePosition) {
                await applyTyreRegistryUpdate({
                    vehicle,
                    vehicleType,
                    item,
                    variantName: line.variantName,
                    tyrePosition: line.tyrePosition,
                    kmReading: line.kmReading,
                    tyreType: line.tyreType
                });
            }
        }

        keptIds.add(String(allocation._id));
        updatedLines.push({
            ...line.toObject?.() || line,
            allocationId: allocation._id
        });
    }

    for (const prevId of previousAllocationIds) {
        if (!keptIds.has(String(prevId))) {
            const alloc = await InventoryAllocation.findById(prevId).populate('itemId');
            if (alloc) {
                await rollbackTyreOnDelete(alloc);
                await InventoryAllocation.findByIdAndDelete(prevId);
            }
        }
    }

    bill.lines = updatedLines;
    await bill.save();
    return bill;
};

const populateBill = (query) =>
    query
        .populate('vendorId', 'name phone address email')
        .populate('busId', 'busNumber vehicleNumber type')
        .populate('lines.itemId', 'itemName variantName variants category unit');

const toPublicBill = (bill) => {
    const obj = bill.toObject ? bill.toObject() : bill;
    return {
        ...obj,
        items: (obj.lines || []).map((line) => ({
            ...line,
            price: line.pricingMode === 'lumpSum'
                ? (line.quantity > 0 ? line.amount / line.quantity : line.amount)
                : line.unitPrice,
            _id: line.allocationId || line._id,
            allocationId: line.allocationId,
            itemId: line.itemId,
            quantity: line.quantity,
            gstPercent: line.gstPercent,
            remarks: line.remarks,
            tyrePosition: line.tyrePosition,
            kmReading: line.kmReading,
            adminName: obj.adminName,
            billNo: obj.billNo,
            allocatedDate: obj.date,
            vendorId: obj.vendorId,
            busId: obj.busId
        })),
        date: obj.date,
        totalAmount: obj.grandTotal,
        subtotal: obj.subtotal,
        gstTotal: obj.taxTotal,
        taxTotal: obj.taxTotal,
        discountTotal: obj.discountTotal
    };
};

/** Map legacy raise-bill body into hybrid payload */
const adaptLegacyRaiseBillBody = (body) => ({
    ...body,
    taxMode: body.taxMode || 'lineLevel',
    discountMode: body.discountMode || 'none',
    items: (body.items || []).map((item) => ({
        ...item,
        pricingMode: item.pricingMode || 'unitRate',
        unitPrice: item.unitPrice ?? item.price,
        amount: item.amount ?? (item.pricingMode === 'lumpSum' ? item.price : undefined),
        itemId: item.itemId || (Array.isArray(item.itemIds) ? item.itemIds[0] : item.itemIds)
    }))
});

exports.createBill = async (req, res) => {
    try {
        const body = adaptLegacyRaiseBillBody(req.body);
        if (!body.billNo) {
            return res.status(400).json({ message: 'Bill number is required' });
        }

        const resolved = await resolveVehicle(body.busId);
        if (!resolved) return res.status(404).json({ message: 'Vehicle not found' });
        const { vehicle, vehicleType } = resolved;

        const docData = await buildBillDocument({ body, vehicle, vehicleType, existingAttachments: [] });
        const bill = new MaintenanceBill(docData);
        await bill.save();

        await syncAllocationsForBill(bill, { vehicle, vehicleType, previousAllocationIds: [] });

        const populated = await populateBill(MaintenanceBill.findById(bill._id));
        res.status(201).json({
            message: 'Bill raised and assigned successfully',
            bill: toPublicBill(populated),
            count: populated.lines.length
        });
    } catch (error) {
        res.status(400).json({ message: error.message || 'Error raising bill', error: error.message });
    }
};

exports.updateBillById = async (req, res) => {
    try {
        const bill = await MaintenanceBill.findById(req.params.id);
        if (!bill) return res.status(404).json({ message: 'Bill not found' });

        const body = adaptLegacyRaiseBillBody({
            ...req.body,
            billNo: req.body.billNo || bill.billNo
        });

        const resolved = await resolveVehicle(body.busId);
        if (!resolved) return res.status(404).json({ message: 'Vehicle not found' });
        const { vehicle, vehicleType } = resolved;

        const previousAllocationIds = (bill.lines || [])
            .map((line) => line.allocationId)
            .filter(Boolean);

        const docData = await buildBillDocument({
            body,
            vehicle,
            vehicleType,
            existingAttachments: bill.attachments || []
        });

        Object.assign(bill, docData);
        await bill.save();
        await syncAllocationsForBill(bill, { vehicle, vehicleType, previousAllocationIds });

        const populated = await populateBill(MaintenanceBill.findById(bill._id));
        res.status(200).json({
            message: 'Bill updated successfully',
            bill: toPublicBill(populated),
            count: populated.lines.length
        });
    } catch (error) {
        res.status(400).json({ message: error.message || 'Error updating bill', error: error.message });
    }
};

/** Update by original bill number (legacy + hybrid edit path) */
exports.updateBillByNumber = async (req, res) => {
    try {
        const originalBillNo = req.body.originalBillNo || req.params.billNo;
        if (!originalBillNo) {
            return res.status(400).json({ message: 'Original bill number is required for editing' });
        }

        let bill = await MaintenanceBill.findOne({ billNo: originalBillNo }).sort({ updatedAt: -1 });

        if (!bill) {
            // Create from legacy allocations if bill document missing
            const existingAllocations = await InventoryAllocation.find({ billNo: originalBillNo });
            if (existingAllocations.length === 0) {
                return res.status(404).json({ message: 'Bill not found' });
            }

            const body = adaptLegacyRaiseBillBody(req.body);
            const resolved = await resolveVehicle(body.busId || existingAllocations[0].busId);
            if (!resolved) return res.status(404).json({ message: 'Vehicle not found' });
            const { vehicle, vehicleType } = resolved;

            const docData = await buildBillDocument({
                body: {
                    ...body,
                    billNo: body.billNo || originalBillNo,
                    items: body.items?.length
                        ? body.items
                        : existingAllocations.map((a) => ({
                            allocationId: a._id,
                            itemId: a.itemId,
                            variantName: a.variantName,
                            quantity: a.quantity,
                            unitPrice: a.price,
                            price: a.price,
                            gstPercent: a.gstPercent,
                            pricingMode: a.pricingMode || 'unitRate',
                            amount: a.amount,
                            remarks: a.remarks,
                            tyrePosition: a.tyrePosition,
                            kmReading: a.kmReading
                        }))
                },
                vehicle,
                vehicleType
            });
            bill = new MaintenanceBill(docData);
            await bill.save();

            const previousAllocationIds = existingAllocations.map((a) => a._id);
            await syncAllocationsForBill(bill, { vehicle, vehicleType, previousAllocationIds });
        } else {
            req.params.id = bill._id;
            return exports.updateBillById(req, res);
        }

        const populated = await populateBill(MaintenanceBill.findById(bill._id));
        res.status(200).json({
            message: 'Bill updated successfully',
            bill: toPublicBill(populated),
            count: populated.lines.length
        });
    } catch (error) {
        res.status(400).json({ message: error.message || 'Error updating bill', error: error.message });
    }
};

exports.deleteBillById = async (req, res) => {
    try {
        const bill = await MaintenanceBill.findById(req.params.id);
        if (!bill) return res.status(404).json({ message: 'Bill not found' });

        const allocations = await InventoryAllocation.find({
            $or: [{ maintenanceBillId: bill._id }, { billNo: bill.billNo }]
        }).populate('itemId');

        for (const alloc of allocations) {
            await rollbackTyreOnDelete(alloc);
        }
        await InventoryAllocation.deleteMany({
            $or: [{ maintenanceBillId: bill._id }, { billNo: bill.billNo }]
        });

        deleteAttachmentFiles(bill.attachments);
        await MaintenanceBill.findByIdAndDelete(bill._id);

        res.status(200).json({
            message: 'Bill deleted and vehicle assignments removed successfully',
            count: allocations.length
        });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting bill', error: error.message });
    }
};

exports.deleteBillByNumber = async (req, res) => {
    try {
        const billNo = decodeURIComponent(req.params.billNo || '').trim();
        if (!billNo) return res.status(400).json({ message: 'Bill number is required' });

        const bill = await MaintenanceBill.findOne({ billNo }).sort({ updatedAt: -1 });
        if (bill) {
            req.params.id = bill._id;
            return exports.deleteBillById(req, res);
        }

        // Legacy delete by allocations only
        const allocations = await InventoryAllocation.find({ billNo }).populate('itemId');
        if (allocations.length === 0) {
            return res.status(404).json({ message: 'Bill not found' });
        }
        for (const alloc of allocations) {
            await rollbackTyreOnDelete(alloc);
        }
        await InventoryAllocation.deleteMany({ billNo });
        res.status(200).json({
            message: 'Bill deleted and vehicle assignments removed successfully',
            count: allocations.length
        });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting bill', error: error.message });
    }
};

exports.getBills = async (req, res) => {
    try {
        const { busId } = req.query;
        const query = {};

        if (busId && busId !== 'all') {
            const resolved = await resolveVehicle(busId);
            if (!resolved) return res.status(200).json([]);
            query.busId = resolved.vehicle._id;
            query.vehicleType = resolved.vehicleType;
        }

        const bills = await populateBill(MaintenanceBill.find(query).sort({ date: -1 }));
        res.status(200).json(bills.map(toPublicBill));
    } catch (error) {
        res.status(500).json({ message: 'Error fetching bills', error: error.message });
    }
};

exports.getBillById = async (req, res) => {
    try {
        const bill = await populateBill(MaintenanceBill.findById(req.params.id));
        if (!bill) return res.status(404).json({ message: 'Bill not found' });
        res.status(200).json(toPublicBill(bill));
    } catch (error) {
        res.status(500).json({ message: 'Error fetching bill', error: error.message });
    }
};

exports.addAttachments = async (req, res) => {
    try {
        const bill = await MaintenanceBill.findById(req.params.id);
        if (!bill) return res.status(404).json({ message: 'Bill not found' });

        const files = req.files || [];
        if (files.length === 0) {
            return res.status(400).json({ message: 'No files uploaded' });
        }

        const newAttachments = files.map((file) => ({
            url: `/uploads/bills/${file.filename}`,
            fileName: file.originalname,
            mimeType: file.mimetype,
            uploadedAt: new Date()
        }));

        bill.attachments = [...(bill.attachments || []), ...newAttachments];
        await bill.save();

        const populated = await populateBill(MaintenanceBill.findById(bill._id));
        res.status(200).json({
            message: 'Attachments uploaded',
            bill: toPublicBill(populated),
            attachments: bill.attachments
        });
    } catch (error) {
        res.status(400).json({ message: error.message || 'Error uploading attachments' });
    }
};

exports.deleteAttachment = async (req, res) => {
    try {
        const bill = await MaintenanceBill.findById(req.params.id);
        if (!bill) return res.status(404).json({ message: 'Bill not found' });

        const attachment = bill.attachments.id(req.params.attachmentId);
        if (!attachment) return res.status(404).json({ message: 'Attachment not found' });

        deleteAttachmentFiles([attachment]);
        attachment.deleteOne();
        await bill.save();

        res.status(200).json({ message: 'Attachment removed', attachments: bill.attachments });
    } catch (error) {
        res.status(400).json({ message: error.message || 'Error deleting attachment' });
    }
};

exports.adaptLegacyRaiseBillBody = adaptLegacyRaiseBillBody;
exports.toPublicBill = toPublicBill;
exports.buildBillDocument = buildBillDocument;
exports.syncAllocationsForBill = syncAllocationsForBill;
exports.resolveVehicle = resolveVehicle;
