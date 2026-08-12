import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import Loader from '../components/Loader';
import {
    Plus, Trash2, History, Truck, Printer, AlertCircle,
    Edit, Calendar, ChevronDown, ChevronUp, Filter, FileText, ChevronRight, Package, User, Tag, Bus
} from 'lucide-react';
import BillPrint from '../components/BillPrint';
import { apiFetch, API_BASE } from '../utils/api';
import { printHtmlDocument } from '../utils/printHtml';
import { hasPermission } from '../utils/permissions';
import { computeBillTotals, getLineTotal } from '../utils/billCalculations';

const API = API_BASE;
const API_ORIGIN = String(API_BASE || '').replace(/\/api\/?$/, '');

const PAGE_TABS = { raise: 'raise', view: 'view' };

const getBillKey = (bill) => `${bill.billNo || 'no-bill'}-${bill._id || bill.items?.[0]?._id || bill.date}`;

const formatCurrency = (value) => Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
});

const formatCurrencyIndian = (num) => {
    if (!num) return '0';
    const parts = Math.round(num).toString().split(".");
    let lastThree = parts[0].substring(parts[0].length - 3);
    const otherBits = parts[0].substring(0, parts[0].length - 3);
    if (otherBits !== "") {
        lastThree = "," + lastThree;
    }
    const res = otherBits.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + lastThree;
    return res;
};

const TYRE_POSITIONS = [
    'front right',
    'front left',
    'back right',
    'back left',
    'rear left',
    'rear right'
];

const CATEGORIES = [
    'General',
    'Mechanical',
    'Electrical',
    'Tires',
    'Lubricants',
    'Body & Interior',
    'Safety',
    'Cleaning'
];

const getCategoryDisplayName = (cat) => {
    switch (cat) {
        case 'Mechanical': return 'Engine Parts';
        case 'Body & Interior': return 'Body Parts';
        case 'Tires': return 'Tyres';
        default: return cat;
    }
};

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
    busId: [],
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
    insuranceClaimAmount: '',
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
    if (Math.round(num * 10) !== num * 10) return null;
    return num;
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
        busId: vehicleNumber ? [vehicleNumber] : [],
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
        insuranceClaimAmount: bill.insuranceClaimAmount ?? '',
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
    const [hasLoadedDraft, setHasLoadedDraft] = useState(false);
    const [showActionModal, setShowActionModal] = useState(false);
    const [showPreviewModal, setShowPreviewModal] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const [printBill, setPrintBill] = useState(null);
    const [loadError, setLoadError] = useState('');
    const [selectedBusFilter, setSelectedBusFilter] = useState('all');
    const [expandedBillKey, setExpandedBillKey] = useState(null);
    const [isFormVehicleDropdownOpen, setIsFormVehicleDropdownOpen] = useState(false);

    const inventoryGroups = getInventoryGroups(items);

    const switchTab = (tab) => {
        setPageTab(tab);
        setShowActionModal(false);
        setShowPreviewModal(false);
        setErrorMsg('');
        if (tab === PAGE_TABS.view) {
            setSearchParams({ tab: 'view' });
        } else if (billIdParam || billNoParam) {
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

    useEffect(() => {
        if (!isFormVehicleDropdownOpen) return;
        const handleOutsideClick = (event) => {
            if (!event.target.closest('.form-vehicle-dropdown-container')) {
                setIsFormVehicleDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleOutsideClick);
        return () => {
            document.removeEventListener('mousedown', handleOutsideClick);
        };
    }, [isFormVehicleDropdownOpen]);

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

    // Restore draft from localStorage on initial load when master data finishes loading
    useEffect(() => {
        if (!loading && !isEditMode) {
            const adminInfo = JSON.parse(localStorage.getItem('adminInfo') || '{}');
            const username = adminInfo.username || adminInfo.name || 'guest';
            const savedDraft = localStorage.getItem(`bill_draft_new_${username}`);
            if (savedDraft) {
                try {
                    const parsed = JSON.parse(savedDraft);
                    if (parsed && typeof parsed === 'object') {
                        setBillFormData(parsed);
                        setHasLoadedDraft(true);
                    }
                } catch (e) {
                    console.error('Error parsing bill draft:', e);
                }
            }
        }
    }, [loading, isEditMode]);

    // Auto-save billFormData to localStorage when it changes
    useEffect(() => {
        if (loading || isEditMode) return;

        const isDefault = JSON.stringify(billFormData) === JSON.stringify(emptyBillFormData);
        if (isDefault) {
            const adminInfo = JSON.parse(localStorage.getItem('adminInfo') || '{}');
            const username = adminInfo.username || adminInfo.name || 'guest';
            localStorage.removeItem(`bill_draft_new_${username}`);
            return;
        }

        const adminInfo = JSON.parse(localStorage.getItem('adminInfo') || '{}');
        const username = adminInfo.username || adminInfo.name || 'guest';
        localStorage.setItem(`bill_draft_new_${username}`, JSON.stringify(billFormData));
    }, [billFormData, isEditMode, loading]);

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
        const activeBusId = Array.isArray(billFormData.busId) ? (billFormData.busId[0] || '') : (billFormData.busId || '');
        if (!activeBusId) {
            setHistory([]);
            return;
        }

        const fetchHistory = async () => {
            setHistoryLoading(true);
            try {
                const response = await apiFetch(`${API}/inventory/history/${encodeURIComponent(activeBusId)}`);
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
        fetchBillsList(activeBusId);
    }, [billFormData.busId]);

    // Sync bill-level discount when items or discount mode changes
    useEffect(() => {
        if (billFormData.discountMode === 'billLevel') {
            const currentTotals = computeBillTotals({
                taxMode: billFormData.taxMode,
                discountMode: billFormData.discountMode,
                discountAmount: billFormData.discountAmount,
                discountPercent: billFormData.discountPercent,
                items: billFormData.items.map((item) => ({
                    ...item,
                    pricingMode: item.pricingMode || 'unitRate',
                    unitPrice: item.price,
                    amount: item.amount
                }))
            });
            const subtotal = currentTotals.subtotal || 0;
            const pct = parseFloat(billFormData.discountPercent) || 0;
            const amt = parseFloat(billFormData.discountAmount) || 0;
            if (pct > 0 && subtotal > 0) {
                const calculatedAmt = Math.round((subtotal * pct / 100) * 100) / 100;
                if (String(calculatedAmt) !== billFormData.discountAmount) {
                    setBillFormData(prev => ({ ...prev, discountAmount: String(calculatedAmt) }));
                }
            } else if (amt > 0 && subtotal > 0) {
                const calculatedPct = Math.round((amt / subtotal * 100) * 100) / 100;
                if (String(calculatedPct) !== billFormData.discountPercent) {
                    setBillFormData(prev => ({ ...prev, discountPercent: String(calculatedPct) }));
                }
            }
        }
    }, [billFormData.items, billFormData.discountMode]);

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
        const item = { ...newItems[index], [field]: value };

        const getBase = (it) => {
            const pm = it.pricingMode === 'lumpSum' ? 'lumpSum' : 'unitRate';
            if (pm === 'lumpSum') {
                return parseFloat(it.amount) || 0;
            }
            return (parseInt(it.quantity, 10) || 0) * (parseFloat(it.price) || 0);
        };

        if (billFormData.discountMode === 'lineLevel') {
            const base = getBase(item);
            if (field === 'discountPercent') {
                if (value === '') {
                    item.discountAmount = '';
                } else {
                    const pct = parseFloat(value) || 0;
                    item.discountAmount = base > 0 ? String(Math.round((base * pct / 100) * 100) / 100) : '0';
                }
            } else if (field === 'discountAmount') {
                if (value === '') {
                    item.discountPercent = '';
                } else {
                    const amt = parseFloat(value) || 0;
                    item.discountPercent = base > 0 ? String(Math.round((amt / base * 100) * 100) / 100) : '0';
                }
            } else if (field === 'price' || field === 'quantity' || field === 'amount' || field === 'pricingMode') {
                const pct = parseFloat(item.discountPercent) || 0;
                const amt = parseFloat(item.discountAmount) || 0;
                if (pct > 0) {
                    item.discountAmount = base > 0 ? String(Math.round((base * pct / 100) * 100) / 100) : '0';
                } else if (amt > 0) {
                    item.discountPercent = base > 0 ? String(Math.round((amt / base * 100) * 100) / 100) : '0';
                }
            }
        }

        newItems[index] = item;
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

    const getSelectedInventoryItem = (lineItem) => {
        if (lineItem.itemId) return items.find((item) => item._id === lineItem.itemId);
        return null;
    };

    const getGroupByName = (name) => inventoryGroups.find((group) => group.itemName === name);

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

    const getCategoryItemsAndVariants = (category) => {
        const list = [];
        items.forEach(item => {
            if (category === 'all' || item.category === category) {
                const variants = getItemVariants(item);
                if (variants.length > 0) {
                    variants.forEach(v => {
                        list.push({
                            id: `${item._id}|${v.name}`,
                            itemId: item._id,
                            variantName: v.name,
                            displayName: `${item.itemName} - ${v.name}`,
                            unit: item.unit,
                            category: item.category
                        });
                    });
                } else {
                    list.push({
                        id: `${item._id}|`,
                        itemId: item._id,
                        variantName: '',
                        displayName: item.itemName,
                        unit: item.unit,
                        category: item.category
                    });
                }
            }
        });
        return list.sort((a, b) => a.displayName.localeCompare(b.displayName));
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
        insuranceClaimAmount: parseFloat(billFormData.insuranceClaimAmount) || 0,
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
        insuranceClaimAmount: billFormData.insuranceClaimAmount,
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
        const vehicleDisplayLabel = getFormattedVehicleLabel(billFormData.busId);
        const activeBusId = Array.isArray(billFormData.busId) ? (billFormData.busId[0] || '') : (billFormData.busId || '');
        const selectedBus = buses.find((bus) => bus.busNumber === activeBusId)
            || otherVehicles.find((v) => v.vehicleNumber === activeBusId);
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
            busId: (Array.isArray(billFormData.busId) && billFormData.busId.length > 1)
                ? { vehicleNumber: vehicleDisplayLabel, busNumber: vehicleDisplayLabel }
                : (selectedBus
                    ? { ...selectedBus, busNumber: selectedBus.busNumber || selectedBus.vehicleNumber }
                    : activeBusId),
            vehicleDisplayLabel,
            adminName: JSON.parse(localStorage.getItem('adminInfo') || '{}').name || 'Admin',
            taxMode: billFormData.taxMode,
            discountMode: billFormData.discountMode,
            taxes: buildBillTaxesPayload(),
            discountAmount: billFormData.discountAmount,
            discountPercent: billFormData.discountPercent,
            insuranceClaimAmount: billFormData.insuranceClaimAmount,
            notes: billFormData.notes,
            subtotal: totals.subtotal,
            discountTotal: totals.discountTotal,
            gstTotal: totals.taxTotal,
            taxTotal: totals.taxTotal,
            computedGrandTotal: totals.computedGrandTotal,
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

    const getFormattedVehicleLabel = (busIds) => {
        if (!busIds || (Array.isArray(busIds) && busIds.length === 0)) {
            return '-- Choose Vehicle --';
        }
        if (!Array.isArray(busIds)) {
            return busIds;
        }

        const totalVehiclesCount = buses.length + otherVehicles.length;

        if (totalVehiclesCount > 0 && busIds.length === totalVehiclesCount) {
            return `All Vehicles (${totalVehiclesCount} Vehicles)`;
        }
        
        if (buses.length > 0 && busIds.length === buses.length && buses.every((b) => busIds.includes(b.busNumber))) {
            return `All Buses (${buses.length} Buses)`;
        }

        if (otherVehicles.length > 0 && busIds.length === otherVehicles.length && otherVehicles.every((o) => busIds.includes(o.vehicleNumber))) {
            return `All Other Vehicles (${otherVehicles.length} Vehicles)`;
        }

        if (busIds.length <= 2) {
            return busIds.join(', ');
        }

        // Check if all selected are buses
        const selectedBusesCount = busIds.filter(id => buses.map(b => b.busNumber).includes(id)).length;
        if (selectedBusesCount === busIds.length) {
            return `${busIds.length} Buses Selected (${busIds.slice(0, 2).join(', ')}...)`;
        }

        return `${busIds.length} Vehicles Selected (${busIds.slice(0, 2).join(', ')}...)`;
    };

    const handleBillSubmit = (e) => {
        e.preventDefault();

        // 1. Run validation
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

        if (!billFormData.busId || billFormData.busId.length === 0) {
            alert('Please select at least one vehicle.');
            return;
        }

        // 2. Open confirmation modal
        setErrorMsg('');
        setShowActionModal(true);
    };

    const saveAndPrintBill = async () => {
        const adminInfo = JSON.parse(localStorage.getItem('adminInfo') || '{}');
        const isEditing = Boolean(editingBill?.originalBillNo || editingBill?.billId);
        const useIdPath = Boolean(editingBill?.billId);
        const url = isEditing
            ? (useIdPath
                ? `${API}/inventory/bills/by-id/${editingBill.billId}`
                : `${API}/inventory/update-bill`)
            : `${API}/inventory/bills`;
        const method = isEditing ? 'PUT' : 'POST';

        const vehiclesList = Array.isArray(billFormData.busId) ? billFormData.busId : [billFormData.busId].filter(Boolean);
        if (vehiclesList.length === 0) {
            alert('Please select at least one vehicle.');
            return;
        }

        setSubmitting(true);
        setErrorMsg('');
        try {
            let lastSavedBill = null;
            
            // Save all bills in parallel for maximum speed!
            const savePromises = vehiclesList.map(async (vehicleNo) => {
                const payload = buildHybridBillPayload(adminInfo.name || adminInfo.username || 'Admin');
                payload.busId = vehicleNo;
                
                if (isEditing && !useIdPath) {
                    payload.originalBillNo = editingBill.originalBillNo;
                }
                
                const response = await apiFetch(url, {
                    method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (!response.ok) {
                    const data = await response.json().catch(() => ({}));
                    throw new Error(data.message || `Failed to save bill for vehicle ${vehicleNo}`);
                }
                
                return response.json();
            });

            const results = await Promise.all(savePromises);
            lastSavedBill = results[results.length - 1]?.bill || null;

            // Compute printable data BEFORE resetting the form!
            let printableBill = null;
            if (lastSavedBill) {
                printableBill = {
                    ...buildPrintableBillData(),
                    ...lastSavedBill,
                    wasEdit: isEditing
                };
            }

            // Close modals
            setShowActionModal(false);
            setShowPreviewModal(false);

            // Reset form
            resetBillForm();
            
            // Clear draft
            const adminInfoLocal = JSON.parse(localStorage.getItem('adminInfo') || '{}');
            const usernameLocal = adminInfoLocal.username || adminInfoLocal.name || 'guest';
            localStorage.removeItem(`bill_draft_new_${usernameLocal}`);
            setHasLoadedDraft(false);
            
            // Switch tab and refresh list
            switchTab(PAGE_TABS.view);
            
            // Trigger print dialog
            if (printableBill) {
                await handlePrint(printableBill);
            }
        } catch (error) {
            console.error(isEditing ? 'Error updating:' : 'Error saving:', error);
            setErrorMsg(error.message || (isEditing ? 'Failed to save bill' : 'Failed to save bill'));
        } finally {
            setSubmitting(false);
        }
    };

    const pageTitle = editingBill?.originalBillNo
        ? `Edit Bill #${editingBill.originalBillNo}`
        : 'Raise Bill';

    const activeBusId = Array.isArray(billFormData.busId) ? (billFormData.busId[0] || '') : (billFormData.busId || '');
    const selectedVehicleObj = buses.find(b => b.busNumber === activeBusId)
        || otherVehicles.find(o => o.vehicleNumber === activeBusId);

    return (
        <Layout>
            {/* Title / Tab Switching capsule row */}
            <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-xl font-black text-slate-805 tracking-tight flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600 border border-blue-100 shrink-0">
                            <Truck size={18} />
                        </div>
                        {pageTab === PAGE_TABS.view ? 'View Bills' : pageTitle}
                    </h2>
                    <p className="text-slate-500 mt-0.5 text-[11px] font-semibold">
                        {pageTab === PAGE_TABS.view
                            ? 'Browse raised maintenance bills across the fleet.'
                            : (isEditMode
                                ? 'Update an existing maintenance bill and vehicle allocations.'
                                : 'Create a maintenance bill and allocate items to the selected vehicle.')}
                    </p>
                </div>
                <div className="flex items-center gap-2 shrink-0 self-start">
                    <button
                        type="button"
                        onClick={() => switchTab(PAGE_TABS.raise)}
                        className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all duration-200 cursor-pointer ${
                            pageTab === PAGE_TABS.raise
                                ? 'bg-[#2563EB] text-white shadow-md shadow-blue-500/20'
                                : 'bg-white text-slate-655 hover:text-slate-900 border border-slate-200 hover:bg-slate-50 shadow-sm'
                        }`}
                    >
                        <Truck size={13} /> Raise Bill
                    </button>
                    <button
                        type="button"
                        onClick={() => switchTab(PAGE_TABS.view)}
                        className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all duration-200 cursor-pointer ${
                            pageTab === PAGE_TABS.view
                                ? 'bg-[#2563EB] text-white shadow-md shadow-blue-500/20'
                                : 'bg-white text-slate-655 hover:text-slate-900 border border-slate-200 hover:bg-slate-50 shadow-sm'
                        }`}
                    >
                        <History size={13} /> View Bills
                    </button>
                </div>
            </div>

            {pageTab === PAGE_TABS.view && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 animate-in fade-in duration-200">
                    <div className="flex flex-col md:flex-row gap-4 justify-between items-center mb-5">
                        <div className="relative flex items-center bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 shrink-0">
                            <Filter size={14} className="text-slate-400 absolute left-3 pointer-events-none" />
                            <select
                                className="pl-6 pr-5 bg-transparent border-none outline-none text-xs font-bold text-slate-705 cursor-pointer appearance-none"
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
                            <ChevronDown size={13} className="text-slate-400 absolute right-3 pointer-events-none" />
                        </div>
                        <button
                            type="button"
                            onClick={() => switchTab(PAGE_TABS.raise)}
                            className="bg-[#2563EB] text-white px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 hover:bg-blue-700 shadow-sm transition-all active:scale-95 cursor-pointer"
                        >
                            <Plus size={14} /> New Bill
                        </button>
                    </div>

                    {billsLoading ? (
                        <div className="py-20 flex justify-center"><Loader text="Fetching bills..." /></div>
                    ) : groupedBills.length > 0 ? (
                        <div className="overflow-x-auto border border-slate-100 rounded-2xl">
                            <table className="w-full text-left border-collapse text-xs">
                                <thead>
                                    <tr className="bg-slate-50 border-b border-slate-100 text-[10px] uppercase text-slate-450 font-black tracking-wider">
                                        <th className="px-5 py-3 rounded-l-xl">Bill Date</th>
                                        <th className="px-5 py-3">Bill No</th>
                                        <th className="px-5 py-3">Vendor & Bus</th>
                                        <th className="px-5 py-3">Items Summary</th>
                                        <th className="px-5 py-3">Total Amount</th>
                                        <th className="px-5 py-3 text-right rounded-r-xl">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50 font-medium text-slate-700">
                                    {groupedBills.map((bill) => {
                                        const billKey = getBillKey(bill);
                                        const isExpanded = expandedBillKey === billKey;

                                        return (
                                            <React.Fragment key={billKey}>
                                                <tr className="hover:bg-slate-50/50 transition-colors">
                                                    <td className="px-5 py-3.5 whitespace-nowrap">
                                                        <div className="flex items-center gap-2 text-slate-800 font-bold">
                                                            <Calendar size={13} className="text-slate-400" />
                                                            {new Date(bill.date).toLocaleDateString()}
                                                        </div>
                                                    </td>
                                                    <td className="px-5 py-3.5 whitespace-nowrap font-black text-blue-600">
                                                        #{bill.billNo || 'N/A'}
                                                    </td>
                                                    <td className="px-5 py-3.5">
                                                        <div className="flex flex-col">
                                                            <span className="font-bold text-slate-800">{bill.vendorId?.name || 'Unknown'}</span>
                                                            <span className="text-[9px] text-slate-400 font-bold uppercase mt-0.5">
                                                                Vehicle: {bill.busId?.vehicleNumber || bill.busId?.busNumber || 'N/A'}
                                                            </span>
                                                        </div>
                                                    </td>
                                                    <td className="px-5 py-3.5">
                                                        <button
                                                            type="button"
                                                            onClick={() => setExpandedBillKey(isExpanded ? null : billKey)}
                                                            className="flex items-center gap-1.5 text-left font-bold text-slate-600 hover:text-blue-600 transition-colors cursor-pointer"
                                                        >
                                                            {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                                                            <span>{bill.items.length} item(s)</span>
                                                        </button>
                                                    </td>
                                                    <td className="px-5 py-3.5 font-bold text-blue-700 text-sm">
                                                        ₹{formatCurrency(bill.totalAmount)}
                                                    </td>
                                                    <td className="px-5 py-3.5 text-right">
                                                        <div className="flex justify-end gap-1">
                                                            {canEditBills && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => openEditBill(bill)}
                                                                    className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 border border-slate-200 bg-white rounded-lg transition-all shadow-sm cursor-pointer"
                                                                    title="Edit Bill"
                                                                >
                                                                    <Edit size={13} />
                                                                </button>
                                                            )}
                                                            {canDeleteBills && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleDeleteBill(bill)}
                                                                    className="p-1.5 text-slate-400 hover:text-red-655 hover:bg-red-50 border border-slate-200 bg-white rounded-lg transition-all shadow-sm cursor-pointer"
                                                                    title="Delete Bill"
                                                                >
                                                                    <Trash2 size={13} />
                                                                </button>
                                                            )}
                                                            <button
                                                                type="button"
                                                                onClick={() => handlePrint(bill)}
                                                                className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 border border-slate-200 bg-white rounded-lg transition-all shadow-sm cursor-pointer"
                                                                title="Print Full Bill"
                                                            >
                                                                <Printer size={13} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                                {isExpanded && (
                                                    <tr className="bg-slate-50/50">
                                                        <td colSpan={6} className="px-5 py-3">
                                                            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
                                                                <table className="w-full text-left text-xs font-semibold">
                                                                    <thead>
                                                                        <tr className="bg-slate-50 border-b border-slate-100 text-[10px] font-black uppercase text-slate-455 tracking-wider">
                                                                            <th className="px-4 py-2.5">Item</th>
                                                                            <th className="px-4 py-2.5 text-center">Qty</th>
                                                                            <th className="px-4 py-2.5 text-right">Price / Amount</th>
                                                                            <th className="px-4 py-2.5 text-center">GST %</th>
                                                                            <th className="px-4 py-2.5 text-right">Overall Price</th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody className="divide-y divide-slate-100 text-slate-750">
                                                                        {bill.items.map((item, idx) => {
                                                                            const pricingMode = item.pricingMode || 'unitRate';
                                                                            const lineTotal = item.lineTotal != null
                                                                                ? item.lineTotal
                                                                                : getLineTotal(item.quantity, item.unitPrice ?? item.price, item.gstPercent);
                                                                            const amountLabel = pricingMode === 'lumpSum'
                                                                                ? item.amount ?? item.price
                                                                                : item.unitPrice ?? item.price;
                                                                            return (
                                                                                <tr key={item._id || item.allocationId || idx}>
                                                                                    <td className="px-4 py-2.5 font-semibold">
                                                                                        {getAllocatedItemDisplayName(item)}
                                                                                        {pricingMode === 'lumpSum' && (
                                                                                            <span className="ml-2 text-[9px] uppercase text-slate-400 font-bold">Lump sum</span>
                                                                                        )}
                                                                                    </td>
                                                                                    <td className="px-4 py-2.5 text-center">{item.quantity}</td>
                                                                                    <td className="px-4 py-2.5 text-right">₹{formatCurrency(amountLabel)}</td>
                                                                                    <td className="px-4 py-2.5 text-center">
                                                                                        {bill.taxMode === 'none' ? '—' : `${item.gstPercent || 0}%`}
                                                                                    </td>
                                                                                    <td className="px-4 py-2.5 text-right font-black text-blue-700">₹{formatCurrency(lineTotal)}</td>
                                                                                </tr>
                                                                            );
                                                                        })}
                                                                    </tbody>
                                                                    <tfoot>
                                                                        <tr className="bg-blue-50/40 border-t border-blue-100">
                                                                            <td colSpan={4} className="px-4 py-2.5 text-right text-[10px] font-black uppercase text-slate-450 tracking-wider">Grand Total</td>
                                                                            <td className="px-4 py-2.5 text-right font-black text-blue-700 text-xs">₹{formatCurrency(bill.totalAmount)}</td>
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
                        <div className="py-20 text-center text-slate-400 bg-slate-50 rounded-lg border-2 border-dashed border-slate-100">
                            <AlertCircle className="mx-auto mb-3 opacity-20" size={48} />
                            <p className="font-medium">No bills available.</p>
                        </div>
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
                            <AlertCircle className="mx-auto text-red-400 opacity-80" size={48} />
                            <p className="text-red-700 font-bold">{loadError}</p>
                            <button
                                type="button"
                                onClick={() => switchTab(PAGE_TABS.view)}
                                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-all shadow-md cursor-pointer"
                            >
                                <History size={15} /> View Bills
                            </button>
                        </div>
                    )}

                    {!loading && !billLoading && !loadError && (
                        <form onSubmit={handleBillSubmit} className="animate-in fade-in duration-200">
                            {hasLoadedDraft && (
                                <div className="mb-4 flex items-center justify-between p-3.5 bg-blue-50/70 border border-blue-100 rounded-xl text-xs font-semibold text-blue-800 animate-in fade-in duration-200 shadow-sm">
                                    <div className="flex items-center gap-2">
                                        <AlertCircle size={15} className="text-blue-600 shrink-0" />
                                        <span>We restored a draft of this bill from your last session.</span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const adminInfo = JSON.parse(localStorage.getItem('adminInfo') || '{}');
                                            const username = adminInfo.username || adminInfo.name || 'guest';
                                            localStorage.removeItem(`bill_draft_new_${username}`);
                                            resetBillForm();
                                            setHasLoadedDraft(false);
                                        }}
                                        className="text-blue-600 hover:text-blue-700 font-extrabold underline cursor-pointer bg-transparent border-none outline-none"
                                    >
                                        Clear Draft
                                    </button>
                                </div>
                            )}
                            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                                {/* Left Side Form Container */}
                                <div className="lg:col-span-8 space-y-5">
                                    {/* 1. Basic Details Card */}
                                    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
                                        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2.5">
                                            <span className="text-blue-600 font-black">1.</span> Basic Details
                                        </h3>
                                        
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                            <div>
                                                <label className="block text-[9px] font-black uppercase text-slate-400 mb-1 tracking-wider">Select Vehicle *</label>
                                                <div className="relative form-vehicle-dropdown-container">
                                                    <Bus size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 z-10 pointer-events-none" />
                                                    <button
                                                        type="button"
                                                        onClick={() => setIsFormVehicleDropdownOpen(!isFormVehicleDropdownOpen)}
                                                        className="w-full pl-9 pr-8 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 focus:ring-4 focus:ring-blue-50 focus:border-blue-500 outline-none transition-all cursor-pointer text-left flex items-center justify-between min-h-[34px]"
                                                    >
                                                        <span className="truncate">
                                                            {getFormattedVehicleLabel(billFormData.busId)}
                                                        </span>
                                                        <ChevronDown size={13} className="text-slate-400 shrink-0 pointer-events-none" />
                                                    </button>
                                                    {isFormVehicleDropdownOpen && (
                                                        <div className="absolute left-0 right-0 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-xl z-50 p-2.5 max-h-72 overflow-y-auto space-y-2.5 animate-in fade-in slide-in-from-top-1 duration-150">
                                                            {/* Buses Section */}
                                                            {buses.length > 0 && (
                                                                <div className="space-y-1">
                                                                    <div className="flex items-center justify-between px-2 py-1 border-b border-slate-100 mb-1">
                                                                        <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Buses</span>
                                                                        <label className="flex items-center gap-1.5 cursor-pointer text-[10px] font-bold text-blue-600 hover:text-blue-700">
                                                                            <input
                                                                                type="checkbox"
                                                                                checked={buses.length > 0 && buses.every((b) => billFormData.busId.includes(b.busNumber))}
                                                                                onChange={(e) => {
                                                                                    const busNumbers = buses.map(b => b.busNumber).filter(Boolean);
                                                                                    const otherSelected = billFormData.busId.filter(id => !busNumbers.includes(id));
                                                                                    if (e.target.checked) {
                                                                                        setBillFormData({
                                                                                            ...billFormData,
                                                                                            busId: [...otherSelected, ...busNumbers]
                                                                                        });
                                                                                    } else {
                                                                                        setBillFormData({
                                                                                            ...billFormData,
                                                                                            busId: otherSelected
                                                                                        });
                                                                                    }
                                                                                }}
                                                                                className="rounded text-blue-600 focus:ring-blue-500 border-slate-300 w-3.5 h-3.5 cursor-pointer"
                                                                            />
                                                                            <span>Select All</span>
                                                                        </label>
                                                                    </div>
                                                                    {buses.map((b) => {
                                                                        const isChecked = billFormData.busId.includes(b.busNumber);
                                                                        return (
                                                                            <label key={b._id} className="flex items-center gap-2 px-2.5 py-1 hover:bg-slate-50 rounded-lg cursor-pointer text-xs font-bold text-slate-700">
                                                                                <input
                                                                                    type="checkbox"
                                                                                    checked={isChecked}
                                                                                    onChange={() => {
                                                                                        const updated = isChecked
                                                                                            ? billFormData.busId.filter(id => id !== b.busNumber)
                                                                                            : [...billFormData.busId, b.busNumber];
                                                                                        setBillFormData({ ...billFormData, busId: updated });
                                                                                    }}
                                                                                    className="rounded text-blue-600 focus:ring-blue-500 border-slate-300 w-3.5 h-3.5 cursor-pointer"
                                                                                />
                                                                                <span>{b.busNumber} ({b.type})</span>
                                                                            </label>
                                                                        );
                                                                    })}
                                                                </div>
                                                            )}

                                                            {/* Other Vehicles Section */}
                                                            {otherVehicles.length > 0 && (
                                                                <div className="space-y-1">
                                                                    <div className="flex items-center justify-between px-2 py-1 border-b border-slate-100 mb-1">
                                                                        <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Other Vehicles</span>
                                                                        <label className="flex items-center gap-1.5 cursor-pointer text-[10px] font-bold text-blue-600 hover:text-blue-700">
                                                                            <input
                                                                                type="checkbox"
                                                                                checked={otherVehicles.length > 0 && otherVehicles.every((o) => billFormData.busId.includes(o.vehicleNumber))}
                                                                                onChange={(e) => {
                                                                                    const otherNumbers = otherVehicles.map(o => o.vehicleNumber).filter(Boolean);
                                                                                    const busesSelected = billFormData.busId.filter(id => !otherNumbers.includes(id));
                                                                                    if (e.target.checked) {
                                                                                        setBillFormData({
                                                                                            ...billFormData,
                                                                                            busId: [...busesSelected, ...otherNumbers]
                                                                                        });
                                                                                    } else {
                                                                                        setBillFormData({
                                                                                            ...billFormData,
                                                                                            busId: busesSelected
                                                                                        });
                                                                                    }
                                                                                }}
                                                                                className="rounded text-blue-600 focus:ring-blue-500 border-slate-300 w-3.5 h-3.5 cursor-pointer"
                                                                            />
                                                                            <span>Select All</span>
                                                                        </label>
                                                                    </div>
                                                                    {otherVehicles.map((o) => {
                                                                        const isChecked = billFormData.busId.includes(o.vehicleNumber);
                                                                        return (
                                                                            <label key={o._id} className="flex items-center gap-2 px-2.5 py-1 hover:bg-slate-50 rounded-lg cursor-pointer text-xs font-bold text-slate-700">
                                                                                <input
                                                                                    type="checkbox"
                                                                                    checked={isChecked}
                                                                                    onChange={() => {
                                                                                        const updated = isChecked
                                                                                            ? billFormData.busId.filter(id => id !== o.vehicleNumber)
                                                                                            : [...billFormData.busId, o.vehicleNumber];
                                                                                        setBillFormData({ ...billFormData, busId: updated });
                                                                                    }}
                                                                                    className="rounded text-blue-600 focus:ring-blue-500 border-slate-300 w-3.5 h-3.5 cursor-pointer"
                                                                                />
                                                                                <span>{o.vehicleNumber} ({o.type})</span>
                                                                            </label>
                                                                        );
                                                                    })}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            <div>
                                                <label className="block text-[9px] font-black uppercase text-slate-400 mb-1 tracking-wider">Select Vendor *</label>
                                                <div className="relative">
                                                    <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                                    <select
                                                        required
                                                        className="w-full pl-9 pr-6 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 focus:ring-4 focus:ring-blue-50 focus:border-blue-500 outline-none transition-all cursor-pointer appearance-none"
                                                        value={billFormData.vendorId}
                                                        onChange={(e) => setBillFormData({ ...billFormData, vendorId: e.target.value })}
                                                    >
                                                        <option value="">-- Choose Vendor --</option>
                                                        {vendors.map((v) => <option key={v._id} value={v._id}>{v.name}</option>)}
                                                    </select>
                                                    <ChevronDown size={13} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                                </div>
                                            </div>

                                            <div>
                                                <label className="block text-[9px] font-black uppercase text-slate-400 mb-1 tracking-wider">Bill / Invoice No *</label>
                                                <div className="relative">
                                                    <FileText size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                                    <input
                                                        type="text"
                                                        required
                                                        placeholder="Invoice / Bill No"
                                                        className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 focus:ring-4 focus:ring-blue-50 focus:border-blue-500 outline-none transition-all"
                                                        value={billFormData.billNo}
                                                        onChange={(e) => setBillFormData({ ...billFormData, billNo: e.target.value })}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 border-t border-slate-50 pt-3.5">
                                            <div>
                                                <label className="block text-[9px] font-black uppercase text-slate-400 mb-1 tracking-wider">Tax Mode</label>
                                                <div className="relative">
                                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-black">%</span>
                                                    <select
                                                        className="w-full pl-9 pr-6 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 focus:ring-4 focus:ring-blue-50 focus:border-blue-500 outline-none transition-all cursor-pointer appearance-none"
                                                        value={billFormData.taxMode}
                                                        onChange={(e) => setBillFormData({ ...billFormData, taxMode: e.target.value })}
                                                    >
                                                        <option value="none">No Tax</option>
                                                        <option value="lineLevel">Per Line (GST %)</option>
                                                        <option value="billLevel">On Bill Total</option>
                                                    </select>
                                                    <ChevronDown size={13} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                                </div>
                                            </div>

                                            <div>
                                                <label className="block text-[9px] font-black uppercase text-slate-400 mb-1 tracking-wider">Discount Mode</label>
                                                <div className="relative">
                                                    <Tag size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                                    <select
                                                        className="w-full pl-9 pr-6 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 focus:ring-4 focus:ring-blue-50 focus:border-blue-500 outline-none transition-all cursor-pointer appearance-none"
                                                        value={billFormData.discountMode}
                                                        onChange={(e) => setBillFormData({ ...billFormData, discountMode: e.target.value })}
                                                    >
                                                        <option value="none">No Discount</option>
                                                        <option value="lineLevel">Per Line</option>
                                                        <option value="billLevel">On Bill Total</option>
                                                    </select>
                                                    <ChevronDown size={13} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                                </div>
                                            </div>

                                            <div>
                                                <label className="block text-[9px] font-black uppercase text-slate-400 mb-1 tracking-wider">Grand Total Override</label>
                                                <div className="relative">
                                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-bold">₹</span>
                                                    <input
                                                        type="text"
                                                        inputMode="decimal"
                                                        placeholder="Match paper bill"
                                                        className="w-full pl-7 pr-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-705 focus:ring-4 focus:ring-blue-50 focus:border-blue-500 outline-none transition-all"
                                                        value={billFormData.grandTotalOverride}
                                                        onChange={(e) => {
                                                            const parsed = parsePriceInput(e.target.value);
                                                            if (parsed === null) return;
                                                            setBillFormData({ ...billFormData, grandTotalOverride: parsed });
                                                        }}
                                                    />
                                                </div>
                                            </div>

                                            <div>
                                                <label className="block text-[9px] font-black uppercase text-slate-400 mb-1 tracking-wider">Insurance Claim / Adjustment</label>
                                                <div className="relative">
                                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-bold">₹</span>
                                                    <input
                                                        type="text"
                                                        inputMode="decimal"
                                                        placeholder="Deducted from total"
                                                        className="w-full pl-7 pr-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-705 focus:ring-4 focus:ring-blue-50 focus:border-blue-500 outline-none transition-all"
                                                        value={billFormData.insuranceClaimAmount}
                                                        onChange={(e) => {
                                                            const parsed = parsePriceInput(e.target.value);
                                                            if (parsed === null) return;
                                                            setBillFormData({ ...billFormData, insuranceClaimAmount: parsed });
                                                        }}
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        {billFormData.taxMode === 'billLevel' && (
                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-slate-50 pt-3.5">
                                                <div>
                                                    <label className="block text-[9px] font-black uppercase text-slate-400 mb-1 tracking-wider">CGST %</label>
                                                    <input
                                                        type="text"
                                                        inputMode="decimal"
                                                        className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 outline-none focus:ring-4 focus:ring-blue-50 focus:border-blue-500 transition-all"
                                                        value={billFormData.billCgstPercent}
                                                        onChange={(e) => {
                                                            const parsed = parseGstInput(e.target.value);
                                                            if (parsed === null) return;
                                                            setBillFormData({ ...billFormData, billCgstPercent: parsed });
                                                        }}
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-[9px] font-black uppercase text-slate-400 mb-1 tracking-wider">SGST %</label>
                                                    <input
                                                        type="text"
                                                        inputMode="decimal"
                                                        className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 outline-none focus:ring-4 focus:ring-blue-50 focus:border-blue-500 transition-all"
                                                        value={billFormData.billSgstPercent}
                                                        onChange={(e) => {
                                                            const parsed = parseGstInput(e.target.value);
                                                            if (parsed === null) return;
                                                            setBillFormData({ ...billFormData, billSgstPercent: parsed });
                                                        }}
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-[9px] font-black uppercase text-slate-400 mb-1 tracking-wider">Single GST %</label>
                                                    <input
                                                        type="text"
                                                        inputMode="decimal"
                                                        className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 outline-none focus:ring-4 focus:ring-blue-50 focus:border-blue-500 transition-all"
                                                        value={billFormData.billGstPercent}
                                                        onChange={(e) => {
                                                            const parsed = parseGstInput(e.target.value);
                                                            if (parsed === null) return;
                                                            setBillFormData({ ...billFormData, billGstPercent: parsed });
                                                        }}
                                                    />
                                                </div>
                                            </div>
                                        )}

                                        {billFormData.discountMode === 'billLevel' && (
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-slate-50 pt-3.5">
                                                <div>
                                                    <label className="block text-[9px] font-black uppercase text-slate-400 mb-1 tracking-wider">Bill Disc %</label>
                                                    <input
                                                        type="text"
                                                        inputMode="decimal"
                                                        className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 outline-none focus:ring-4 focus:ring-blue-50 focus:border-blue-500 transition-all"
                                                        value={billFormData.discountPercent}
                                                        onChange={(e) => {
                                                            const parsed = parseGstInput(e.target.value);
                                                            if (parsed === null) return;
                                                            if (parsed === '') {
                                                                setBillFormData({ ...billFormData, discountPercent: '', discountAmount: '' });
                                                            } else {
                                                                const pct = parseFloat(parsed) || 0;
                                                                const subtotal = billTotals.subtotal || 0;
                                                                const amt = subtotal > 0 ? Math.round((subtotal * pct / 100) * 100) / 100 : 0;
                                                                setBillFormData({ ...billFormData, discountPercent: parsed, discountAmount: String(amt) });
                                                            }
                                                        }}
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-[9px] font-black uppercase text-slate-400 mb-1 tracking-wider">Bill Disc Amount</label>
                                                    <input
                                                        type="text"
                                                        inputMode="decimal"
                                                        className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-705 outline-none focus:ring-4 focus:ring-blue-50 focus:border-blue-500 transition-all"
                                                        value={billFormData.discountAmount}
                                                        onChange={(e) => {
                                                            const parsed = parsePriceInput(e.target.value);
                                                            if (parsed === null) return;
                                                            if (parsed === '') {
                                                                setBillFormData({ ...billFormData, discountAmount: '', discountPercent: '' });
                                                            } else {
                                                                const amt = parseFloat(parsed) || 0;
                                                                const subtotal = billTotals.subtotal || 0;
                                                                const pct = subtotal > 0 ? Math.round((amt / subtotal * 100) * 100) / 100 : 0;
                                                                setBillFormData({ ...billFormData, discountAmount: parsed, discountPercent: String(pct) });
                                                            }
                                                        }}
                                                    />
                                                </div>
                                            </div>
                                        )}

                                        <div className="border-t border-slate-50 pt-3.5">
                                            <label className="block text-[9px] font-black uppercase text-slate-400 mb-1 tracking-wider">Notes / Description</label>
                                            <textarea
                                                rows="2"
                                                maxLength="200"
                                                placeholder="Add notes or remarks for this bill..."
                                                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 outline-none focus:ring-4 focus:ring-blue-50 focus:border-blue-500 transition-all"
                                                value={billFormData.notes}
                                                onChange={(e) => setBillFormData({ ...billFormData, notes: e.target.value })}
                                            />
                                            <div className="text-right text-[8px] text-slate-400 font-bold mt-0.5">
                                                {billFormData.notes?.length || 0} / 200
                                            </div>
                                        </div>
                                    </div>

                                    {/* 2. Items to Allocate Card */}
                                    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
                                        <div className="flex items-center justify-between border-b border-slate-55 pb-2.5">
                                            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                                                <span className="text-blue-600 font-black">2.</span> Items to Allocate
                                            </h3>
                                            <div className="flex items-center gap-2">
                                                <span className="text-[9px] font-black bg-slate-100 text-slate-650 px-2 py-0.5 rounded border border-slate-200 uppercase">
                                                    {billFormData.items.length} Row(s)
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={addBillItem}
                                                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#2563EB] hover:bg-blue-750 text-white text-[9px] font-bold uppercase transition-all shadow-sm cursor-pointer active:scale-95 animate-in fade-in"
                                                >
                                                    <Plus size={11} /> Add Row
                                                </button>
                                            </div>
                                        </div>

                                        <div className="overflow-x-auto">
                                            <table className="w-full text-left border-collapse text-xs font-semibold">
                                                <thead>
                                                    <tr className="border-b border-slate-100 text-[9px] uppercase text-slate-400 font-black tracking-wider bg-slate-50/50">
                                                        <th className="px-1 py-2 w-6">#</th>
                                                        <th className="px-3 py-2">Category *</th>
                                                        <th className="px-3 py-2">Variant / Item *</th>
                                                        <th className="px-3 py-2 w-28">Qty *</th>
                                                        <th className="px-3 py-2 w-28">Mode</th>
                                                        <th className="px-3 py-2">Unit Price / Amt (₹)</th>
                                                        {billFormData.taxMode === 'lineLevel' && <th className="px-3 py-2 w-20">GST %</th>}
                                                        <th className="px-3 py-2 text-right">Amount (₹)</th>
                                                        <th className="px-3 py-2 text-right w-10">Action</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-50">
                                                    {billFormData.items.map((lineItem, index) => {
                                                        const lineTotal = billTotals.lines[index]?.lineTotal || 0;
                                                        const isTire = lineItem.itemId && getSelectedInventoryItem(lineItem)?.category === 'Tires';
                                                        const isLineDiscount = billFormData.discountMode === 'lineLevel';
                                                        const lastRowClass = (!isLineDiscount && !isTire) ? "border-b-4 border-slate-100" : "";
                                                        
                                                        return (
                                                            <React.Fragment key={index}>
                                                                <tr className={`hover:bg-slate-50/55 transition-colors ${lastRowClass}`}>
                                                                    <td className="px-1 py-2 text-center">
                                                                        <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center text-[9px] font-black border border-slate-200 shadow-sm mx-auto">
                                                                            {index + 1}
                                                                        </span>
                                                                    </td>
                                                                                                                      <td className="px-2 py-2">
                                                                        <select
                                                                            required
                                                                            className="w-full pl-2.5 pr-6 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-705 focus:ring-4 focus:ring-blue-50 focus:border-blue-500 outline-none transition-all cursor-pointer"
                                                                            value={lineItem.itemGroup}
                                                                            onChange={(e) => handleBillGroupChange(index, e.target.value)}
                                                                        >
                                                                            <option value="">-- Choose Item --</option>
                                                                            {inventoryGroups.map((group) => (
                                                                                <option key={group.key} value={group.itemName}>
                                                                                    {group.itemName} ({getCategoryDisplayName(group.category)})
                                                                                </option>
                                                                            ))}
                                                                        </select>
                                                                    </td>
 
                                                                    <td className="px-2 py-2">
                                                                        <select
                                                                            className="w-full pl-2.5 pr-6 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-705 focus:ring-4 focus:ring-blue-50 focus:border-blue-500 outline-none transition-all cursor-pointer disabled:bg-slate-50 disabled:text-slate-400"
                                                                            value={lineItem.variantName}
                                                                            onChange={(e) => handleBillVariantChange(index, e.target.value)}
                                                                        >
                                                                            <option value="">-- {lineItem.itemGroup ? 'Base Variant / No Variant' : 'Choose Item First'} --</option>
                                                                            {(getGroupByName(lineItem.itemGroup)?.variants || []).map((variant) => (
                                                                                <option key={variant.name} value={variant.name}>
                                                                                    {variant.name}
                                                                                </option>
                                                                            ))}
                                                                        </select>
                                                                    </td>

                                                                    <td className="px-2 py-2">
                                                                        <div className="flex items-center border border-slate-200 rounded-xl overflow-hidden bg-white max-w-[95px] shadow-sm">
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => {
                                                                                    const currentVal = parseFloat(lineItem.quantity) || 0;
                                                                                    if (currentVal > 1) {
                                                                                        const nextVal = Math.round((currentVal - 1) * 10) / 10;
                                                                                        updateBillItem(index, 'quantity', nextVal);
                                                                                    } else if (currentVal > 0.1) {
                                                                                        const nextVal = Math.max(0.1, Math.round((currentVal - 1) * 10) / 10);
                                                                                        if (nextVal !== currentVal) {
                                                                                            updateBillItem(index, 'quantity', nextVal);
                                                                                        }
                                                                                    }
                                                                                }}
                                                                                className="px-2 py-1.5 hover:bg-slate-50 text-slate-400 font-extrabold transition-colors cursor-pointer text-[10px] shrink-0 select-none border-r border-slate-100"
                                                                            >
                                                                                —
                                                                            </button>
                                                                            <input
                                                                                required
                                                                                type="text"
                                                                                inputMode="decimal"
                                                                                className="w-full text-center py-1.5 text-[11px] font-bold text-slate-700 bg-transparent border-none outline-none appearance-none select-none shrink"
                                                                                value={lineItem.quantity}
                                                                                onChange={(e) => handleQuantityChange(index, e.target.value)}
                                                                                onWheel={preventNumberInputScroll}
                                                                            />
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => {
                                                                                    const currentVal = parseFloat(lineItem.quantity) || 0;
                                                                                    const nextVal = Math.round((currentVal + 1) * 10) / 10;
                                                                                    updateBillItem(index, 'quantity', nextVal);
                                                                                }}
                                                                                className="px-2 py-1.5 hover:bg-slate-50 text-slate-400 font-extrabold transition-colors cursor-pointer text-[10px] shrink-0 select-none border-l border-slate-100"
                                                                            >
                                                                                +
                                                                            </button>
                                                                        </div>
                                                                    </td>

                                                                    <td className="px-2 py-2 w-28">
                                                                        <select
                                                                            className="w-full px-2 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-705 focus:ring-4 focus:ring-blue-50 focus:border-blue-500 outline-none transition-all cursor-pointer"
                                                                            value={lineItem.pricingMode || 'unitRate'}
                                                                            onChange={(e) => updateBillItem(index, 'pricingMode', e.target.value)}
                                                                        >
                                                                            <option value="unitRate">Unit Rate</option>
                                                                            <option value="lumpSum">Lump Sum</option>
                                                                        </select>
                                                                    </td>

                                                                    <td className="px-2 py-2">
                                                                        {(lineItem.pricingMode || 'unitRate') === 'unitRate' ? (
                                                                            <div className="relative">
                                                                                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[10px] font-bold">₹</span>
                                                                                <input
                                                                                    required
                                                                                    type="text"
                                                                                    inputMode="decimal"
                                                                                    placeholder="0.00"
                                                                                    className="w-full pl-5 pr-2 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-705 outline-none focus:ring-4 focus:ring-blue-50 focus:border-blue-500 transition-all"
                                                                                    value={lineItem.price}
                                                                                    onChange={(e) => handlePriceChange(index, e.target.value)}
                                                                                />
                                                                            </div>
                                                                        ) : (
                                                                            <div className="relative">
                                                                                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[10px] font-bold">₹</span>
                                                                                <input
                                                                                    required
                                                                                    type="text"
                                                                                    inputMode="decimal"
                                                                                    placeholder="0.00"
                                                                                    className="w-full pl-5 pr-2 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-705 outline-none focus:ring-4 focus:ring-blue-50 focus:border-blue-500 transition-all"
                                                                                    value={lineItem.amount}
                                                                                    onChange={(e) => {
                                                                                        const parsed = parsePriceInput(e.target.value);
                                                                                        if (parsed === null) return;
                                                                                        updateBillItem(index, 'amount', parsed);
                                                                                    }}
                                                                                />
                                                                            </div>
                                                                        )}
                                                                    </td>

                                                                    {billFormData.taxMode === 'lineLevel' && (
                                                                        <td className="px-2 py-2">
                                                                            <div className="relative">
                                                                                <input
                                                                                    type="text"
                                                                                    inputMode="decimal"
                                                                                    placeholder="0"
                                                                                    className="w-full pr-5 pl-2.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-705 outline-none focus:ring-4 focus:ring-blue-50 focus:border-blue-500 transition-all text-right"
                                                                                    value={lineItem.gstPercent}
                                                                                    onChange={(e) => {
                                                                                        const parsed = parseGstInput(e.target.value);
                                                                                        if (parsed === null) return;
                                                                                        updateBillItem(index, 'gstPercent', parsed);
                                                                                    }}
                                                                                />
                                                                                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 text-[10px] font-bold pointer-events-none">%</span>
                                                                            </div>
                                                                        </td>
                                                                    )}

                                                                    <td className="px-3 py-2 text-right font-black text-slate-805 text-xs">
                                                                        ₹{formatCurrency(lineTotal)}
                                                                    </td>

                                                                    <td className="px-3 py-2 text-right">
                                                                        {billFormData.items.length > 1 && (
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => removeBillItem(index)}
                                                                                className="p-1.5 text-slate-400 hover:text-red-655 hover:bg-red-50 rounded-lg transition-all border border-slate-200 bg-white shadow-sm cursor-pointer"
                                                                                title="Remove row"
                                                                            >
                                                                                <Trash2 size={12} />
                                                                            </button>
                                                                        )}
                                                                    </td>
                                                                </tr>
                                                                {billFormData.discountMode === 'lineLevel' && (
                                                                    <tr className={`bg-slate-50/20 ${isTire ? "border-b border-slate-100/50" : "border-b-4 border-slate-100"}`}>
                                                                        <td colSpan={8 + (billFormData.taxMode === 'lineLevel' ? 1 : 0)} className="px-5 py-2">
                                                                            <div className="flex flex-col sm:flex-row sm:items-center gap-3 w-full border-l-2 border-blue-500 pl-3">
                                                                                <span className="text-[9px] font-black text-slate-800 uppercase tracking-wider shrink-0">Line Discount:</span>
                                                                                <div className="grid grid-cols-2 gap-3 flex-1 w-full">
                                                                                    <div className="relative">
                                                                                        <input
                                                                                            type="text"
                                                                                            inputMode="decimal"
                                                                                            placeholder="Discount Percent (%)"
                                                                                            className="w-full pr-6 pl-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-705 outline-none focus:ring-4 focus:ring-blue-50 focus:border-blue-500 transition-all text-right"
                                                                                            value={lineItem.discountPercent}
                                                                                            onChange={(e) => {
                                                                                                const parsed = parseGstInput(e.target.value);
                                                                                                if (parsed === null) return;
                                                                                                updateBillItem(index, 'discountPercent', parsed);
                                                                                            }}
                                                                                        />
                                                                                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-bold pointer-events-none">%</span>
                                                                                    </div>
                                                                                    <div className="relative">
                                                                                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-bold pointer-events-none">₹</span>
                                                                                        <input
                                                                                            type="text"
                                                                                            inputMode="decimal"
                                                                                            placeholder="Discount Amount"
                                                                                            className="w-full pl-6 pr-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-705 outline-none focus:ring-4 focus:ring-blue-50 focus:border-blue-500 transition-all text-right"
                                                                                            value={lineItem.discountAmount}
                                                                                            onChange={(e) => {
                                                                                                const parsed = parsePriceInput(e.target.value);
                                                                                                if (parsed === null) return;
                                                                                                updateBillItem(index, 'discountAmount', parsed);
                                                                                            }}
                                                                                        />
                                                                                    </div>
                                                                                </div>
                                                                            </div>
                                                                        </td>
                                                                    </tr>
                                                                )}
                                                                {lineItem.itemId && getSelectedInventoryItem(lineItem)?.category === 'Tires' && (
                                                                    <tr className="bg-slate-50/50 border-b-4 border-slate-100">
                                                                        <td colSpan={8 + (billFormData.taxMode === 'lineLevel' ? 1 : 0)} className="px-5 py-2">
                                                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 bg-white rounded-xl border border-slate-200 shadow-sm max-w-lg border-l-2 border-amber-500 pl-3">
                                                                                <div>
                                                                                    <label className="block text-[8px] font-black uppercase text-slate-400 mb-0.5 tracking-wider">Position</label>
                                                                                    <select
                                                                                        className="w-full px-2 py-1 rounded-lg border border-slate-200 text-[10px] bg-white font-bold text-slate-700 outline-none cursor-pointer"
                                                                                        value={lineItem.tyrePosition}
                                                                                        onChange={(e) => updateBillItem(index, 'tyrePosition', e.target.value)}
                                                                                    >
                                                                                        {TYRE_POSITIONS.map((p) => <option key={p} value={p}>{p.toUpperCase()}</option>)}
                                                                                    </select>
                                                                                </div>
                                                                                <div>
                                                                                    <label className="block text-[8px] font-black uppercase text-slate-400 mb-0.5 tracking-wider">Type</label>
                                                                                    <select
                                                                                        className="w-full px-2 py-1 rounded-lg border border-slate-200 text-[10px] bg-white font-bold text-slate-700 outline-none cursor-pointer"
                                                                                        value={lineItem.tyreType}
                                                                                        onChange={(e) => updateBillItem(index, 'tyreType', e.target.value)}
                                                                                    >
                                                                                        <option value="new tyre">New Tyre</option>
                                                                                        <option value="old tyre">Old Tyre</option>
                                                                                    </select>
                                                                                </div>
                                                                                <div>
                                                                                    <label className="block text-[8px] font-black uppercase text-slate-400 mb-0.5 tracking-wider">Reading (KM)</label>
                                                                                    <input
                                                                                        type="number"
                                                                                        className="w-full px-2 py-1 rounded-lg border border-slate-200 text-[10px] bg-white font-bold text-slate-700 outline-none"
                                                                                        value={lineItem.kmReading}
                                                                                        onChange={(e) => updateBillItem(index, 'kmReading', e.target.value)}
                                                                                    />
                                                                                </div>
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

                                        <button
                                            type="button"
                                            onClick={addBillItem}
                                            className="w-full flex items-center justify-center gap-1.5 px-6 py-2.5 rounded-xl border-2 border-dashed border-slate-200 text-slate-400 font-bold hover:bg-slate-50 hover:border-slate-350 transition-all text-[11px] uppercase tracking-wider cursor-pointer mt-2"
                                        >
                                            <Plus size={13} /> Add another item
                                        </button>
                                    </div>
                                </div>

                                {/* Right Side Sidebar */}
                                <div className="lg:col-span-4 space-y-5">
                                    {/* Sidebar Card 1: BUS ITEM HISTORY */}
                                    <div className="bg-white rounded-2xl border border-slate-150 shadow-sm overflow-hidden flex flex-col">
                                        <div className="bg-[#2563EB] text-white p-4">
                                            <h3 className="text-xs font-black uppercase tracking-[0.2em] flex items-center gap-2">
                                                <History size={15} className="text-white/80" /> BUS ITEM HISTORY
                                            </h3>
                                            <p className="text-[10px] text-blue-100 mt-1 font-semibold">
                                                Select a bus to view assignment history
                                            </p>
                                        </div>
                                        <div className="p-4">
                                            {historyLoading ? (
                                                <div className="py-6 flex justify-center"><Loader text="Loading history..." /></div>
                                            ) : !activeBusId ? (
                                                <div className="py-6 text-center text-slate-350 italic text-[11px] font-medium">
                                                    Choose a bus first.
                                                </div>
                                            ) : (
                                                <div>
                                                    {/* Selected Vehicle details badge */}
                                                    {selectedVehicleObj && (
                                                        <div className="flex items-center justify-between p-3 bg-blue-50/50 border border-blue-100 rounded-xl">
                                                            <div className="flex items-center gap-2.5 min-w-0">
                                                                <div className="w-8.5 h-8.5 rounded-xl bg-blue-100/50 flex items-center justify-center text-blue-600 shrink-0 border border-blue-100/80">
                                                                    <Bus size={15} />
                                                                </div>
                                                                <div className="min-w-0">
                                                                    <p className="text-xs font-black text-slate-805 truncate">{selectedVehicleObj.busNumber || selectedVehicleObj.vehicleNumber}</p>
                                                                    <div className="flex items-center gap-1 mt-0.5">
                                                                        <span className="text-[9px] font-bold text-slate-400">{selectedVehicleObj.type || 'Vehicle'}</span>
                                                                        <span className="w-1 h-1 rounded-full bg-slate-300"></span>
                                                                        <span className={`text-[9px] font-black ${selectedVehicleObj.status === 'Active' ? 'text-[#10B981]' : 'text-amber-500'}`}>
                                                                            {selectedVehicleObj.status || 'Active'}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <ChevronRight size={13} className="text-slate-400 shrink-0" />
                                                        </div>
                                                    )}

                                                    {/* Recent Bills loop */}
                                                    <div className="mt-3.5 pt-3.5 border-t border-slate-100 space-y-2.5">
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-[9px] font-black text-slate-405 uppercase tracking-wider">Recent Bills</span>
                                                            <button
                                                                type="button"
                                                                onClick={() => switchTab(PAGE_TABS.view)}
                                                                className="text-[9px] font-bold text-blue-600 hover:text-blue-700"
                                                            >
                                                                View All
                                                            </button>
                                                        </div>
                                                        
                                                        {maintenanceBills.length > 0 ? (
                                                            <div className="space-y-2 max-h-[160px] overflow-y-auto pr-1">
                                                                {maintenanceBills.slice(0, 3).map((bill) => (
                                                                    <div key={bill._id} className="flex items-center justify-between p-2 rounded-xl border border-slate-50 hover:bg-slate-50/50 transition-colors">
                                                                        <div className="flex items-center gap-2 min-w-0">
                                                                            <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600 shrink-0 border border-blue-50">
                                                                                <FileText size={13} />
                                                                            </div>
                                                                            <div className="min-w-0">
                                                                                <p className="text-[11px] font-black text-slate-800 truncate">#{bill.billNo}</p>
                                                                                <p className="text-[8px] font-semibold text-slate-400 mt-0.5">{new Date(bill.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</p>
                                                                            </div>
                                                                        </div>
                                                                        <div className="flex items-center gap-1.5 shrink-0">
                                                                            <span className="text-[11px] font-bold text-slate-800">₹{formatCurrencyIndian(bill.grandTotal ?? bill.totalAmount)}</span>
                                                                            <span className="text-[8px] font-black bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded border border-emerald-100 uppercase">Paid</span>
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        ) : (
                                                            <p className="text-[9px] text-slate-400 italic text-center py-3">No recent bills found.</p>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Sidebar Card 2: Bill Summary */}
                                    <div className="bg-white rounded-2xl border border-slate-150 shadow-sm p-4 space-y-3.5">
                                        <h3 className="text-xs font-black uppercase tracking-[0.2em] text-slate-450 border-b border-slate-100 pb-2 flex items-center gap-2">
                                            <FileText size={14} /> Bill Summary
                                        </h3>
                                        
                                        <div className="space-y-2 text-xs font-semibold text-slate-655">
                                            <div className="flex justify-between">
                                                <span>Sub Total</span>
                                                <span className="text-slate-800 font-bold">₹{formatCurrency(billTotals.subtotal)}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span>Discount</span>
                                                <span className="text-red-500">- ₹{formatCurrency(billTotals.discountTotal || 0)}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span>Total Tax (GST)</span>
                                                <span className="text-slate-800 font-bold">₹{formatCurrency(billTotals.taxTotal ?? billTotals.gstTotal ?? 0)}</span>
                                            </div>
                                            {billTotals.insuranceClaimAmount > 0 && (
                                                <div className="flex justify-between text-amber-600 font-bold">
                                                    <span>Insurance Claim</span>
                                                    <span>- ₹{formatCurrency(billTotals.insuranceClaimAmount)}</span>
                                                </div>
                                            )}
                                        </div>
                                        
                                        <div className="border-t border-slate-100 pt-2.5">
                                            <p className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Grand Total</p>
                                            <p className="text-xl font-black text-blue-700 italic mt-0.5 leading-none">
                                                ₹{formatCurrency(billTotals.grandTotal)}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Submit action button directly below summary card */}
                                    <button
                                        type="submit"
                                        disabled={submitting}
                                        className="w-full bg-[#2563EB] text-white font-black py-3 rounded-xl hover:bg-blue-755 transition-all shadow-md active:scale-95 flex items-center justify-center gap-2 uppercase text-xs tracking-widest shrink-0 disabled:opacity-60 cursor-pointer"
                                    >
                                        <Truck size={16} /> {submitting ? 'Saving...' : (editingBill ? 'Update Bill' : 'Raise Bill')}
                                    </button>
                                </div>
                            </div>
                        </form>
                    )}
                </>
            )}

            {/* 1. Action Confirmation Modal with Blurred Background */}
            {showActionModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md animate-in fade-in duration-200">
                    <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 p-6 max-w-md w-full space-y-4 animate-in zoom-in duration-150 relative">
                        <h3 className="text-sm font-black text-slate-805 uppercase tracking-widest flex items-center gap-2 border-b border-slate-100 pb-3">
                            <AlertCircle size={16} className="text-blue-600 animate-pulse" /> Confirm Bill Actions
                        </h3>
                        
                        <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 space-y-2.5 text-xs font-semibold text-slate-655">
                            <div className="flex justify-between items-start gap-4">
                                <span className="shrink-0">Vehicle / Bus:</span>
                                <span className="text-slate-800 font-bold text-right truncate">{getFormattedVehicleLabel(billFormData.busId)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span>Vendor:</span>
                                <span className="text-slate-800 font-bold truncate max-w-[200px]">
                                    {vendors.find(v => v._id === billFormData.vendorId)?.name || 'Unknown'}
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span>Bill Number:</span>
                                <span className="text-slate-800 font-bold">#{billFormData.billNo || 'N/A'}</span>
                            </div>
                            {billTotals.insuranceClaimAmount > 0 && (
                                <div className="flex justify-between text-slate-500 font-semibold">
                                    <span>Invoice Total:</span>
                                    <span>₹{formatCurrency(billTotals.computedGrandTotal)}</span>
                                </div>
                            )}
                            {billTotals.insuranceClaimAmount > 0 && (
                                <div className="flex justify-between text-red-655 font-semibold">
                                    <span>Insurance Claim:</span>
                                    <span>- ₹{formatCurrency(billTotals.insuranceClaimAmount)}</span>
                                </div>
                            )}
                            <div className="flex justify-between border-t border-slate-200 pt-2 font-black text-sm">
                                <span className="text-slate-850">Net Payable:</span>
                                <span className="text-blue-700">₹{formatCurrency(billTotals.grandTotal)}</span>
                            </div>
                        </div>

                        {errorMsg && (
                            <div className="p-3 rounded-lg bg-red-50 border border-red-100 text-red-700 text-xs font-bold leading-relaxed">
                                {errorMsg}
                            </div>
                        )}

                        <div className="flex flex-col gap-2 pt-2">
                            <button
                                type="button"
                                onClick={saveAndPrintBill}
                                disabled={submitting}
                                className="w-full bg-[#2563EB] text-white font-black py-2.5 rounded-xl hover:bg-blue-700 flex items-center justify-center gap-1.5 uppercase text-xs tracking-wider cursor-pointer shadow-md disabled:opacity-60 transition-all active:scale-98"
                            >
                                {submitting ? 'Saving Bill...' : 'Save & Print'}
                            </button>
                            <button
                                type="button"
                                onClick={() => setShowPreviewModal(true)}
                                className="w-full bg-slate-900 text-white font-black py-2.5 rounded-xl hover:bg-slate-800 flex items-center justify-center gap-1.5 uppercase text-xs tracking-wider cursor-pointer shadow-md transition-all active:scale-98"
                            >
                                <Printer size={13} /> Preview Bill Layout
                            </button>
                            <button
                                type="button"
                                onClick={() => setShowActionModal(false)}
                                className="w-full border border-slate-200 text-slate-700 font-bold py-2 rounded-xl hover:bg-slate-50 text-xs cursor-pointer bg-white transition-colors"
                            >
                                Cancel & Back to Edit
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 2. Print Preview Modal with Blurred Background */}
            {showPreviewModal && (
                <div className="fixed inset-0 z-50 flex flex-col items-center justify-center p-4 sm:p-6 bg-slate-900/60 backdrop-blur-md overflow-y-auto animate-in fade-in duration-200">
                    <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 max-w-4xl w-full flex flex-col overflow-hidden max-h-[90vh] animate-in zoom-in duration-200">
                        {/* Header toolbar */}
                        <div className="flex justify-between items-center px-6 py-4 border-b border-slate-100 bg-white sticky top-0 z-10">
                            <h3 className="text-xs font-black text-slate-805 uppercase tracking-widest flex items-center gap-2">
                                <Printer size={15} className="text-slate-400" /> Bill Print Preview
                            </h3>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => setShowPreviewModal(false)}
                                    className="px-3.5 py-1.5 rounded-xl border border-slate-200 text-slate-700 font-bold hover:bg-slate-50 text-xs cursor-pointer bg-white transition-colors"
                                >
                                    Close Preview
                                </button>
                                <button
                                    type="button"
                                    onClick={saveAndPrintBill}
                                    disabled={submitting}
                                    className="px-4 py-1.5 rounded-xl bg-[#2563EB] text-white font-black hover:bg-blue-700 text-xs cursor-pointer flex items-center gap-1.5 transition-colors disabled:opacity-60"
                                >
                                    {submitting ? 'Saving...' : 'Save & Print'}
                                </button>
                            </div>
                        </div>
                        {/* Scrollable Printable sheet */}
                        <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
                            <div className="p-8 border border-slate-100 rounded-xl bg-white shadow-sm max-w-3xl mx-auto">
                                <BillPrint
                                    billData={buildPrintableBillData()}
                                    vendor={vendors.find((v) => v._id === billFormData.vendorId)}
                                    bus={(Array.isArray(billFormData.busId) && billFormData.busId.length > 1)
                                        ? { vehicleNumber: getFormattedVehicleLabel(billFormData.busId), busNumber: getFormattedVehicleLabel(billFormData.busId) }
                                        : (buses.find((b) => b.busNumber === activeBusId)
                                            || otherVehicles.find((v) => v.vehicleNumber === activeBusId))}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* 3. Hidden Print Fallback Element */}
            <div className="hidden print:block absolute top-0 left-0 w-full bg-white z-[9999]">
                {printBill && (
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
        </Layout>
    );
};

export default RaiseBill;
