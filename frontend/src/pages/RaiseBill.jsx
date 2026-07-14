import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import Loader from '../components/Loader';
import {
    Plus, Trash2, History, Truck, Printer, AlertCircle,
    Edit, Calendar, ChevronDown, ChevronUp, Filter
} from 'lucide-react';
import BillPrint from '../components/BillPrint';
import { apiFetch, API_BASE } from '../utils/api';
import { printHtmlDocument } from '../utils/printHtml';
import { hasPermission } from '../utils/permissions';
import { computeBillTotals, getLineTotal } from '../utils/billCalculations';

const API = API_BASE;

const PAGE_TABS = { raise: 'raise', view: 'view' };

const getBillKey = (bill) => `${bill.billNo || 'no-bill'}-${bill._id || bill.items?.[0]?._id || bill.date}`;

const formatCurrency = (value) => Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
});

const TYRE_POSITIONS = [
    'front right',
    'front left',
    'back right',
    'back left',
    'rear left',
    'rear right'
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

const preventNumberInputScroll = (event) => {
    event.currentTarget.blur();
};

const mapBillToFormData = (bill) => {
    const vehicleNumber = bill.busId?.busNumber || bill.busId?.vehicleNumber || '';
    const vendorId = bill.vendorId?._id || bill.vendorId || '';
    const billTaxes = Array.isArray(bill.taxes) ? bill.taxes : [];
    const cgst = billTaxes.find((t) => /cgst/i.test(t.name));
    const sgst = billTaxes.find((t) => /sgst|utgst/i.test(t.name));
    const singleGst = billTaxes.length === 1 ? billTaxes[0] : null;

    return {
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
    };
};

const RaiseBill = () => {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const billIdParam = searchParams.get('billId');
    const billNoParam = searchParams.get('billNo');
    const tabParam = searchParams.get('tab');
    const isEditMode = Boolean(billIdParam || billNoParam);
    const canEditBills = hasPermission('inventory_edit');
    const canDeleteBills = hasPermission('inventory_delete');

    const initialTab = tabParam === 'view' && !isEditMode ? PAGE_TABS.view : PAGE_TABS.raise;
    const [pageTab, setPageTab] = useState(initialTab);

    const [items, setItems] = useState([]);
    const [history, setHistory] = useState([]);
    const [maintenanceBills, setMaintenanceBills] = useState([]);
    const [vendors, setVendors] = useState([]);
    const [buses, setBuses] = useState([]);
    const [otherVehicles, setOtherVehicles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [billLoading, setBillLoading] = useState(false);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [billsLoading, setBillsLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [editingBill, setEditingBill] = useState(null);
    const [billFormData, setBillFormData] = useState(emptyBillFormData);
    const [printBill, setPrintBill] = useState(null);
    const [showSuccess, setShowSuccess] = useState(false);
    const [loadError, setLoadError] = useState('');
    const [selectedBusFilter, setSelectedBusFilter] = useState('all');
    const [expandedBillKey, setExpandedBillKey] = useState(null);

    const inventoryGroups = getInventoryGroups(items);

    const switchTab = (tab) => {
        setPageTab(tab);
        setShowSuccess(false);
        if (tab === PAGE_TABS.view) {
            setSearchParams({ tab: 'view' });
        } else if (billIdParam || billNoParam) {
            // keep edit params when staying on raise for edit
            const next = {};
            if (billIdParam) next.billId = billIdParam;
            if (billNoParam) next.billNo = billNoParam;
            setSearchParams(next);
        } else {
            setSearchParams({});
        }
    };

    const resetBillForm = () => {
        setBillFormData(emptyBillFormData);
        setEditingBill(null);
    };

    const applyLoadedBill = (bill) => {
        setEditingBill({
            originalBillNo: bill.billNo,
            billId: bill._id || bill.maintenanceBillId || null
        });
        setBillFormData(mapBillToFormData(bill));
    };

    useEffect(() => {
        const loadMasters = async () => {
            setLoading(true);
            try {
                const [itemsRes, vendorsRes, busesRes, otherRes] = await Promise.all([
                    apiFetch(`${API}/inventory`),
                    apiFetch(`${API}/inventory/vendors`),
                    apiFetch(`${API}/buses`),
                    apiFetch(`${API}/other-vehicles`)
                ]);
                const [itemsData, vendorsData, busesData, otherData] = await Promise.all([
                    itemsRes.json(),
                    vendorsRes.json(),
                    busesRes.json(),
                    otherRes.json()
                ]);
                setItems(Array.isArray(itemsData) ? itemsData : []);
                setVendors(Array.isArray(vendorsData) ? vendorsData : []);
                setBuses(Array.isArray(busesData) ? busesData : []);
                setOtherVehicles(Array.isArray(otherData) ? otherData : []);
            } catch (error) {
                console.error('Error loading raise-bill masters:', error);
            } finally {
                setLoading(false);
            }
        };
        loadMasters();
    }, []);

    useEffect(() => {
        if (!isEditMode) {
            resetBillForm();
            setLoadError('');
            return;
        }

        if (!canEditBills) {
            setLoadError('You do not have permission to edit bills.');
            return;
        }

        const loadBillForEdit = async () => {
            setBillLoading(true);
            setLoadError('');
            try {
                let bill = null;

                if (billIdParam) {
                    const response = await apiFetch(`${API}/inventory/bills/by-id/${billIdParam}`);
                    if (!response.ok) {
                        const data = await response.json().catch(() => ({}));
                        throw new Error(data.message || 'Bill not found');
                    }
                    bill = await response.json();
                } else if (billNoParam) {
                    const response = await apiFetch(`${API}/inventory/bills`);
                    const bills = await response.json();
                    const match = (Array.isArray(bills) ? bills : []).find(
                        (b) => String(b.billNo || '') === String(billNoParam)
                    );
                    if (!match) {
                        throw new Error(`Bill #${billNoParam} not found`);
                    }
                    if (match._id) {
                        const byIdRes = await apiFetch(`${API}/inventory/bills/by-id/${match._id}`);
                        if (byIdRes.ok) {
                            bill = await byIdRes.json();
                        } else {
                            bill = match;
                        }
                    } else {
                        bill = match;
                    }
                }

                if (!bill) {
                    throw new Error('Bill not found');
                }
                applyLoadedBill(bill);
            } catch (error) {
                console.error('Error loading bill for edit:', error);
                setLoadError(error.message || 'Failed to load bill');
                resetBillForm();
            } finally {
                setBillLoading(false);
            }
        };

        loadBillForEdit();
    }, [billIdParam, billNoParam, isEditMode, canEditBills]);

    useEffect(() => {
        if (!billFormData.busId) {
            setHistory([]);
            return;
        }

        const fetchHistory = async () => {
            setHistoryLoading(true);
            try {
                const response = await apiFetch(`${API}/inventory/history/${encodeURIComponent(billFormData.busId)}`);
                const data = await response.json();
                setHistory(Array.isArray(data) ? data : []);
            } catch (error) {
                console.error('Error fetching bus history:', error);
                setHistory([]);
            } finally {
                setHistoryLoading(false);
            }
        };
        fetchHistory();
    }, [billFormData.busId]);

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
            items: printableItems,
        };
    };

    const getLastPrice = (itemId) => {
        if (!history || history.length === 0) return null;
        const lastAllocation = history.find((h) => (h.itemId?._id || h.itemId) === itemId);
        return lastAllocation ? lastAllocation.price : null;
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
                window.print();
            }
        } catch (error) {
            console.error('Error generating bill print:', error);
            window.print();
        }
    };

    const fetchBillsList = async (busId = selectedBusFilter) => {
        setBillsLoading(true);
        try {
            const billsUrl = busId === 'all'
                ? `${API}/inventory/bills`
                : `${API}/inventory/bills?busId=${encodeURIComponent(busId)}`;
            const historyUrl = busId === 'all'
                ? `${API}/inventory/history`
                : `${API}/inventory/history/${encodeURIComponent(busId)}`;

            const [billsRes, historyRes] = await Promise.all([
                apiFetch(billsUrl),
                apiFetch(historyUrl)
            ]);
            const billsData = await billsRes.json();
            const historyData = await historyRes.json();
            setMaintenanceBills(Array.isArray(billsData) ? billsData : []);
            setHistory(Array.isArray(historyData) ? historyData : []);
        } catch (error) {
            console.error('Error fetching bills:', error);
            setMaintenanceBills([]);
        } finally {
            setBillsLoading(false);
        }
    };

    useEffect(() => {
        if (pageTab === PAGE_TABS.view) {
            fetchBillsList(selectedBusFilter);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pageTab, selectedBusFilter]);

    useEffect(() => {
        if (isEditMode) {
            setPageTab(PAGE_TABS.raise);
        } else if (tabParam === 'view') {
            setPageTab(PAGE_TABS.view);
        }
    }, [isEditMode, tabParam]);

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
            const response = await apiFetch(deleteUrl, { method: 'DELETE' });
            if (response.ok) {
                if (expandedBillKey === getBillKey(bill)) setExpandedBillKey(null);
                fetchBillsList(selectedBusFilter);
            } else {
                const data = await response.json().catch(() => ({}));
                alert(data.message || 'Failed to delete bill');
            }
        } catch (error) {
            console.error('Error deleting bill:', error);
            alert('Error deleting bill. Please try again.');
        }
    };

    const openEditBill = (bill) => {
        if (!canEditBills) {
            alert('You do not have permission to edit bills.');
            return;
        }
        if (bill._id) {
            navigate(`/inventory/raise-bill?billId=${bill._id}`);
        } else if (bill.billNo) {
            navigate(`/inventory/raise-bill?billNo=${encodeURIComponent(bill.billNo)}`);
        }
        setPageTab(PAGE_TABS.raise);
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

        setSubmitting(true);
        try {
            const response = await apiFetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                const data = await response.json().catch(() => ({}));
                const savedBill = data.bill || null;

                const printableBill = {
                    ...buildPrintableBillData(),
                    ...(savedBill || {}),
                    wasEdit: isEditing
                };
                setPrintBill(printableBill);
                setShowSuccess(true);
                resetBillForm();
            } else {
                const data = await response.json().catch(() => ({}));
                setPrintBill({
                    error: data.message || (isEditing ? 'Failed to update bill' : 'Failed to raise bill'),
                    wasEdit: isEditing
                });
                setShowSuccess(true);
            }
        } catch (error) {
            console.error(isEditing ? 'Error updating bill:' : 'Error raising bill:', error);
            setPrintBill({
                error: isEditing ? 'Error updating bill. Please try again.' : 'Error raising bill. Please try again.',
                wasEdit: isEditing
            });
            setShowSuccess(true);
        } finally {
            setSubmitting(false);
        }
    };

    const pageTitle = editingBill?.originalBillNo
        ? `Edit Bill #${editingBill.originalBillNo}`
        : 'Raise Bill';

    if (showSuccess) {
        return (
            <Layout>
                <div className="max-w-lg mx-auto mt-12">
                    <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-8 space-y-5">
                        <h2 className="text-2xl font-bold text-slate-800">
                            {printBill?.error
                                ? (printBill?.wasEdit ? 'Bill Not Updated' : 'Bill Not Raised')
                                : (printBill?.wasEdit ? 'Bill Updated Successfully' : 'Bill Raised Successfully')}
                        </h2>
                        {printBill?.error ? (
                            <div className="p-4 rounded-xl bg-red-50 border border-red-100 text-red-700 text-sm font-semibold">
                                {printBill.error}
                            </div>
                        ) : (
                            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-100">
                                <p className="text-sm font-black text-emerald-800">
                                    {printBill?.wasEdit
                                        ? 'Bill updated successfully.'
                                        : 'Bill raised and assigned to bus successfully.'}
                                </p>
                                <p className="text-xs text-emerald-700 mt-1">
                                    Bill #{printBill?.billNo || 'N/A'} · Total ₹{printBill?.totalAmount ?? printBill?.grandTotal ?? 0}
                                </p>
                            </div>
                        )}
                        <div className="flex flex-col sm:flex-row gap-3">
                            {!printBill?.error && (
                                <button
                                    type="button"
                                    onClick={() => handlePrint(printBill)}
                                    className="flex-1 px-4 py-3 rounded-xl bg-blue-600 text-white text-sm font-black hover:bg-blue-700 flex items-center justify-center gap-2"
                                >
                                    <Printer size={16} /> Print Bill
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => {
                                    setShowSuccess(false);
                                    setPrintBill(null);
                                    switchTab(PAGE_TABS.view);
                                }}
                                className="flex-1 px-4 py-3 rounded-xl border border-slate-200 text-slate-700 text-sm font-bold hover:bg-slate-50"
                            >
                                View Bills
                            </button>
                        </div>
                    </div>
                    <div className="hidden print:block absolute top-0 left-0 w-full">
                        {printBill && !printBill.error && (
                            <div id="print-container">
                                <BillPrint
                                    billData={printBill}
                                    vendor={vendors.find((v) => (v._id?.toString() || v._id) === (printBill.vendorId?._id?.toString() || printBill.vendorId?.toString() || printBill.vendorId))}
                                    bus={buses.find((b) => b.busNumber === (printBill.busId?.busNumber || printBill.busId))
                                        || otherVehicles.find((v) => v.vehicleNumber === (printBill.busId?.busNumber || printBill.busId?.vehicleNumber || printBill.busId))}
                                />
                            </div>
                        )}
                    </div>
                </div>
            </Layout>
        );
    }

    return (
        <Layout>
            <div className="mb-6 flex flex-col md:flex-row md:items-start justify-between gap-4">
                <div>
                    <h2 className="text-3xl font-bold text-slate-800 tracking-tight flex items-center gap-3">
                        <Truck className="text-emerald-600" size={32} />
                        {pageTab === PAGE_TABS.view ? 'View Bills' : pageTitle}
                    </h2>
                    <p className="text-slate-500 mt-1">
                        {pageTab === PAGE_TABS.view
                            ? 'Browse raised maintenance bills across the fleet.'
                            : (isEditMode
                                ? 'Update an existing maintenance bill and vehicle allocations.'
                                : 'Raise a maintenance bill and allocate items to a vehicle.')}
                    </p>
                </div>
                <div className="flex bg-gray-100 p-1 rounded border border-gray-200 shrink-0 self-start">
                    <button
                        type="button"
                        onClick={() => switchTab(PAGE_TABS.raise)}
                        className={`px-4 py-2 rounded text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
                            pageTab === PAGE_TABS.raise ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'
                        }`}
                    >
                        <Truck size={14} /> Raise Bill
                    </button>
                    <button
                        type="button"
                        onClick={() => switchTab(PAGE_TABS.view)}
                        className={`px-4 py-2 rounded text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
                            pageTab === PAGE_TABS.view ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'
                        }`}
                    >
                        <History size={14} /> View Bills
                    </button>
                </div>
            </div>

            {pageTab === PAGE_TABS.view && (
                <div className="bg-white rounded-lg shadow-sm border border-slate-100 p-6">
                    <div className="flex flex-col md:flex-row gap-4 justify-between items-center mb-6">
                        <div className="flex items-center gap-3 w-full md:w-auto bg-slate-50 p-1 rounded-md border border-slate-100">
                            <Filter size={18} className="ml-3 text-slate-400" />
                            <select
                                className="bg-transparent border-none outline-none text-sm font-bold text-slate-700 pr-8"
                                value={selectedBusFilter}
                                onChange={(e) => setSelectedBusFilter(e.target.value)}
                            >
                                <option value="all">All Fleet Activity</option>
                                <optgroup label="Buses">
                                    {buses.map((b) => (
                                        <option key={b._id} value={b.busNumber}>{b.busNumber} ({b.type})</option>
                                    ))}
                                </optgroup>
                                <optgroup label="Other Vehicles">
                                    {otherVehicles.map((o) => (
                                        <option key={o._id} value={o.vehicleNumber}>{o.vehicleNumber} ({o.type})</option>
                                    ))}
                                </optgroup>
                            </select>
                        </div>
                        <button
                            type="button"
                            onClick={() => switchTab(PAGE_TABS.raise)}
                            className="bg-emerald-700 text-white px-4 py-2 rounded text-sm font-bold flex items-center gap-2 hover:bg-emerald-800"
                        >
                            <Plus size={16} /> New Bill
                        </button>
                    </div>

                    {billsLoading ? (
                        <div className="py-20 flex justify-center"><Loader text="Fetching bills..." /></div>
                    ) : groupedBills.length > 0 ? (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-slate-50/50 text-left text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
                                        <th className="px-6 py-4">Bill Date</th>
                                        <th className="px-6 py-4">Bill No</th>
                                        <th className="px-6 py-4">Vendor & Bus</th>
                                        <th className="px-6 py-4">Items Summary</th>
                                        <th className="px-6 py-4">Total Amount</th>
                                        <th className="px-6 py-4 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {groupedBills.map((bill) => {
                                        const billKey = getBillKey(bill);
                                        const isExpanded = expandedBillKey === billKey;

                                        return (
                                            <React.Fragment key={billKey}>
                                                <tr className="hover:bg-slate-50 transition-colors group">
                                                    <td className="px-6 py-5 whitespace-nowrap">
                                                        <div className="flex items-center gap-2 text-slate-800 font-bold text-sm">
                                                            <Calendar size={14} className="text-slate-400" />
                                                            {new Date(bill.date).toLocaleDateString()}
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-5 whitespace-nowrap">
                                                        <span className="text-xs font-black text-blue-600 uppercase tracking-tighter">#{bill.billNo || 'N/A'}</span>
                                                    </td>
                                                    <td className="px-6 py-5">
                                                        <div className="flex flex-col">
                                                            <span className="font-bold text-slate-800 text-sm">{bill.vendorId?.name || 'Unknown'}</span>
                                                            <span className="text-[10px] text-slate-400 font-black uppercase mt-0.5">
                                                                Vehicle: {bill.busId?.vehicleNumber || bill.busId?.busNumber || 'N/A'}
                                                            </span>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-5">
                                                        <button
                                                            type="button"
                                                            onClick={() => setExpandedBillKey(isExpanded ? null : billKey)}
                                                            className="flex items-center gap-2 text-left text-xs font-bold text-slate-600 hover:text-blue-600 transition-colors"
                                                        >
                                                            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                                            <span>{bill.items.length} item(s)</span>
                                                        </button>
                                                    </td>
                                                    <td className="px-6 py-5">
                                                        <span className="font-black text-blue-700">₹{formatCurrency(bill.totalAmount)}</span>
                                                    </td>
                                                    <td className="px-6 py-5 text-right">
                                                        <div className="flex justify-end gap-1">
                                                            {canEditBills && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => openEditBill(bill)}
                                                                    className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-md transition-all"
                                                                    title="Edit Bill"
                                                                >
                                                                    <Edit size={16} />
                                                                </button>
                                                            )}
                                                            {canDeleteBills && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleDeleteBill(bill)}
                                                                    className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-all"
                                                                    title="Delete Bill"
                                                                >
                                                                    <Trash2 size={16} />
                                                                </button>
                                                            )}
                                                            <button
                                                                type="button"
                                                                onClick={() => handlePrint(bill)}
                                                                className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-all"
                                                                title="Print Full Bill"
                                                            >
                                                                <Printer size={16} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                                {isExpanded && (
                                                    <tr className="bg-slate-50/70">
                                                        <td colSpan={6} className="px-6 py-4">
                                                            <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
                                                                <table className="w-full text-left text-sm">
                                                                    <thead>
                                                                        <tr className="bg-slate-100 text-[10px] font-black uppercase text-slate-500 tracking-wider">
                                                                            <th className="px-4 py-3">Item</th>
                                                                            <th className="px-4 py-3 text-center">Qty</th>
                                                                            <th className="px-4 py-3 text-right">Price / Amount</th>
                                                                            <th className="px-4 py-3 text-center">GST %</th>
                                                                            <th className="px-4 py-3 text-right">Overall Price</th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody className="divide-y divide-slate-100">
                                                                        {bill.items.map((item, idx) => {
                                                                            const pricingMode = item.pricingMode || 'unitRate';
                                                                            const lineTotal = item.lineTotal != null
                                                                                ? item.lineTotal
                                                                                : getLineTotal(item.quantity, item.unitPrice ?? item.price, item.gstPercent);
                                                                            const amountLabel = pricingMode === 'lumpSum'
                                                                                ? item.amount ?? item.price
                                                                                : item.unitPrice ?? item.price;
                                                                            return (
                                                                                <tr key={item._id || item.allocationId || idx} className="text-slate-700">
                                                                                    <td className="px-4 py-3 font-semibold">
                                                                                        {getAllocatedItemDisplayName(item)}
                                                                                        {pricingMode === 'lumpSum' && (
                                                                                            <span className="ml-2 text-[10px] uppercase text-slate-400">Lump sum</span>
                                                                                        )}
                                                                                    </td>
                                                                                    <td className="px-4 py-3 text-center">{item.quantity}</td>
                                                                                    <td className="px-4 py-3 text-right">₹{formatCurrency(amountLabel)}</td>
                                                                                    <td className="px-4 py-3 text-center">
                                                                                        {bill.taxMode === 'none' ? '—' : `${item.gstPercent || 0}%`}
                                                                                    </td>
                                                                                    <td className="px-4 py-3 text-right font-bold text-blue-700">₹{formatCurrency(lineTotal)}</td>
                                                                                </tr>
                                                                            );
                                                                        })}
                                                                    </tbody>
                                                                    <tfoot>
                                                                        <tr className="bg-blue-50/60">
                                                                            <td colSpan={4} className="px-4 py-3 text-right text-xs font-black uppercase text-slate-500">Grand Total</td>
                                                                            <td className="px-4 py-3 text-right font-black text-blue-700">₹{formatCurrency(bill.totalAmount)}</td>
                                                                        </tr>
                                                                    </tfoot>
                                                                </table>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                            </React.Fragment>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="py-20 text-center text-slate-400">No bills available.</div>
                    )}
                </div>
            )}

            {pageTab === PAGE_TABS.raise && (
                <>
            {(loading || billLoading) && (
                <div className="py-20 flex justify-center"><Loader text={billLoading ? 'Loading bill...' : 'Loading form...'} /></div>
            )}

            {!loading && !billLoading && loadError && (
                <div className="max-w-xl mx-auto py-16 text-center space-y-4">
                    <AlertCircle className="mx-auto text-red-400" size={48} />
                    <p className="text-red-700 font-semibold">{loadError}</p>
                    <button
                        type="button"
                        onClick={() => switchTab(PAGE_TABS.view)}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-bold"
                    >
                        <History size={16} /> View Bills
                    </button>
                </div>
            )}

            {!loading && !billLoading && !loadError && (
                <form onSubmit={handleBillSubmit} className="flex flex-col gap-6">
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                        <div className="lg:col-span-8 space-y-6">
                            <div className="bg-gray-50 p-6 rounded-lg border border-gray-200 grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div>
                                    <label className="block text-xs font-bold text-gray-600 mb-2 uppercase">1. Select Vehicle</label>
                                    <select
                                        required
                                        className="w-full px-4 py-2.5 rounded border border-gray-300 bg-white font-medium text-gray-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                                        value={billFormData.busId}
                                        onChange={(e) => setBillFormData({ ...billFormData, busId: e.target.value })}
                                    >
                                        <option value="">-- Choose Vehicle --</option>
                                        <optgroup label="Buses">
                                            {buses.map((b) => (
                                                <option key={b._id} value={b.busNumber}>{b.busNumber} ({b.type})</option>
                                            ))}
                                        </optgroup>
                                        <optgroup label="Other Vehicles">
                                            {otherVehicles.map((o) => (
                                                <option key={o._id} value={o.vehicleNumber}>{o.vehicleNumber} ({o.type})</option>
                                            ))}
                                        </optgroup>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-600 mb-2 uppercase">2. Select Vendor</label>
                                    <select
                                        required
                                        className="w-full px-4 py-2.5 rounded border border-gray-300 bg-white font-medium text-gray-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                                        value={billFormData.vendorId}
                                        onChange={(e) => setBillFormData({ ...billFormData, vendorId: e.target.value })}
                                    >
                                        <option value="">-- Choose Vendor --</option>
                                        {vendors.map((v) => <option key={v._id} value={v._id}>{v.name}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-600 mb-2 uppercase">Bill Number</label>
                                    <input
                                        type="text"
                                        required
                                        placeholder="Invoice or Bill No"
                                        className="w-full px-4 py-2.5 rounded border border-gray-300 bg-white font-medium text-gray-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                                        value={billFormData.billNo}
                                        onChange={(e) => setBillFormData({ ...billFormData, billNo: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div className="bg-white p-4 rounded-lg border border-gray-200 grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div>
                                    <label className="block text-[11px] font-bold text-gray-500 mb-1.5 uppercase">Tax Mode</label>
                                    <select
                                        className="w-full px-3 py-2 rounded border border-gray-200 text-sm font-medium"
                                        value={billFormData.taxMode}
                                        onChange={(e) => setBillFormData({ ...billFormData, taxMode: e.target.value })}
                                    >
                                        <option value="none">No Tax</option>
                                        <option value="lineLevel">Per Line (GST %)</option>
                                        <option value="billLevel">On Bill Total</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-[11px] font-bold text-gray-500 mb-1.5 uppercase">Discount Mode</label>
                                    <select
                                        className="w-full px-3 py-2 rounded border border-gray-200 text-sm font-medium"
                                        value={billFormData.discountMode}
                                        onChange={(e) => setBillFormData({ ...billFormData, discountMode: e.target.value })}
                                    >
                                        <option value="none">No Discount</option>
                                        <option value="lineLevel">Per Line</option>
                                        <option value="billLevel">On Bill Total</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-[11px] font-bold text-gray-500 mb-1.5 uppercase">Grand Total Override</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        placeholder="Optional — match paper bill"
                                        className="w-full px-3 py-2 rounded border border-gray-200 text-sm font-medium"
                                        value={billFormData.grandTotalOverride}
                                        onChange={(e) => {
                                            const parsed = parsePriceInput(e.target.value);
                                            if (parsed === null) return;
                                            setBillFormData({ ...billFormData, grandTotalOverride: parsed });
                                        }}
                                    />
                                </div>
                                {billFormData.taxMode === 'billLevel' && (
                                    <>
                                        <div>
                                            <label className="block text-[11px] font-bold text-gray-500 mb-1.5 uppercase">CGST %</label>
                                            <input
                                                type="text"
                                                inputMode="decimal"
                                                className="w-full px-3 py-2 rounded border border-gray-200 text-sm"
                                                value={billFormData.billCgstPercent}
                                                onChange={(e) => {
                                                    const parsed = parseGstInput(e.target.value);
                                                    if (parsed === null) return;
                                                    setBillFormData({ ...billFormData, billCgstPercent: parsed });
                                                }}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-[11px] font-bold text-gray-500 mb-1.5 uppercase">SGST %</label>
                                            <input
                                                type="text"
                                                inputMode="decimal"
                                                className="w-full px-3 py-2 rounded border border-gray-200 text-sm"
                                                value={billFormData.billSgstPercent}
                                                onChange={(e) => {
                                                    const parsed = parseGstInput(e.target.value);
                                                    if (parsed === null) return;
                                                    setBillFormData({ ...billFormData, billSgstPercent: parsed });
                                                }}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-[11px] font-bold text-gray-500 mb-1.5 uppercase">Or Single GST %</label>
                                            <input
                                                type="text"
                                                inputMode="decimal"
                                                className="w-full px-3 py-2 rounded border border-gray-200 text-sm"
                                                value={billFormData.billGstPercent}
                                                onChange={(e) => {
                                                    const parsed = parseGstInput(e.target.value);
                                                    if (parsed === null) return;
                                                    setBillFormData({ ...billFormData, billGstPercent: parsed });
                                                }}
                                            />
                                        </div>
                                    </>
                                )}
                                {billFormData.discountMode === 'billLevel' && (
                                    <>
                                        <div>
                                            <label className="block text-[11px] font-bold text-gray-500 mb-1.5 uppercase">Bill Disc %</label>
                                            <input
                                                type="text"
                                                inputMode="decimal"
                                                className="w-full px-3 py-2 rounded border border-gray-200 text-sm"
                                                value={billFormData.discountPercent}
                                                onChange={(e) => {
                                                    const parsed = parseGstInput(e.target.value);
                                                    if (parsed === null) return;
                                                    setBillFormData({ ...billFormData, discountPercent: parsed });
                                                }}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-[11px] font-bold text-gray-500 mb-1.5 uppercase">Bill Disc Amount</label>
                                            <input
                                                type="text"
                                                inputMode="decimal"
                                                className="w-full px-3 py-2 rounded border border-gray-200 text-sm"
                                                value={billFormData.discountAmount}
                                                onChange={(e) => {
                                                    const parsed = parsePriceInput(e.target.value);
                                                    if (parsed === null) return;
                                                    setBillFormData({ ...billFormData, discountAmount: parsed });
                                                }}
                                            />
                                        </div>
                                    </>
                                )}
                                <div className="md:col-span-3">
                                    <label className="block text-[11px] font-bold text-gray-500 mb-1.5 uppercase">Notes / Grouped Description</label>
                                    <input
                                        type="text"
                                        placeholder="Optional free-text description for this bill"
                                        className="w-full px-3 py-2 rounded border border-gray-200 text-sm"
                                        value={billFormData.notes}
                                        onChange={(e) => setBillFormData({ ...billFormData, notes: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                                    <h4 className="text-sm font-bold text-gray-800 uppercase tracking-tight">3. Items to Allocate</h4>
                                    <span className="text-[10px] font-black bg-gray-900 text-white px-3 py-1 rounded-full uppercase">{billFormData.items.length} row(s)</span>
                                </div>

                                {billFormData.items.map((lineItem, index) => (
                                    <div key={index} className="relative p-6 bg-white rounded-lg border border-gray-200 shadow-sm transition-all mb-4 hover:border-blue-200">
                                        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-end">
                                            <div className="md:col-span-3">
                                                <label className="block text-[11px] font-bold text-gray-500 mb-1.5 uppercase tracking-wide">Select Category</label>
                                                <select
                                                    required
                                                    className="w-full px-4 py-2 rounded border border-gray-200 bg-white text-sm font-medium text-gray-700 focus:border-blue-500 outline-none"
                                                    value={lineItem.itemGroup}
                                                    onChange={(e) => handleBillGroupChange(index, e.target.value)}
                                                >
                                                    <option value="">-- Choose Category --</option>
                                                    {inventoryGroups.map((group) => (
                                                        <option key={group.key} value={group.itemName}>
                                                            {group.itemName} ({group.category})
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>

                                            <div className="md:col-span-3">
                                                <label className="block text-[11px] font-bold text-gray-500 mb-1.5 uppercase tracking-wide">Select Variant</label>
                                                <select
                                                    className="w-full px-4 py-2 rounded border border-gray-200 bg-white text-sm font-medium text-gray-700 focus:border-blue-500 outline-none disabled:bg-gray-50 disabled:text-gray-400"
                                                    value={lineItem.variantName}
                                                    disabled={!lineItem.itemGroup}
                                                    onChange={(e) => handleBillVariantChange(index, e.target.value)}
                                                >
                                                    <option value="">-- {lineItem.itemGroup ? 'No Variant / Base Item' : 'Choose Category First'} --</option>
                                                    {(getGroupByName(lineItem.itemGroup)?.variants || []).map((variant) => (
                                                        <option key={variant.name} value={variant.name}>
                                                            {variant.name}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>

                                            <div className="md:col-span-6 grid grid-cols-1 sm:grid-cols-4 gap-4">
                                                <div>
                                                    <label className="block text-[11px] font-bold text-gray-500 mb-1.5 uppercase tracking-wide">
                                                        Pricing
                                                    </label>
                                                    <select
                                                        className="w-full px-3 py-2 rounded border border-gray-200 bg-white text-sm font-medium"
                                                        value={lineItem.pricingMode || 'unitRate'}
                                                        onChange={(e) => updateBillItem(index, 'pricingMode', e.target.value)}
                                                    >
                                                        <option value="unitRate">Unit Rate</option>
                                                        <option value="lumpSum">Lump Sum</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="block text-[11px] font-bold text-gray-500 mb-1.5 uppercase tracking-wide">
                                                        Quantity {lineItem.itemId && `(${getSelectedInventoryItem(lineItem)?.unit || 'Pcs'})`}
                                                    </label>
                                                    <input
                                                        required
                                                        type="number"
                                                        min="0.1"
                                                        step="0.1"
                                                        className="w-full px-4 py-2 rounded border border-gray-200 bg-white text-sm font-medium"
                                                        value={lineItem.quantity}
                                                        onChange={(e) => handleQuantityChange(index, e.target.value)}
                                                        onWheel={preventNumberInputScroll}
                                                    />
                                                </div>
                                                {(lineItem.pricingMode || 'unitRate') === 'unitRate' ? (
                                                    <div>
                                                        <label className="block text-[11px] font-bold text-gray-500 mb-1.5 uppercase tracking-wide flex justify-between">
                                                            Unit Price
                                                            {lineItem.itemId && getLastPrice(lineItem.itemId) != null && (
                                                                <span className="text-blue-600 font-bold lowercase italic opacity-80">
                                                                    Last: ₹{getLastPrice(lineItem.itemId)}
                                                                </span>
                                                            )}
                                                        </label>
                                                        <div className="relative">
                                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs font-bold">₹</span>
                                                            <input
                                                                required
                                                                type="text"
                                                                inputMode="decimal"
                                                                placeholder="0.00"
                                                                className="w-full pl-7 pr-4 py-2 rounded border border-gray-200 bg-white text-sm font-medium"
                                                                value={lineItem.price}
                                                                onChange={(e) => handlePriceChange(index, e.target.value)}
                                                            />
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div>
                                                        <label className="block text-[11px] font-bold text-gray-500 mb-1.5 uppercase tracking-wide">
                                                            Lump Amount
                                                        </label>
                                                        <div className="relative">
                                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs font-bold">₹</span>
                                                            <input
                                                                required
                                                                type="text"
                                                                inputMode="decimal"
                                                                placeholder="0.00"
                                                                className="w-full pl-7 pr-4 py-2 rounded border border-gray-200 bg-white text-sm font-medium"
                                                                value={lineItem.amount}
                                                                onChange={(e) => {
                                                                    const parsed = parsePriceInput(e.target.value);
                                                                    if (parsed === null) return;
                                                                    updateBillItem(index, 'amount', parsed);
                                                                }}
                                                            />
                                                        </div>
                                                    </div>
                                                )}
                                                {billFormData.taxMode === 'lineLevel' && (
                                                    <div>
                                                        <label className="block text-[11px] font-bold text-gray-500 mb-1.5 uppercase tracking-wide">
                                                            GST %
                                                        </label>
                                                        <div className="relative">
                                                            <input
                                                                type="text"
                                                                inputMode="decimal"
                                                                placeholder="0"
                                                                className="w-full px-4 py-2 pr-8 rounded border border-gray-200 bg-white text-sm font-medium"
                                                                value={lineItem.gstPercent}
                                                                onChange={(e) => handleGstChange(index, e.target.value)}
                                                            />
                                                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs font-bold">%</span>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                            {billFormData.discountMode === 'lineLevel' && (
                                                <div className="md:col-span-12 grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
                                                    <div>
                                                        <label className="block text-[11px] font-bold text-gray-500 mb-1.5 uppercase">Line Disc %</label>
                                                        <input
                                                            type="text"
                                                            inputMode="decimal"
                                                            className="w-full px-3 py-2 rounded border border-gray-200 text-sm"
                                                            value={lineItem.discountPercent}
                                                            onChange={(e) => {
                                                                const parsed = parseGstInput(e.target.value);
                                                                if (parsed === null) return;
                                                                updateBillItem(index, 'discountPercent', parsed);
                                                            }}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="block text-[11px] font-bold text-gray-500 mb-1.5 uppercase">Line Disc Amount</label>
                                                        <input
                                                            type="text"
                                                            inputMode="decimal"
                                                            className="w-full px-3 py-2 rounded border border-gray-200 text-sm"
                                                            value={lineItem.discountAmount}
                                                            onChange={(e) => {
                                                                const parsed = parsePriceInput(e.target.value);
                                                                if (parsed === null) return;
                                                                updateBillItem(index, 'discountAmount', parsed);
                                                            }}
                                                        />
                                                    </div>
                                                </div>
                                            )}
                                            <div className="md:col-span-12 mt-2">
                                                <label className="block text-[11px] font-bold text-gray-500 mb-1.5 uppercase">Sub-descriptions (one per line)</label>
                                                <textarea
                                                    rows={2}
                                                    placeholder="e.g. Vehicle reg nos under a grouped service"
                                                    className="w-full px-3 py-2 rounded border border-gray-100 bg-gray-50/50 text-xs"
                                                    value={lineItem.subDescriptions || ''}
                                                    onChange={(e) => updateBillItem(index, 'subDescriptions', e.target.value)}
                                                />
                                            </div>
                                        </div>

                                        {lineItem.itemId && getSelectedInventoryItem(lineItem)?.category === 'Tires' && (
                                            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-gray-50 rounded border border-gray-100 italic">
                                                <div>
                                                    <label className="block text-[10px] font-bold text-gray-400 mb-1 uppercase">Position</label>
                                                    <select
                                                        className="w-full px-3 py-1.5 rounded border border-gray-200 text-xs bg-white font-bold"
                                                        value={lineItem.tyrePosition}
                                                        onChange={(e) => updateBillItem(index, 'tyrePosition', e.target.value)}
                                                    >
                                                        {TYRE_POSITIONS.map((p) => <option key={p} value={p}>{p.toUpperCase()}</option>)}
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="block text-[10px] font-bold text-gray-400 mb-1 uppercase">Type</label>
                                                    <select
                                                        className="w-full px-3 py-1.5 rounded border border-gray-200 text-xs bg-white font-bold"
                                                        value={lineItem.tyreType}
                                                        onChange={(e) => updateBillItem(index, 'tyreType', e.target.value)}
                                                    >
                                                        <option value="new tyre">New Tyre</option>
                                                        <option value="old tyre">Old Tyre</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="block text-[10px] font-bold text-gray-400 mb-1 uppercase">Reading (KM)</label>
                                                    <input
                                                        type="number"
                                                        className="w-full px-3 py-1.5 rounded border border-gray-200 text-xs bg-white font-bold"
                                                        value={lineItem.kmReading}
                                                        onChange={(e) => updateBillItem(index, 'kmReading', e.target.value)}
                                                    />
                                                </div>
                                            </div>
                                        )}

                                        <div className="mt-4 flex items-center gap-3">
                                            <div className="flex-1">
                                                <input
                                                    type="text"
                                                    placeholder="Add remarks for this item..."
                                                    className="w-full px-4 py-2 rounded border border-gray-100 bg-gray-50/50 text-xs text-gray-600 focus:bg-white transition-all outline-none focus:border-blue-200"
                                                    value={lineItem.remarks}
                                                    onChange={(e) => updateBillItem(index, 'remarks', e.target.value)}
                                                />
                                            </div>
                                            {billFormData.items.length > 1 && (
                                                <button
                                                    type="button"
                                                    onClick={() => removeBillItem(index)}
                                                    className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                                                    title="Remove this item"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                                <button
                                    type="button"
                                    onClick={addBillItem}
                                    className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded border-2 border-dashed border-gray-300 text-gray-400 font-bold hover:bg-gray-50 hover:border-gray-400 transition-all text-xs uppercase tracking-widest"
                                >
                                    <Plus size={16} /> Add Another Item Row
                                </button>
                            </div>
                        </div>

                        <div className="lg:col-span-4 sticky top-4 space-y-6">
                            <div className="bg-white rounded-lg border-2 border-blue-600 shadow-lg overflow-hidden flex flex-col max-h-[70vh]">
                                <div className="bg-blue-600 text-white p-4">
                                    <h3 className="text-xs font-black uppercase tracking-[0.2em] flex items-center gap-2">
                                        <History size={16} className="text-white/80" /> Bus Item History
                                    </h3>
                                    <p className="text-[10px] text-blue-100 mt-1 font-semibold">
                                        {billFormData.busId ? `Bus ${billFormData.busId}` : 'Select a bus to view assignment history'}
                                    </p>
                                </div>
                                <div className="flex-1 p-6 overflow-y-auto space-y-4">
                                    {historyLoading ? (
                                        <div className="py-8 flex justify-center"><Loader text="Loading history..." /></div>
                                    ) : !billFormData.busId ? (
                                        <div className="py-12 text-center text-gray-300 italic text-xs">
                                            Choose a bus first.
                                        </div>
                                    ) : getSelectedBillHistory().length > 0 ? (
                                        getSelectedBillHistory().map((record) => (
                                            <div key={record._id} className="border-b border-gray-100 pb-3">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <p className="text-xs font-black text-gray-800 truncate" title={getAllocatedItemDisplayName(record)}>
                                                            {getAllocatedItemDisplayName(record)}
                                                        </p>
                                                        <p className="text-[10px] text-gray-400 mt-1 font-semibold">
                                                            {new Date(record.allocatedDate).toLocaleDateString()} · Bill #{record.billNo || 'N/A'}
                                                        </p>
                                                        {record.remarks && (
                                                            <p className="text-[10px] text-gray-500 mt-1 italic line-clamp-2">{record.remarks}</p>
                                                        )}
                                                    </div>
                                                    <div className="text-right shrink-0">
                                                        <p className="text-xs font-black text-blue-700">{record.quantity} {record.itemId?.unit || 'Pcs'}</p>
                                                        <p className="text-[10px] text-gray-400">₹{record.price || 0}</p>
                                                    </div>
                                                </div>
                                            </div>
                                        ))
                                    ) : (
                                        <div className="py-12 text-center text-gray-300 italic text-xs">
                                            No previous assignment history for this bus.
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="sticky bottom-0 z-20 -mx-6 md:-mx-8 px-6 md:px-8 py-4 border-t border-blue-100 bg-slate-50/95 backdrop-blur-sm shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.12)]">
                        <div className="bg-blue-50/50 border border-blue-100 rounded-lg p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 flex-1 w-full">
                                <div className="text-center sm:text-left px-3 py-2 rounded-md bg-white/60 border border-blue-100">
                                    <p className="text-[10px] font-black uppercase text-blue-400 tracking-widest">Subtotal</p>
                                    <p className="text-lg font-black text-slate-700">₹{formatCurrency(billTotals.subtotal)}</p>
                                </div>
                                <div className="text-center sm:text-left px-3 py-2 rounded-md bg-white/60 border border-blue-100">
                                    <p className="text-[10px] font-black uppercase text-blue-400 tracking-widest">Discount</p>
                                    <p className="text-lg font-black text-slate-700">₹{formatCurrency(billTotals.discountTotal || 0)}</p>
                                </div>
                                <div className="text-center sm:text-left px-3 py-2 rounded-md bg-white/60 border border-blue-100">
                                    <p className="text-[10px] font-black uppercase text-blue-400 tracking-widest">Total Tax</p>
                                    <p className="text-lg font-black text-slate-700">₹{formatCurrency(billTotals.taxTotal ?? billTotals.gstTotal ?? 0)}</p>
                                </div>
                                <div className="text-center sm:text-left px-3 py-2 rounded-md bg-white border border-blue-200">
                                    <p className="text-[10px] font-black uppercase text-blue-500 tracking-widest">Grand Total</p>
                                    <p className="text-xl font-black text-blue-700 italic">₹{formatCurrency(billTotals.grandTotal)}</p>
                                </div>
                            </div>
                            <button
                                type="submit"
                                disabled={submitting}
                                className="lg:w-64 w-full bg-blue-600 text-white font-black py-4 rounded hover:bg-blue-700 transition-all shadow-lg active:scale-95 flex items-center justify-center gap-2 uppercase text-xs tracking-widest shrink-0 disabled:opacity-60"
                            >
                                <Truck size={18} /> {submitting ? 'Saving...' : (editingBill ? 'Update Bill' : 'Raise Bill')}
                            </button>
                        </div>
                    </div>
                </form>
            )}
                </>
            )}
        </Layout>
    );
};

export default RaiseBill;
