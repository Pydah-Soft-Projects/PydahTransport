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
        lineTotal,
        baseAmount: base,
        gstAmount: taxAmount,
        finalAmount: lineTotal
    };
};

export const computeBillTotals = (bill = {}) => {
    const taxMode = ['none', 'billLevel', 'lineLevel'].includes(bill.taxMode) ? bill.taxMode : 'lineLevel';
    const discountMode = ['none', 'billLevel', 'lineLevel'].includes(bill.discountMode)
        ? bill.discountMode
        : 'none';
    const lines = Array.isArray(bill.lines) ? bill.lines : (Array.isArray(bill.items) ? bill.items : []);

    const lineBases = lines.map((line) => getLineBase(line));
    const totalBase = round2(lineBases.reduce((sum, b) => sum + b, 0));

    const billDiscVal = toNumber(bill.discountAmount, 0);
    let distributedDiscountSum = 0;
    const billLineDiscounts = lines.map((line, idx) => {
        if (idx === lines.length - 1) {
            return Math.max(0, round2(billDiscVal - distributedDiscountSum));
        }
        const lineDisc = totalBase > 0 ? round2((lineBases[idx] / totalBase) * billDiscVal) : 0;
        distributedDiscountSum = round2(distributedDiscountSum + lineDisc);
        return lineDisc;
    });

    const computedLines = lines.map((line, idx) => {
        let lineDiscountAmount = 0;
        let lineDiscountPercent = 0;
        let resolvedDiscountMode = discountMode;

        if (discountMode === 'lineLevel') {
            lineDiscountAmount = toNumber(line.discountAmount, 0);
            lineDiscountPercent = toNumber(line.discountPercent, 0);
        } else if (discountMode === 'billLevel') {
            resolvedDiscountMode = 'lineLevel';
            if (bill.discountPercent > 0) {
                lineDiscountPercent = toNumber(bill.discountPercent, 0);
                lineDiscountAmount = round2((lineBases[idx] * lineDiscountPercent) / 100);
            } else if (bill.discountAmount > 0) {
                lineDiscountAmount = billLineDiscounts[idx];
                lineDiscountPercent = lineBases[idx] > 0 ? round2((lineDiscountAmount / lineBases[idx]) * 100) : 0;
            }
        }

        let lineTaxes = [];
        let lineGstPercent = 0;
        let resolvedTaxMode = taxMode;

        if (taxMode === 'lineLevel') {
            lineTaxes = line.taxes;
            lineGstPercent = line.gstPercent;
        } else if (taxMode === 'billLevel') {
            resolvedTaxMode = 'lineLevel';
            lineTaxes = bill.taxes;
            lineGstPercent = bill.gstPercent;
        }

        return computeLine({
            ...line,
            discountAmount: lineDiscountAmount,
            discountPercent: lineDiscountPercent,
            taxes: lineTaxes,
            gstPercent: lineGstPercent
        }, {
            taxMode: resolvedTaxMode,
            discountMode: resolvedDiscountMode
        });
    });

    const subtotal = round2(computedLines.reduce((sum, line) => sum + line.taxableAmount, 0));
    const discountTotal = round2(computedLines.reduce((sum, line) => sum + line.discountAmount, 0));
    const taxTotal = round2(computedLines.reduce((sum, line) => sum + line.gstAmount, 0));
    const computedGrandTotal = round2(computedLines.reduce((sum, line) => sum + line.finalAmount, 0));

    const insuranceClaimAmount = toNumber(bill.insuranceClaimAmount, 0);

    const overrideRaw = bill.grandTotalOverride;
    const hasOverride = overrideRaw !== null && overrideRaw !== undefined && overrideRaw !== '';
    const grandTotalOverride = hasOverride ? round2(toNumber(overrideRaw, computedGrandTotal)) : null;
    const grandTotal = round2((grandTotalOverride !== null ? grandTotalOverride : computedGrandTotal) - insuranceClaimAmount);

    const billTaxes = taxMode === 'billLevel'
        ? normalizeTaxEntries(bill.taxes, bill.gstPercent)
        : [];

    return {
        taxMode,
        discountMode,
        lines: computedLines,
        subtotal,
        discountTotal,
        taxTotal,
        gstTotal: taxTotal,
        computedGrandTotal,
        grandTotalOverride,
        grandTotal,
        insuranceClaimAmount,
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
