export const getLineSubtotal = (quantity, price) => {
    const qty = parseFloat(quantity) || 0;
    const unitPrice = parseFloat(price) || 0;
    return qty * unitPrice;
};

export const getLineGstPercent = (gstPercent) => {
    const num = parseFloat(gstPercent);
    return Number.isFinite(num) && num >= 0 ? num : 0;
};

export const getLineGstAmount = (quantity, price, gstPercent) => {
    const subtotal = getLineSubtotal(quantity, price);
    return subtotal * (getLineGstPercent(gstPercent) / 100);
};

export const getLineTotal = (quantity, price, gstPercent) => {
    return getLineSubtotal(quantity, price) + getLineGstAmount(quantity, price, gstPercent);
};

export const getBillTotals = (items = []) => {
    return items.reduce((acc, item) => {
        const subtotal = getLineSubtotal(item.quantity, item.price);
        const gstAmount = getLineGstAmount(item.quantity, item.price, item.gstPercent);
        acc.subtotal += subtotal;
        acc.gstTotal += gstAmount;
        acc.grandTotal += subtotal + gstAmount;
        return acc;
    }, { subtotal: 0, gstTotal: 0, grandTotal: 0 });
};
