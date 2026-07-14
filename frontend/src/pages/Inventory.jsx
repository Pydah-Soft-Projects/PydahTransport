import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import Modal from '../components/Modal';
import Loader from '../components/Loader';
import { 
    Package, Plus, Search, Edit, Trash2, History, Truck, 
    Calendar, Tag, User, Layers, Printer, ChevronDown, 
    ChevronUp, LayoutGrid, List, AlertCircle, Filter, Paperclip
} from 'lucide-react';
import BillPrint from '../components/BillPrint';
import { apiFetch, API_BASE } from '../utils/api';
import { printHtmlDocument } from '../utils/printHtml';
import { hasPermission } from '../utils/permissions';
import { getLineTotal, computeBillTotals } from '../utils/billCalculations';

const API = API_BASE;
const API_ORIGIN = String(API_BASE || '').replace(/\/api\/?$/, '');

const attachmentUrl = (url) => {
    if (!url) return '';
    if (/^https?:\/\//i.test(url)) return url;
    return `${API_ORIGIN}${url.startsWith('/') ? url : `/${url}`}`;
};

const TABS = { inventory: 'inventory', vendors: 'vendors', tyreRegistry: 'tyreRegistry' };

const CATEGORIES = [
    'General',
    'Mechanical',
    'Electrical',
    'Tires', // Note: Category name used in logic
    'Lubricants',
    'Body & Interior',
    'Safety',
    'Cleaning'
];

const TYRE_POSITIONS = [
    'front right',
    'front left',
    'back right',
    'back left',
    'rear left',
    'rear right'
];

const UNITS = [
    'Pcs',
    'Ltr',
    'Kg',
    'Set',
    'Box',
    'Mtr',
    'Can'
];

const getItemDisplayName = (item) => {
    if (!item) return 'Unselected Item';
    return item.variantName ? `${item.itemName} - ${item.variantName}` : item.itemName;
};

const getAllocatedItemDisplayName = (allocation) => {
    if (!allocation?.itemId) return 'Unselected Item';
    return allocation.variantName
        ? `${allocation.itemId.itemName} - ${allocation.variantName}`
        : getItemDisplayName(allocation.itemId);
};

const getItemVariants = (item) => {
    const variants = Array.isArray(item?.variants)
        ? item.variants
            .filter((variant) => variant?.isActive !== false && variant?.name)
            .map((variant) => ({ name: variant.name, itemId: item._id, source: 'group' }))
        : [];

    if (item?.variantName) {
        variants.push({ name: item.variantName, itemId: item._id, source: 'legacy' });
    }

    return variants;
};

const getInventoryGroups = (items) => {
    const map = new Map();
    items.forEach((item) => {
        const key = item.itemName || item._id;
        if (!map.has(key)) {
            map.set(key, {
                key,
                itemName: item.itemName,
                category: item.category,
                unit: item.unit,
                description: item.description,
                primaryItem: item,
                variants: [],
                itemIds: [],
            });
        }
        const group = map.get(key);
        group.itemIds.push(item._id);
        if ((item.variants || []).length > (group.primaryItem?.variants || []).length) {
            group.primaryItem = item;
            group.category = item.category;
            group.unit = item.unit;
            group.description = item.description;
        }
        group.variants.push(...getItemVariants(item));
    });

    return Array.from(map.values()).map((group) => ({
        ...group,
        variants: group.variants.filter((variant, index, arr) => (
            arr.findIndex((candidate) => candidate.name === variant.name) === index
        )),
    })).sort((a, b) => a.itemName.localeCompare(b.itemName));
};

const emptyItemFormData = {
    itemName: '',
    variantName: '',
    variantNames: [''],
    category: 'General',
    unit: 'Pcs',
    description: ''
};

const emptyBillLineItem = {
    allocationId: '',
    itemId: '',
    itemGroup: '',
    variantName: '',
    pricingMode: 'unitRate',
    quantity: 1,
    price: '',
    amount: '',
    gstPercent: '',
    discountAmount: '',
    discountPercent: '',
    subDescriptions: '',
    remarks: '',
    tyrePosition: 'front right',
    kmReading: '',
    tyreType: 'new tyre'
};

const emptyBillFormData = {
    busId: '',
    vendorId: '',
    billNo: '',
    taxMode: 'lineLevel',
    discountMode: 'none',
    billGstPercent: '',
    billCgstPercent: '',
    billSgstPercent: '',
    discountAmount: '',
    discountPercent: '',
    grandTotalOverride: '',
    notes: '',
    items: [{ ...emptyBillLineItem }]
};

const parseQuantityInput = (rawValue) => {
    if (rawValue === '' || rawValue === '.') return rawValue;
    if (!/^\d+(\.\d{0,1})?$/.test(String(rawValue))) return null;
    return rawValue;
};

const toBillQuantity = (value) => {
    const num = parseFloat(value);
    if (!Number.isFinite(num) || num < 0.1) return null;
    return Math.round(num * 10) / 10;
};

const parsePriceInput = (rawValue) => {
    if (rawValue === '' || rawValue === '.') return rawValue;
    if (!/^\d+(\.\d{0,2})?$/.test(String(rawValue))) return null;
    return rawValue;
};

const parseGstInput = (rawValue) => {
    if (rawValue === '' || rawValue === '.') return rawValue;
    if (!/^\d{1,3}(\.\d{0,2})?$/.test(String(rawValue))) return null;
    const num = parseFloat(rawValue);
    if (num > 100) return null;
    return rawValue;
};

const formatCurrency = (value) => Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
});

const getBillKey = (bill) => `${bill.billNo || 'no-bill'}-${bill.items?.[0]?._id || bill.date}`;

const preventNumberInputScroll = (event) => {
    event.currentTarget.blur();
};

const Inventory = () => {
    const navigate = useNavigate();
    const canEditBills = hasPermission('inventory_edit');
    const canDeleteBills = hasPermission('inventory_delete');

    const [activeTab, setActiveTab] = useState(TABS.inventory);
    const [items, setItems] = useState([]);
    const [history, setHistory] = useState([]);
    const [maintenanceBills, setMaintenanceBills] = useState([]);
    const [vendors, setVendors] = useState([]);
    const [tyreRegistry, setTyreRegistry] = useState([]);
    const [buses, setBuses] = useState([]);
    const [otherVehicles, setOtherVehicles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [vendorsLoading, setVendorsLoading] = useState(false);
    const [registryLoading, setRegistryLoading] = useState(false);
    const [pendingAttachments, setPendingAttachments] = useState([]);
    
    // Modals
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isVendorModalOpen, setIsVendorModalOpen] = useState(false);
    const [isBillModalOpen, setIsBillModalOpen] = useState(false);
    const [isBillSuccessModalOpen, setIsBillSuccessModalOpen] = useState(false);
    const [printBill, setPrintBill] = useState(null);
    const [inventoryView, setInventoryView] = useState('card'); // 'card' or 'table'
    
    const [editingItem, setEditingItem] = useState(null);
    const [editingVendor, setEditingVendor] = useState(null);
    const [editingBill, setEditingBill] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedBusFilter, setSelectedBusFilter] = useState('all');
    const [expandedInventoryGroup, setExpandedInventoryGroup] = useState(null);
    const [expandedBillKey, setExpandedBillKey] = useState(null);

    const [itemFormData, setItemFormData] = useState(emptyItemFormData);

    const [billFormData, setBillFormData] = useState(emptyBillFormData);

    const addBillItem = () => {
        setBillFormData({
            ...billFormData,
            items: [...billFormData.items, { ...emptyBillLineItem }]
        });
    };

    const removeBillItem = (index) => {
        if (billFormData.items.length <= 1) return;
        const newItems = [...billFormData.items];
        newItems.splice(index, 1);
        setBillFormData({ ...billFormData, items: newItems });
    };

    const updateBillItem = (index, field, value) => {
        const newItems = [...billFormData.items];
        newItems[index] = { ...newItems[index], [field]: value };
        setBillFormData({ ...billFormData, items: newItems });
    };

    const handleQuantityChange = (index, rawValue) => {
        const parsed = parseQuantityInput(rawValue);
        if (parsed === null) return;
        updateBillItem(index, 'quantity', parsed);
    };

    const handlePriceChange = (index, rawValue) => {
        const parsed = parsePriceInput(rawValue);
        if (parsed === null) return;
        updateBillItem(index, 'price', parsed);
    };

    const handleGstChange = (index, rawValue) => {
        const parsed = parseGstInput(rawValue);
        if (parsed === null) return;
        updateBillItem(index, 'gstPercent', parsed);
    };

    const resetBillForm = () => {
        setBillFormData(emptyBillFormData);
        setEditingBill(null);
        setPendingAttachments([]);
    };

    const openNewBillModal = () => {
        resetBillForm();
        setIsBillModalOpen(true);
    };

    const openEditBillModal = (bill) => {
        if (!canEditBills) {
            alert('You do not have permission to edit bills.');
            return;
        }

        const vehicleNumber = bill.busId?.busNumber || bill.busId?.vehicleNumber || '';
        const vendorId = bill.vendorId?._id || bill.vendorId || '';
        const billTaxes = Array.isArray(bill.taxes) ? bill.taxes : [];
        const cgst = billTaxes.find((t) => /cgst/i.test(t.name));
        const sgst = billTaxes.find((t) => /sgst|utgst/i.test(t.name));
        const singleGst = billTaxes.length === 1 ? billTaxes[0] : null;

        setEditingBill({
            originalBillNo: bill.billNo,
            billId: bill._id || bill.maintenanceBillId || null,
            existingAttachments: bill.attachments || []
        });
        setPendingAttachments([]);
        setBillFormData({
            busId: vehicleNumber,
            vendorId: String(vendorId),
            billNo: bill.billNo || '',
            taxMode: bill.taxMode || 'lineLevel',
            discountMode: bill.discountMode || 'none',
            billGstPercent: singleGst && !cgst && !sgst ? String(singleGst.rate) : '',
            billCgstPercent: cgst ? String(cgst.rate) : '',
            billSgstPercent: sgst ? String(sgst.rate) : '',
            discountAmount: bill.discountAmount || '',
            discountPercent: bill.discountPercent || '',
            grandTotalOverride: bill.grandTotalOverride ?? '',
            notes: bill.notes || bill.rawDescription || '',
            items: (bill.items || bill.lines || []).map((alloc) => {
                const itemDoc = alloc.itemId;
                const pricingMode = alloc.pricingMode || 'unitRate';
                return {
                    allocationId: alloc.allocationId || alloc._id || '',
                    itemId: itemDoc?._id || alloc.itemId || '',
                    itemGroup: itemDoc?.itemName || '',
                    variantName: alloc.variantName || itemDoc?.variantName || '',
                    pricingMode,
                    quantity: alloc.quantity,
                    price: pricingMode === 'unitRate' ? (alloc.unitPrice ?? alloc.price ?? '') : '',
                    amount: pricingMode === 'lumpSum' ? (alloc.amount ?? alloc.price ?? '') : '',
                    gstPercent: alloc.gstPercent ?? '',
                    discountAmount: alloc.discountAmount ?? '',
                    discountPercent: alloc.discountPercent ?? '',
                    subDescriptions: Array.isArray(alloc.subDescriptions)
                        ? alloc.subDescriptions.join('\n')
                        : '',
                    remarks: alloc.remarks || '',
                    tyrePosition: alloc.tyrePosition || 'front right',
                    kmReading: alloc.kmReading ?? '',
                    tyreType: alloc.tyreType || 'new tyre'
                };
            })
        });
        setIsBillModalOpen(true);
    };

    const closeBillModal = () => {
        setIsBillModalOpen(false);
        resetBillForm();
    };

    const toggleItemInBill = (index, itemId) => {
        const newItems = [...billFormData.items];
        const itemIds = [...newItems[index].itemIds];
        const itemIdx = itemIds.indexOf(itemId);
        if (itemIdx > -1) {
            itemIds.splice(itemIdx, 1);
        } else {
            itemIds.push(itemId);
        }
        newItems[index].itemIds = itemIds;
        setBillFormData({ ...billFormData, items: newItems });
    };

    const [vendorFormData, setVendorFormData] = useState({
        name: '',
        contactPerson: '',
        phone: '',
        email: '',
        address: ''
    });

    useEffect(() => {
        fetchItems();
        fetchBuses();
        fetchOtherVehicles();
        fetchVendors();
    }, []);

    useEffect(() => {
        if (activeTab === TABS.vendors) {
            fetchVendors();
        } else if (activeTab === TABS.tyreRegistry) {
            fetchTyreRegistry(selectedBusFilter);
        }
    }, [activeTab, selectedBusFilter]);

    // Fetch history for modal reference when bus is selected
    useEffect(() => {
        if (isBillModalOpen && billFormData.busId) {
            fetchHistory(billFormData.busId);
        }
    }, [isBillModalOpen, billFormData.busId]);

    const fetchItems = async () => {
        setLoading(true);
        try {
            const response = await apiFetch(`${API}/inventory`);
            const data = await response.json();
            setItems(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error('Error fetching inventory:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchBuses = async () => {
        try {
            const response = await apiFetch(`${API}/buses`);
            const data = await response.json();
            setBuses(data);
        } catch (error) {
            console.error('Error fetching buses:', error);
        }
    };

    const fetchOtherVehicles = async () => {
        try {
            const response = await apiFetch(`${API}/other-vehicles`);
            const data = await response.json();
            setOtherVehicles(data);
        } catch (error) {
            console.error('Error fetching other vehicles:', error);
        }
    };

    const fetchVendors = async () => {
        setVendorsLoading(true);
        try {
            const response = await apiFetch(`${API}/inventory/vendors`);
            const data = await response.json();
            setVendors(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error('Error fetching vendors:', error);
        } finally {
            setVendorsLoading(false);
        }
    };

    const fetchTyreRegistry = async (busId) => {
        setRegistryLoading(true);
        try {
            const url = busId === 'all' ? `${API}/inventory/tyre-registry` : `${API}/inventory/tyre-registry/${busId}`;
            const response = await apiFetch(url);
            const data = await response.json();
            setTyreRegistry(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error('Error fetching tyre registry:', error);
        } finally {
            setRegistryLoading(false);
        }
    };

    const fetchHistory = async (busId) => {
        setHistoryLoading(true);
        try {
            const historyUrl = busId === 'all' ? `${API}/inventory/history` : `${API}/inventory/history/${busId}`;
            const billsUrl = busId === 'all'
                ? `${API}/inventory/bills`
                : `${API}/inventory/bills?busId=${encodeURIComponent(busId)}`;

            const [historyRes, billsRes] = await Promise.all([
                apiFetch(historyUrl),
                apiFetch(billsUrl)
            ]);
            const historyData = await historyRes.json();
            const billsData = await billsRes.json();
            setHistory(Array.isArray(historyData) ? historyData : []);
            setMaintenanceBills(Array.isArray(billsData) ? billsData : []);
        } catch (error) {
            console.error('Error fetching history:', error);
        } finally {
            setHistoryLoading(false);
        }
    };

    const uploadPendingAttachments = async (billId) => {
        if (!billId || !pendingAttachments.length) return null;
        const formData = new FormData();
        pendingAttachments.forEach((file) => formData.append('attachments', file));
        const response = await apiFetch(`${API}/inventory/bills/by-id/${billId}/attachments`, {
            method: 'POST',
            body: formData
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.message || 'Failed to upload attachments');
        }
        return response.json();
    };

    const buildBillTaxesPayload = () => {
        if (billFormData.taxMode !== 'billLevel') return [];
        const taxes = [];
        const cgst = parseFloat(billFormData.billCgstPercent);
        const sgst = parseFloat(billFormData.billSgstPercent);
        const gst = parseFloat(billFormData.billGstPercent);
        if (Number.isFinite(cgst) && cgst > 0) taxes.push({ name: 'CGST', rate: cgst });
        if (Number.isFinite(sgst) && sgst > 0) taxes.push({ name: 'SGST', rate: sgst });
        if (taxes.length === 0 && Number.isFinite(gst) && gst > 0) {
            taxes.push({ name: 'GST', rate: gst });
        }
        return taxes;
    };

    const buildHybridBillPayload = (adminName) => ({
        busId: billFormData.busId,
        vendorId: billFormData.vendorId,
        billNo: billFormData.billNo,
        adminName,
        taxMode: billFormData.taxMode,
        discountMode: billFormData.discountMode,
        discountAmount: parseFloat(billFormData.discountAmount) || 0,
        discountPercent: parseFloat(billFormData.discountPercent) || 0,
        taxes: buildBillTaxesPayload(),
        grandTotalOverride: billFormData.grandTotalOverride === '' || billFormData.grandTotalOverride == null
            ? null
            : parseFloat(billFormData.grandTotalOverride),
        notes: billFormData.notes || '',
        items: billFormData.items.map((item) => {
            const pricingMode = item.pricingMode === 'lumpSum' ? 'lumpSum' : 'unitRate';
            return {
                allocationId: item.allocationId || undefined,
                itemId: item.itemId,
                itemIds: [item.itemId],
                variantName: item.variantName || '',
                pricingMode,
                quantity: toBillQuantity(item.quantity),
                unitPrice: pricingMode === 'unitRate' ? (parseFloat(item.price) || 0) : 0,
                price: pricingMode === 'unitRate'
                    ? (parseFloat(item.price) || 0)
                    : (parseFloat(item.amount) || 0),
                amount: pricingMode === 'lumpSum' ? (parseFloat(item.amount) || 0) : undefined,
                gstPercent: billFormData.taxMode === 'lineLevel' ? (parseFloat(item.gstPercent) || 0) : 0,
                discountAmount: billFormData.discountMode === 'lineLevel'
                    ? (parseFloat(item.discountAmount) || 0)
                    : 0,
                discountPercent: billFormData.discountMode === 'lineLevel'
                    ? (parseFloat(item.discountPercent) || 0)
                    : 0,
                subDescriptions: String(item.subDescriptions || '')
                    .split(/\r?\n/)
                    .map((s) => s.trim())
                    .filter(Boolean),
                remarks: item.remarks || '',
                tyrePosition: item.tyrePosition,
                kmReading: item.kmReading,
                tyreType: item.tyreType
            };
        })
    });

    const handleItemSubmit = async (e) => {
        e.preventDefault();
        const url = editingItem ? `${API}/inventory/${editingItem._id}` : `${API}/inventory`;
        const method = editingItem ? 'PUT' : 'POST';

        try {
            const response = await apiFetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(itemFormData)
            });

            if (response.ok) {
                fetchItems();
                setIsModalOpen(false);
                setEditingItem(null);
                setItemFormData(emptyItemFormData);
            }
        } catch (error) {
            console.error('Error saving item:', error);
        }
    };

    const handleVendorSubmit = async (e) => {
        e.preventDefault();
        const url = editingVendor ? `${API}/inventory/vendors/${editingVendor._id}` : `${API}/inventory/vendors`;
        const method = editingVendor ? 'PUT' : 'POST';

        try {
            const response = await apiFetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(vendorFormData)
            });

            if (response.ok) {
                fetchVendors();
                setIsVendorModalOpen(false);
                setEditingVendor(null);
                setVendorFormData({ name: '', contactPerson: '', phone: '', email: '', address: '' });
            }
        } catch (error) {
            console.error('Error saving vendor:', error);
        }
    };

    const handleBillSubmit = async (e) => {
        e.preventDefault();

        for (const item of billFormData.items) {
            const qty = toBillQuantity(item.quantity);
            if (qty === null) {
                alert('Each item quantity must be at least 0.1 with up to 1 decimal place.');
                return;
            }
            if (!item.itemId) {
                alert('Each row must have an inventory item selected.');
                return;
            }
            const pricingMode = item.pricingMode === 'lumpSum' ? 'lumpSum' : 'unitRate';
            if (pricingMode === 'unitRate') {
                const price = parseFloat(item.price);
                if (!Number.isFinite(price) || price < 0) {
                    alert('Each unit-rate item must have a valid unit price.');
                    return;
                }
            } else {
                const amount = parseFloat(item.amount);
                if (!Number.isFinite(amount) || amount < 0) {
                    alert('Each lump-sum item must have a valid amount.');
                    return;
                }
            }
        }

        const adminInfo = JSON.parse(localStorage.getItem('adminInfo') || '{}');
        const payload = buildHybridBillPayload(adminInfo.name || adminInfo.username || 'Admin');

        const isEditing = Boolean(editingBill?.originalBillNo || editingBill?.billId);
        if (isEditing && !canEditBills) {
            alert('You do not have permission to edit bills.');
            return;
        }

        const useIdPath = Boolean(editingBill?.billId);
        const url = isEditing
            ? (useIdPath
                ? `${API}/inventory/bills/by-id/${editingBill.billId}`
                : `${API}/inventory/update-bill`)
            : `${API}/inventory/bills`;
        const method = isEditing ? 'PUT' : 'POST';

        if (isEditing && !useIdPath) {
            payload.originalBillNo = editingBill.originalBillNo;
        }

        try {
            const response = await apiFetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                const data = await response.json().catch(() => ({}));
                const savedBill = data.bill || null;
                let attachments = savedBill?.attachments || editingBill?.existingAttachments || [];

                if (pendingAttachments.length && savedBill?._id) {
                    try {
                        const uploadResult = await uploadPendingAttachments(savedBill._id);
                        attachments = uploadResult?.attachments || uploadResult?.bill?.attachments || attachments;
                    } catch (uploadError) {
                        console.error(uploadError);
                        alert(uploadError.message || 'Bill saved but attachment upload failed.');
                    }
                }

                const printableBill = {
                    ...buildPrintableBillData(),
                    ...(savedBill || {}),
                    attachments,
                    wasEdit: isEditing
                };
                fetchItems();
                fetchHistory(billFormData.busId);
                setIsBillModalOpen(false);
                setPrintBill(printableBill);
                setIsBillSuccessModalOpen(true);
                resetBillForm();
                if (activeTab === TABS.tyreRegistry) fetchTyreRegistry(selectedBusFilter);
            } else {
                const data = await response.json();
                setPrintBill({
                    error: data.message || (isEditing ? 'Failed to update bill' : 'Failed to raise bill'),
                });
                setIsBillSuccessModalOpen(true);
            }
        } catch (error) {
            console.error(isEditing ? 'Error updating bill:' : 'Error raising bill:', error);
            setPrintBill({ error: isEditing ? 'Error updating bill. Please try again.' : 'Error raising bill. Please try again.' });
            setIsBillSuccessModalOpen(true);
        }
    };

    const handleDeleteBill = async (bill) => {
        if (!canDeleteBills) {
            alert('You do not have permission to delete bills.');
            return;
        }
        if (!bill?.billNo && !bill?._id) {
            alert('This bill cannot be deleted because it has no bill number.');
            return;
        }

        const vehicleLabel = bill.busId?.vehicleNumber || bill.busId?.busNumber || 'the vehicle';
        if (!window.confirm(`Delete bill #${bill.billNo || bill._id}? This will remove all item assignments from ${vehicleLabel}.`)) {
            return;
        }

        try {
            const deleteUrl = bill._id
                ? `${API}/inventory/bills/by-id/${bill._id}`
                : `${API}/inventory/bills/${encodeURIComponent(bill.billNo)}`;
            const response = await apiFetch(deleteUrl, {
                method: 'DELETE'
            });
            if (response.ok) {
                const busId = bill.busId?.busNumber || bill.busId?.vehicleNumber;
                if (busId) fetchHistory(busId);
                fetchHistory(selectedBusFilter);
                if (activeTab === TABS.tyreRegistry) fetchTyreRegistry(selectedBusFilter);
                if (expandedBillKey === getBillKey(bill)) {
                    setExpandedBillKey(null);
                }
            } else {
                const data = await response.json();
                alert(data.message || 'Failed to delete bill');
            }
        } catch (error) {
            console.error('Error deleting bill:', error);
            alert('Error deleting bill. Please try again.');
        }
    };

    const handlePrint = async (billData) => {
        try {
            const response = await apiFetch(`${API}/print`, {
                method: 'POST',
                body: JSON.stringify({
                    template: 'bill-print',
                    data: {
                        billNo: billData.billNo,
                        billId: billData._id,
                        vendorId: billData.vendorId?._id || billData.vendorId,
                        busId: billData.busId?._id || billData.busId
                    }
                })
            });
            if (response.ok) {
                const html = await response.text();
                printHtmlDocument(html, `Transport-Maintenance-Bill-${billData.billNo}`);
            } else {
                // Fallback: client-side print of BillPrint component
                window.print();
            }
        } catch (error) {
            console.error('Error generating bill print:', error);
            window.print();
        }
    };

    const handleDeleteVendor = async (id) => {
        if (!window.confirm('Are you sure you want to delete this vendor?')) return;
        try {
            const response = await apiFetch(`${API}/inventory/vendors/${id}`, { method: 'DELETE' });
            if (response.ok) {
                fetchVendors();
            } else {
                const data = await response.json();
                alert(data.message || 'Delete failed');
            }
        } catch (error) {
            console.error('Error deleting vendor:', error);
        }
    };

    const handleDeleteItem = async (id) => {
        if (!window.confirm('Are you sure you want to delete this item?')) return;
        try {
            const response = await apiFetch(`${API}/inventory/${id}`, { method: 'DELETE' });
            if (response.ok) {
                fetchItems();
            } else {
                const data = await response.json();
                alert(data.message || 'Delete failed');
            }
        } catch (error) {
            console.error('Error deleting item:', error);
        }
    };

    const openEditModal = (item, group = null) => {
        setEditingItem(item);
        const existingVariants = group?.variants?.length
            ? group.variants.map((variant) => variant.name).filter(Boolean)
            : Array.isArray(item.variants)
            ? item.variants.map((variant) => variant.name).filter(Boolean)
            : [];
        setItemFormData({
            itemName: group?.itemName || item.itemName,
            variantName: item.variantName || '',
            variantNames: existingVariants.length > 0 ? existingVariants : (item.variantName ? [item.variantName] : ['']),
            category: group?.category || item.category,
            totalQuantity: item.totalQuantity,
            unit: group?.unit || item.unit,
            description: group?.description || item.description
        });
        setIsModalOpen(true);
    };

    const inventoryGroups = getInventoryGroups(items);
    const filteredGroups = inventoryGroups.filter(group =>
        group.itemName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        group.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
        group.variants.some((variant) => variant.name.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    const getLastPrice = (itemId) => {
        if (!history || history.length === 0) return null;
        // Find the most recent allocation for this itemId in history
        const lastAllocation = history.find(h => (h.itemId?._id || h.itemId) === itemId);
        return lastAllocation ? lastAllocation.price : null;
    };

    const liveBillCalcInput = {
        taxMode: billFormData.taxMode,
        discountMode: billFormData.discountMode,
        discountAmount: billFormData.discountAmount,
        discountPercent: billFormData.discountPercent,
        taxes: buildBillTaxesPayload(),
        grandTotalOverride: billFormData.grandTotalOverride,
        items: billFormData.items.map((item) => ({
            ...item,
            pricingMode: item.pricingMode || 'unitRate',
            unitPrice: item.price,
            amount: item.amount
        }))
    };
    const billTotals = computeBillTotals(liveBillCalcInput);

    const buildPrintableBillData = () => {
        const selectedBus = buses.find((bus) => bus.busNumber === billFormData.busId)
            || otherVehicles.find((v) => v.vehicleNumber === billFormData.busId);
        const selectedVendor = vendors.find((vendor) => vendor._id === billFormData.vendorId);
        const printableItems = billFormData.items
            .filter((line) => line.itemId)
            .map((line) => ({
                ...line,
                pricingMode: line.pricingMode || 'unitRate',
                unitPrice: line.price,
                amount: line.amount,
                itemId: items.find((item) => item._id === line.itemId) || line.itemId,
                allocatedDate: new Date(),
                subDescriptions: String(line.subDescriptions || '')
                    .split(/\r?\n/)
                    .map((s) => s.trim())
                    .filter(Boolean)
            }));
        const totals = computeBillTotals({
            ...liveBillCalcInput,
            items: printableItems
        });

        return {
            billNo: billFormData.billNo,
            date: new Date(),
            vendorId: selectedVendor || billFormData.vendorId,
            busId: selectedBus
                ? { ...selectedBus, busNumber: selectedBus.busNumber || selectedBus.vehicleNumber }
                : billFormData.busId,
            adminName: JSON.parse(localStorage.getItem('adminInfo') || '{}').name || 'Admin',
            taxMode: billFormData.taxMode,
            discountMode: billFormData.discountMode,
            taxes: buildBillTaxesPayload(),
            discountAmount: billFormData.discountAmount,
            discountPercent: billFormData.discountPercent,
            notes: billFormData.notes,
            subtotal: totals.subtotal,
            discountTotal: totals.discountTotal,
            gstTotal: totals.taxTotal,
            taxTotal: totals.taxTotal,
            totalAmount: totals.grandTotal,
            grandTotal: totals.grandTotal,
            attachments: editingBill?.existingAttachments || [],
            items: printableItems,
        };
    };

    const getSelectedBillHistory = () => {
        const selectedLines = billFormData.items.filter((line) => line.itemId || line.itemGroup);
        if (!billFormData.busId) return [];
        if (selectedLines.length === 0) return history.slice(0, 20);

        return history.filter((record) => {
            const recordItem = record.itemId;
            const recordGroup = recordItem?.itemName || '';
            const recordVariant = record.variantName || recordItem?.variantName || '';
            return selectedLines.some((line) => {
                if (line.variantName) {
                    return recordGroup === line.itemGroup && recordVariant === line.variantName;
                }
                if (line.itemGroup) {
                    return recordGroup === line.itemGroup;
                }
                return (recordItem?._id || record.itemId) === line.itemId;
            });
        });
    };

    const getGroupedBills = () => {
        if (maintenanceBills.length > 0) {
            return maintenanceBills.map((bill) => ({
                ...bill,
                date: bill.date,
                totalAmount: bill.grandTotal ?? bill.totalAmount ?? 0,
                items: bill.items || bill.lines || [],
                attachments: bill.attachments || []
            }));
        }

        if (!history || history.length === 0) return [];

        const groups = history.reduce((acc, record) => {
            const billKey = record.billNo || `no-bill-${record._id}`;
            if (!acc[billKey]) {
                acc[billKey] = {
                    billNo: record.billNo,
                    date: record.allocatedDate,
                    vendorId: record.vendorId,
                    busId: record.busId,
                    adminName: record.adminName,
                    taxMode: 'lineLevel',
                    discountMode: 'none',
                    items: [],
                    attachments: [],
                    totalAmount: 0
                };
            }
            acc[billKey].items.push({
                ...record,
                pricingMode: record.pricingMode || 'unitRate',
                unitPrice: record.price
            });
            acc[billKey].totalAmount += getLineTotal(record.quantity, record.price, record.gstPercent);
            return acc;
        }, {});

        return Object.values(groups);
    };

    const groupedBills = getGroupedBills();
    const itemGroupOptions = [...new Set(items.map((item) => item.itemName).filter(Boolean))].sort();
    const filledVariantNames = itemFormData.variantNames.map((value) => value.trim()).filter(Boolean);
    const creatingMultipleVariants = !editingItem && filledVariantNames.length > 1;

    const getGroupByName = (name) => inventoryGroups.find((group) => group.itemName === name);
    const getSelectedInventoryItem = (lineItem) => {
        if (lineItem.itemId) return items.find((item) => item._id === lineItem.itemId);
        const group = getGroupByName(lineItem.itemGroup);
        return group?.primaryItem || null;
    };

    const handleBillGroupChange = (index, groupName) => {
        const group = getGroupByName(groupName);
        const firstVariant = group?.variants?.[0] || null;
        const newItems = [...billFormData.items];
        newItems[index] = {
            ...newItems[index],
            itemGroup: groupName,
            itemId: firstVariant?.itemId || group?.primaryItem?._id || '',
            variantName: firstVariant?.name || '',
        };
        setBillFormData({ ...billFormData, items: newItems });
    };

    const handleBillVariantChange = (index, variantName) => {
        const lineItem = billFormData.items[index];
        const group = getGroupByName(lineItem.itemGroup);
        const variant = group?.variants?.find((candidate) => candidate.name === variantName);
        const newItems = [...billFormData.items];
        newItems[index] = {
            ...newItems[index],
            variantName,
            itemId: variant?.itemId || group?.primaryItem?._id || '',
        };
        setBillFormData({ ...billFormData, items: newItems });
    };

    const addVariantRow = () => {
        setItemFormData((prev) => ({
            ...prev,
            variantNames: [...prev.variantNames, ''],
        }));
    };

    const updateVariantRow = (index, value) => {
        setItemFormData((prev) => {
            const nextVariants = [...prev.variantNames];
            nextVariants[index] = value;
            const firstVariant = nextVariants.map((name) => name.trim()).find(Boolean) || '';
            return {
                ...prev,
                variantName: firstVariant,
                variantNames: nextVariants,
            };
        });
    };

    const removeVariantRow = (index) => {
        setItemFormData((prev) => {
            const nextVariants = prev.variantNames.filter((_, i) => i !== index);
            const normalizedVariants = nextVariants.length > 0 ? nextVariants : [''];
            const firstVariant = normalizedVariants.map((name) => name.trim()).find(Boolean) || '';
            return {
                ...prev,
                variantName: firstVariant,
                variantNames: normalizedVariants,
            };
        });
    };

    return (
        <Layout>
            <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-3xl font-bold text-slate-800 tracking-tight flex items-center gap-3">
                        <Package className="text-blue-600" size={32} />
                        Bus Inventory
                    </h2>
                    <p className="text-slate-500 mt-1">Manage parts, supplies, and their allocation to the fleet.</p>
                </div>
                <div className="flex flex-wrap gap-3">
                    <button 
                        onClick={() => { setEditingItem(null); setItemFormData(emptyItemFormData); setIsModalOpen(true); }}
                        className="bg-gray-800 text-white px-4 py-2 rounded text-sm font-bold flex items-center gap-2 hover:bg-gray-700 transition-all shadow-sm active:scale-95"
                    >
                        <Plus size={16} /> Add Item / Variant
                    </button>
                    <Link
                        to="/inventory/raise-bill"
                        className="bg-emerald-700 text-white px-4 py-2 rounded text-sm font-bold flex items-center gap-2 hover:bg-emerald-800 transition-all shadow-sm active:scale-95"
                    >
                        <Truck size={16} /> Raise Bill
                    </Link>
                    <button 
                        onClick={() => setActiveTab(TABS.tyreRegistry)}
                        className="bg-blue-700 text-white px-4 py-2 rounded text-sm font-bold flex items-center gap-2 hover:bg-blue-800 transition-all shadow-sm active:scale-95"
                    >
                        <Layers size={16} /> Tyre Registry
                    </button>
                    <button 
                        onClick={() => { setEditingVendor(null); setVendorFormData({ name: '', contactPerson: '', phone: '', email: '', address: '' }); setIsVendorModalOpen(true); }}
                        className="bg-gray-100 text-gray-700 px-4 py-2 rounded text-sm font-bold flex items-center gap-2 hover:bg-gray-200 transition-all border border-gray-300"
                    >
                        <Plus size={16} /> Manage Vendors
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-3 bg-gray-100 p-1 rounded border border-gray-200 mb-6 w-full gap-1">
                <button
                    onClick={() => setActiveTab(TABS.inventory)}
                    className={`px-4 py-2 rounded text-xs font-bold transition-all flex items-center justify-center gap-2 whitespace-nowrap ${activeTab === TABS.inventory ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                    <Layers size={14} /> Master Inventory
                </button>
                <button
                    onClick={() => setActiveTab(TABS.vendors)}
                    className={`px-4 py-2 rounded text-xs font-bold transition-all flex items-center justify-center gap-2 whitespace-nowrap ${activeTab === TABS.vendors ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                    <Package size={14} /> Vendors
                </button>
                <button
                    onClick={() => setActiveTab(TABS.tyreRegistry)}
                    className={`px-4 py-2 rounded text-xs font-bold transition-all flex items-center justify-center gap-2 whitespace-nowrap ${activeTab === TABS.tyreRegistry ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                    <Truck size={14} /> Tyre Registry
                </button>
            </div>

            {activeTab === TABS.inventory && (
                <>
                    <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-6 mb-8">
                        <div className="flex flex-col md:flex-row gap-4 justify-between items-center mb-6">
                            <div className="relative w-full md:w-96 group">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500 transition-colors" size={18} />
                                <input
                                    type="text"
                                    placeholder="Search by item group, variant, or category..."
                                    className="w-full pl-11 pr-4 py-3 rounded-md border border-slate-200 focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none transition-all text-sm font-medium"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                            <div className="flex bg-gray-100 p-1 rounded-lg border border-gray-200 shrink-0">
                                <button 
                                    onClick={() => setInventoryView('card')}
                                    className={`p-2 rounded-md transition-all ${inventoryView === 'card' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                                    title="Card View"
                                >
                                    <LayoutGrid size={20} />
                                </button>
                                <button 
                                    onClick={() => setInventoryView('table')}
                                    className={`p-2 rounded-md transition-all ${inventoryView === 'table' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                                    title="Table View"
                                >
                                    <List size={20} />
                                </button>
                            </div>
                        </div>

                        {loading ? (
                            <div className="py-20 flex justify-center"><Loader text="Loading inventory..." /></div>
                        ) : filteredGroups.length > 0 ? (
                            inventoryView === 'table' ? (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left border-collapse">
                                        <thead>
                                            <tr className="bg-slate-50 border-b border-slate-100 text-[11px] uppercase text-slate-400 font-black tracking-widest">
                                                <th className="px-6 py-4">Item Details</th>
                                                <th className="px-6 py-4">Description</th>
                                                <th className="px-6 py-4 text-right">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-50">
                                            {filteredGroups.map(group => (
                                                <tr
                                                    key={group.key}
                                                    onClick={() => setExpandedInventoryGroup(expandedInventoryGroup === group.key ? null : group.key)}
                                                    className="hover:bg-slate-50/50 transition-colors group cursor-pointer"
                                                >
                                                    <td className="px-6 py-5">
                                                        <div>
                                                            <p className="font-bold text-slate-800">{group.itemName}</p>
                                                            <div className="flex items-center gap-2 mt-1">
                                                                <span className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded text-[10px] font-bold uppercase">{group.category}</span>
                                                                <span className="text-[10px] text-slate-400 font-medium">| {group.unit}</span>
                                                                <span className="bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded text-[10px] font-bold uppercase">
                                                                    {group.variants.length} variant(s)
                                                                </span>
                                                            </div>
                                                            {expandedInventoryGroup === group.key && group.variants.length > 0 && (
                                                                <div className="flex flex-wrap gap-1 mt-2">
                                                                    {group.variants.map((variant) => (
                                                                        <span key={variant.name} className="text-[10px] font-semibold bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                                                                            {variant.name}
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-5">
                                                        <p className="text-sm text-slate-500 line-clamp-1">{group.description || 'No description'}</p>
                                                    </td>
                                                    <td className="px-6 py-5 text-right">
                                                        <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                            <button onClick={(e) => { e.stopPropagation(); openEditModal(group.primaryItem, group); }} className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-all"><Edit size={16} /></button>
                                                            <button onClick={(e) => { e.stopPropagation(); handleDeleteItem(group.primaryItem._id); }} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-all"><Trash2 size={16} /></button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                                    {filteredGroups.map(group => (
                                        <div
                                            key={group.key}
                                            onClick={() => setExpandedInventoryGroup(expandedInventoryGroup === group.key ? null : group.key)}
                                            className="group relative bg-white rounded-xl border border-blue-300 shadow-xl shadow-blue-500/5 transition-all p-5 flex flex-col justify-between overflow-hidden cursor-pointer"
                                        >
                                            {/* Accent Banner */}
                                            <div className="absolute top-0 right-0 left-0 h-1 bg-gradient-to-r from-blue-500 to-indigo-600"></div>
                                            
                                            <div>
                                                <div className="flex justify-between items-start mb-4">
                                                    <div className="p-2.5 bg-blue-50 rounded-lg transition-colors">
                                                        <Package className="text-blue-600 transition-colors" size={24} />
                                                    </div>
                                                    <span className="px-2 py-1 bg-blue-50 text-blue-600 rounded text-[9px] font-black uppercase tracking-widest">{group.category}</span>
                                                </div>
                                                
                                                <h3 className="text-lg font-black text-blue-700 leading-tight uppercase transition-colors line-clamp-1">{group.itemName}</h3>
                                                {expandedInventoryGroup === group.key && group.variants.length > 0 && (
                                                    <div className="mt-2 flex flex-wrap gap-1">
                                                        {group.variants.map((variant) => (
                                                            <span key={variant.name} className="text-[10px] font-bold bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded">
                                                                {variant.name}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                                <div className="mt-2 text-xs font-black text-slate-400 uppercase tracking-tighter flex items-center gap-1.5 pt-2 border-t border-slate-50">
                                                    Measured In: <span className="text-slate-800">{group.unit}</span>
                                                </div>
                                                
                                                <p className="mt-4 text-xs font-medium text-slate-500 line-clamp-2 italic leading-relaxed h-8">
                                                    {group.description || 'No detailed description provided for this item.'}
                                                </p>
                                            </div>

                                            <div className="mt-6 pt-4 border-t border-slate-50 flex items-center justify-between">
                                                <div className="flex gap-2">
                                                    <button 
                                                        onClick={(e) => { e.stopPropagation(); openEditModal(group.primaryItem, group); }}
                                                        className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                                                        title="Edit Item"
                                                    >
                                                        <Edit size={16} />
                                                    </button>
                                                    <button 
                                                        onClick={(e) => { e.stopPropagation(); handleDeleteItem(group.primaryItem._id); }}
                                                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                                                        title="Delete Item"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                                <span className="text-[10px] font-black text-slate-300 uppercase italic">{group.variants.length} variant(s)</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )
                        ) : (
                            <div className="py-20 text-center text-slate-400 bg-slate-50 rounded-lg border-2 border-dashed border-slate-100">
                                <AlertCircle className="mx-auto mb-3 opacity-20" size={48} />
                                <p className="font-medium">No items found matching your search.</p>
                            </div>
                        )}
                    </div>
                </>
            )}

            {activeTab === TABS.vendors && (
                <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-6">
                    {vendorsLoading ? (
                        <div className="py-20 flex justify-center"><Loader text="Fetching vendors..." /></div>
                    ) : vendors.length > 0 ? (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-slate-50 border-b border-slate-100 text-[11px] uppercase text-slate-400 font-black tracking-widest">
                                        <th className="px-6 py-4">Vendor Name</th>
                                        <th className="px-6 py-4">Contact Person</th>
                                        <th className="px-6 py-4">Phone / Email</th>
                                        <th className="px-6 py-4 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {vendors.map(v => (
                                        <tr key={v._id} className="hover:bg-slate-50 transition-colors group">
                                            <td className="px-6 py-5 font-bold text-slate-800 text-sm">{v.name}</td>
                                            <td className="px-6 py-5 text-sm text-slate-600 font-medium">{v.contactPerson}</td>
                                            <td className="px-6 py-5 text-sm text-slate-500">
                                                <div>{v.phone}</div>
                                                <div className="text-xs opacity-60">{v.email}</div>
                                            </td>
                                            <td className="px-6 py-5 text-right">
                                                <div className="flex justify-end gap-1">
                                                    <button onClick={() => { setEditingVendor(v); setVendorFormData(v); setIsVendorModalOpen(true); }} className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-all" title="Edit Vendor"><Edit size={16} /></button>
                                                    <button onClick={() => handleDeleteVendor(v._id)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-all" title="Delete Vendor"><Trash2 size={16} /></button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="py-20 text-center text-slate-400">No vendors found.</div>
                    )}
                </div>
            )}

            {activeTab === TABS.tyreRegistry && (
                <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-6">
                    <div className="flex flex-col md:flex-row gap-4 justify-between items-center mb-6">
                        <div className="flex items-center gap-3 w-full md:w-auto bg-slate-50 p-1 rounded-md border border-slate-100">
                            <Filter size={18} className="ml-3 text-slate-400" />
                            <select 
                                className="bg-transparent border-none outline-none text-sm font-bold text-slate-700 pr-8"
                                value={selectedBusFilter}
                                onChange={(e) => setSelectedBusFilter(e.target.value)}
                            >
                                <option value="all">All Fleet Tyres</option>
                                <optgroup label="Buses">
                                    {buses.map(b => (
                                        <option key={b._id} value={b.busNumber}>{b.busNumber} ({b.type})</option>
                                    ))}
                                </optgroup>
                                <optgroup label="Other Vehicles">
                                    {otherVehicles.map(o => (
                                        <option key={o._id} value={o.vehicleNumber}>{o.vehicleNumber} ({o.type})</option>
                                    ))}
                                </optgroup>
                            </select>
                        </div>
                    </div>

                    {registryLoading ? (
                        <div className="py-20 flex justify-center"><Loader text="Fetching registry..." /></div>
                    ) : tyreRegistry.length > 0 ? (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-slate-50 border-b border-slate-100 text-[11px] uppercase text-slate-400 font-black tracking-widest">
                                        <th className="px-6 py-4">Vehicle</th>
                                        <th className="px-6 py-4">Position</th>
                                        <th className="px-6 py-4">Type</th>
                                        <th className="px-6 py-4">Install KM</th>
                                        <th className="px-6 py-4">Last Updated</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {tyreRegistry.map(reg => (
                                        <tr key={reg._id} className="hover:bg-slate-50 transition-colors">
                                            <td className="px-6 py-5"><span className="font-black text-slate-900 text-xs px-2 py-1 bg-slate-100 rounded-lg">{reg.busId?.vehicleNumber || reg.busId?.busNumber || 'N/A'}</span></td>
                                            <td className="px-6 py-5 uppercase font-bold text-xs text-blue-600">{reg.position}</td>
                                            <td className="px-6 py-5 text-sm">
                                                <span className={`px-2 py-0.5 rounded-full font-black text-[10px] uppercase ${reg.tyreType === 'new tyre' ? 'bg-green-50 text-green-600' : 'bg-yellow-50 text-yellow-600'}`}>
                                                    {reg.tyreType}
                                                </span>
                                            </td>
                                            <td className="px-6 py-5 text-sm font-bold text-slate-700">{reg.installKm} KM</td>
                                            <td className="px-6 py-5 text-xs text-slate-400">{new Date(reg.updatedAt).toLocaleString()}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="py-20 text-center text-slate-400">No active tyres found in registry.</div>
                    )}
                </div>
            )}

            {/* Item Modal */}
            <Modal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title={editingItem ? 'Edit Inventory Item / Variant' : 'Add New Item Variants'}
            >
                <form onSubmit={handleItemSubmit} className="space-y-5">
                    <div>
                        <label className="block text-xs font-black uppercase text-slate-400 mb-2 tracking-widest">Item Group / Category</label>
                        <input
                            required
                            type="text"
                            placeholder="e.g. Mirror, Filter, Engine Oil"
                            list="inventory-item-groups"
                            className="w-full px-4 py-3 rounded-md border border-slate-200 focus:ring-4 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all font-medium"
                            value={itemFormData.itemName}
                            onChange={(e) => setItemFormData({ ...itemFormData, itemName: e.target.value })}
                        />
                        <datalist id="inventory-item-groups">
                            {itemGroupOptions.map((name) => (
                                <option key={name} value={name} />
                            ))}
                        </datalist>
                        <p className="text-[11px] text-slate-400 mt-1 font-medium">Use this as the parent item name. Examples: Mirror, Filter, Tyre.</p>
                    </div>
                    <div>
                        <label className="block text-xs font-black uppercase text-slate-400 mb-2 tracking-widest">Variants</label>
                        <div className="space-y-2">
                            {itemFormData.variantNames.map((variant, index) => (
                                <div key={index} className="flex gap-2">
                                    <input
                                        type="text"
                                        placeholder={index === 0 ? 'e.g. Left Mirror' : 'Another variant'}
                                        className="flex-1 px-4 py-3 rounded-md border border-slate-200 focus:ring-4 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all font-medium"
                                        value={variant}
                                        onChange={(e) => updateVariantRow(index, e.target.value)}
                                    />
                                    {itemFormData.variantNames.length > 1 && (
                                        <button
                                            type="button"
                                            onClick={() => removeVariantRow(index)}
                                            className="px-3 rounded-md border border-red-100 text-red-500 hover:bg-red-50"
                                            title="Remove variant"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    )}
                                </div>
                            ))}
                            <button
                                type="button"
                                onClick={addVariantRow}
                                className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-blue-50 text-blue-700 text-xs font-black uppercase tracking-wide hover:bg-blue-100"
                            >
                                <Plus size={14} /> Add Variant
                            </button>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-1 font-medium">
                            Add one row per variant. Leave all variants blank to keep only the item group.
                        </p>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-black uppercase text-slate-400 mb-2 tracking-widest">Inventory Type</label>
                            <select
                                required
                                className="w-full px-4 py-3 rounded-md border border-slate-200 focus:ring-4 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all font-medium bg-white"
                                value={itemFormData.category}
                                onChange={(e) => setItemFormData({ ...itemFormData, category: e.target.value })}
                            >
                                {CATEGORIES.map(cat => (
                                    <option key={cat} value={cat}>{cat}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-black uppercase text-slate-400 mb-2 tracking-widest">Unit</label>
                            <select
                                required
                                className="w-full px-4 py-3 rounded-md border border-slate-200 focus:ring-4 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all font-medium bg-white"
                                value={itemFormData.unit}
                                onChange={(e) => setItemFormData({ ...itemFormData, unit: e.target.value })}
                            >
                                {UNITS.map(unit => (
                                    <option key={unit} value={unit}>{unit}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-black uppercase text-slate-400 mb-2 tracking-widest">Description</label>
                        <textarea
                            rows="2"
                            placeholder="Optional notes..."
                            className="w-full px-4 py-3 rounded-md border border-slate-200 focus:ring-4 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all font-medium"
                            value={itemFormData.description}
                            onChange={(e) => setItemFormData({ ...itemFormData, description: e.target.value })}
                        />
                    </div>
                    <div className="flex gap-3 pt-4">
                        <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 px-4 py-3 rounded-md border border-slate-200 font-bold text-slate-600 hover:bg-slate-50 transition-all">Cancel</button>
                        <button type="submit" className="flex-1 px-4 py-3 rounded-md bg-slate-900 text-white font-bold hover:bg-slate-800 transition-all shadow-lg active:scale-95">
                            {creatingMultipleVariants ? `Save ${filledVariantNames.length} Variants` : 'Save Item'}
                        </button>
                    </div>
                </form>
            </Modal>


            {/* Vendor Modal */}
            <Modal
                isOpen={isVendorModalOpen}
                onClose={() => setIsVendorModalOpen(false)}
                title={editingVendor ? 'Edit Vendor' : 'Add New Vendor'}
            >
                <form onSubmit={handleVendorSubmit} className="space-y-4">
                    <div>
                        <label className="block text-xs font-black uppercase text-slate-400 mb-1">Vendor Name</label>
                        <input required className="w-full px-4 py-2 rounded-md border border-slate-200" value={vendorFormData.name} onChange={e => setVendorFormData({...vendorFormData, name: e.target.value})} />
                    </div>
                    <div>
                        <label className="block text-xs font-black uppercase text-slate-400 mb-1">Contact Person</label>
                        <input className="w-full px-4 py-2 rounded-md border border-slate-200" value={vendorFormData.contactPerson} onChange={e => setVendorFormData({...vendorFormData, contactPerson: e.target.value})} />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-black uppercase text-slate-400 mb-1">Phone</label>
                            <input className="w-full px-4 py-2 rounded-md border border-slate-200" value={vendorFormData.phone} onChange={e => setVendorFormData({...vendorFormData, phone: e.target.value})} />
                        </div>
                        <div>
                            <label className="block text-xs font-black uppercase text-slate-400 mb-1">Email</label>
                            <input type="email" className="w-full px-4 py-2 rounded-md border border-slate-200" value={vendorFormData.email} onChange={e => setVendorFormData({...vendorFormData, email: e.target.value})} />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-black uppercase text-slate-400 mb-1">Address</label>
                        <textarea className="w-full px-4 py-2 rounded-md border border-slate-200" value={vendorFormData.address} onChange={e => setVendorFormData({...vendorFormData, address: e.target.value})} />
                    </div>
                    <button type="submit" className="w-full bg-slate-900 text-white font-bold py-3 rounded-md hover:bg-slate-800 transition-all shadow-lg active:scale-95">
                        {editingVendor ? 'Update Vendor' : 'Save Vendor'}
                    </button>
                </form>
            </Modal>

            {/* Hidden Print Area */}
            <div className="hidden print:block absolute top-0 left-0 w-full">
                {printBill && !printBill.error && (
                    <div id="print-container">
                        <BillPrint 
                            billData={printBill} 
                            vendor={vendors.find(v => (v._id?.toString() || v._id) === (printBill.vendorId?._id?.toString() || printBill.vendorId?.toString() || printBill.vendorId))}
                            bus={buses.find(b => b.busNumber === (printBill.busId?.busNumber || printBill.busId))}
                        />
                    </div>
                )}
            </div>
        </Layout>
    );
};

export default Inventory;
