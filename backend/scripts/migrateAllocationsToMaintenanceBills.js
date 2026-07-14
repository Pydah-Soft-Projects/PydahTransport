/**
 * Migrate legacy InventoryAllocation groups (by billNo) into MaintenanceBill documents.
 *
 * Usage: node scripts/migrateAllocationsToMaintenanceBills.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const InventoryAllocation = require('../models/InventoryAllocation');
const MaintenanceBill = require('../models/MaintenanceBill');
const { computeBillTotals } = require('../utils/billCalculations');

const run = async () => {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!mongoUri) {
        throw new Error('MONGO_URI is required');
    }

    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB');

    const allocations = await InventoryAllocation.find({
        billNo: { $exists: true, $ne: '' },
        $or: [
            { maintenanceBillId: null },
            { maintenanceBillId: { $exists: false } }
        ]
    }).sort({ allocatedDate: 1 });

    console.log(`Found ${allocations.length} allocations to migrate`);

    const groups = new Map();
    for (const alloc of allocations) {
        const key = `${alloc.billNo}::${alloc.busId}::${alloc.vehicleType}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(alloc);
    }

    let created = 0;
    let skipped = 0;

    for (const [, group] of groups) {
        const first = group[0];
        const existing = await MaintenanceBill.findOne({
            billNo: first.billNo,
            busId: first.busId,
            vehicleType: first.vehicleType
        });
        if (existing) {
            await InventoryAllocation.updateMany(
                { _id: { $in: group.map((g) => g._id) } },
                { $set: { maintenanceBillId: existing._id } }
            );
            skipped += 1;
            continue;
        }

        const linesInput = group.map((alloc) => ({
            pricingMode: alloc.pricingMode || 'unitRate',
            quantity: alloc.quantity,
            unitPrice: alloc.price || 0,
            amount: alloc.amount || 0,
            gstPercent: alloc.gstPercent || 0,
            discountAmount: alloc.discountAmount || 0,
            discountPercent: alloc.discountPercent || 0
        }));

        const totals = computeBillTotals({
            taxMode: 'lineLevel',
            discountMode: 'none',
            lines: linesInput
        });

        const bill = new MaintenanceBill({
            billNo: first.billNo,
            date: first.allocatedDate || first.createdAt || new Date(),
            busId: first.busId,
            vehicleType: first.vehicleType || 'Bus',
            vendorId: first.vendorId || null,
            adminName: first.adminName || '',
            taxMode: 'lineLevel',
            discountMode: 'none',
            taxes: [],
            discountAmount: 0,
            discountPercent: 0,
            subtotal: totals.subtotal,
            discountTotal: 0,
            taxTotal: totals.taxTotal,
            computedGrandTotal: totals.computedGrandTotal,
            grandTotalOverride: null,
            grandTotal: totals.grandTotal,
            notes: '',
            rawDescription: '',
            attachments: [],
            lines: group.map((alloc, index) => {
                const computed = totals.lines[index];
                return {
                    allocationId: alloc._id,
                    itemId: alloc.itemId,
                    variantName: alloc.variantName || '',
                    description: '',
                    subDescriptions: [],
                    pricingMode: computed.pricingMode,
                    quantity: computed.quantity,
                    unitPrice: computed.unitPrice,
                    amount: computed.amount,
                    uom: 'Pcs',
                    discountAmount: 0,
                    discountPercent: 0,
                    gstPercent: computed.gstPercent,
                    taxes: computed.taxes,
                    taxableAmount: computed.taxableAmount,
                    taxAmount: computed.taxAmount,
                    lineTotal: computed.lineTotal,
                    tyrePosition: alloc.tyrePosition || null,
                    kmReading: alloc.kmReading || 0,
                    tyreType: '',
                    remarks: alloc.remarks || ''
                };
            })
        });

        await bill.save();
        await InventoryAllocation.updateMany(
            { _id: { $in: group.map((g) => g._id) } },
            { $set: { maintenanceBillId: bill._id } }
        );
        created += 1;
        console.log(`Created bill ${bill.billNo} with ${group.length} line(s)`);
    }

    console.log(`Done. Created: ${created}, Linked to existing: ${skipped}`);
    await mongoose.disconnect();
};

run().catch(async (error) => {
    console.error('Migration failed:', error);
    try { await mongoose.disconnect(); } catch (_) { /* ignore */ }
    process.exit(1);
});
