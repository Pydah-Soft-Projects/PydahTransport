import React from 'react';
import {
    computeBillTotals,
    getLineGstAmount,
    getLineGstPercent,
    getLineTotal,
    round2
} from '../utils/billCalculations';

const getItemDisplayName = (item) => {
    if (!item) return 'General Part';
    return item.variantName ? `${item.itemName} - ${item.variantName}` : item.itemName;
};

const getAllocatedItemDisplayName = (allocation) => {
    if (!allocation?.itemId) return 'General Part';
    if (typeof allocation.itemId === 'string') {
        return allocation.description || allocation.variantName || 'General Part';
    }
    return allocation.variantName
        ? `${allocation.itemId.itemName} - ${allocation.variantName}`
        : getItemDisplayName(allocation.itemId);
};

const formatCurrency = (value) => Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
});

const BillPrint = ({ billData, vendor, bus }) => {
    if (!billData || !billData.items || billData.items.length === 0) return null;

    const taxMode = billData.taxMode || 'lineLevel';
    const discountMode = billData.discountMode || 'none';
    const computed = computeBillTotals({
        ...billData,
        taxMode,
        discountMode,
        lines: billData.lines || billData.items
    });

    const subtotal = Number(billData.subtotal ?? computed.subtotal);
    const discountTotal = Number(billData.discountTotal ?? computed.discountTotal ?? 0);
    const gstTotal = Number(billData.gstTotal ?? billData.taxTotal ?? computed.taxTotal ?? computed.gstTotal ?? 0);
    const computedGrandTotal = Number(billData.computedGrandTotal ?? computed.computedGrandTotal ?? (subtotal + gstTotal));
    const insuranceClaimAmount = Number(billData.insuranceClaimAmount ?? computed.insuranceClaimAmount ?? 0);
    const grandTotal = Number(billData.totalAmount ?? billData.grandTotal ?? computed.grandTotal);

    const showLineGst = taxMode === 'lineLevel';
    const showLineDiscount = discountMode === 'lineLevel';
    const showUnitPrice = (billData.items || []).some(
        (item) => (item.pricingMode || 'unitRate') !== 'lumpSum'
    );
    const formattedDate = new Date(billData.date || Date.now()).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
    const vehicleNumber = billData.vehicleDisplayLabel
        || (billData.busIds && billData.busIds.length > 0
            ? billData.busIds.map(b => b.busNumber || b.vehicleNumber || (typeof b === 'string' ? b : '')).filter(Boolean).join(', ')
            : (bus?.vehicleNumber || bus?.busNumber
               || billData.items[0]?.busId?.vehicleNumber || billData.items[0]?.busId?.busNumber
               || (typeof billData.busId === 'string' ? billData.busId : (billData.busId?.vehicleNumber || billData.busId?.busNumber))
               || 'N/A'));
    const vendorName = vendor?.name || billData.vendorId?.name || 'Generic Vendor';
    const vendorAddress = vendor?.address || billData.vendorId?.address || 'Address not provided';
    const vendorPhone = vendor?.phone || billData.vendorId?.phone || null;

    return (
        <div id="printable-bill" className="bg-white text-black font-sans max-w-5xl mx-auto p-10 min-h-screen">
            <div className="text-center border-b-2 border-black pb-4 mb-6">
                <h1 className="text-2xl font-bold uppercase tracking-wide">Pydah Transport</h1>
                <p className="text-sm font-semibold mt-1">Vehicle Maintenance & Spares Bill</p>
            </div>

            <div className="grid grid-cols-2 gap-6 mb-6 text-sm">
                <div className="space-y-1">
                    <p><span className="font-bold">Bill No:</span> #{billData.billNo || 'N/A'}</p>
                    <p><span className="font-bold">Date:</span> {formattedDate}</p>
                    <p><span className="font-bold">Vehicle / Bus:</span> {vehicleNumber}</p>
                </div>
                <div className="space-y-1">
                    <p><span className="font-bold">Vendor:</span> {vendorName}</p>
                    <p><span className="font-bold">Address:</span> {vendorAddress}</p>
                    {vendorPhone && <p><span className="font-bold">Phone:</span> {vendorPhone}</p>}
                </div>
            </div>

            {(billData.notes || billData.rawDescription) && (
                <p className="text-sm mb-4 italic border border-black p-2">
                    {billData.notes || billData.rawDescription}
                </p>
            )}

            <table className="w-full border-collapse border border-black text-sm">
                <thead>
                    <tr className="bg-gray-100">
                        <th className="border border-black p-2 text-center w-12">S.No</th>
                        <th className="border border-black p-2 text-left">Item Details</th>
                        <th className="border border-black p-2 text-center w-16">Qty</th>
                        {showUnitPrice && (
                            <th className="border border-black p-2 text-right w-24">Unit Price</th>
                        )}
                        <th className="border border-black p-2 text-right w-24">Amount</th>
                        {showLineDiscount && (
                            <th className="border border-black p-2 text-right w-20">Disc.</th>
                        )}
                        {showLineGst && (
                            <>
                                <th className="border border-black p-2 text-center w-16">GST %</th>
                                <th className="border border-black p-2 text-right w-24">GST Amt</th>
                            </>
                        )}
                        <th className="border border-black p-2 text-right w-28">Overall Price</th>
                    </tr>
                </thead>
                <tbody>
                    {billData.items.map((item, index) => {
                        const pricingMode = item.pricingMode || 'unitRate';
                        const lineComputed = computed.lines?.[index];
                        const baseAmount = pricingMode === 'lumpSum'
                            ? Number(item.amount ?? item.price ?? 0)
                            : Number(item.quantity || 0) * Number(item.unitPrice ?? item.price ?? 0);
                        const gstPercent = showLineGst
                            ? (lineComputed?.gstPercent ?? getLineGstPercent(item.gstPercent))
                            : 0;
                        const gstAmount = showLineGst
                            ? (lineComputed?.taxAmount ?? getLineGstAmount(item.quantity, item.unitPrice ?? item.price, item.gstPercent))
                            : 0;
                        const lineTotal = lineComputed?.lineTotal
                            ?? (showLineGst
                                ? getLineTotal(item.quantity, item.unitPrice ?? item.price, item.gstPercent)
                                : round2(baseAmount));
                        const disc = showLineDiscount
                            ? Number(item.discountAmount || 0) + (baseAmount * Number(item.discountPercent || 0) / 100)
                            : 0;

                        return (
                            <tr key={index} className="align-top">
                                <td className="border border-black p-2 text-center">{index + 1}</td>
                                <td className="border border-black p-2">
                                    <div className="text-xs font-bold">{getAllocatedItemDisplayName(item)}</div>
                                    {pricingMode === 'lumpSum' && (
                                        <div className="text-[10px] mt-0.5 uppercase tracking-wide">Lump sum</div>
                                    )}
                                    {Array.isArray(item.subDescriptions) && item.subDescriptions.length > 0 && (
                                        <ul className="text-xs mt-1 list-disc pl-4">
                                            {item.subDescriptions.map((sub, i) => (
                                                <li key={i}>{sub}</li>
                                            ))}
                                        </ul>
                                    )}
                                    {item.tyrePosition && item.itemId?.category === 'Tires' && (
                                        <div className="text-xs mt-1">Tyre Position: {item.tyrePosition} | Reading: {item.kmReading || 0} KM</div>
                                    )}
                                    {item.remarks && (
                                        <div className="text-xs mt-1 italic">Remarks: {item.remarks}</div>
                                    )}
                                </td>
                                <td className="border border-black p-2 text-center">{item.quantity}</td>
                                {showUnitPrice && (
                                    <td className="border border-black p-2 text-right">
                                        {pricingMode === 'lumpSum'
                                            ? '—'
                                            : `₹${formatCurrency(item.unitPrice ?? item.price)}`}
                                    </td>
                                )}
                                <td className="border border-black p-2 text-right">
                                    ₹{formatCurrency(baseAmount)}
                                </td>
                                {showLineDiscount && (
                                    <td className="border border-black p-2 text-right">
                                        ₹{formatCurrency(disc)}
                                    </td>
                                )}
                                {showLineGst && (
                                    <>
                                        <td className="border border-black p-2 text-center">{gstPercent}%</td>
                                        <td className="border border-black p-2 text-right">
                                            ₹{formatCurrency(gstAmount)}
                                        </td>
                                    </>
                                )}
                                <td className="border border-black p-2 text-right font-bold">
                                    ₹{formatCurrency(lineTotal)}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>

            <div className="bill-grand-total-table w-full border border-black border-t-0 text-sm">
                <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-2 p-3">
                    <div className="text-right whitespace-nowrap">
                        <span className="font-bold">Subtotal:</span>{' '}
                        <span>₹{formatCurrency(subtotal)}</span>
                    </div>
                    {discountTotal > 0 && (
                        <div className="text-right whitespace-nowrap">
                            <span className="font-bold">Discount:</span>{' '}
                            <span>₹{formatCurrency(discountTotal)}</span>
                        </div>
                    )}
                    {taxMode === 'billLevel' && Array.isArray(billData.taxes) && billData.taxes.length > 0 && (
                        billData.taxes.map((tax, idx) => (
                            <div key={idx} className="text-right whitespace-nowrap">
                                <span className="font-bold">{tax.name} @{tax.rate}%:</span>{' '}
                                <span>₹{formatCurrency((subtotal - discountTotal) * tax.rate / 100)}</span>
                            </div>
                        ))
                    )}
                    {gstTotal > 0 && taxMode !== 'none' && (
                        <div className="text-right whitespace-nowrap">
                            <span className="font-bold">Total Tax:</span>{' '}
                            <span>₹{formatCurrency(gstTotal)}</span>
                        </div>
                    )}
                    {insuranceClaimAmount > 0 ? (
                        <>
                            <div className="bill-grand-total-row text-right whitespace-nowrap">
                                <span className="font-bold">Grand Total:</span>{' '}
                                <span>₹{formatCurrency(computedGrandTotal)}</span>
                            </div>
                            <div className="text-right whitespace-nowrap text-red-600">
                                <span className="font-bold">Insurance Claim:</span>{' '}
                                <span>- ₹{formatCurrency(insuranceClaimAmount)}</span>
                            </div>
                            <div className="bill-net-payable-row text-right whitespace-nowrap font-bold border-t border-black pt-1 mt-1">
                                <span className="font-bold">Net Payable:</span>{' '}
                                <span className="font-bold text-lg text-blue-700">₹{formatCurrency(grandTotal)}</span>
                            </div>
                        </>
                    ) : (
                        <div className="bill-grand-total-row text-right whitespace-nowrap">
                            <span className="font-bold">Grand Total:</span>{' '}
                            <span className="font-bold">₹{formatCurrency(grandTotal)}</span>
                        </div>
                    )}
                </div>
            </div>

            <div className="bill-footer-section mt-8 text-xs">
                <p><span className="font-bold">Raised By:</span> {billData.adminName || 'Admin'}</p>
                <p className="mt-1">Items listed above were allocated to the mentioned vehicle for maintenance/spares usage.</p>
            </div>

            <div className="mt-16 grid grid-cols-3 gap-10 text-center text-xs font-bold">
                <div className="border-t border-black pt-2">Receiver Signature</div>
                <div className="border-t border-black pt-2">Fleet Manager</div>
                <div className="border-t border-black pt-2">Authorized Signatory</div>
            </div>

            <style type="text/css" media="print">
                {`
                    @page { 
                        size: A4 portrait; 
                        margin: 10mm; 
                    }
                    @media print {
                        body * { visibility: hidden; }
                        #print-container, #print-container *,
                        #printable-bill, #printable-bill * { visibility: visible !important; }
                        #print-container, #printable-bill {
                            position: absolute !important;
                            left: 0 !important;
                            top: 0 !important;
                            width: 100% !important;
                        }
                        tr { page-break-inside: avoid; }
                        tbody tr { page-break-inside: auto; }
                        .bill-grand-total-table,
                        .bill-grand-total-row,
                        .bill-net-payable-row,
                        .bill-footer-section {
                            page-break-inside: avoid !important;
                            break-inside: avoid !important;
                        }
                    }
                    #printable-bill { 
                        font-family: 'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important;
                        width: 100% !important; 
                        max-width: none !important; 
                        margin: 0 !important; 
                        padding: 0 !important;
                    }
                    * {
                        -webkit-print-color-adjust: exact !important;
                        print-color-adjust: exact !important;
                    }
                    table, th, td { border-color: #94a3b8 !important; }
                `}
            </style>
        </div>
    );
};

export default BillPrint;
