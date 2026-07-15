import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import Modal from '../components/Modal';
import Loader from '../components/Loader';
import { 
    Package, Plus, Search, Edit, Trash2, History, Truck, 
    Calendar, Tag, User, Layers, Printer, ChevronDown, 
    ChevronUp, LayoutGrid, List, AlertCircle, Filter, Paperclip,
    ChevronLeft, ChevronRight, Wrench, Zap, Disc, Droplet, Bus, Shield, Sparkles, MoreVertical, FileText
} from 'lucide-react';
import BillPrint from '../components/BillPrint';
import { apiFetch, API_BASE } from '../utils/api';
import { printHtmlDocument } from '../utils/printHtml';
import { hasPermission } from '../utils/permissions';
import { getLineTotal } from '../utils/billCalculations';

const API = API_BASE;
const API_ORIGIN = String(API_BASE || '').replace(/\/api\/?$/, '');

const attachmentUrl = (url) => {
    if (!url) return '';
    if (/^https?:\/\//i.test(url)) return url;
    return `${API_ORIGIN}${url.startsWith('/') ? url : `/${url}`}`;
};

const TABS = { 
    inventory: 'inventory', 
    vendors: 'vendors', 
    tyreRegistry: 'tyreRegistry' 
};

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

const getBillKey = (bill) => `${bill.billNo || 'no-bill'}-${bill.items?.[0]?._id || bill.date}`;

const getCategoryDisplayName = (cat) => {
    switch (cat) {
        case 'Mechanical': return 'Engine Parts';
        case 'Body & Interior': return 'Body Parts';
        case 'Tires': return 'Tyres';
        default: return cat;
    }
};

const getCategoryDetails = (category) => {
    switch (category) {
        case 'Mechanical':
            return { label: 'Engine Parts', bg: 'bg-blue-50 text-blue-700 border-blue-100', color: '#2563EB' };
        case 'Body & Interior':
            return { label: 'Body Parts', bg: 'bg-emerald-50 text-emerald-700 border-emerald-100', color: '#10B981' };
        case 'Tires':
            return { label: 'Tyres', bg: 'bg-purple-50 text-purple-700 border-purple-100', color: '#8B5CF6' };
        case 'Electrical':
            return { label: 'Electrical', bg: 'bg-amber-50 text-amber-700 border-amber-100', color: '#F59E0B' };
        case 'Lubricants':
            return { label: 'Lubricants', bg: 'bg-sky-50 text-sky-700 border-sky-100', color: '#0EA5E9' };
        case 'Safety':
            return { label: 'Safety', bg: 'bg-rose-50 text-rose-700 border-rose-100', color: '#F43F5E' };
        case 'Cleaning':
            return { label: 'Cleaning', bg: 'bg-pink-50 text-pink-700 border-pink-100', color: '#EC4899' };
        default:
            return { label: category || 'General', bg: 'bg-slate-50 text-slate-705 border-slate-100', color: '#64748B' };
    }
};

const getCategoryIcon = (category) => {
    switch (category) {
        case 'Mechanical':
            return (
                <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center text-blue-600 border border-blue-100 shrink-0">
                    <Wrench size={14} />
                </div>
            );
        case 'Body & Interior':
            return (
                <div className="w-8 h-8 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600 border border-emerald-100 shrink-0">
                    <Bus size={14} />
                </div>
            );
        case 'Tires':
            return (
                <div className="w-8 h-8 rounded-full bg-purple-50 flex items-center justify-center text-purple-600 border border-purple-100 shrink-0">
                    <Disc size={14} />
                </div>
            );
        case 'Electrical':
            return (
                <div className="w-8 h-8 rounded-full bg-amber-50 flex items-center justify-center text-amber-600 border border-amber-100 shrink-0">
                    <Zap size={14} />
                </div>
            );
        case 'Lubricants':
            return (
                <div className="w-8 h-8 rounded-full bg-sky-50 flex items-center justify-center text-sky-600 border border-sky-100 shrink-0">
                    <Droplet size={14} />
                </div>
            );
        case 'Safety':
            return (
                <div className="w-8 h-8 rounded-full bg-rose-50 flex items-center justify-center text-rose-600 border border-rose-100 shrink-0">
                    <Shield size={14} />
                </div>
            );
        case 'Cleaning':
            return (
                <div className="w-8 h-8 rounded-full bg-pink-50 flex items-center justify-center text-pink-600 border border-pink-100 shrink-0">
                    <Sparkles size={14} />
                </div>
            );
        default:
            return (
                <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center text-slate-600 border border-slate-100 shrink-0">
                    <Package size={14} />
                </div>
            );
    }
};

const getCategoryBadge = (category) => {
    const details = getCategoryDetails(category);
    return (
        <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border ${details.bg}`}>
            {details.label}
        </span>
    );
};

const Inventory = () => {
    const navigate = useNavigate();
    const canEditBills = hasPermission('inventory_edit');
    const canDeleteBills = hasPermission('inventory_delete');
    const canEditItems = hasPermission('inventory_edit');
    const canDeleteItems = hasPermission('inventory_delete');

    const [activeTab, setActiveTab] = useState(TABS.inventory);
    const [items, setItems] = useState([]);
    const [history, setHistory] = useState([]);
    const [maintenanceBills, setMaintenanceBills] = useState([]);
    const [vendors, setVendors] = useState([]);
    const [tyreRegistry, setTyreRegistry] = useState([]);
    const [buses, setBuses] = useState([]);
    const [otherVehicles, setOtherVehicles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [vendorsLoading, setVendorsLoading] = useState(false);
    const [registryLoading, setRegistryLoading] = useState(false);
    
    // Modals
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isVendorModalOpen, setIsVendorModalOpen] = useState(false);
    const [printBill, setPrintBill] = useState(null);
    const [inventoryView, setInventoryView] = useState('card'); // 'card' or 'table'
    
    const [editingItem, setEditingItem] = useState(null);
    const [editingVendor, setEditingVendor] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedBusFilter, setSelectedBusFilter] = useState('all');
    const [selectedGroupFilter, setSelectedGroupFilter] = useState('all');
    const [expandedInventoryGroup, setExpandedInventoryGroup] = useState(null);

    const [itemFormData, setItemFormData] = useState(emptyItemFormData);

    const [vendorFormData, setVendorFormData] = useState({
        name: '',
        contactPerson: '',
        phone: '',
        email: '',
        address: ''
    });

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(10);
    
    // Actions Dropdowns
    const [activeRowActionsDropdown, setActiveRowActionsDropdown] = useState(null);
    const [isFilterDropdownOpen, setIsFilterDropdownOpen] = useState(false);
    const [sortBy, setSortBy] = useState('name-asc'); // 'name-asc', 'name-desc', 'variants-desc', 'variants-asc'

    // Vendor search input
    const [vendorSearchTerm, setVendorSearchTerm] = useState('');

    useEffect(() => {
        fetchItems();
        fetchBuses();
        fetchOtherVehicles();
        fetchVendors();
        fetchHistory('all');
    }, []);

    useEffect(() => {
        if (activeTab === TABS.tyreRegistry) {
            fetchTyreRegistry(selectedBusFilter);
        }
    }, [activeTab, selectedBusFilter]);

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
        }
    };

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

    // Inventory Groups Calculations
    const inventoryGroups = getInventoryGroups(items);
    
    // Filtering for items
    const filteredGroups = inventoryGroups.filter(group => {
        const matchesSearch = group.itemName.toLowerCase().includes(searchTerm.toLowerCase()) ||
            group.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
            group.variants.some((variant) => variant.name.toLowerCase().includes(searchTerm.toLowerCase()));
        
        const matchesCategory = selectedGroupFilter === 'all' || group.category === selectedGroupFilter;
        return matchesSearch && matchesCategory;
    });

    // Sorting items
    let sortedGroups = [...filteredGroups];
    if (sortBy === 'name-asc') {
        sortedGroups.sort((a, b) => a.itemName.localeCompare(b.itemName));
    } else if (sortBy === 'name-desc') {
        sortedGroups.sort((a, b) => b.itemName.localeCompare(a.itemName));
    } else if (sortBy === 'variants-desc') {
        sortedGroups.sort((a, b) => b.variants.length - a.variants.length);
    } else if (sortBy === 'variants-asc') {
        sortedGroups.sort((a, b) => a.variants.length - b.variants.length);
    }

    // Dynamic stats calculations
    const totalItemGroupsCount = inventoryGroups.length;
    const totalVariantsCount = inventoryGroups.reduce((sum, group) => sum + group.variants.length, 0);
    const totalBillsCountDynamic = maintenanceBills.length;
    const totalAmountSpentDynamic = maintenanceBills.reduce((sum, bill) => sum + (bill.grandTotal ?? bill.totalAmount ?? 0), 0);

    // Pagination for master items
    const totalItemsCount = sortedGroups.length;
    const totalPages = Math.ceil(totalItemsCount / itemsPerPage);
    const paginatedGroups = sortedGroups.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

    const pageNumbers = [];
    if (totalPages <= 5) {
        for (let i = 1; i <= totalPages; i++) pageNumbers.push(i);
    } else {
        if (currentPage <= 3) {
            pageNumbers.push(1, 2, 3, '...', totalPages);
        } else if (currentPage >= totalPages - 2) {
            pageNumbers.push(1, '...', totalPages - 2, totalPages - 1, totalPages);
        } else {
            pageNumbers.push(1, '...', currentPage, '...', totalPages);
        }
    }

    // Vendor search filtering
    const filteredVendors = vendors.filter(v => 
        (v.name || '').toLowerCase().includes(vendorSearchTerm.toLowerCase()) ||
        (v.contactPerson || '').toLowerCase().includes(vendorSearchTerm.toLowerCase()) ||
        (v.phone || '').toLowerCase().includes(vendorSearchTerm.toLowerCase()) ||
        (v.email || '').toLowerCase().includes(vendorSearchTerm.toLowerCase())
    );

    const itemGroupOptions = [...new Set(items.map((item) => item.itemName).filter(Boolean))].sort();
    const filledVariantNames = itemFormData.variantNames.map((value) => value.trim()).filter(Boolean);
    const creatingMultipleVariants = !editingItem && filledVariantNames.length > 1;

    return (
        <Layout>
            {/* Header section */}
            <div className="mb-8 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600 border border-blue-100 shadow-sm shrink-0">
                        <Package size={24} />
                    </div>
                    <div>
                        <h2 className="text-2xl font-black text-slate-800 tracking-tight">
                            Bus Inventory
                        </h2>
                        <p className="text-slate-550 text-xs font-semibold mt-0.5">Manage parts, supplies and raise bills for purchased items.</p>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <button 
                        onClick={() => { setEditingItem(null); setItemFormData(emptyItemFormData); setIsModalOpen(true); }}
                        className="bg-[#071B45] hover:bg-[#0A2558] text-white px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all shadow-sm active:scale-95 cursor-pointer"
                    >
                        <Plus size={15} /> Add Item / Variant
                    </button>
                    {/* <button
                        onClick={() => navigate('/inventory/raise-bill')}
                        className="bg-[#10B981] hover:bg-[#059669] text-white px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all shadow-sm active:scale-95 cursor-pointer"
                    >
                        <Truck size={15} /> Raise Bill
                    </button> */}
                    <button 
                        onClick={() => setActiveTab(TABS.tyreRegistry)}
                        className="bg-[#2563EB] hover:bg-[#1D4ED8] text-white px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all shadow-sm active:scale-95 cursor-pointer"
                    >
                        <Disc size={15} /> Tyre Registry
                    </button>
                    <button 
                        onClick={() => { setEditingVendor(null); setVendorFormData({ name: '', contactPerson: '', phone: '', email: '', address: '' }); setIsVendorModalOpen(true); }}
                        className="bg-white hover:bg-slate-50 text-slate-705 px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all border border-slate-205 shadow-sm cursor-pointer"
                    >
                        <User size={15} /> Manage Vendors
                    </button>
                </div>
            </div>

            {/* Dynamic statistics metrics row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                {/* Metric 1: TOTAL ITEMS */}
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm flex items-center gap-4 hover:shadow-md transition-all duration-300">
                    <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600 border border-blue-100 shrink-0">
                        <Package size={22} />
                    </div>
                    <div className="min-w-0">
                        <p className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Total Items</p>
                        <h3 className="text-xl font-bold text-slate-800 mt-1 leading-none">{totalItemGroupsCount}</h3>
                        <p className="text-[10px] text-slate-500 mt-1.5 font-semibold">All Item Groups</p>
                    </div>
                </div>

                {/* Metric 2: TOTAL VARIANTS */}
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm flex items-center gap-4 hover:shadow-md transition-all duration-300">
                    <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600 border border-emerald-100 shrink-0">
                        <Tag size={22} />
                    </div>
                    <div className="min-w-0">
                        <p className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Total Variants</p>
                        <h3 className="text-xl font-bold text-[#10B981] mt-1 leading-none">{totalVariantsCount}</h3>
                        <p className="text-[10px] text-slate-500 mt-1.5 font-semibold">Across all items</p>
                    </div>
                </div>

                {/* Metric 3: TOTAL BILLS */}
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm flex items-center gap-4 hover:shadow-md transition-all duration-300">
                    <div className="w-12 h-12 rounded-xl bg-purple-50 flex items-center justify-center text-purple-600 border border-purple-100 shrink-0">
                        <FileText size={22} />
                    </div>
                    <div className="min-w-0">
                        <p className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Total Bills</p>
                        <h3 className="text-xl font-bold text-slate-800 mt-1 leading-none">{totalBillsCountDynamic}</h3>
                        <p className="text-[10px] text-slate-500 mt-1.5 font-semibold">This Academic Year</p>
                    </div>
                </div>

                {/* Metric 4: TOTAL AMOUNT */}
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm flex items-center gap-4 hover:shadow-md transition-all duration-300">
                    <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center text-amber-600 border border-amber-100 shrink-0">
                        <span className="text-lg font-black leading-none">₹</span>
                    </div>
                    <div className="min-w-0">
                        <p className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Total Amount</p>
                        <h3 className="text-xl font-bold text-slate-850 mt-1 leading-none">₹ {formatCurrencyIndian(totalAmountSpentDynamic)}</h3>
                        <p className="text-[10px] text-slate-500 mt-1.5 font-semibold">This Academic Year</p>
                    </div>
                </div>
            </div>

            {/* Switcher capsule tabs */}
            <div className="flex flex-wrap gap-2 mb-6">
                <button
                    onClick={() => { setActiveTab(TABS.inventory); setCurrentPage(1); }}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold transition-all duration-200 cursor-pointer ${
                        activeTab === TABS.inventory
                            ? 'bg-[#2563EB] text-white shadow-md shadow-blue-500/20'
                            : 'bg-white text-slate-650 hover:text-slate-900 border border-slate-100 hover:bg-slate-50 shadow-sm'
                    }`}
                >
                    <Package size={15} /> Master Items
                </button>
                <button
                    onClick={() => { setActiveTab(TABS.vendors); }}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold transition-all duration-200 cursor-pointer ${
                        activeTab === TABS.vendors
                            ? 'bg-[#2563EB] text-white shadow-md shadow-blue-500/20'
                            : 'bg-white text-slate-650 hover:text-slate-900 border border-slate-100 hover:bg-slate-50 shadow-sm'
                    }`}
                >
                    <User size={15} /> Vendors
                </button>
                <button
                    onClick={() => setActiveTab(TABS.tyreRegistry)}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold transition-all duration-200 cursor-pointer ${
                        activeTab === TABS.tyreRegistry
                            ? 'bg-[#2563EB] text-white shadow-md shadow-blue-500/20'
                            : 'bg-white text-slate-650 hover:text-slate-900 border border-slate-100 hover:bg-slate-50 shadow-sm'
                    }`}
                >
                    <Disc size={15} /> Tyre Registry
                </button>
            </div>

            {/* CONTENT RENDERERS */}

            {/* TAB: Master Items */}
            {activeTab === TABS.inventory && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
                    {/* Controls row */}
                    <div className="flex flex-col md:flex-row gap-4 justify-between items-center mb-6">
                        {/* Search input */}
                        <div className="relative w-full md:flex-1 max-w-md group">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500 transition-colors" size={16} />
                            <input
                                type="text"
                                placeholder="Search by item name, group or category..."
                                className="w-full pl-11 pr-4 py-2.5 rounded-xl border border-slate-200 focus:ring-4 focus:ring-blue-50 focus:border-blue-400 outline-none transition-all text-xs font-medium bg-white text-slate-700 shadow-sm"
                                value={searchTerm}
                                onChange={(e) => {
                                    setSearchTerm(e.target.value);
                                    setCurrentPage(1);
                                }}
                            />
                        </div>
                        {/* Dropdown Filters & Grid/List switcher */}
                        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto justify-end">
                            {/* Category Filter */}
                            <div className="relative flex items-center bg-white border border-slate-200 rounded-xl shadow-sm px-3 py-2 shrink-0">
                                <Package size={15} className="text-slate-400 absolute left-3 pointer-events-none" />
                                <select
                                    value={selectedGroupFilter}
                                    onChange={(e) => {
                                        setSelectedGroupFilter(e.target.value);
                                        setCurrentPage(1);
                                    }}
                                    className="pl-7 pr-6 bg-transparent border-none outline-none text-xs font-bold text-slate-705 cursor-pointer appearance-none"
                                >
                                    <option value="all">All Groups</option>
                                    {CATEGORIES.map(cat => (
                                        <option key={cat} value={cat}>{getCategoryDisplayName(cat)}</option>
                                    ))}
                                </select>
                                <ChevronDown size={14} className="text-slate-400 absolute right-3 pointer-events-none" />
                            </div>

                            {/* Sorting Filters Menu */}
                            <div className="relative shrink-0">
                                <button
                                    onClick={() => setIsFilterDropdownOpen(!isFilterDropdownOpen)}
                                    className="flex items-center gap-2 px-3.5 py-2 border border-slate-200 rounded-xl hover:bg-slate-50 text-xs font-bold text-slate-700 bg-white transition-all shadow-sm cursor-pointer"
                                >
                                    <Filter size={14} />
                                    <span>Filters</span>
                                    <ChevronDown size={13} className={`transition-transform duration-200 ${isFilterDropdownOpen ? 'rotate-180' : ''}`} />
                                </button>
                                {isFilterDropdownOpen && (
                                    <>
                                        <div 
                                            className="fixed inset-0 z-40" 
                                            onClick={() => setIsFilterDropdownOpen(false)}
                                        ></div>
                                        <div className="absolute right-0 mt-2 w-48 bg-white border border-slate-100 rounded-xl shadow-lg py-2 z-50 animate-in fade-in slide-in-from-top-1">
                                            <p className="text-[10px] font-black text-slate-450 uppercase tracking-widest px-4 py-1.5 border-b border-slate-55 mb-1">Sort options</p>
                                            <button
                                                onClick={() => { setSortBy('name-asc'); setIsFilterDropdownOpen(false); }}
                                                className={`w-full text-left px-4 py-2 text-xs font-semibold transition-colors ${sortBy === 'name-asc' ? 'bg-blue-50 text-blue-755' : 'text-slate-600 hover:bg-slate-50'}`}
                                            >
                                                Name (A to Z)
                                            </button>
                                            <button
                                                onClick={() => { setSortBy('name-desc'); setIsFilterDropdownOpen(false); }}
                                                className={`w-full text-left px-4 py-2 text-xs font-semibold transition-colors ${sortBy === 'name-desc' ? 'bg-blue-50 text-blue-755' : 'text-slate-600 hover:bg-slate-50'}`}
                                            >
                                                Name (Z to A)
                                            </button>
                                            <button
                                                onClick={() => { setSortBy('variants-desc'); setIsFilterDropdownOpen(false); }}
                                                className={`w-full text-left px-4 py-2 text-xs font-semibold transition-colors ${sortBy === 'variants-desc' ? 'bg-blue-50 text-blue-760' : 'text-slate-600 hover:bg-slate-50'}`}
                                            >
                                                Most Variants
                                            </button>
                                            <button
                                                onClick={() => { setSortBy('variants-asc'); setIsFilterDropdownOpen(false); }}
                                                className={`w-full text-left px-4 py-2 text-xs font-semibold transition-colors ${sortBy === 'variants-asc' ? 'bg-blue-50 text-blue-765' : 'text-slate-600 hover:bg-slate-50'}`}
                                            >
                                                Least Variants
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>

                            {/* Layout toggle switcher */}
                            <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 shrink-0">
                                <button 
                                    onClick={() => setInventoryView('card')}
                                    className={`p-1.5 rounded-lg transition-all cursor-pointer ${inventoryView === 'card' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-650'}`}
                                    title="Card View"
                                >
                                    <LayoutGrid size={16} />
                                </button>
                                <button 
                                    onClick={() => setInventoryView('table')}
                                    className={`p-1.5 rounded-lg transition-all cursor-pointer ${inventoryView === 'table' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-650'}`}
                                    title="Table View"
                                >
                                    <List size={16} />
                                </button>
                            </div>
                        </div>
                    </div>

                    {loading ? (
                        <div className="py-20 flex justify-center"><Loader text="Loading inventory..." /></div>
                    ) : totalItemsCount > 0 ? (
                        inventoryView === 'table' ? (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="border-b border-slate-100 text-[11px] uppercase text-slate-400 font-black tracking-widest bg-slate-50/50">
                                            <th className="px-6 py-4 rounded-l-xl">Item Name</th>
                                            <th className="px-6 py-4">Group</th>
                                            <th className="px-6 py-4">Unit</th>
                                            <th className="px-6 py-4">Variants</th>
                                            <th className="px-6 py-4">Description</th>
                                            <th className="px-6 py-4 text-right rounded-r-xl">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50">
                                        {paginatedGroups.map(group => {
                                            const categoryDetails = getCategoryDetails(group.category);
                                            const isExpanded = expandedInventoryGroup === group.key;
                                            
                                            return (
                                                <React.Fragment key={group.key}>
                                                    <tr
                                                        onClick={() => setExpandedInventoryGroup(isExpanded ? null : group.key)}
                                                        className="hover:bg-slate-50/40 transition-colors group cursor-pointer"
                                                    >
                                                        <td className="px-6 py-4 font-bold text-slate-800 text-xs">
                                                            <div className="flex items-center gap-3">
                                                                {getCategoryIcon(group.category)}
                                                                <span className="truncate">{group.itemName}</span>
                                                            </div>
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            {getCategoryBadge(group.category)}
                                                        </td>
                                                        <td className="px-6 py-4 text-xs font-bold text-slate-600">
                                                            {group.unit || 'PCS'}
                                                        </td>
                                                        <td className="px-6 py-4 text-xs font-bold text-slate-750">
                                                            {group.variants.length}
                                                        </td>
                                                        <td className="px-6 py-4 text-xs text-slate-500 max-w-xs truncate font-medium">
                                                            {group.description || 'No description provided.'}
                                                        </td>
                                                        <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                                                            <div className="flex justify-end items-center gap-1.5">
                                                                {canEditItems && (
                                                                    <button 
                                                                        onClick={() => openEditModal(group.primaryItem, group)} 
                                                                        className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 border border-slate-200 rounded-lg transition-all bg-white shadow-sm cursor-pointer"
                                                                        title="Edit Item"
                                                                    >
                                                                        <Edit size={13} />
                                                                    </button>
                                                                )}
                                                                {canDeleteItems && (
                                                                    <div className="relative">
                                                                        <button
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                setActiveRowActionsDropdown(activeRowActionsDropdown === group.key ? null : group.key);
                                                                            }}
                                                                            className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 hover:text-slate-900 transition-colors text-slate-400 bg-white shadow-sm cursor-pointer"
                                                                        >
                                                                            <MoreVertical size={13} />
                                                                        </button>
                                                                        {activeRowActionsDropdown === group.key && (
                                                                            <>
                                                                                <div 
                                                                                    className="fixed inset-0 z-40" 
                                                                                    onClick={(e) => { e.stopPropagation(); setActiveRowActionsDropdown(null); }}
                                                                                ></div>
                                                                                <div className="absolute right-0 mt-1.5 w-32 bg-white border border-slate-100 rounded-xl shadow-lg py-1.5 z-50 animate-in fade-in slide-in-from-top-1">
                                                                                    <button
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            setActiveRowActionsDropdown(null);
                                                                                            handleDeleteItem(group.primaryItem._id);
                                                                                        }}
                                                                                        className="w-full text-left px-3 py-1.5 text-xs text-red-650 hover:bg-red-50 hover:text-red-700 transition-colors font-bold flex items-center gap-1.5"
                                                                                    >
                                                                                        <Trash2 size={12} /> Delete Item
                                                                                    </button>
                                                                                </div>
                                                                            </>
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                    {isExpanded && group.variants.length > 0 && (
                                                        <tr>
                                                            <td colSpan={6} className="bg-slate-50/50 px-12 py-3 border-b border-slate-100">
                                                                <div className="flex flex-col gap-1.5">
                                                                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-0.5">Item Variants</span>
                                                                    <div className="flex flex-wrap gap-1.5">
                                                                        {group.variants.map((variant) => (
                                                                            <span 
                                                                                key={variant.name} 
                                                                                className="inline-flex items-center text-[10px] font-bold bg-white text-slate-650 px-2.5 py-1 rounded-lg border border-slate-150 shadow-sm"
                                                                            >
                                                                                {variant.name}
                                                                            </span>
                                                                        ))}
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
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                                {paginatedGroups.map(group => (
                                    <div
                                        key={group.key}
                                        onClick={() => setExpandedInventoryGroup(expandedInventoryGroup === group.key ? null : group.key)}
                                        className="group relative bg-white rounded-2xl border border-slate-150 shadow-sm hover:shadow-md transition-all p-5 flex flex-col justify-between overflow-hidden cursor-pointer"
                                    >
                                        <div className="absolute top-0 right-0 left-0 h-1 bg-gradient-to-r from-blue-500 to-indigo-500"></div>
                                        
                                        <div>
                                            <div className="flex justify-between items-start mb-4">
                                                {getCategoryIcon(group.category)}
                                                {getCategoryBadge(group.category)}
                                            </div>
                                            
                                            <h3 className="text-sm font-bold text-slate-800 transition-colors line-clamp-1">{group.itemName}</h3>
                                            
                                            {expandedInventoryGroup === group.key && group.variants.length > 0 && (
                                                <div className="mt-2.5 flex flex-wrap gap-1">
                                                    {group.variants.map((variant) => (
                                                        <span key={variant.name} className="text-[9px] font-bold bg-slate-50 text-slate-650 px-2 py-0.5 rounded border border-slate-150">
                                                            {variant.name}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                            
                                            <div className="mt-3 text-[10px] font-bold text-slate-400 uppercase tracking-tighter flex items-center gap-1.5 pt-2.5 border-t border-slate-50">
                                                Measured In: <span className="text-slate-700">{group.unit || 'PCS'}</span>
                                            </div>
                                            
                                            <p className="mt-3 text-xs text-slate-500 line-clamp-2 italic leading-relaxed h-8 font-medium">
                                                {group.description || 'No detailed description provided for this item.'}
                                            </p>
                                        </div>

                                        <div className="mt-5 pt-3.5 border-t border-slate-100 flex items-center justify-between">
                                            <div className="flex gap-2">
                                                {canEditItems && (
                                                    <button 
                                                        onClick={(e) => { e.stopPropagation(); openEditModal(group.primaryItem, group); }}
                                                        className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all border border-slate-150 bg-white cursor-pointer"
                                                        title="Edit Item"
                                                    >
                                                        <Edit size={14} />
                                                    </button>
                                                )}
                                                {canDeleteItems && (
                                                    <button 
                                                        onClick={(e) => { e.stopPropagation(); handleDeleteItem(group.primaryItem._id); }}
                                                        className="p-1.5 text-slate-400 hover:text-red-650 hover:bg-red-50 rounded-lg transition-all border border-slate-150 bg-white cursor-pointer"
                                                        title="Delete Item"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                )}
                                            </div>
                                            <span className="text-[10px] font-bold text-slate-350 uppercase italic">{group.variants.length} variant(s)</span>
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

                    {/* Pagination footer */}
                    {totalPages > 1 && (
                        <div className="flex flex-col md:flex-row items-center justify-between gap-4 mt-6 pt-4 border-t border-slate-100 text-xs font-semibold text-slate-500">
                            <div>
                                Showing {totalItemsCount > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0} to {Math.min(currentPage * itemsPerPage, totalItemsCount)} of {totalItemsCount} items
                            </div>
                            
                            <div className="flex items-center gap-1">
                                <button
                                    disabled={currentPage === 1}
                                    onClick={() => setCurrentPage(currentPage - 1)}
                                    className="p-1.5 rounded-lg border border-slate-205 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-slate-650 bg-white cursor-pointer"
                                >
                                    <ChevronLeft size={14} />
                                </button>
                                
                                {pageNumbers.map((num, i) => (
                                    num === '...' ? (
                                        <span key={i} className="px-2 text-slate-400 font-bold">...</span>
                                    ) : (
                                        <button
                                            key={i}
                                            onClick={() => setCurrentPage(num)}
                                            className={`w-7 h-7 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                                currentPage === num
                                                    ? 'bg-[#2563EB] text-white shadow-md'
                                                    : 'border border-slate-205 hover:bg-slate-50 text-slate-650 bg-white'
                                            }`}
                                        >
                                            {num}
                                        </button>
                                    )
                                ))}
                                
                                <button
                                    disabled={currentPage === totalPages || totalPages === 0}
                                    onClick={() => setCurrentPage(currentPage + 1)}
                                    className="p-1.5 rounded-lg border border-slate-205 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-slate-650 bg-white cursor-pointer"
                                >
                                    <ChevronRight size={14} />
                                </button>
                            </div>
                            
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] uppercase font-bold text-slate-400">Rows:</span>
                                <select
                                    value={itemsPerPage}
                                    onChange={(e) => {
                                        setItemsPerPage(Number(e.target.value));
                                        setCurrentPage(1);
                                    }}
                                    className="border border-slate-200 rounded-lg bg-white px-2 py-1.5 outline-none text-slate-650 cursor-pointer font-bold text-[11px]"
                                >
                                    <option value={5}>5 / page</option>
                                    <option value={10}>10 / page</option>
                                    <option value={20}>20 / page</option>
                                    <option value={50}>50 / page</option>
                                </select>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* TAB: Vendors */}
            {activeTab === TABS.vendors && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 animate-in fade-in duration-200">
                    {/* Controls row */}
                    <div className="flex flex-col md:flex-row gap-4 justify-between items-center mb-6">
                        <div className="relative w-full md:w-96 group">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500 transition-colors" size={16} />
                            <input
                                type="text"
                                placeholder="Search vendors by name, email, phone..."
                                className="w-full pl-11 pr-4 py-2.5 rounded-xl border border-slate-200 focus:ring-4 focus:ring-blue-50 focus:border-blue-400 outline-none transition-all text-xs font-medium bg-white text-slate-700 shadow-sm"
                                value={vendorSearchTerm}
                                onChange={(e) => setVendorSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>

                    {vendorsLoading ? (
                        <div className="py-20 flex justify-center"><Loader text="Fetching vendors..." /></div>
                    ) : filteredVendors.length > 0 ? (
                        <div className="overflow-x-auto border border-slate-100 rounded-2xl">
                            <table className="w-full text-left border-collapse text-xs">
                                <thead>
                                    <tr className="bg-slate-50 border-b border-slate-100 text-[10px] uppercase text-slate-450 font-black tracking-wider">
                                        <th className="px-6 py-4 rounded-l-xl">Vendor</th>
                                        <th className="px-6 py-4">Contact Person</th>
                                        <th className="px-6 py-4">Phone & Email</th>
                                        <th className="px-6 py-4">Address</th>
                                        <th className="px-6 py-4 text-right rounded-r-xl">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {filteredVendors.map(v => (
                                        <tr key={v._id} className="hover:bg-slate-50/50 transition-colors">
                                            <td className="px-6 py-4">
                                                <div className="font-bold text-slate-800">{v.name}</div>
                                            </td>
                                            <td className="px-6 py-4 text-slate-700 font-bold">
                                                {v.contactPerson || 'N/A'}
                                            </td>
                                            <td className="px-6 py-4 text-slate-600 font-semibold">
                                                <div>{v.phone || 'N/A'}</div>
                                                <div className="text-[10px] opacity-60 mt-0.5">{v.email || ''}</div>
                                            </td>
                                            <td className="px-6 py-4 text-slate-500 font-medium max-w-xs truncate">
                                                {v.address || 'N/A'}
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <div className="flex justify-end gap-1.5">
                                                    <button 
                                                        onClick={() => {
                                                            setEditingVendor(v);
                                                            setVendorFormData(v);
                                                            setIsVendorModalOpen(true);
                                                        }} 
                                                        className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 border border-slate-150 bg-white rounded-lg transition-all cursor-pointer"
                                                        title="Edit Vendor"
                                                    >
                                                        <Edit size={13} />
                                                    </button>
                                                    <button 
                                                        onClick={() => handleDeleteVendor(v._id)} 
                                                        className="p-1.5 text-slate-400 hover:text-red-650 hover:bg-red-50 border border-slate-150 bg-white rounded-lg transition-all cursor-pointer"
                                                        title="Delete Vendor"
                                                    >
                                                        <Trash2 size={13} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="py-20 text-center text-slate-400 bg-slate-50 rounded-lg border-2 border-dashed border-slate-100">
                            <AlertCircle className="mx-auto mb-3 opacity-20" size={48} />
                            <p className="font-medium">No vendors found.</p>
                        </div>
                    )}
                </div>
            )}

            {/* TAB: Tyre Registry */}
            {activeTab === TABS.tyreRegistry && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 animate-in fade-in duration-200">
                    <div className="flex flex-col md:flex-row gap-4 justify-between items-center mb-6">
                        <div className="relative flex items-center bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 shrink-0">
                            <Filter size={15} className="text-slate-400 absolute left-3 pointer-events-none" />
                            <select 
                                className="pl-7 pr-6 bg-transparent border-none outline-none text-xs font-bold text-slate-705 cursor-pointer appearance-none"
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
                            <ChevronDown size={14} className="text-slate-400 absolute right-3 pointer-events-none" />
                        </div>
                    </div>

                    {registryLoading ? (
                        <div className="py-20 flex justify-center"><Loader text="Fetching registry..." /></div>
                    ) : tyreRegistry.length > 0 ? (
                        <div className="overflow-x-auto border border-slate-100 rounded-2xl">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="border-b border-slate-100 text-[11px] uppercase text-slate-450 font-black tracking-widest bg-slate-50/50">
                                        <th className="px-6 py-4 rounded-l-xl">Vehicle</th>
                                        <th className="px-6 py-4">Position</th>
                                        <th className="px-6 py-4">Type</th>
                                        <th className="px-6 py-4">Install KM</th>
                                        <th className="px-6 py-4 text-right rounded-r-xl">Last Updated</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {tyreRegistry.map(reg => (
                                        <tr key={reg._id} className="hover:bg-slate-50/50 transition-colors">
                                            <td className="px-6 py-4 font-bold text-slate-800 text-xs">
                                                <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-lg border border-slate-200">
                                                    {reg.busId?.vehicleNumber || reg.busId?.busNumber || 'N/A'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 uppercase font-bold text-xs text-blue-600">{reg.position}</td>
                                            <td className="px-6 py-4 text-xs font-semibold">
                                                <span className={`px-2.5 py-1 rounded-lg border ${reg.tyreType === 'new tyre' ? 'bg-green-50 text-green-705 border-green-100' : 'bg-amber-50 text-amber-705 border-amber-105'}`}>
                                                    {reg.tyreType}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-xs font-bold text-slate-750">{reg.installKm} KM</td>
                                            <td className="px-6 py-4 text-xs text-slate-400 text-right font-medium">{new Date(reg.updatedAt).toLocaleString()}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="py-20 text-center text-slate-400 bg-slate-50 rounded-lg border-2 border-dashed border-slate-100">
                            <AlertCircle className="mx-auto mb-3 opacity-20" size={48} />
                            <p className="font-medium">No active tyres found in registry.</p>
                        </div>
                    )}
                </div>
            )}

            {/* MODALS SECTION */}

            {/* 1. Item Modal (Variants add / edit) */}
            <Modal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title={editingItem ? 'Edit Inventory Item / Variant' : 'Add New Item Variants'}
            >
                <form onSubmit={handleItemSubmit} className="space-y-4">
                    <div>
                        <label className="block text-[10px] font-black uppercase text-slate-400 mb-1.5 tracking-wider">Item Group / Category</label>
                        <input
                            required
                            type="text"
                            placeholder="e.g. Mirror, Filter, Engine Oil"
                            list="inventory-item-groups"
                            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-4 focus:ring-blue-50 focus:border-blue-500 outline-none transition-all font-medium text-xs bg-white text-slate-700"
                            value={itemFormData.itemName}
                            onChange={(e) => setItemFormData({ ...itemFormData, itemName: e.target.value })}
                        />
                        <datalist id="inventory-item-groups">
                            {itemGroupOptions.map((name) => (
                                <option key={name} value={name} />
                            ))}
                        </datalist>
                        <p className="text-[10px] text-slate-400 mt-1 font-semibold">Use this as the parent item name. Examples: Mirror, Filter, Tyre.</p>
                    </div>
                    <div>
                        <label className="block text-[10px] font-black uppercase text-slate-400 mb-1.5 tracking-wider">Variants</label>
                        <div className="space-y-2">
                            {itemFormData.variantNames.map((variant, index) => (
                                <div key={index} className="flex gap-2">
                                    <input
                                        type="text"
                                        placeholder={index === 0 ? 'e.g. Left Mirror' : 'Another variant'}
                                        className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-4 focus:ring-blue-50 focus:border-blue-500 outline-none transition-all font-medium text-xs bg-white text-slate-700"
                                        value={variant}
                                        onChange={(e) => updateVariantRow(index, e.target.value)}
                                    />
                                    {itemFormData.variantNames.length > 1 && (
                                        <button
                                            type="button"
                                            onClick={() => removeVariantRow(index)}
                                            className="px-2.5 rounded-xl border border-red-100 text-red-500 hover:bg-red-50 hover:text-red-650 cursor-pointer transition-colors"
                                            title="Remove variant"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    )}
                                </div>
                            ))}
                            <button
                                type="button"
                                onClick={addVariantRow}
                                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-50 text-blue-700 text-[10px] font-bold uppercase tracking-wide hover:bg-blue-100 cursor-pointer transition-colors"
                            >
                                <Plus size={13} /> Add Variant
                            </button>
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1 font-semibold">
                            Add one row per variant. Leave all variants blank to keep only the item group.
                        </p>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-[10px] font-black uppercase text-slate-400 mb-1.5 tracking-wider">Inventory Type</label>
                            <select
                                required
                                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-4 focus:ring-blue-50 focus:border-blue-500 outline-none transition-all font-bold text-xs bg-white text-slate-700 cursor-pointer"
                                value={itemFormData.category}
                                onChange={(e) => setItemFormData({ ...itemFormData, category: e.target.value })}
                            >
                                {CATEGORIES.map(cat => (
                                    <option key={cat} value={cat}>{cat}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-[10px] font-black uppercase text-slate-400 mb-1.5 tracking-wider">Unit</label>
                            <select
                                required
                                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-4 focus:ring-blue-50 focus:border-blue-500 outline-none transition-all font-bold text-xs bg-white text-slate-700 cursor-pointer"
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
                        <label className="block text-[10px] font-black uppercase text-slate-400 mb-1.5 tracking-wider">Description</label>
                        <textarea
                            rows="2"
                            placeholder="Optional notes..."
                            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-4 focus:ring-blue-50 focus:border-blue-500 outline-none transition-all font-medium text-xs bg-white text-slate-700"
                            value={itemFormData.description}
                            onChange={(e) => setItemFormData({ ...itemFormData, description: e.target.value })}
                        />
                    </div>
                    <div className="flex gap-3 pt-3">
                        <button 
                            type="button" 
                            onClick={() => setIsModalOpen(false)} 
                            className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 font-bold text-slate-600 hover:bg-slate-50 transition-all text-xs cursor-pointer"
                        >
                            Cancel
                        </button>
                        <button 
                            type="submit" 
                            className="flex-1 px-4 py-2.5 rounded-xl bg-slate-900 text-white font-bold hover:bg-slate-800 transition-all shadow-lg active:scale-95 text-xs cursor-pointer"
                        >
                            {creatingMultipleVariants ? `Save ${filledVariantNames.length} Variants` : 'Save Item'}
                        </button>
                    </div>
                </form>
            </Modal>

            {/* 2. Vendor Modal */}
            <Modal
                isOpen={isVendorModalOpen}
                onClose={() => {
                    setIsVendorModalOpen(false);
                    setEditingVendor(null);
                    setVendorFormData({ name: '', contactPerson: '', phone: '', email: '', address: '' });
                }}
                title={editingVendor ? 'Edit Vendor' : 'Add New Vendor'}
            >
                <form onSubmit={handleVendorSubmit} className="space-y-4">
                    <div>
                        <label className="block text-[10px] font-black uppercase text-slate-400 mb-1.5 tracking-wider">Vendor Name</label>
                        <input 
                            required 
                            type="text"
                            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-4 focus:ring-blue-50 focus:border-blue-500 outline-none transition-all font-medium text-xs bg-white text-slate-700" 
                            value={vendorFormData.name} 
                            onChange={e => setVendorFormData({...vendorFormData, name: e.target.value})} 
                        />
                    </div>
                    <div>
                        <label className="block text-[10px] font-black uppercase text-slate-400 mb-1.5 tracking-wider">Contact Person</label>
                        <input 
                            type="text"
                            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-4 focus:ring-blue-50 focus:border-blue-500 outline-none transition-all font-medium text-xs bg-white text-slate-700" 
                            value={vendorFormData.contactPerson} 
                            onChange={e => setVendorFormData({...vendorFormData, contactPerson: e.target.value})} 
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-[10px] font-black uppercase text-slate-400 mb-1.5 tracking-wider">Phone</label>
                            <input 
                                type="text"
                                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-4 focus:ring-blue-50 focus:border-blue-500 outline-none transition-all font-medium text-xs bg-white text-slate-700" 
                                value={vendorFormData.phone} 
                                onChange={e => setVendorFormData({...vendorFormData, phone: e.target.value})} 
                            />
                        </div>
                        <div>
                            <label className="block text-[10px] font-black uppercase text-slate-400 mb-1.5 tracking-wider">Email</label>
                            <input 
                                type="email" 
                                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-4 focus:ring-blue-50 focus:border-blue-500 outline-none transition-all font-medium text-xs bg-white text-slate-700" 
                                value={vendorFormData.email} 
                                onChange={e => setVendorFormData({...vendorFormData, email: e.target.value})} 
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-[10px] font-black uppercase text-slate-400 mb-1.5 tracking-wider">Address</label>
                        <textarea 
                            rows="2"
                            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-4 focus:ring-blue-50 focus:border-blue-500 outline-none transition-all font-medium text-xs bg-white text-slate-700" 
                            value={vendorFormData.address} 
                            onChange={e => setVendorFormData({...vendorFormData, address: e.target.value})} 
                        />
                    </div>
                    <div className="flex gap-3 pt-3">
                        <button 
                            type="button" 
                            onClick={() => setIsVendorModalOpen(false)} 
                            className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 font-bold text-slate-650 hover:bg-slate-50 transition-all text-xs cursor-pointer"
                        >
                            Cancel
                        </button>
                        <button 
                            type="submit" 
                            className="flex-1 bg-slate-900 hover:bg-slate-800 text-white font-bold py-2.5 rounded-xl transition-all shadow-lg active:scale-95 text-xs cursor-pointer"
                        >
                            {editingVendor ? 'Update Vendor' : 'Save Vendor'}
                        </button>
                    </div>
                </form>
            </Modal>

            {/* Hidden Print Area */}
            <div className="hidden print:block absolute top-0 left-0 w-full">
                {printBill && (
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
