export const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

export const toNumber = (value, fallback = 0) => {
    const num = parseFloat(value);
    return Number.isFinite(num) ? num : fallback;
};

export const normalizeTaxEntries = (taxes = [], gstPercent) => {
    if (Array.isArray(taxes) && taxes.length > 0) {
        return taxes
            .map((tax) => ({
                name: String(tax.name || 'GST').trim() || 'GST',
                rate: Math.max(0, toNumber(tax.rate, 0))
            }))
            .filter((tax) => tax.rate > 0);
    }
    const rate = toNumber(gstPercent, 0);
    if (rate > 0) return [{ name: 'GST', rate }];
    return [];
};

export const applyDiscount = (base, discountAmount, discountPercent) => {
    let taxable = Math.max(0, toNumber(base, 0));
    const pct = Math.max(0, toNumber(discountPercent, 0));
    const amt = Math.max(0, toNumber(discountAmount, 0));
    if (amt > 0) {
        taxable -= amt;
    } else if (pct > 0) {
        taxable -= (taxable * pct) / 100;
    }
    return round2(Math.max(0, taxable));
};

const taxAmountFromEntries = (taxable, taxes) =>
    round2(taxes.reduce((sum, tax) => sum + (taxable * tax.rate) / 100, 0));

export const getLineBase = (line = {}) => {
    const pricingMode = line.pricingMode === 'lumpSum' ? 'lumpSum' : 'unitRate';
    if (pricingMode === 'lumpSum') {
        return round2(toNumber(line.amount ?? line.price, 0));
    }
    return round2(toNumber(line.quantity, 0) * toNumber(line.unitPrice ?? line.price, 0));
};

export const computeLine = (line = {}, { taxMode = 'lineLevel', discountMode = 'none' } = {}) => {
    const pricingMode = line.pricingMode === 'lumpSum' ? 'lumpSum' : 'unitRate';
    const quantity = toNumber(line.quantity, 0);
    const unitPrice = pricingMode === 'unitRate' ? toNumber(line.unitPrice ?? line.price, 0) : 0;
    const amount = pricingMode === 'lumpSum' ? toNumber(line.amount ?? line.price, 0) : round2(quantity * unitPrice);
    const base = pricingMode === 'lumpSum' ? amount : round2(quantity * unitPrice);

    const lineDiscountAmount = discountMode === 'lineLevel' ? toNumber(line.discountAmount, 0) : 0;
    const lineDiscountPercent = discountMode === 'lineLevel' ? toNumber(line.discountPercent, 0) : 0;
    const taxableAmount = discountMode === 'lineLevel'
        ? applyDiscount(base, lineDiscountAmount, lineDiscountPercent)
        : round2(base);

    const lineTaxes = taxMode === 'lineLevel'
        ? normalizeTaxEntries(line.taxes, line.gstPercent)
        : [];
    const taxAmount = taxMode === 'lineLevel' ? taxAmountFromEntries(taxableAmount, lineTaxes) : 0;
    const lineTotal = round2(taxableAmount + taxAmount);

    return {
        pricingMode,
        quantity,
        unitPrice: pricingMode === 'unitRate' ? unitPrice : round2(quantity > 0 ? amount / quantity : amount),
        amount: pricingMode === 'lumpSum' ? amount : base,
        discountAmount: lineDiscountAmount,
        discountPercent: lineDiscountPercent,
        gstPercent: lineTaxes.length === 1 && lineTaxes[0].name === 'GST'
            ? lineTaxes[0].rate
            : toNumber(line.gstPercent, 0),
        taxes: lineTaxes,
        taxableAmount,
        taxAmount,
        lineTotal
    };
};

export const computeBillTotals = (bill = {}) => {
    const taxMode = ['none', 'billLevel', 'lineLevel'].includes(bill.taxMode) ? bill.taxMode : 'lineLevel';
    const discountMode = ['none', 'billLevel', 'lineLevel'].includes(bill.discountMode)
        ? bill.discountMode
        : 'none';
    const lines = Array.isArray(bill.lines) ? bill.lines : (Array.isArray(bill.items) ? bill.items : []);

    const computedLines = lines.map((line) => computeLine(line, { taxMode, discountMode }));

    const linesSubtotal = round2(computedLines.reduce((sum, line) => sum + line.taxableAmount, 0));
    const lineTaxTotal = round2(computedLines.reduce((sum, line) => sum + line.taxAmount, 0));
    const lineDiscountTotal = discountMode === 'lineLevel'
        ? round2(computedLines.reduce((sum, line) => {
            const base = line.pricingMode === 'lumpSum' ? line.amount : round2(line.quantity * line.unitPrice);
            return sum + Math.max(0, base - line.taxableAmount);
        }, 0))
        : 0;

    let afterBillDiscount = linesSubtotal;
    let billDiscountTotal = 0;
    if (discountMode === 'billLevel') {
        const before = linesSubtotal;
        afterBillDiscount = applyDiscount(before, bill.discountAmount, bill.discountPercent);
        billDiscountTotal = round2(before - afterBillDiscount);
    }

    const billTaxes = taxMode === 'billLevel'
        ? normalizeTaxEntries(bill.taxes, bill.gstPercent)
        : [];
    const billTaxTotal = taxMode === 'billLevel' ? taxAmountFromEntries(afterBillDiscount, billTaxes) : 0;

    const taxTotal = taxMode === 'lineLevel' ? lineTaxTotal : billTaxTotal;
    const discountTotal = discountMode === 'lineLevel' ? lineDiscountTotal : billDiscountTotal;
    const computedGrandTotal = round2(afterBillDiscount + taxTotal);

    const overrideRaw = bill.grandTotalOverride;
    const hasOverride = overrideRaw !== null && overrideRaw !== undefined && overrideRaw !== '';
    const grandTotalOverride = hasOverride ? round2(toNumber(overrideRaw, computedGrandTotal)) : null;
    const grandTotal = grandTotalOverride !== null ? grandTotalOverride : computedGrandTotal;

    return {
        taxMode,
        discountMode,
        lines: computedLines,
        subtotal: linesSubtotal,
        discountTotal,
        taxTotal,
        gstTotal: taxTotal,
        computedGrandTotal,
        grandTotalOverride,
        grandTotal,
        billTaxes
    };
};

/** Legacy helpers — still used by older views */
export const getLineSubtotal = (quantity, price) => round2(toNumber(quantity) * toNumber(price));

export const getLineGstPercent = (gstPercent) => {
    const num = toNumber(gstPercent, 0);
    return num >= 0 ? num : 0;
};

export const getLineGstAmount = (quantity, price, gstPercent) =>
    round2(getLineSubtotal(quantity, price) * (getLineGstPercent(gstPercent) / 100));

export const getLineTotal = (quantity, price, gstPercent) =>
    round2(getLineSubtotal(quantity, price) + getLineGstAmount(quantity, price, gstPercent));

export const getBillTotals = (items = []) => {
    if (items.some((item) => item.pricingMode || item.unitPrice !== undefined || item.amount !== undefined)) {
        return computeBillTotals({ items, taxMode: 'lineLevel', discountMode: 'none' });
    }
    return items.reduce(
        (acc, item) => {
            const subtotal = getLineSubtotal(item.quantity, item.price);
            const gstAmount = getLineGstAmount(item.quantity, item.price, item.gstPercent);
            acc.subtotal += subtotal;
            acc.gstTotal += gstAmount;
            acc.grandTotal += subtotal + gstAmount;
            return acc;
        },
        { subtotal: 0, gstTotal: 0, taxTotal: 0, discountTotal: 0, grandTotal: 0 }
    );
};
