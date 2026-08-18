import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Package, Calendar, Tag, UserCheck, AlertTriangle, Armchair, ShieldAlert, History, Plus, Edit, Trash2 } from 'lucide-react';
import Layout from '../components/Layout';
import Modal from '../components/Modal';
import Loader from '../components/Loader';
import { apiFetch, API_BASE } from '../utils/api';

const API = API_BASE;

const getInventoryItemName = (item) => {
    if (!item) return 'Deleted Item';
    return item.variantName ? `${item.itemName} - ${item.variantName}` : item.itemName;
};

const getInventoryAllocationItemName = (record) => {
    if (!record?.itemId) return 'Deleted Item';
    return record.variantName
        ? `${record.itemId.itemName} - ${record.variantName}`
        : getInventoryItemName(record.itemId);
};

const VehicleDetails = () => {
    const { id } = useParams();
    const [vehicle, setVehicle] = useState(null);
    const [loading, setLoading] = useState(true);
    const [inventoryHistory, setInventoryHistory] = useState([]);
    const [inventoryLoading, setInventoryLoading] = useState(false);
    
    const [activeTab, setActiveTab] = useState('inventory'); // 'inventory' or 'taxes'
    
    // Tax Headers states
    const [taxHeaders, setTaxHeaders] = useState([]);
    const [taxValues, setTaxValues] = useState({}); // { taxHeaderName: { amount: '', endDate: '' } }
    const [expiredTaxesWarning, setExpiredTaxesWarning] = useState([]);
    
    // Tax History states
    const [isTaxHistoryModalOpen, setIsTaxHistoryModalOpen] = useState(false);
    const [taxHistoryData, setTaxHistoryData] = useState(null);
    const [taxHistoryLoading, setTaxHistoryLoading] = useState(false);
    const [activeHistoryTaxName, setActiveHistoryTaxName] = useState('');

    const fetchVehicleDetails = async () => {
        try {
            const response = await apiFetch(`${API}/other-vehicles/${id}`);
            if (response.ok) {
                const data = await response.json();
                setVehicle(data);
                
                // Initialize tax values
                const initialValues = {};
                (data.taxes || []).forEach(tax => {
                    initialValues[tax.taxHeader] = {
                        amount: tax.amount.toString(),
                        endDate: tax.endDate ? new Date(tax.endDate).toISOString().slice(0, 10) : ''
                    };
                });
                setTaxValues(initialValues);
            }
        } catch (error) {
            console.error('Error fetching vehicle details:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchInventoryHistory = async () => {
        if (!vehicle?.vehicleNumber) return;
        setInventoryLoading(true);
        try {
            const response = await apiFetch(`${API}/inventory/history/${vehicle.vehicleNumber}`);
            if (response.ok) {
                setInventoryHistory(await response.json());
            }
        } catch (error) {
            console.error('Error fetching inventory history:', error);
        } finally {
            setInventoryLoading(false);
        }
    };

    const fetchTaxHeaders = async () => {
        try {
            const response = await apiFetch(`${API}/tax-headers`);
            if (response.ok) {
                const data = await response.json();
                setTaxHeaders(data.filter(h => h.isActive));
            }
        } catch (error) {
            console.error('Error fetching tax headers:', error);
        }
    };

    useEffect(() => {
        fetchVehicleDetails();
        fetchTaxHeaders();
    }, [id]);

    useEffect(() => {
        if (vehicle?.vehicleNumber) {
            fetchInventoryHistory();
        }
    }, [vehicle?.vehicleNumber]);

    // Check for expired taxes whenever vehicle data changes
    useEffect(() => {
        if (vehicle?.taxes && vehicle.taxes.length > 0) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            const expired = vehicle.taxes
                .filter(tax => {
                    const taxEndDate = new Date(tax.endDate);
                    taxEndDate.setHours(0, 0, 0, 0);
                    return taxEndDate < today;
                })
                .map(tax => ({
                    ...tax,
                    formattedEndDate: new Date(tax.endDate).toLocaleDateString()
                }));
                
            setExpiredTaxesWarning(expired);
        } else {
            setExpiredTaxesWarning([]);
        }
    }, [vehicle]);

    const handleUpdateTaxInTable = async (taxId, taxData) => {
        try {
            const response = await apiFetch(`${API}/other-vehicles/${vehicle._id}/taxes/${taxId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    taxHeader: taxData.taxHeader,
                    amount: parseFloat(taxData.amount),
                    endDate: taxData.endDate
                })
            });
            
            if (response.ok) {
                await fetchVehicleDetails();
            } else {
                const errorData = await response.json();
                alert(errorData.message || 'Failed to update tax');
            }
        } catch (error) {
            console.error('Error updating tax:', error);
            alert('Error updating tax');
        }
    };
    
    const handleAddTaxInTable = async (taxData) => {
        try {
            const response = await apiFetch(`${API}/other-vehicles/${vehicle._id}/taxes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    taxHeader: taxData.taxHeader,
                    amount: parseFloat(taxData.amount),
                    endDate: taxData.endDate
                })
            });
            
            if (response.ok) {
                await fetchVehicleDetails();
            } else {
                const errorData = await response.json();
                alert(errorData.message || 'Failed to add tax');
            }
        } catch (error) {
            console.error('Error adding tax:', error);
            alert('Error adding tax');
        }
    };

    if (loading) {
        return (
            <Layout>
                <div className="py-20">
                    <Loader text="Loading vehicle details..." />
                </div>
            </Layout>
        );
    }

    if (!vehicle) {
        return (
            <Layout>
                <div className="text-center py-20">
                    <p className="text-gray-500 mb-4">Vehicle not found.</p>
                    <Link to="/fleet" className="text-blue-600 hover:underline">← Back to Fleet</Link>
                </div>
            </Layout>
        );
    }

    return (
        <Layout>
            <div className="mb-6 flex items-center justify-between">
                <Link to="/fleet" className="text-blue-600 hover:underline text-sm font-medium flex items-center gap-1">
                    <span>←</span> Back to Fleet
                </Link>
            </div>

            {/* Premium Dashboard Header */}
            <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-8 mb-8">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <h1 className="text-4xl font-black text-gray-900 tracking-tight">{vehicle.vehicleNumber}</h1>
                            <span className={`px-3 py-1 rounded-full text-xs font-black uppercase tracking-widest ${
                                vehicle.status === 'Active' ? 'bg-green-100 text-green-700' :
                                vehicle.status === 'Inactive' ? 'bg-slate-100 text-slate-700' :
                                'bg-red-100 text-red-700'
                            }`}>
                                {vehicle.status}
                            </span>
                        </div>
                        <p className="text-gray-500 font-medium flex items-center gap-2 flex-wrap">
                            <Tag size={16} className="text-blue-500" />
                            {vehicle.type}
                            {vehicle.vehicleModel && <> • {vehicle.vehicleModel}</>}
                            {vehicle.registrationDate && (
                                <> • Reg. {new Date(vehicle.registrationDate).toLocaleDateString()}</>
                            )}
                            {vehicle.campus && (
                                <> • Campus: <span className="font-bold text-gray-800">{vehicle.campus.name || vehicle.campus}</span></>
                            )}
                        </p>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Staff Info */}
                    <div className="bg-purple-50/50 rounded-2xl p-5 border border-purple-100/50">
                        <p className="text-[10px] font-black text-purple-400 uppercase tracking-widest mb-3">Assigned Staff</p>
                        <div className="space-y-2">
                            <div className="flex justify-between items-center">
                                <span className="text-xs text-gray-500">Driver</span>
                                <span className="text-sm font-bold text-gray-900">{vehicle.driverName || '—'}</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-xs text-gray-500">Attendant</span>
                                <span className="text-sm font-bold text-gray-900">{vehicle.attendantName || '—'}</span>
                            </div>
                        </div>
                    </div>

                    {/* Capacity Info */}
                    <div className="bg-emerald-50/50 rounded-2xl p-5 border border-emerald-100/50">
                        <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest mb-3">Capacity</p>
                        <div className="flex items-baseline gap-2 mt-2">
                            <span className="text-3xl font-black text-emerald-700">{vehicle.capacity}</span>
                            <span className="text-gray-400 font-bold">Seats</span>
                        </div>
                    </div>

                    {/* Taxes Count */}
                    <div className="bg-blue-50/50 rounded-2xl p-5 border border-blue-100/50">
                        <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-3">Taxes Configured</p>
                        <div className="flex items-baseline gap-2 mt-2">
                            <span className="text-3xl font-black text-blue-700">{(vehicle.taxes || []).length}</span>
                            <span className="text-gray-400 font-bold">Records</span>
                        </div>
                    </div>
                </div>
                
                {/* Expired Taxes Warning */}
                {expiredTaxesWarning.length > 0 && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-6 mt-6">
                        <div className="flex items-start">
                            <div className="flex-shrink-0">
                                <AlertTriangle size={24} className="mr-4 text-red-500" />
                            </div>
                            <div className="flex-1">
                                <h3 className="text-sm font-bold text-red-800 mb-2">
                                    Warning: Expired Taxes Detected
                                </h3>
                                <p className="text-sm text-red-600">
                                    The following taxes have expired and need attention:
                                </p>
                                <div className="mt-3 space-y-2">
                                    {expiredTaxesWarning.map((tax, index) => (
                                        <div key={index} className="bg-white rounded-lg p-3 border border-red-100">
                                            <div className="flex justify-between items-start">
                                                <div>
                                                    <p className="font-medium text-slate-800">{tax.taxHeader}</p>
                                                    <p className="text-xs text-red-600">
                                                        Expired on: {tax.formattedEndDate}
                                                    </p>
                                                </div>
                                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700">
                                                    EXPIRED
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Content Tabs */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="border-b border-gray-100 flex">
                    <button
                        onClick={() => setActiveTab('inventory')}
                        className={`px-6 py-4 text-sm font-bold flex items-center gap-2 border-b-2 transition-all ${activeTab === 'inventory' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
                    >
                        <Package size={18} /> Servicing & Spares History
                    </button>
                    <button
                        onClick={() => setActiveTab('taxes')}
                        className={`px-6 py-4 text-sm font-bold flex items-center gap-2 border-b-2 transition-all ${activeTab === 'taxes' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
                    >
                        <History size={18} /> Taxes Configuration
                    </button>
                </div>

                <div className="p-6">
                    {activeTab === 'inventory' && (
                        inventoryLoading ? (
                            <div className="py-20 flex justify-center"><Loader text="Loading servicing history..." /></div>
                        ) : inventoryHistory.length > 0 ? (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-gray-50 border-b border-gray-100 text-[11px] uppercase text-gray-400 font-black tracking-widest">
                                            <th className="px-6 py-4">Date</th>
                                            <th className="px-6 py-4">Item</th>
                                            <th className="px-6 py-4">Quantity</th>
                                            <th className="px-6 py-4">Remarks</th>
                                            <th className="px-6 py-4">Allocated By</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50">
                                        {inventoryHistory.map(record => (
                                            <tr key={record._id} className="hover:bg-gray-50 transition-colors">
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-800 font-bold">
                                                    <div className="flex items-center gap-2">
                                                        <Calendar size={14} className="text-gray-400" />
                                                        {new Date(record.allocatedDate).toLocaleDateString()}
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <div className="flex items-center gap-2">
                                                        <Package size={14} className="text-blue-400" />
                                                        <span className="font-bold text-gray-800 text-sm">{getInventoryAllocationItemName(record)}</span>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <span className="font-black text-blue-700">{record.quantity} {record.itemId?.unit || ''}</span>
                                                </td>
                                                <td className="px-6 py-4 text-xs text-gray-500 italic">
                                                    {record.remarks || '—'}
                                                </td>
                                                <td className="px-6 py-4 text-sm text-gray-500 font-medium">
                                                    {record.adminName}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <div className="py-20 text-center text-gray-400 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-100">
                                <History className="mx-auto mb-3 opacity-20" size={48} />
                                <p className="font-medium text-sm">No items have been allocated to this vehicle yet.</p>
                                <Link to="/inventory" className="mt-4 inline-block text-blue-600 font-bold hover:underline">Go to Inventory Management</Link>
                            </div>
                        )
                    )}

                    {activeTab === 'taxes' && (
                        <div className="space-y-6">
                            <div className="flex justify-between items-center pb-4 border-b border-gray-100">
                                <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wide">Configure Taxes & Insurances</h3>
                                <p className="text-xs text-gray-500">Set amounts and valid dates for active tax headers.</p>
                            </div>

                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-slate-50 border-b border-slate-100 text-[11px] uppercase text-slate-400 font-black tracking-widest">
                                            <th className="px-6 py-4">Tax Header</th>
                                            <th className="px-6 py-4 w-48">Amount</th>
                                            <th className="px-6 py-4 w-56">Valid End Date</th>
                                            <th className="px-6 py-4 w-44">Status</th>
                                            <th className="px-6 py-4 text-right w-44">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {taxHeaders.map((header) => {
                                            const taxHeaderName = header.taxName;
                                            const existingTax = (vehicle.taxes || []).find(t => t.taxHeader === taxHeaderName);
                                            const taxExistsOnBus = !!existingTax;
                                            
                                            // Get or init current values
                                            const currentValues = taxValues[taxHeaderName] || { amount: '', endDate: '' };
                                            
                                            // Determine expiration
                                            const today = new Date();
                                            today.setHours(0, 0, 0, 0);
                                            const isRowExpired = taxExistsOnBus && existingTax.endDate && new Date(existingTax.endDate) < today;

                                            return (
                                                <tr key={header._id} className="hover:bg-slate-50 transition-colors">
                                                    <td className="px-6 py-4">
                                                        <div>
                                                            <p className="font-bold text-slate-800 text-sm">{taxHeaderName}</p>
                                                            <p className="text-[10px] text-slate-400 mt-0.5">{header.description || 'No description'}</p>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <div className="relative">
                                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-bold">₹</span>
                                                            <input
                                                                type="number"
                                                                placeholder={header.defaultAmount ? header.defaultAmount.toString() : '0.00'}
                                                                value={currentValues.amount || ''}
                                                                onChange={(e) => {
                                                                    setTaxValues(prev => ({
                                                                        ...prev,
                                                                        [taxHeaderName]: {
                                                                            ...prev[taxHeaderName],
                                                                            amount: e.target.value
                                                                        }
                                                                    }));
                                                                }}
                                                                className={`w-full pl-7 pr-3 py-2 rounded-lg border text-sm ${!taxExistsOnBus && !currentValues.amount ? 'border-slate-200 bg-slate-50 placeholder-slate-400' : 'border-slate-300 bg-white'}`}
                                                            />
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <input
                                                            type="date"
                                                            value={currentValues.endDate || ''}
                                                            onChange={(e) => {
                                                                setTaxValues(prev => ({
                                                                    ...prev,
                                                                    [taxHeaderName]: {
                                                                        ...prev[taxHeaderName],
                                                                        endDate: e.target.value
                                                                    }
                                                                }));
                                                            }}
                                                            className={`w-full px-3 py-2 rounded-lg border text-sm ${isRowExpired ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-300 bg-white'}`}
                                                        />
                                                        {isRowExpired && (
                                                            <p className="text-[10px] text-red-600 mt-1 font-medium font-sans">Date has expired — please update</p>
                                                        )}
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        {taxExistsOnBus ? (
                                                            isRowExpired ? (
                                                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-red-700 border border-red-100 inline-flex items-center">
                                                                    <ShieldAlert size={12} className="mr-1" /> Expired
                                                                </span>
                                                            ) : (
                                                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-100 inline-flex items-center">
                                                                    Active
                                                                </span>
                                                            )
                                                        ) : (
                                                            <span className="text-slate-400 text-xs italic">Not Configured</span>
                                                        )}
                                                    </td>
                                                    <td className="px-6 py-4 text-right">
                                                        <div className="flex space-x-2 justify-end">
                                                            <button
                                                                onClick={() => {
                                                                    if (!currentValues.amount || currentValues.amount === '' || isNaN(parseFloat(currentValues.amount))) {
                                                                        alert('Please enter an amount before saving.');
                                                                        return;
                                                                    }
                                                                    if (!currentValues.endDate) {
                                                                        alert('Please select an end date before saving.');
                                                                        return;
                                                                    }
                                                                    const taxData = {
                                                                        taxHeader: taxHeaderName,
                                                                        amount: parseFloat(currentValues.amount),
                                                                        endDate: currentValues.endDate
                                                                    };
                                                                    if (existingTax) {
                                                                        handleUpdateTaxInTable(existingTax._id, taxData);
                                                                    } else {
                                                                        handleAddTaxInTable(taxData);
                                                                    }
                                                                }}
                                                                disabled={!taxExistsOnBus && (!currentValues.amount || !currentValues.endDate)}
                                                                className="px-4 py-1.5 bg-blue-900 text-white text-xs font-bold rounded-lg hover:bg-blue-800 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                                                            >
                                                                {taxExistsOnBus ? 'Update' : 'Add'}
                                                            </button>
                                                            <button
                                                                onClick={async () => {
                                                                    setTaxHistoryData(null);
                                                                    setIsTaxHistoryModalOpen(true);
                                                                    setTaxHistoryLoading(true);
                                                                    setActiveHistoryTaxName(taxHeaderName);
                                                                    try {
                                                                        const res = await apiFetch(
                                                                            `${API}/other-vehicles/${vehicle._id}/taxes/history?taxHeader=${encodeURIComponent(taxHeaderName)}`
                                                                        );
                                                                        const data = await res.json();
                                                                        setTaxHistoryData(data);
                                                                    } catch (e) {
                                                                        console.error('Error fetching tax history', e);
                                                                    } finally {
                                                                        setTaxHistoryLoading(false);
                                                                    }
                                                                }}
                                                                className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-lg text-xs"
                                                            >
                                                                History
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Tax History Modal */}
            <Modal isOpen={isTaxHistoryModalOpen} onClose={() => { setIsTaxHistoryModalOpen(false); setTaxHistoryData(null); }} title={`Tax History - ${activeHistoryTaxName}`} maxWidth="max-w-xl">
                 <div className="space-y-4">
                     {taxHistoryLoading ? (
                         <div className="py-12 flex justify-center"><Loader text="Loading history logs..." /></div>
                     ) : taxHistoryData?.history && taxHistoryData.history.length > 0 ? (
                         <div className="overflow-hidden border border-slate-100 rounded-xl">
                             <table className="w-full text-left border-collapse">
                                 <thead>
                                     <tr className="bg-slate-50 border-b border-slate-100 text-[10px] uppercase font-bold text-slate-400">
                                         <th className="p-3">Updated Date</th>
                                         <th className="p-3">Amount</th>
                                         <th className="p-3">Valid Until</th>
                                         <th className="p-3">Changed By</th>
                                     </tr>
                                 </thead>
                                 <tbody className="divide-y divide-slate-100 text-xs">
                                     {taxHistoryData.history.map((log) => (
                                         <tr key={log._id}>
                                             <td className="p-3 font-semibold text-slate-600">{new Date(log.changedAt).toLocaleDateString()}</td>
                                             <td className="p-3 font-bold text-blue-700">₹{log.amount.toLocaleString()}</td>
                                             <td className="p-3 text-slate-700">{log.endDate ? new Date(log.endDate).toLocaleDateString() : '—'}</td>
                                             <td className="p-3 text-slate-500">{log.changedBy}</td>
                                         </tr>
                                     ))}
                                 </tbody>
                             </table>
                         </div>
                     ) : (
                         <p className="text-center text-slate-400 py-10">No history matches found for this tax type.</p>
                     )}
                 </div>
            </Modal>
        </Layout>
    );
};

export default VehicleDetails;
