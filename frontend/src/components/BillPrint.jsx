import React from 'react';

const getItemDisplayName = (item) => {
    if (!item) return 'General Part';
    return item.variantName ? `${item.itemName} - ${item.variantName}` : item.itemName;
};

const getAllocatedItemDisplayName = (allocation) => {
    if (!allocation?.itemId) return 'General Part';
    return allocation.variantName
        ? `${allocation.itemId.itemName} - ${allocation.variantName}`
        : getItemDisplayName(allocation.itemId);
};

const BillPrint = ({ billData, vendor, bus }) => {
    if (!billData || !billData.items || billData.items.length === 0) return null;

    const totalAmount = Number(billData.totalAmount || 0);
    const formattedDate = new Date(billData.date).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
    const vehicleNumber = bus?.busNumber || billData.items[0]?.busId?.busNumber || billData.busId?.busNumber || billData.busId || 'N/A';
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
                    <p><span className="font-bold">Bus No:</span> {vehicleNumber}</p>
                </div>
                <div className="space-y-1">
                    <p><span className="font-bold">Vendor:</span> {vendorName}</p>
                    <p><span className="font-bold">Address:</span> {vendorAddress}</p>
                    {vendorPhone && <p><span className="font-bold">Phone:</span> {vendorPhone}</p>}
                </div>
            </div>

            <table className="w-full border-collapse border border-black text-sm">
                <thead>
                    <tr className="bg-gray-100">
                        <th className="border border-black p-2 text-center w-12">S.No</th>
                        <th className="border border-black p-2 text-left">Item Details</th>
                        <th className="border border-black p-2 text-center w-24">Qty</th>
                        <th className="border border-black p-2 text-right w-28">Rate</th>
                        <th className="border border-black p-2 text-right w-32">Amount</th>
                    </tr>
                </thead>
                <tbody>
                    {billData.items.map((item, index) => (
                        <tr key={index} className="align-top">
                            <td className="border border-black p-2 text-center">{index + 1}</td>
                            <td className="border border-black p-2">
                                <div className="font-bold">{getAllocatedItemDisplayName(item)}</div>
                                <div className="text-xs mt-1">Category: {item.itemId?.category || 'General'} | Unit: {item.itemId?.unit || 'Pcs'}</div>
                                {item.tyrePosition && item.itemId?.category === 'Tires' && (
                                    <div className="text-xs mt-1">Tyre Position: {item.tyrePosition} | Reading: {item.kmReading || 0} KM</div>
                                )}
                                {item.remarks && (
                                    <div className="text-xs mt-1 italic">Remarks: {item.remarks}</div>
                                )}
                            </td>
                            <td className="border border-black p-2 text-center">{item.quantity} {item.itemId?.unit || 'Pcs'}</td>
                            <td className="border border-black p-2 text-right">
                                ₹{Number(item.price || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </td>
                            <td className="border border-black p-2 text-right font-bold">
                                ₹{(Number(item.quantity || 0) * Number(item.price || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </td>
                        </tr>
                    ))}
                </tbody>
                <tfoot>
                    <tr>
                        <td colSpan="4" className="border border-black p-2 text-right font-bold">Grand Total</td>
                        <td className="border border-black p-2 text-right font-bold">
                            ₹{totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>
                    </tr>
                </tfoot>
            </table>

            <div className="mt-8 text-xs">
                <p><span className="font-bold">Raised By:</span> {billData.adminName || 'Admin'}</p>
                <p className="mt-1">Items listed above were allocated to the mentioned vehicle for maintenance/spares usage.</p>
            </div>

            <div className="mt-16 grid grid-cols-3 gap-10 text-center text-xs font-bold">
                <div className="border-t border-black pt-2">Receiver Signature</div>
                <div className="border-t border-black pt-2">Fleet Manager</div>
                <div className="border-t border-black pt-2">Authorized Signatory</div>
            </div>

            {/* Simple Print Styles */}
            <style type="text/css" media="print">
                {`
                    @page { 
                        size: A4 portrait; 
                        margin: 10mm; 
                    }
                    @media print {
                        body * { visibility: hidden; }
                        #print-container, #print-container * { visibility: visible !important; }
                        #print-container {
                            position: absolute !important;
                            left: 0 !important;
                            top: 0 !important;
                            width: 100% !important;
                        }
                        tr { page-break-inside: avoid; }
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
