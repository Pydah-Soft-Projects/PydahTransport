import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import Modal from '../components/Modal';
import Loader from '../components/Loader';
import { apiFetch } from '../utils/api';
import { campusIdsMatch, filterCampusesForUser, getCampusId } from '../utils/campus';
import {
    Bus,
    Users,
    User,
    MapPin,
    Edit,
    Trash2,
    Plus,
    UserCheck,
    Armchair,
    X,
    History,
    AlertTriangle,
    Truck,
    ChevronLeft,
    ChevronRight
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL || '';

const TABS = { buses: 'buses', otherVehicles: 'otherVehicles', mapping: 'mapping', staffMapping: 'staffMapping', staff: 'staff', taxHeaders: 'taxHeaders' };


const todayDateInput = () => new Date().toISOString().slice(0, 10);

const normalizeStaffName = (name) => (name || '').trim().toLowerCase();

const matchStaffByName = (list, name) =>
    list.find((s) => normalizeStaffName(s.employee_name) === normalizeStaffName(name));

const withCurrentStaffOption = (list, currentName) => {
    if (!currentName) return list;
    if (list.some((s) => s.employee_name === currentName)) return list;
    return [{ _id: 'current-assigned', employee_name: currentName, emp_no: 'Assigned' }, ...list];
};

const BusManagement = () => {
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState(TABS.buses);
    const [staffSubTab, setStaffSubTab] = useState('drivers');
    const [mappingSubTab, setMappingSubTab] = useState('busWise');
    const [expandedBusEditId, setExpandedBusEditId] = useState(null);
    const [expandedRouteEditId, setExpandedRouteEditId] = useState(null);
    const [routeWiseDrafts, setRouteWiseDrafts] = useState({});

    const [buses, setBuses] = useState([]);
    const [otherVehicles, setOtherVehicles] = useState([]);
    const [isOtherVehicleMode, setIsOtherVehicleMode] = useState(false);
    const [routes, setRoutes] = useState([]);
    const [campuses, setCampuses] = useState([]);
    const [selectedCampusFilter, setSelectedCampusFilter] = useState('');
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [assigningBusId, setAssigningBusId] = useState(null);
    const [assigningStaffBusId, setAssigningStaffBusId] = useState(null);
    const [drivers, setDrivers] = useState([]);
    const [cleaners, setCleaners] = useState([]);
    const [driversLoading, setDriversLoading] = useState(false);
    const [cleanersLoading, setCleanersLoading] = useState(false);
    const [staffDrafts, setStaffDrafts] = useState({});
    const [routeDrafts, setRouteDrafts] = useState({});
    const [formData, setFormData] = useState({
        busNumber: '',
        capacity: '',
        type: 'Standard',
        vehicleModel: '',
        registrationDate: '',
        status: 'Active',
        campus: '',
        driverName: '',
        attendantName: ''
    });
    const [isTaxesModalOpen, setIsTaxesModalOpen] = useState(false);
    const [selectedBusForTaxes, setSelectedBusForTaxes] = useState(null);
    const selectedBusForTaxesRef = useRef(null); // mirrors selectedBusForTaxes for use inside async callbacks
    const [taxHeaders, setTaxHeaders] = useState([]);
    const [taxHeadersLoading, setTaxHeadersLoading] = useState(true);
    const [isTaxHeaderModalOpen, setIsTaxHeaderModalOpen] = useState(false);
    const [editingTaxHeaderId, setEditingTaxHeaderId] = useState(null);
    const [newTaxHeader, setNewTaxHeader] = useState({
        taxName: '',
        description: '',
        defaultAmount: '',
        isActive: true
    });
    
    // Taxes table state - tracks amount and endDate for each tax header on the selected bus
    const [taxValues, setTaxValues] = useState({}); // { taxHeaderName: { amount: '', endDate: '' } }
    const [taxToast, setTaxToast] = useState({ text: '', type: '' }); // inline toast for the taxes modal

    // Tax History Modal
    const [isTaxHistoryModalOpen, setIsTaxHistoryModalOpen] = useState(false);
    const [taxHistoryData, setTaxHistoryData] = useState(null);        // { taxHeader, history[], stats{} }
    const [taxHistoryLoading, setTaxHistoryLoading] = useState(false);

    // Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10;

    useEffect(() => {
        setCurrentPage(1);
    }, [activeTab, staffSubTab, mappingSubTab, selectedCampusFilter]);

    const fetchBuses = async () => {
        try {
            const response = await apiFetch(`${API}/buses`);
            const data = await response.json();
            const busList = Array.isArray(data) ? data : [];
            setBuses(busList);

            // Sync the open modal's bus + taxValues with fresh data
            const currentSelected = selectedBusForTaxesRef.current;
            if (currentSelected) {
                const fresh = busList.find(b => b._id === currentSelected._id);
                if (fresh) {
                    setSelectedBusForTaxes(fresh);
                    selectedBusForTaxesRef.current = fresh;
                    // Rebuild taxValues from saved data so expired warnings recompute
                    const updatedValues = {};
                    (fresh.taxes || []).forEach(tax => {
                        updatedValues[tax.taxHeader] = {
                            amount: tax.amount.toString(),
                            endDate: tax.endDate ? new Date(tax.endDate).toISOString().slice(0, 10) : ''
                        };
                    });
                    setTaxValues(updatedValues);
                }
            }

            return busList;
        } catch (error) {
            console.error('Error fetching buses:', error);
            setBuses([]);
            return [];
        } finally {
            setLoading(false);
        }
    };

    const fetchOtherVehicles = async () => {
        try {
            const response = await apiFetch(`${API}/other-vehicles`);
            const data = await response.json();
            const vehicleList = Array.isArray(data) ? data : [];
            setOtherVehicles(vehicleList);

            // Sync the open modal's vehicle + taxValues with fresh data
            const currentSelected = selectedBusForTaxesRef.current;
            if (currentSelected) {
                const fresh = vehicleList.find(b => b._id === currentSelected._id);
                if (fresh) {
                    setSelectedBusForTaxes(fresh);
                    selectedBusForTaxesRef.current = fresh;
                    const updatedValues = {};
                    (fresh.taxes || []).forEach(tax => {
                        updatedValues[tax.taxHeader] = {
                            amount: tax.amount.toString(),
                            endDate: tax.endDate ? new Date(tax.endDate).toISOString().slice(0, 10) : ''
                        };
                    });
                    setTaxValues(updatedValues);
                }
            }

            return vehicleList;
        } catch (error) {
            console.error('Error fetching other vehicles:', error);
            setOtherVehicles([]);
            return [];
        } finally {
            setLoading(false);
        }
    };

    const fetchRoutes = async () => {
        try {
            const response = await apiFetch(`${API}/routes`);
            const data = await response.json();
            setRoutes(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error('Error fetching routes:', error);
            setRoutes([]);
        }
    };

    const loadDrivers = async () => {
        setDriversLoading(true);
        try {
            const adminInfo = JSON.parse(localStorage.getItem('adminInfo'));
            const token = adminInfo?.token;

            if (!token) {
                console.error('No token found in localStorage');
                setDrivers([]);
                return [];
            }

            const response = await apiFetch(`${API}/employees/drivers`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            const data = await response.json();
            const list = Array.isArray(data) ? data : [];
            setDrivers(list);
            return list;
        } catch (error) {
            console.error('Error fetching drivers:', error);
            setDrivers([]);
            return [];
        } finally {
            setDriversLoading(false);
        }
    };

    const loadCleaners = async () => {
        setCleanersLoading(true);
        try {
            const adminInfo = JSON.parse(localStorage.getItem('adminInfo'));
            const token = adminInfo?.token;

            if (!token) {
                setCleaners([]);
                return [];
            }

            const response = await apiFetch(`${API}/employees/cleaners`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            const data = await response.json();
            const list = Array.isArray(data) ? data : [];
            setCleaners(list);
            return list;
        } catch (error) {
            console.error('Error fetching cleaners:', error);
            setCleaners([]);
            return [];
        } finally {
            setCleanersLoading(false);
        }
    };

    const fetchCampuses = async () => {
        try {
            const response = await apiFetch(`${API}/campuses`);
            const data = await response.json();
            setCampuses(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error('Error fetching campuses:', error);
        }
    };

    const fetchTaxHeaders = async () => {
        setTaxHeadersLoading(true);
        try {
            const response = await apiFetch(`${API}/tax-headers`);
            const data = await response.json();
            setTaxHeaders(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error('Error fetching tax headers:', error);
            setTaxHeaders([]);
        } finally {
            setTaxHeadersLoading(false);
        }
    };

    useEffect(() => {
        fetchBuses();
        fetchOtherVehicles();
        fetchRoutes();
        loadDrivers();
        loadCleaners();
        fetchTaxHeaders();
        fetchCampuses();
    }, []);

    const filteredBuses = selectedCampusFilter
        ? buses.filter((bus) => campusIdsMatch(getCampusId(bus.campus), selectedCampusFilter))
        : buses;

    const adminInfo = JSON.parse(localStorage.getItem('adminInfo') || '{}');
    const userCampuses = adminInfo.campuses || [];
    const isSuperAdmin = adminInfo.role === 'admin' || (adminInfo.roles && adminInfo.roles.includes('superadmin'));

    const allowedCampuses = filterCampusesForUser(campuses, userCampuses, isSuperAdmin);

    useEffect(() => {
        if (campuses.length > 0 && !isSuperAdmin && userCampuses.length === 1) {
            setSelectedCampusFilter(String(userCampuses[0]));
        }
    }, [campuses]);

    const buildStaffDraft = (bus) => ({
        driverName: bus.driverName || '',
        attendantName: bus.attendantName || '',
        driverExitDate: todayDateInput(),
        driverEntryDate: todayDateInput(),
        cleanerExitDate: todayDateInput(),
        cleanerEntryDate: todayDateInput(),
    });

    const buildRouteDraft = (bus) => ({
        routeId: bus.assignedRouteId || '',
        exitDate: todayDateInput(),
        entryDate: todayDateInput(),
    });

    const getRouteLabel = (routeId) => {
        if (!routeId) return '—';
        const route = routes.find((r) => r.routeId === routeId);
        return route ? `${route.routeName} (${route.routeId})` : routeId;
    };

    useEffect(() => {
        if (!buses.length) return;
        setStaffDrafts(Object.fromEntries(buses.map((bus) => [bus._id, buildStaffDraft(bus)])));
        setRouteDrafts(Object.fromEntries(buses.map((bus) => [bus._id, buildRouteDraft(bus)])));
        if (routes.length) {
            setRouteWiseDrafts(
                Object.fromEntries(routes.map((r) => [r.routeId, buildRouteWiseDraft(r.routeId)]))
            );
        }
    }, [buses, routes]);

    const buildRouteWiseDraft = (routeId) => {
        const currentBus = buses.find((b) => b.assignedRouteId === routeId);
        return {
            busId: currentBus ? currentBus._id : '',
            exitDate: todayDateInput(),
            entryDate: todayDateInput(),
        };
    };

    const handleRouteWiseDraftChange = (routeId, busId) => {
        setRouteWiseDrafts((prev) => ({
            ...prev,
            [routeId]: {
                ...(prev[routeId] || { exitDate: todayDateInput(), entryDate: todayDateInput() }),
                busId,
            },
        }));
    };

    const handleRouteWiseDraftDateChange = (routeId, field, value) => {
        setRouteWiseDrafts((prev) => ({
            ...prev,
            [routeId]: { ...prev[routeId], [field]: value },
        }));
    };

    const hasRouteWiseDraftChanges = (route) => {
        const draft = routeWiseDrafts[route.routeId] || buildRouteWiseDraft(route.routeId);
        const currentBus = buses.find((b) => b.assignedRouteId === route.routeId);
        const previousBusId = currentBus ? currentBus._id : '';
        return (draft.busId || '') !== previousBusId;
    };

    const handleRouteWiseSaveClick = async (route) => {
        const draft = routeWiseDrafts[route.routeId] || buildRouteWiseDraft(route.routeId);
        const currentBus = buses.find((b) => b.assignedRouteId === route.routeId);
        const previousBusId = currentBus ? currentBus._id : '';
        const newBusId = draft.busId || '';

        if (previousBusId === newBusId) {
            alert('No changes to save for this route.');
            return;
        }
        if (previousBusId && !draft.exitDate) {
            alert('Please set the exit date for the previous bus.');
            return;
        }
        if (newBusId && !draft.entryDate) {
            alert('Please set the assignment date for the new bus.');
            return;
        }

        setAssigningBusId(route._id);
        try {
            let totalCalls = 0;
            let successCount = 0;

            if (previousBusId && previousBusId !== newBusId) {
                totalCalls++;
                const res = await apiFetch(`${API}/buses/${previousBusId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        routeChange: {
                            newRouteId: null,
                            exitDate: draft.exitDate,
                            entryDate: null,
                        },
                    }),
                });
                if (res.ok) successCount++;
            }

            if (newBusId && newBusId !== previousBusId) {
                totalCalls++;
                const res = await apiFetch(`${API}/buses/${newBusId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        routeChange: {
                            newRouteId: route.routeId,
                            exitDate: null,
                            entryDate: draft.entryDate,
                        },
                    }),
                });
                if (res.ok) successCount++;
            }

            if (totalCalls === 0 || successCount === totalCalls) {
                await fetchBuses();
                setExpandedRouteEditId(null);
            } else {
                alert('Partial error updating bus-route assignment.');
                await fetchBuses();
            }
        } catch (e) {
            console.error(e);
            alert('Error updating bus assignment');
        } finally {
            setAssigningBusId(null);
        }
    };

    const handleRouteDraftChange = (busId, routeId) => {
        setRouteDrafts((prev) => ({
            ...prev,
            [busId]: {
                ...(prev[busId] || { exitDate: todayDateInput(), entryDate: todayDateInput() }),
                routeId,
            },
        }));
    };

    const handleRouteDraftDateChange = (busId, field, value) => {
        setRouteDrafts((prev) => ({
            ...prev,
            [busId]: { ...prev[busId], [field]: value },
        }));
    };

    const hasRouteDraftChanges = (bus) => {
        const draft = routeDrafts[bus._id] || buildRouteDraft(bus);
        return (draft.routeId || '') !== (bus.assignedRouteId || '');
    };

    const handleRouteSaveClick = async (bus) => {
        const draft = routeDrafts[bus._id] || buildRouteDraft(bus);
        const previousRouteId = bus.assignedRouteId || '';
        const newRouteId = draft.routeId || '';

        if (previousRouteId === newRouteId) {
            alert('No route changes to save for this bus.');
            return;
        }
        if (previousRouteId && !draft.exitDate) {
            alert('Please set the exit date for the previous route.');
            return;
        }
        if (newRouteId && !draft.entryDate) {
            alert('Please set the assignment date for the new route.');
            return;
        }

        setAssigningBusId(bus._id);
        try {
            const response = await apiFetch(`${API}/buses/${bus._id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    routeChange: {
                        newRouteId: newRouteId || null,
                        exitDate: previousRouteId ? draft.exitDate : null,
                        entryDate: newRouteId ? draft.entryDate : null,
                    },
                }),
            });
            if (response.ok) {
                fetchBuses();
                setExpandedBusEditId(null);
            } else {
                const data = await response.json().catch(() => ({}));
                alert(data.message || 'Failed to update route assignment');
            }
        } catch (e) {
            console.error(e);
            alert('Error updating route assignment');
        } finally {
            setAssigningBusId(null);
        }
    };

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: value
        }));
    };

    const formatDateForInput = (value) => {
        if (!value) return '';
        try {
            return new Date(value).toISOString().slice(0, 10);
        } catch {
            return '';
        }
    };

    const handleEdit = (vehicle, e) => {
        e.stopPropagation();
        const isOther = otherVehicles.some(v => v._id === vehicle._id);
        setIsOtherVehicleMode(isOther);
        setFormData({
            busNumber: isOther ? vehicle.vehicleNumber : vehicle.busNumber,
            capacity: vehicle.capacity,
            type: vehicle.type,
            vehicleModel: vehicle.vehicleModel || '',
            registrationDate: formatDateForInput(vehicle.registrationDate),
            status: vehicle.status,
            campus: getCampusId(vehicle.campus) || '',
            driverName: vehicle.driverName || '',
            attendantName: vehicle.attendantName || ''
        });
        setEditingId(vehicle._id);
        setIsModalOpen(true);
    };

    const handleDelete = async (id, e) => {
        e.stopPropagation();
        const isOther = otherVehicles.some(v => v._id === id);
        const nameLabel = isOther ? 'vehicle' : 'bus';
        if (!window.confirm(`Are you sure you want to delete this ${nameLabel}?`)) return;

        try {
            const baseUrl = isOther ? `${API}/other-vehicles` : `${API}/buses`;
            const response = await apiFetch(`${baseUrl}/${id}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                if (isOther) {
                    fetchOtherVehicles();
                } else {
                    fetchBuses();
                }
            } else {
                alert(`Failed to delete ${nameLabel}`);
            }
        } catch (error) {
            console.error(`Error deleting ${nameLabel}:`, error);
            alert(`Error deleting ${nameLabel}`);
        }
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setEditingId(null);
        setIsOtherVehicleMode(false);
        setFormData({
            busNumber: '',
            capacity: '',
            type: 'Standard',
            vehicleModel: '',
            registrationDate: '',
            status: 'Active',
            campus: '',
            driverName: '',
            attendantName: ''
        });
    };

    const handleStaffDraftChange = (busId, field, value) => {
        setStaffDrafts((prev) => ({
            ...prev,
            [busId]: {
                ...(prev[busId] || buildStaffDraft({ driverName: '', attendantName: '' })),
                [field]: value,
            },
        }));
    };

    const handleStaffDraftDateChange = (busId, field, value) => {
        setStaffDrafts((prev) => ({
            ...prev,
            [busId]: { ...prev[busId], [field]: value },
        }));
    };

    const handleDismissStaffChanges = (bus) => {
        setStaffDrafts((prev) => ({
            ...prev,
            [bus._id]: buildStaffDraft(bus),
        }));
    };

    const hasStaffDraftChanges = (bus) => {
        const draft = staffDrafts[bus._id] || {
            driverName: bus.driverName || '',
            attendantName: bus.attendantName || '',
        };
        return (
            normalizeStaffName(draft.driverName) !== normalizeStaffName(bus.driverName) ||
            normalizeStaffName(draft.attendantName) !== normalizeStaffName(bus.attendantName)
        );
    };

    const handleStaffSaveClick = async (bus) => {
        const draft = staffDrafts[bus._id] || buildStaffDraft(bus);
        const driverChanged = normalizeStaffName(draft.driverName) !== normalizeStaffName(bus.driverName);
        const cleanerChanged = normalizeStaffName(draft.attendantName) !== normalizeStaffName(bus.attendantName);

        if (!driverChanged && !cleanerChanged) {
            alert('No changes to save for this bus.');
            return;
        }

        if (driverChanged) {
            if (bus.driverName && !draft.driverExitDate) {
                alert('Please set the exit date for the previous driver.');
                return;
            }
            if (draft.driverName && !draft.driverEntryDate) {
                alert('Please set the entry date for the new driver.');
                return;
            }
        }
        if (cleanerChanged) {
            if (bus.attendantName && !draft.cleanerExitDate) {
                alert('Please set the exit date for the previous cleaner.');
                return;
            }
            if (draft.attendantName && !draft.cleanerEntryDate) {
                alert('Please set the entry date for the new cleaner.');
                return;
            }
        }

        const staffChanges = {};
        if (driverChanged) {
            staffChanges.driver = {
                previousName: bus.driverName || null,
                newName: draft.driverName || null,
                exitDate: bus.driverName ? draft.driverExitDate : null,
                entryDate: draft.driverName ? draft.driverEntryDate : null,
                empNo: matchStaffByName(drivers, draft.driverName)?.emp_no || null,
            };
        }
        if (cleanerChanged) {
            staffChanges.cleaner = {
                previousName: bus.attendantName || null,
                newName: draft.attendantName || null,
                exitDate: bus.attendantName ? draft.cleanerExitDate : null,
                entryDate: draft.attendantName ? draft.cleanerEntryDate : null,
                empNo: matchStaffByName(cleaners, draft.attendantName)?.emp_no || null,
            };
        }

        setAssigningStaffBusId(bus._id);
        try {
            const response = await apiFetch(`${API}/buses/${bus._id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ staffChanges }),
            });
            if (response.ok) {
                fetchBuses();
            } else {
                const data = await response.json().catch(() => ({}));
                alert(data.message || 'Failed to update staff assignment');
            }
        } catch (error) {
            console.error('Error assigning staff:', error);
            alert('Error updating staff assignment');
        } finally {
            setAssigningStaffBusId(null);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        try {
            const baseUrl = isOtherVehicleMode ? `${API}/other-vehicles` : `${API}/buses`;
            const url = editingId
                ? `${baseUrl}/${editingId}`
                : baseUrl;

            const method = editingId ? 'PUT' : 'POST';

            const payload = { ...formData };
            if (isOtherVehicleMode) {
                payload.vehicleNumber = payload.busNumber;
                delete payload.busNumber;
            }

            const response = await apiFetch(url, {
                method: method,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                handleCloseModal();
                if (isOtherVehicleMode) {
                    fetchOtherVehicles();
                } else {
                    fetchBuses();
                }
            } else {
                const errData = await response.json().catch(() => ({}));
                alert(errData.message || `Failed to ${editingId ? 'update' : 'create'} ${isOtherVehicleMode ? 'vehicle' : 'bus'}`);
            }
        } catch (error) {
            console.error(`Error ${editingId ? 'updating' : 'creating'} ${isOtherVehicleMode ? 'vehicle' : 'bus'}:`, error);
            alert(`Error ${editingId ? 'updating' : 'creating'} ${isOtherVehicleMode ? 'vehicle' : 'bus'}`);
        }
    };

    const handleOpenTaxesModal = (bus) => {
        setSelectedBusForTaxes(bus);
        selectedBusForTaxesRef.current = bus;
        // Initialize tax values for the selected bus
        const initialValues = {};
        bus.taxes.forEach(tax => {
            initialValues[tax.taxHeader] = {
                amount: tax.amount.toString(),
                endDate: tax.endDate ? new Date(tax.endDate).toISOString().slice(0, 10) : ''
            };
        });
        setTaxValues(initialValues);
        setIsTaxesModalOpen(true);
    };

    const handleCloseTaxesModal = () => {
        setIsTaxesModalOpen(false);
        setSelectedBusForTaxes(null);
        selectedBusForTaxesRef.current = null;
        setTaxValues({});
    };

    // Table-based tax editing
     const handleUpdateTaxInTable = async (taxId, taxData) => {
         if (!selectedBusForTaxes) return;
         
         const isOther = otherVehicles.some(v => v._id === selectedBusForTaxes._id);
         const baseUrl = isOther ? `${API}/other-vehicles/${selectedBusForTaxes._id}/taxes` : `${API}/buses/${selectedBusForTaxes._id}/taxes`;
         
         try {
             const response = await apiFetch(`${baseUrl}/${taxId}`, {
                 method: 'PUT',
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({
                     taxHeader: taxData.taxHeader,
                     amount: parseFloat(taxData.amount),
                     endDate: taxData.endDate
                 })
             });
             
             if (response.ok) {
                 if (isOther) {
                     await fetchOtherVehicles();
                 } else {
                     await fetchBuses();
                 }
             } else {
                 const errorData = await response.json();
                 alert(errorData.message || `Failed to update tax: ${errorData.message}`);
             }
         } catch (error) {
             console.error('Error updating tax:', error);
             alert('Error updating tax');
         }
     };
     
     const handleAddTaxInTable = async (taxData) => {
         if (!selectedBusForTaxes) return;
         
         const isOther = otherVehicles.some(v => v._id === selectedBusForTaxes._id);
         const baseUrl = isOther ? `${API}/other-vehicles/${selectedBusForTaxes._id}/taxes` : `${API}/buses/${selectedBusForTaxes._id}/taxes`;
         
         try {
             const response = await apiFetch(baseUrl, {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({
                     taxHeader: taxData.taxHeader,
                     amount: parseFloat(taxData.amount),
                     endDate: taxData.endDate
                 })
             });
             
             if (response.ok) {
                 if (isOther) {
                     await fetchOtherVehicles();
                 } else {
                     await fetchBuses();
                 }
             } else {
                 const errorData = await response.json();
                 alert(errorData.message || `Failed to add tax: ${errorData.message}`);
             }
         } catch (error) {
             console.error('Error adding tax:', error);
             alert('Error adding tax');
          }
      };

    const handleOpenTaxHeaderModal = (taxHeader = null) => {
        if (taxHeader) {
            setEditingTaxHeaderId(taxHeader._id);
            setNewTaxHeader({
                taxName: taxHeader.taxName,
                description: taxHeader.description || '',
                defaultAmount: taxHeader.defaultAmount || '',
                isActive: taxHeader.isActive
            });
        } else {
            setEditingTaxHeaderId(null);
            setNewTaxHeader({
                taxName: '',
                description: '',
                defaultAmount: '',
                isActive: true
            });
        }
        setIsTaxHeaderModalOpen(true);
    };

    const handleCloseTaxHeaderModal = () => {
        setIsTaxHeaderModalOpen(false);
        setEditingTaxHeaderId(null);
        setNewTaxHeader({
            taxName: '',
            description: '',
            defaultAmount: '',
            isActive: true
        });
    };

    const handleAddOrUpdateTaxHeader = async () => {
        if (!newTaxHeader.taxName.trim()) {
            alert('Please fill in tax name');
            return;
        }

        try {
            const url = editingTaxHeaderId
                ? `${API}/tax-headers/${editingTaxHeaderId}`
                : `${API}/tax-headers`;

            const method = editingTaxHeaderId ? 'PUT' : 'POST';

            const response = await apiFetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    taxName: newTaxHeader.taxName.trim(),
                    description: newTaxHeader.description.trim(),
                    defaultAmount: newTaxHeader.defaultAmount ? parseFloat(newTaxHeader.defaultAmount) : 0,
                    isActive: newTaxHeader.isActive
                })
            });

            if (response.ok) {
                fetchTaxHeaders();
                handleCloseTaxHeaderModal();
            } else {
                alert(`Failed to ${editingTaxHeaderId ? 'update' : 'add'} tax header`);
            }
        } catch (error) {
            console.error(`Error ${editingTaxHeaderId ? 'updating' : 'adding'} tax header:`, error);
            alert(`Error ${editingTaxHeaderId ? 'updating' : 'adding'} tax header`);
        }
    };

    const handleDeleteTaxHeader = async (id) => {
        if (!window.confirm('Are you sure you want to delete this tax header?')) return;

        try {
            const response = await apiFetch(`${API}/tax-headers/${id}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                fetchTaxHeaders();
            } else {
                alert('Failed to delete tax header');
            }
        } catch (error) {
            console.error('Error deleting tax header:', error);
            alert('Error deleting tax header');
        }
    };

    const getPaginatedData = (dataArray) => {
        if (!Array.isArray(dataArray)) return [];
        const startIndex = (currentPage - 1) * itemsPerPage;
        return dataArray.slice(startIndex, startIndex + itemsPerPage);
    };

    const renderPagination = (totalItems) => {
        const totalPages = Math.ceil(totalItems / itemsPerPage);
        if (totalPages <= 1) return null;
        return (
            <div className="flex items-center justify-between border-t border-slate-100 bg-white px-4 py-3 sm:px-6 rounded-b-xl mt-4">
                <div className="flex flex-1 justify-between sm:hidden">
                    <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="relative inline-flex items-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">Previous</button>
                    <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="relative ml-3 inline-flex items-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">Next</button>
                </div>
                <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
                    <div>
                        <p className="text-sm text-slate-700">
                            Showing <span className="font-medium">{(currentPage - 1) * itemsPerPage + 1}</span> to <span className="font-medium">{Math.min(currentPage * itemsPerPage, totalItems)}</span> of <span className="font-medium">{totalItems}</span> results
                        </p>
                    </div>
                    <div>
                        <nav className="isolate inline-flex -space-x-px rounded-md shadow-sm" aria-label="Pagination">
                            <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="relative inline-flex items-center rounded-l-md px-2 py-2 text-slate-400 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 focus:z-20 focus:outline-offset-0 disabled:opacity-50">
                                <span className="sr-only">Previous</span>
                                <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                            </button>
                            {[...Array(totalPages)].map((_, i) => (
                                <button key={i + 1} onClick={() => setCurrentPage(i + 1)} className={`relative inline-flex items-center px-4 py-2 text-sm font-semibold ${currentPage === i + 1 ? 'z-10 bg-blue-600 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600' : 'text-slate-900 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 focus:z-20 focus:outline-offset-0'}`}>
                                    {i + 1}
                                </button>
                            ))}
                            <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="relative inline-flex items-center rounded-r-md px-2 py-2 text-slate-400 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 focus:z-20 focus:outline-offset-0 disabled:opacity-50">
                                <span className="sr-only">Next</span>
                                <ChevronRight className="h-5 w-5" aria-hidden="true" />
                            </button>
                        </nav>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <Layout>
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-4 gap-3">
                <div>
                    <h2 className="text-xl font-bold text-slate-800 tracking-tight">
                        {activeTab === TABS.otherVehicles ? 'Vehicle Management' : 'Bus Management'}
                    </h2>
                    <p className="text-slate-500 text-xs mt-0.5">
                        {activeTab === TABS.otherVehicles ? 'Manage other vehicles in the fleet and their taxes.' : 'Manage buses, routes, and staff assignments.'}
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    {(activeTab === TABS.buses || activeTab === TABS.otherVehicles || activeTab === TABS.mapping || activeTab === TABS.staffMapping) && allowedCampuses.length > 1 && (
                        <div className="flex items-center bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 shadow-sm">
                            <span className="text-[10px] font-medium text-slate-500 mr-2 uppercase">Campus</span>
                            <select
                                value={selectedCampusFilter}
                                onChange={(e) => setSelectedCampusFilter(e.target.value)}
                                className="bg-transparent text-xs font-bold text-slate-800 focus:outline-none cursor-pointer outline-none"
                            >
                                <option value="">All Campuses</option>
                                {allowedCampuses.map((campus) => (
                                    <option key={getCampusId(campus)} value={getCampusId(campus)}>{campus.name} ({campus.code})</option>
                                ))}
                            </select>
                        </div>
                    )}
                    <div className="flex gap-2">
                        {activeTab === TABS.otherVehicles ? (
                            <button
                                onClick={() => { setIsOtherVehicleMode(true); setFormData(f => ({ ...f, type: 'Car' })); setIsModalOpen(true); }}
                                className="bg-blue-900 hover:bg-blue-700 text-white px-3.5 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition-all hover:shadow-md active:scale-95 flex items-center group"
                            >
                                <Plus className="mr-1.5 group-hover:rotate-90 transition-transform" size={14} />
                                Add New Vehicle
                            </button>
                        ) : (
                            <button
                                onClick={() => { setIsOtherVehicleMode(false); setIsModalOpen(true); }}
                                className="bg-blue-900 hover:bg-blue-700 text-white px-3.5 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition-all hover:shadow-md active:scale-95 flex items-center group"
                            >
                                <Plus className="mr-1.5 group-hover:rotate-90 transition-transform" size={14} />
                                Add New Bus
                            </button>
                        )}
                        <button
                            onClick={() => handleOpenTaxHeaderModal()}
                            className="bg-purple-600 hover:bg-purple-700 text-white px-3.5 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition-all hover:shadow-md active:scale-95 flex items-center group"
                        >
                            <Plus className="mr-1.5 group-hover:rotate-90 transition-transform" size={14} />
                            Add Tax Header
                        </button>
                    </div>
                </div>
            </div>

            <div className="flex gap-1.5 mb-4 border-b border-gray-200 overflow-x-auto no-scrollbar">
                <button
                    type="button"
                    onClick={() => setActiveTab(TABS.buses)}
                    className={`px-3 py-1.5 rounded-t-lg text-xs font-medium transition-colors flex items-center whitespace-nowrap ${activeTab === TABS.buses ? 'bg-white border border-b-0 border-gray-200 text-blue-700 shadow-sm -mb-px' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'}`}
                >
                    <Bus size={14} className="mr-1.5" />
                    Buses ({buses.length})
                </button>
                <button
                    type="button"
                    onClick={() => setActiveTab(TABS.otherVehicles)}
                    className={`px-3 py-1.5 rounded-t-lg text-xs font-medium transition-colors flex items-center whitespace-nowrap ${activeTab === TABS.otherVehicles ? 'bg-white border border-b-0 border-gray-200 text-blue-700 shadow-sm -mb-px' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'}`}
                >
                    <Truck size={14} className="mr-1.5" />
                    Other Vehicles ({otherVehicles.length})
                </button>
                <button
                    type="button"
                    onClick={() => setActiveTab(TABS.mapping)}
                    className={`px-3 py-1.5 rounded-t-lg text-xs font-medium transition-colors flex items-center whitespace-nowrap ${activeTab === TABS.mapping ? 'bg-white border border-b-0 border-gray-200 text-blue-700 shadow-sm -mb-px' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'}`}
                >
                    <MapPin size={14} className="mr-1.5" />
                    Bus–Route mapping
                </button>
                <button
                    type="button"
                    onClick={() => setActiveTab(TABS.staffMapping)}
                    className={`px-3 py-1.5 rounded-t-lg text-xs font-medium transition-colors flex items-center whitespace-nowrap ${activeTab === TABS.staffMapping ? 'bg-white border border-b-0 border-gray-200 text-blue-700 shadow-sm -mb-px' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'}`}
                >
                    <UserCheck size={14} className="mr-1.5" />
                    Bus–Staff assignment
                </button>
                <button
                    type="button"
                    onClick={() => setActiveTab(TABS.staff)}
                    className={`px-3 py-1.5 rounded-t-lg text-xs font-medium transition-colors flex items-center whitespace-nowrap ${activeTab === TABS.staff ? 'bg-white border border-b-0 border-gray-200 text-blue-700 shadow-sm -mb-px' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'}`}
                >
                    <Users size={14} className="mr-1.5" />
                    Staff directory
                </button>
                <button
                    type="button"
                    onClick={() => setActiveTab(TABS.taxHeaders)}
                    className={`px-3 py-1.5 rounded-t-lg text-xs font-medium transition-colors flex items-center whitespace-nowrap ${activeTab === TABS.taxHeaders ? 'bg-white border border-b-0 border-gray-200 text-blue-700 shadow-sm -mb-px' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'}`}
                >
                    Tax Headers
                </button>
            </div>

            {activeTab === TABS.mapping && (
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-6">
                    <div className="px-3 py-2.5 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                        <div>
                            <h3 className="text-sm font-semibold text-slate-800">
                                {mappingSubTab === 'busWise' ? 'Bus-Wise Route Mapping' : 'Route-Wise Bus Mapping'}
                            </h3>
                            <p className="text-xs text-slate-500 mt-0.5">
                                {mappingSubTab === 'busWise'
                                    ? 'Assign and manage route mapped to each bus. Click Edit on any row to change assignment.'
                                    : 'Assign and manage bus mapped to each route. Click Edit on any row to change assignment.'}
                            </p>
                        </div>
                        <div className="bg-white p-0.5 rounded-lg border border-slate-200 flex items-center shadow-sm">
                            <button
                                type="button"
                                onClick={() => { setMappingSubTab('busWise'); setExpandedBusEditId(null); setExpandedRouteEditId(null); }}
                                className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all ${mappingSubTab === 'busWise' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}
                            >
                                BUS WISE
                            </button>
                            <button
                                type="button"
                                onClick={() => { setMappingSubTab('routeWise'); setExpandedBusEditId(null); setExpandedRouteEditId(null); }}
                                className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all ${mappingSubTab === 'routeWise' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}
                            >
                                ROUTE WISE
                            </button>
                        </div>
                    </div>

                    {mappingSubTab === 'busWise' ? (
                        loading ? (
                            <div className="py-12">
                                <Loader text="Loading fleet data..." />
                            </div>
                        ) : buses.length === 0 ? (
                            <div className="p-12 text-center text-slate-500">No buses available. Add buses in the Buses tab first.</div>
                        ) : filteredBuses.length === 0 ? (
                            <div className="p-12 text-center text-slate-500">No buses found matching the selected campus.</div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase text-slate-500 font-bold tracking-wider">
                                            <th className="px-3 py-2 w-56">Bus Details</th>
                                            <th className="px-3 py-2">Capacity</th>
                                            <th className="px-3 py-2">Assigned Route</th>
                                            <th className="px-3 py-2 w-32">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {getPaginatedData(filteredBuses).map((bus) => {
                                            const draft = routeDrafts[bus._id] || buildRouteDraft(bus);
                                            const routeChanged = hasRouteDraftChanges(bus);
                                            const previousRouteId = bus.assignedRouteId || '';
                                            const isExpanded = expandedBusEditId === bus._id;

                                            return (
                                                <React.Fragment key={bus._id}>
                                                    <tr className="hover:bg-blue-50/30 transition-colors">
                                                        <td className="px-3 py-2">
                                                            <div>
                                                                <p className="font-bold text-slate-800">{bus.busNumber}</p>
                                                                <p className="text-xs text-slate-500">{bus.type}</p>
                                                            </div>
                                                        </td>
                                                        <td className="px-3 py-2 text-slate-600 font-medium text-xs">{bus.capacity}</td>
                                                        <td className="px-3 py-2">
                                                            {bus.assignedRouteId ? (
                                                                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-100">
                                                                    {getRouteLabel(bus.assignedRouteId)}
                                                                </span>
                                                            ) : (
                                                                <span className="text-slate-400 italic text-xs">— Unassigned —</span>
                                                            )}
                                                        </td>
                                                        <td className="px-3 py-2">
                                                            <button
                                                                type="button"
                                                                disabled={bus.status === 'Inactive'}
                                                                title={bus.status === 'Inactive' ? 'Inactive buses cannot be assigned routes' : ''}
                                                                onClick={() => setExpandedBusEditId(isExpanded ? null : bus._id)}
                                                                className={`px-3 py-1.5 rounded-md text-xs font-semibold border transition-all flex items-center gap-1.5 whitespace-nowrap ${bus.status === 'Inactive' ? 'bg-slate-50 text-slate-400 border-slate-100 cursor-not-allowed' : isExpanded ? 'bg-slate-100 text-slate-700 border-slate-300' : 'border-slate-200 text-slate-700 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200'}`}
                                                            >
                                                                <Edit size={14} />
                                                                {isExpanded ? 'Close' : 'Edit'}
                                                            </button>
                                                        </td>
                                                    </tr>
                                                    {isExpanded && (
                                                        <tr className="bg-slate-50/80">
                                                            <td colSpan={4} className="px-4 pb-4 pt-2">
                                                                <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 space-y-4 shadow-inner">
                                                                    <div className="flex items-center justify-between border-b border-blue-100 pb-2">
                                                                        <p className="text-xs font-black text-blue-900 uppercase tracking-wide">
                                                                            Edit Route Assignment for Bus: <span className="text-blue-700 font-bold">{bus.busNumber}</span>
                                                                        </p>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => setExpandedBusEditId(null)}
                                                                            className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-white/50 transition-colors"
                                                                            title="Close edit panel"
                                                                        >
                                                                            <X size={16} />
                                                                        </button>
                                                                    </div>
                                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                                        <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2 shadow-sm">
                                                                            <p className="text-xs font-bold text-slate-500 uppercase">Current Route</p>
                                                                            <p className="text-sm font-bold text-slate-900">{getRouteLabel(previousRouteId)}</p>
                                                                            {previousRouteId && (
                                                                                <div className="pt-1">
                                                                                    <label className="block text-xs font-semibold text-slate-600 mb-1">Exit Date</label>
                                                                                    <input
                                                                                        type="date"
                                                                                        value={draft.exitDate}
                                                                                        onChange={(e) => handleRouteDraftDateChange(bus._id, 'exitDate', e.target.value)}
                                                                                        className="w-full px-3 py-1.5 rounded-md border border-slate-200 bg-white text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                                                                                    />
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                        <div className="rounded-lg border border-blue-200 bg-white p-3 space-y-2 shadow-sm">
                                                                            <p className="text-xs font-bold text-blue-700 uppercase">New Route</p>
                                                                            <select
                                                                                value={draft.routeId}
                                                                                onChange={(e) => handleRouteDraftChange(bus._id, e.target.value)}
                                                                                disabled={assigningBusId === bus._id}
                                                                                className="w-full text-xs rounded-md border border-slate-200 py-1.5 px-2.5 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white font-medium text-slate-800"
                                                                            >
                                                                                <option value="">— Unassigned —</option>
                                                                                {routes.map((r) => {
                                                                                    const assignedBus = buses.find((b) => b.assignedRouteId === r.routeId && b._id !== bus._id);
                                                                                    return (
                                                                                        <option key={r._id} value={r.routeId} disabled={!!assignedBus}>
                                                                                            {r.routeName} ({r.routeId}){assignedBus ? ` [Assigned to ${assignedBus.busNumber}]` : ''}
                                                                                        </option>
                                                                                    );
                                                                                })}
                                                                            </select>
                                                                            {draft.routeId && (
                                                                                <div className="pt-1">
                                                                                    <label className="block text-xs font-semibold text-slate-600 mb-1">Assignment Date</label>
                                                                                    <input
                                                                                        type="date"
                                                                                        value={draft.entryDate}
                                                                                        onChange={(e) => handleRouteDraftDateChange(bus._id, 'entryDate', e.target.value)}
                                                                                        className="w-full px-3 py-1.5 rounded-md border border-blue-200 bg-white text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                                                                                    />
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                    <div className="flex justify-end gap-2 pt-1">
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => setExpandedBusEditId(null)}
                                                                            className="px-3 py-1.5 rounded-md text-xs font-semibold border border-slate-200 text-slate-600 hover:bg-slate-100 transition-all"
                                                                        >
                                                                            Cancel
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => handleRouteSaveClick(bus)}
                                                                            disabled={assigningBusId === bus._id || !routeChanged}
                                                                            className="px-4 py-1.5 rounded-md text-xs font-semibold bg-blue-900 text-white hover:bg-blue-800 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm"
                                                                        >
                                                                            {assigningBusId === bus._id ? 'Saving…' : 'Save Changes'}
                                                                        </button>
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
                                {renderPagination(filteredBuses.length)}
                            </div>
                        )
                    ) : (
                        (() => {
                            const filteredRoutes = routes.filter(
                                (r) => !selectedCampusFilter || campusIdsMatch(getCampusId(r.campus), selectedCampusFilter)
                            );

                            return loading ? (
                                <div className="py-12">
                                    <Loader text="Loading route data..." />
                                </div>
                            ) : routes.length === 0 ? (
                                <div className="p-12 text-center text-slate-500">No routes available. Create routes first.</div>
                            ) : filteredRoutes.length === 0 ? (
                                <div className="p-12 text-center text-slate-500">No routes found matching the selected campus.</div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left border-collapse">
                                        <thead>
                                            <tr className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase text-slate-500 font-bold tracking-wider">
                                                <th className="px-3 py-2 w-80">Route Details</th>
                                                <th className="px-3 py-2">Start / End Points</th>
                                                <th className="px-3 py-2">Assigned Bus</th>
                                                <th className="px-3 py-2 w-32">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {getPaginatedData(filteredRoutes).map((route) => {
                                                const assignedBus = buses.find((b) => b.assignedRouteId === route.routeId);
                                                const draft = routeWiseDrafts[route.routeId] || buildRouteWiseDraft(route.routeId);
                                                const routeWiseChanged = hasRouteWiseDraftChanges(route);
                                                const isExpanded = expandedRouteEditId === route._id;

                                                return (
                                                    <React.Fragment key={route._id}>
                                                        <tr className="hover:bg-blue-50/30 transition-colors">
                                                            <td className="px-3 py-2">
                                                                <div>
                                                                    <p className="font-bold text-slate-800 text-xs">{route.routeName}</p>
                                                                    <p className="text-[10px] text-slate-500">ID: {route.routeId}</p>
                                                                </div>
                                                            </td>
                                                            <td className="px-3 py-2 text-slate-600 font-medium text-xs">
                                                                {route.startPoint || '—'} ➔ {route.endPoint || '—'}
                                                            </td>
                                                            <td className="px-3 py-2">
                                                                {assignedBus ? (
                                                                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100">
                                                                        {assignedBus.busNumber} ({assignedBus.type})
                                                                    </span>
                                                                ) : (
                                                                    <span className="text-slate-400 italic text-xs">— Unassigned —</span>
                                                                )}
                                                            </td>
                                                            <td className="px-3 py-2">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setExpandedRouteEditId(isExpanded ? null : route._id)}
                                                                    className={`px-3 py-1.5 rounded-md text-xs font-semibold border transition-all flex items-center gap-1.5 whitespace-nowrap ${isExpanded ? 'bg-slate-100 text-slate-700 border-slate-300' : 'border-slate-200 text-slate-700 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200'}`}
                                                                >
                                                                    <Edit size={14} />
                                                                    {isExpanded ? 'Close' : 'Edit'}
                                                                </button>
                                                            </td>
                                                        </tr>
                                                        {isExpanded && (
                                                            <tr className="bg-slate-50/80">
                                                                <td colSpan={4} className="px-4 pb-4 pt-2">
                                                                    <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 space-y-4 shadow-inner">
                                                                        <div className="flex items-center justify-between border-b border-blue-100 pb-2">
                                                                            <p className="text-xs font-black text-blue-900 uppercase tracking-wide">
                                                                                Edit Bus Assignment for Route: <span className="text-blue-700 font-bold">{route.routeName} ({route.routeId})</span>
                                                                            </p>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => setExpandedRouteEditId(null)}
                                                                                className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-white/50 transition-colors"
                                                                                title="Close edit panel"
                                                                            >
                                                                                <X size={16} />
                                                                            </button>
                                                                        </div>
                                                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                                            <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2 shadow-sm">
                                                                                <p className="text-xs font-bold text-slate-500 uppercase">Current Bus</p>
                                                                                <p className="text-sm font-bold text-slate-900">
                                                                                    {assignedBus ? `${assignedBus.busNumber} (${assignedBus.type})` : '— Unassigned —'}
                                                                                </p>
                                                                                {assignedBus && (
                                                                                    <div className="pt-1">
                                                                                        <label className="block text-xs font-semibold text-slate-600 mb-1">Exit Date</label>
                                                                                        <input
                                                                                            type="date"
                                                                                            value={draft.exitDate}
                                                                                            onChange={(e) => handleRouteWiseDraftDateChange(route.routeId, 'exitDate', e.target.value)}
                                                                                            className="w-full px-3 py-1.5 rounded-md border border-slate-200 bg-white text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                                                                                        />
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                            <div className="rounded-lg border border-blue-200 bg-white p-3 space-y-2 shadow-sm">
                                                                                <p className="text-xs font-bold text-blue-700 uppercase">New Bus</p>
                                                                                <select
                                                                                    value={draft.busId}
                                                                                    onChange={(e) => handleRouteWiseDraftChange(route.routeId, e.target.value)}
                                                                                    disabled={assigningBusId === route._id}
                                                                                    className="w-full text-xs rounded-md border border-slate-200 py-1.5 px-2.5 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white font-medium text-slate-800"
                                                                                >
                                                                                    <option value="">— Unassigned —</option>
                                                                                    {buses.map((b) => {
                                                                                        const isInactive = b.status === 'Inactive';
                                                                                        return (
                                                                                            <option key={b._id} value={b._id} disabled={isInactive}>
                                                                                                {b.busNumber} ({b.type}) {isInactive ? ' [Inactive]' : b.assignedRouteId ? ` [Assigned to ${getRouteLabel(b.assignedRouteId)}]` : ''}
                                                                                            </option>
                                                                                        );
                                                                                    })}
                                                                                </select>
                                                                                {draft.busId && (
                                                                                    <div className="pt-1">
                                                                                        <label className="block text-xs font-semibold text-slate-600 mb-1">Assignment Date</label>
                                                                                        <input
                                                                                            type="date"
                                                                                            value={draft.entryDate}
                                                                                            onChange={(e) => handleRouteWiseDraftDateChange(route.routeId, 'entryDate', e.target.value)}
                                                                                            className="w-full px-3 py-1.5 rounded-md border border-blue-200 bg-white text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                                                                                        />
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                        <div className="flex justify-end gap-2 pt-1">
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => setExpandedRouteEditId(null)}
                                                                                className="px-3 py-1.5 rounded-md text-xs font-semibold border border-slate-200 text-slate-600 hover:bg-slate-100 transition-all"
                                                                            >
                                                                                Cancel
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => handleRouteWiseSaveClick(route)}
                                                                                disabled={assigningBusId === route._id || !routeWiseChanged}
                                                                                className="px-4 py-1.5 rounded-md text-xs font-semibold bg-blue-900 text-white hover:bg-blue-800 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm"
                                                                            >
                                                                                {assigningBusId === route._id ? 'Saving…' : 'Save Changes'}
                                                                            </button>
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
                                    {renderPagination(filteredRoutes.length)}
                                </div>
                            );
                        })()
                    )}
                </div>
            )}

            {activeTab === TABS.staffMapping && (
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-6">
                    <div className="px-3 py-2.5 border-b border-slate-100 bg-slate-50/50">
                        <h3 className="text-sm font-semibold text-slate-800">Assign driver and cleaner to each bus</h3>
                        <p className="text-xs text-slate-500 mt-0.5">Select driver and cleaner per bus. Set previous exit date and new entry date when changing, then click Save.</p>
                    </div>
                    {(driversLoading || cleanersLoading) ? (
                        <div className="py-12">
                            <Loader text="Loading staff data..." />
                        </div>
                    ) : buses.length === 0 ? (
                        <div className="p-12 text-center text-slate-500">No buses available. Add buses in the Buses tab first.</div>
                    ) : filteredBuses.length === 0 ? (
                        <div className="p-12 text-center text-slate-500">No buses found matching the selected campus.</div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase text-slate-500 font-bold tracking-wider">
                                        <th className="px-3 py-2 w-56">Bus Details</th>
                                        <th className="px-3 py-2">Assigned Driver</th>
                                        <th className="px-3 py-2">Assigned Cleaner</th>
                                        <th className="px-3 py-2 w-32">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {getPaginatedData(filteredBuses).map((bus) => {
                                        const draft = staffDrafts[bus._id] || buildStaffDraft(bus);
                                        const hasChanges = hasStaffDraftChanges(bus);
                                        const driverChanged = normalizeStaffName(draft.driverName) !== normalizeStaffName(bus.driverName);
                                        const cleanerChanged = normalizeStaffName(draft.attendantName) !== normalizeStaffName(bus.attendantName);

                                        return (
                                            <React.Fragment key={bus._id}>
                                                <tr className="hover:bg-blue-50/30 transition-colors">
                                                    <td className="px-3 py-2">
                                                        <p className="font-bold text-slate-800">{bus.busNumber}</p>
                                                        <p className="text-xs text-slate-500">{bus.vehicleModel || bus.type}</p>
                                                    </td>
                                                    <td className="px-3 py-2">
                                                        <select
                                                            value={draft.driverName}
                                                            onChange={(e) => handleStaffDraftChange(bus._id, 'driverName', e.target.value)}
                                                            disabled={assigningStaffBusId === bus._id}
                                                            className="w-full max-w-xs text-xs rounded-md border border-slate-200 py-1.5 px-2.5 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white font-medium text-slate-700"
                                                        >
                                                            <option value="">— Unassigned —</option>
                                                            {withCurrentStaffOption(drivers, draft.driverName).map((d) => (
                                                                <option key={d._id} value={d.employee_name}>{d.employee_name} ({d.emp_no})</option>
                                                            ))}
                                                        </select>
                                                    </td>
                                                    <td className="px-3 py-2">
                                                        <select
                                                            value={draft.attendantName}
                                                            onChange={(e) => handleStaffDraftChange(bus._id, 'attendantName', e.target.value)}
                                                            disabled={assigningStaffBusId === bus._id}
                                                            className="w-full max-w-xs text-xs rounded-md border border-slate-200 py-1.5 px-2.5 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white font-medium text-slate-700"
                                                        >
                                                            <option value="">— Unassigned —</option>
                                                            {withCurrentStaffOption(cleaners, draft.attendantName).map((c) => (
                                                                <option key={c._id} value={c.employee_name}>{c.employee_name} ({c.emp_no})</option>
                                                            ))}
                                                        </select>
                                                    </td>
                                                    <td className="px-3 py-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => handleStaffSaveClick(bus)}
                                                            disabled={assigningStaffBusId === bus._id || !hasChanges}
                                                            className="px-3 py-1.5 rounded-md text-xs font-semibold bg-blue-900 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all whitespace-nowrap"
                                                        >
                                                            {assigningStaffBusId === bus._id ? 'Saving…' : 'Save'}
                                                        </button>
                                                    </td>
                                                </tr>
                                                {hasChanges && (
                                                    <tr className="bg-slate-50/80">
                                                        <td colSpan={4} className="px-4 pb-4 pt-0">
                                                            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
                                                                <div className="flex items-center justify-between gap-3">
                                                                    <p className="text-xs font-black text-slate-600 uppercase tracking-wide">Staff change details</p>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleDismissStaffChanges(bus)}
                                                                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                                                                        title="Close and discard changes"
                                                                        aria-label="Close staff change details"
                                                                    >
                                                                        <X size={16} />
                                                                    </button>
                                                                </div>
                                                                {driverChanged && (
                                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                                        {bus.driverName && (
                                                                            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
                                                                                <p className="text-xs font-semibold text-amber-800">Previous driver</p>
                                                                                <p className="text-sm font-bold text-slate-900">{bus.driverName}</p>
                                                                                <div>
                                                                                    <label className="block text-xs font-semibold text-slate-600 mb-1">Exit date</label>
                                                                                    <input
                                                                                        type="date"
                                                                                        value={draft.driverExitDate}
                                                                                        onChange={(e) => handleStaffDraftDateChange(bus._id, 'driverExitDate', e.target.value)}
                                                                                        className="w-full px-3 py-2 rounded-lg border border-amber-200 bg-white text-sm"
                                                                                    />
                                                                                </div>
                                                                            </div>
                                                                        )}
                                                                        {draft.driverName ? (
                                                                            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-2">
                                                                                <p className="text-xs font-semibold text-blue-800">New driver</p>
                                                                                <p className="text-sm font-bold text-slate-900">{draft.driverName}</p>
                                                                                <div>
                                                                                    <label className="block text-xs font-semibold text-slate-600 mb-1">Entry date</label>
                                                                                    <input
                                                                                        type="date"
                                                                                        value={draft.driverEntryDate}
                                                                                        onChange={(e) => handleStaffDraftDateChange(bus._id, 'driverEntryDate', e.target.value)}
                                                                                        className="w-full px-3 py-2 rounded-lg border border-blue-200 bg-white text-sm"
                                                                                    />
                                                                                </div>
                                                                            </div>
                                                                        ) : (
                                                                            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                                                                                <p className="text-sm text-slate-600">Driver will be unassigned.</p>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                )}
                                                                {cleanerChanged && (
                                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                                        {bus.attendantName && (
                                                                            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
                                                                                <p className="text-xs font-semibold text-amber-800">Previous cleaner</p>
                                                                                <p className="text-sm font-bold text-slate-900">{bus.attendantName}</p>
                                                                                <div>
                                                                                    <label className="block text-xs font-semibold text-slate-600 mb-1">Exit date</label>
                                                                                    <input
                                                                                        type="date"
                                                                                        value={draft.cleanerExitDate}
                                                                                        onChange={(e) => handleStaffDraftDateChange(bus._id, 'cleanerExitDate', e.target.value)}
                                                                                        className="w-full px-3 py-2 rounded-lg border border-amber-200 bg-white text-sm"
                                                                                    />
                                                                                </div>
                                                                            </div>
                                                                        )}
                                                                        {draft.attendantName ? (
                                                                            <div className="rounded-lg border border-purple-200 bg-purple-50 p-3 space-y-2">
                                                                                <p className="text-xs font-semibold text-purple-800">New cleaner</p>
                                                                                <p className="text-sm font-bold text-slate-900">{draft.attendantName}</p>
                                                                                <div>
                                                                                    <label className="block text-xs font-semibold text-slate-600 mb-1">Entry date</label>
                                                                                    <input
                                                                                        type="date"
                                                                                        value={draft.cleanerEntryDate}
                                                                                        onChange={(e) => handleStaffDraftDateChange(bus._id, 'cleanerEntryDate', e.target.value)}
                                                                                        className="w-full px-3 py-2 rounded-lg border border-purple-200 bg-white text-sm"
                                                                                    />
                                                                                </div>
                                                                            </div>
                                                                        ) : (
                                                                            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                                                                                <p className="text-sm text-slate-600">Cleaner will be unassigned.</p>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                            </React.Fragment>
                                        );
                                    })}
                                </tbody>
                            </table>
                            {renderPagination(filteredBuses.length)}
                        </div>
                    )}
                </div>
            )}

            {activeTab === TABS.staff && (
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-6">
                    <div className="px-3 py-2 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                        <div>
                            <h3 className="text-sm font-semibold text-slate-800">Staff directory</h3>
                            <p className="text-xs text-slate-500 mt-0.5">List of all staff members from HRMS.</p>
                        </div>
                        <div className="bg-white p-0.5 rounded-lg border border-slate-200 flex items-center shadow-sm">
                            <button
                                onClick={() => setStaffSubTab('drivers')}
                                className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all ${staffSubTab === 'drivers' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}
                            >
                                DRIVERS ({drivers.length})
                            </button>
                            <button
                                onClick={() => setStaffSubTab('cleaners')}
                                className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all ${staffSubTab === 'cleaners' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}
                            >
                                CLEANERS ({cleaners.length})
                            </button>
                        </div>
                    </div>
                    {(driversLoading || cleanersLoading) ? (
                        <div className="py-20 flex justify-center">
                            <Loader size={40} text="Loading staff data..." />
                        </div>
                    ) : (staffSubTab === 'drivers' ? drivers : cleaners).length === 0 ? (
                        <div className="p-12 text-center text-slate-500">No {staffSubTab} found in HRMS.</div>
                    ) : (
                        <div className="overflow-x-auto w-full">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase text-slate-500 font-bold tracking-wider">
                                        <th className="px-3 py-2">Employee Details</th>
                                        <th className="px-3 py-2">Employee ID</th>
                                        <th className="px-3 py-2">Phone Number</th>
                                        <th className="px-3 py-2">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {getPaginatedData(staffSubTab === 'drivers' ? drivers : cleaners).map((staff) => (
                                        <tr key={staff._id} className="hover:bg-blue-50/30 transition-colors">
                                            <td className="px-3 py-2">
                                                <div className="flex items-center">
                                                    <div className={`p-1.5 rounded-lg mr-3 ${staffSubTab === 'drivers' ? 'bg-blue-100 text-blue-600' : 'bg-amber-100 text-amber-600'}`}>
                                                        <User size={18} />
                                                    </div>
                                                    <div>
                                                        <p className="font-bold text-slate-800 text-sm">{staff.employee_name}</p>
                                                        <p className="text-[10px] text-slate-500 uppercase font-black">{staffSubTab === 'drivers' ? 'Driver' : 'Cleaner'}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-3 py-2 text-xs text-slate-600 font-medium">{staff.emp_no}</td>
                                            <td className="px-3 py-2 text-xs text-slate-600">{staff.phone_number || <span className="text-slate-400 italic text-xs">--</span>}</td>
                                            <td className="px-3 py-2">
                                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border flex w-fit items-center ${staff.is_active ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-red-50 text-red-700 border-red-100'}`}>
                                                    <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${staff.is_active ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
                                                    {staff.is_active ? 'Active' : 'Inactive'}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {renderPagination((staffSubTab === 'drivers' ? drivers : cleaners).length)}
                        </div>
                    )}
                </div>
            )}

            {activeTab === TABS.taxHeaders && (
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-6">
                    <div className="px-3 py-2.5 border-b border-slate-100 bg-slate-50/50">
                        <h3 className="text-sm font-semibold text-slate-800">Tax Headers Management</h3>
                        <p className="text-xs text-slate-500 mt-0.5">Create and manage reusable tax headers that can be applied to buses.</p>
                    </div>
                    {taxHeadersLoading ? (
                        <div className="py-12">
                            <Loader text="Loading tax headers..." />
                        </div>
                    ) : taxHeaders.length === 0 ? (
                        <div className="p-12 text-center text-slate-500">
                            No tax headers created yet. Click "Add Tax Header" to create one.
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase text-slate-500 font-bold tracking-wider">
                                        <th className="px-3 py-2">Tax Name</th>
                                        <th className="px-3 py-2">Description</th>
                                        <th className="px-3 py-2">Default Amount</th>
                                        <th className="px-3 py-2">Status</th>
                                        <th className="px-3 py-2 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                {getPaginatedData(taxHeaders).map((header) => (
                                        <tr key={header._id} className="hover:bg-blue-50/30 transition-colors">
                                            <td className="px-3 py-2">
                                                <p className="font-bold text-slate-800 text-sm">{header.taxName}</p>
                                            </td>
                                            <td className="px-3 py-2 text-xs text-slate-600">
                                                {header.description || <span className="text-slate-400 italic text-xs">--</span>}
                                            </td>
                                            <td className="px-3 py-2 text-xs text-slate-600 font-medium">
                                                ₹{parseFloat(header.defaultAmount || 0).toFixed(2)}
                                            </td>
                                            <td className="px-3 py-2">
                                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border flex w-fit items-center ${header.isActive ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-red-50 text-red-700 border-red-100'}`}>
                                                    <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${header.isActive ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
                                                    {header.isActive ? 'Active' : 'Inactive'}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2 text-right">
                                                <div className="flex items-center justify-end gap-1">
                                                    <button
                                                        onClick={() => handleOpenTaxHeaderModal(header)}
                                                        className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-all"
                                                        title="Edit Tax Header"
                                                    >
                                                        <Edit size={16} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteTaxHeader(header._id)}
                                                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-all"
                                                        title="Delete Tax Header"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {renderPagination(taxHeaders.length)}
                        </div>
                    )}
                </div>
            )}

            {activeTab === TABS.otherVehicles && (
                <>
                    {loading ? (
                        <div className="py-20 flex justify-center">
                            <Loader size={40} text="Loading vehicle data..." />
                        </div>
                    ) : otherVehicles.length === 0 ? (
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col items-center justify-center py-20 px-4 text-center">
                            <div className="bg-slate-50 p-6 rounded-full mb-6">
                                <Truck size={48} className="text-slate-400" />
                            </div>
                            <h3 className="text-xl font-bold text-slate-800 mb-2">No Vehicles Found</h3>
                            <p className="text-slate-500 max-w-md mx-auto mb-8">
                                There are no other vehicles in the fleet. Click Add Vehicle to register a car or van.
                            </p>
                            <button onClick={() => { setIsOtherVehicleMode(true); setFormData(f => ({ ...f, type: 'Car' })); setIsModalOpen(true); }} className="flex items-center text-blue-600 font-semibold hover:text-blue-800 hover:bg-blue-50 px-4 py-2 rounded-lg transition-all">
                                <Plus size={20} className="mr-2" />
                                Add your first vehicle
                            </button>
                        </div>
                    ) : otherVehicles.filter(v => !selectedCampusFilter || campusIdsMatch(getCampusId(v.campus), selectedCampusFilter)).length === 0 ? (
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col items-center justify-center py-20 px-4 text-center">
                            <div className="bg-slate-50 p-6 rounded-full mb-6">
                                <Truck size={48} className="text-slate-400" />
                            </div>
                            <h3 className="text-xl font-bold text-slate-800 mb-2">No Vehicles Found</h3>
                            <p className="text-slate-500 max-w-md mx-auto">
                                There are no other vehicles matching the selected campus.
                            </p>
                        </div>
                    ) : (
                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden w-full">
                            <div className="overflow-x-auto w-full">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase text-slate-500 font-bold tracking-wider">
                                            <th className="px-3 py-2 w-56">Vehicle Details</th>
                                            <th className="px-3 py-2">Model</th>
                                            <th className="px-3 py-2">Reg. Date</th>
                                            <th className="px-3 py-2">Capacity</th>
                                            <th className="px-3 py-2">Driver</th>
                                            <th className="px-3 py-2">Attendant</th>
                                            <th className="px-3 py-2">Status</th>
                                            <th className="px-3 py-2">Taxes Config</th>
                                            <th className="px-3 py-2 text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {getPaginatedData(otherVehicles.filter(v => !selectedCampusFilter || campusIdsMatch(getCampusId(v.campus), selectedCampusFilter))).map((vehicle) => (
                                            <tr
                                                key={vehicle._id}
                                                onClick={() => navigate(`/other-vehicles/${vehicle._id}`)}
                                                className="hover:bg-blue-50/30 transition-colors cursor-pointer group"
                                            >
                                                <td className="px-3 py-2">
                                                    <div>
                                                        <p className="font-bold text-slate-800 text-sm">{vehicle.vehicleNumber}</p>
                                                        <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">{vehicle.type}</p>
                                                        {vehicle.campus && (
                                                            <div className="mt-1">
                                                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100">
                                                                    {vehicle.campus.name || vehicle.campus}
                                                                </span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-3 py-2 text-xs text-slate-600">
                                                    {vehicle.vehicleModel || <span className="text-slate-400 italic text-xs">--</span>}
                                                </td>
                                                <td className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">
                                                    {vehicle.registrationDate
                                                        ? new Date(vehicle.registrationDate).toLocaleDateString()
                                                        : <span className="text-slate-400 italic text-xs">--</span>}
                                                </td>
                                                <td className="px-3 py-2 text-xs text-slate-600 font-medium">
                                                    <div className="flex items-center">
                                                        <Armchair size={14} className="text-slate-400 mr-2" />
                                                        {vehicle.capacity}
                                                    </div>
                                                </td>
                                                <td className="px-3 py-2 text-xs text-slate-600">
                                                    {vehicle.driverName || <span className="text-slate-400 italic text-xs">--</span>}
                                                </td>
                                                <td className="px-3 py-2 text-xs text-slate-600">
                                                    {vehicle.attendantName || <span className="text-slate-400 italic text-xs">--</span>}
                                                </td>
                                                <td className="px-3 py-2">
                                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border flex w-fit items-center ${
                                                        vehicle.status === 'Active' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                                                        vehicle.status === 'In Maintenance' ? 'bg-amber-50 text-amber-700 border-amber-100' :
                                                        vehicle.status === 'Inactive' ? 'bg-slate-50 text-slate-600 border-slate-200' :
                                                        'bg-red-50 text-red-700 border-red-100'
                                                        }`}>
                                                        <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${
                                                            vehicle.status === 'Active' ? 'bg-emerald-500' :
                                                            vehicle.status === 'In Maintenance' ? 'bg-amber-500' :
                                                            vehicle.status === 'Inactive' ? 'bg-slate-400' :
                                                            'bg-red-500'
                                                        }`}></span>
                                                        {vehicle.status}
                                                    </span>
                                                </td>
                                                <td className="px-3 py-2">
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setIsOtherVehicleMode(true);
                                                            handleOpenTaxesModal(vehicle);
                                                        }}
                                                        className="px-3 py-1.5 bg-purple-50 text-purple-700 border border-purple-200 rounded-lg text-xs font-semibold hover:bg-purple-100 transition-all flex items-center gap-1"
                                                        title="Manage Taxes"
                                                    >
                                                        <span className="bg-purple-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-[10px] font-bold">
                                                            {(vehicle.taxes && vehicle.taxes.length) || 0}
                                                        </span>
                                                        Taxes
                                                    </button>
                                                </td>
                                                <td className="px-3 py-2 text-right">
                                                    <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                                                        <button
                                                            onClick={(e) => {
                                                                setIsOtherVehicleMode(true);
                                                                handleEdit(vehicle, e);
                                                            }}
                                                            className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-all"
                                                            title="Edit Vehicle"
                                                        >
                                                            <Edit size={16} />
                                                        </button>
                                                        <button
                                                            onClick={(e) => handleDelete(vehicle._id, e)}
                                                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-all"
                                                            title="Delete Vehicle"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {renderPagination(otherVehicles.filter(v => !selectedCampusFilter || campusIdsMatch(getCampusId(v.campus), selectedCampusFilter)).length)}
                            </div>
                        </div>
                    )}
                </>
            )}

            {activeTab === TABS.buses && (
                <>
                    {loading ? (
                        <div className="py-20 flex justify-center">
                            <Loader size={40} text="Loading fleet data..." />
                        </div>
                    ) : buses.length === 0 ? (
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col items-center justify-center py-20 px-4 text-center">
                            <div className="bg-slate-50 p-6 rounded-full mb-6">
                                <Bus size={48} className="text-slate-400" />
                            </div>
                            <h3 className="text-xl font-bold text-slate-800 mb-2">No Buses Found</h3>
                            <p className="text-slate-500 max-w-md mx-auto mb-8">
                                It looks like you haven't added any buses to the fleet yet. Start by adding a bus to manage transport.
                            </p>
                            <button onClick={() => setIsModalOpen(true)} className="flex items-center text-blue-600 font-semibold hover:text-blue-800 hover:bg-blue-50 px-4 py-2 rounded-lg transition-all">
                                <Plus size={20} className="mr-2" />
                                Add your first bus
                            </button>
                        </div>
                    ) : filteredBuses.length === 0 ? (
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col items-center justify-center py-20 px-4 text-center">
                            <div className="bg-slate-50 p-6 rounded-full mb-6">
                                <Bus size={48} className="text-slate-400" />
                            </div>
                            <h3 className="text-xl font-bold text-slate-800 mb-2">No Buses Found</h3>
                            <p className="text-slate-500 max-w-md mx-auto">
                                There are no buses matching the selected campus.
                            </p>
                        </div>
                    ) : (
                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden w-full">
                            <div className="overflow-x-auto w-full">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase text-slate-500 font-bold tracking-wider">
                                            <th className="px-3 py-2 w-44">Bus Details</th>
                                            <th className="px-3 py-2">Model</th>
                                            <th className="px-3 py-2">Reg. Date</th>
                                            <th className="px-3 py-2">Capacity</th>
                                            <th className="px-3 py-2">Driver</th>
                                            <th className="px-3 py-2">Attendant</th>
                                            <th className="px-3 py-2">Status</th>
                                            <th className="px-3 py-2">Route</th>
                                            <th className="px-3 py-2">Taxes Config</th>
                                            <th className="px-3 py-2 text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {getPaginatedData(filteredBuses).map((bus) => (
                                            <tr
                                                key={bus._id}
                                                onClick={() => navigate(`/buses/${bus._id}`)}
                                                className="hover:bg-blue-50/30 transition-colors cursor-pointer group"
                                            >
                                                <td className="px-3 py-2">
                                                    <div>
                                                        <div className="flex items-center gap-1.5">
                                                            <p className="font-bold text-slate-800 text-sm">{bus.busNumber}</p>
                                                        </div>
                                                        <div className="flex items-center gap-2 mt-0.5">
                                                            <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">{bus.type}</p>
                                                            {bus.campus && (
                                                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100 whitespace-nowrap">
                                                                    {bus.campus.name || bus.campus}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-3 py-2 text-xs text-slate-600">
                                                    {bus.vehicleModel || <span className="text-slate-400 italic text-xs">--</span>}
                                                </td>
                                                <td className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">
                                                    {bus.registrationDate
                                                        ? new Date(bus.registrationDate).toLocaleDateString()
                                                        : <span className="text-slate-400 italic text-xs">--</span>}
                                                </td>
                                                <td className="px-3 py-2 text-xs text-slate-600 font-medium">
                                                    <div className="flex items-center">
                                                        <Armchair size={14} className="text-slate-400 mr-2" />
                                                        {bus.capacity}
                                                    </div>
                                                </td>
                                                <td className="px-3 py-2 text-xs text-slate-600">
                                                    {bus.driverName || <span className="text-slate-400 italic text-xs">--</span>}
                                                </td>
                                                <td className="px-3 py-2 text-xs text-slate-600">
                                                    {bus.attendantName || <span className="text-slate-400 italic text-xs">--</span>}
                                                </td>
                                                <td className="px-3 py-2">
                                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border flex w-fit items-center ${
                                                        bus.status === 'Active' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                                                        bus.status === 'In Maintenance' ? 'bg-amber-50 text-amber-700 border-amber-100' :
                                                        bus.status === 'Inactive' ? 'bg-red-50 text-red-700 border-red-100' :
                                                        'bg-red-50 text-red-700 border-red-100'
                                                    }`}>
                                                        <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${
                                                            bus.status === 'Active' ? 'bg-emerald-500' :
                                                            bus.status === 'In Maintenance' ? 'bg-amber-500' :
                                                            'bg-red-500'
                                                        }`} />
                                                        {bus.status}
                                                    </span>
                                                </td>
                                                <td className="px-3 py-2">
                                                    {bus.assignedRouteId ? (
                                                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100">
                                                            <MapPin size={12} className="mr-1" />
                                                            {routes.find(r => r.routeId === bus.assignedRouteId)?.routeName || bus.assignedRouteId}
                                                        </span>
                                                    ) : (
                                                        <span className="text-slate-400 italic text-xs">--</span>
                                                    )}
                                                </td>

                                                <td className="px-3 py-2">
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleOpenTaxesModal(bus);
                                                        }}
                                                        className="px-2 py-1 bg-purple-50 text-purple-700 border border-purple-200 rounded-md text-[10px] font-semibold hover:bg-purple-100 transition-all flex items-center gap-1"
                                                        title="Manage Taxes"
                                                    >
                                                        <span className="bg-purple-600 text-white rounded-full w-4 h-4 flex items-center justify-center text-[9px] font-bold">
                                                            {(bus.taxes && bus.taxes.length) || 0}
                                                        </span>
                                                        Taxes
                                                    </button>
                                                </td>
                                                <td className="px-3 py-2 text-right">
                                                    <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                                                        <button
                                                            onClick={(e) => handleEdit(bus, e)}
                                                            className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-all"
                                                            title="Edit Bus"
                                                        >
                                                            <Edit size={14} />
                                                        </button>
                                                        <button
                                                            onClick={(e) => handleDelete(bus._id, e)}
                                                            className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-all"
                                                            title="Delete Bus"
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {renderPagination(filteredBuses.length)}
                            </div>
                        </div>
                    )}
                </>
            )}

            <Modal isOpen={isModalOpen} onClose={handleCloseModal} title={editingId ? (isOtherVehicleMode ? "Edit Vehicle Details" : "Edit Bus Details") : (isOtherVehicleMode ? "Add New Vehicle" : "Add New Bus")}>
                <form onSubmit={handleSubmit} className="space-y-5">
                    <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1.5">{isOtherVehicleMode ? "Vehicle Number" : "Bus Number"}</label>
                        <input type="text" name="busNumber" required value={formData.busNumber} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all" placeholder="e.g. KA-01-F-1234" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Capacity</label>
                            <input type="number" name="capacity" required value={formData.capacity} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all" placeholder="e.g. 40" />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Type</label>
                            <select name="type" value={formData.type} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all bg-white">
                                {isOtherVehicleMode ? (
                                    <>
                                        <option value="Car">Car</option>
                                        <option value="Van">Van</option>
                                        <option value="SUV">SUV</option>
                                        <option value="Other">Other</option>
                                    </>
                                ) : (
                                    <>
                                        <option value="Standard">Standard</option>
                                        <option value="Mini-bus">Mini-bus</option>
                                        <option value="Van">Van</option>
                                    </>
                                )}
                            </select>
                        </div>
                    </div>
                    {isOtherVehicleMode && (
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Driver Name</label>
                                <input type="text" name="driverName" value={formData.driverName || ''} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all" placeholder="e.g. Ramesh" />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Attendant Name</label>
                                <input type="text" name="attendantName" value={formData.attendantName || ''} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all" placeholder="e.g. Suresh" />
                            </div>
                        </div>
                    )}
                    <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1.5">Vehicle Model</label>
                        <input type="text" name="vehicleModel" value={formData.vehicleModel} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all" placeholder="e.g. Ashok Leyland Viking" />
                    </div>
                    <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1.5">Date of Registration</label>
                        <input type="date" name="registrationDate" value={formData.registrationDate} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all" />
                    </div>
                    <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1.5">Campus</label>
                        <select name="campus" value={formData.campus} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all bg-white">
                            <option value="">Select Campus</option>
                            {allowedCampuses.map((c) => (
                                <option key={getCampusId(c)} value={getCampusId(c)}>{c.name} ({c.code})</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1.5">Status</label>
                        <select name="status" value={formData.status} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all bg-white">
                            <option value="Active">Active</option>
                            <option value="Inactive">Inactive</option>
                            <option value="In Maintenance">In Maintenance</option>
                            <option value="Retired">Retired</option>
                        </select>
                    </div>
                    <button type="submit" className="w-full bg-blue-900 text-white font-bold py-3.5 rounded-xl hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200 mt-4">
                        {editingId ? (isOtherVehicleMode ? 'Update Vehicle Details' : 'Update Bus Details') : (isOtherVehicleMode ? 'Create Vehicle' : 'Create Bus')}
                    </button>
                </form>
            </Modal>

             <Modal isOpen={isTaxesModalOpen} onClose={handleCloseTaxesModal} title={selectedBusForTaxes ? `Manage Taxes - ${selectedBusForTaxes.vehicleNumber || selectedBusForTaxes.busNumber}` : "Manage Taxes"} maxWidth="max-w-4xl">
                 <div className="space-y-6">
                     {/* Expired taxes banner — checks both saved data and live input values */}
                     {(() => {
                         const today = new Date();
                         today.setHours(0, 0, 0, 0);

                         const isDateExpired = (dateVal) => {
                             if (!dateVal) return false;
                             const d = new Date(dateVal);
                             d.setHours(0, 0, 0, 0);
                             return d < today;
                         };

                         // Collect expired taxes: prefer live taxValues input, fall back to saved endDate
                         const expiredNames = new Set();
                         (selectedBusForTaxes?.taxes || []).forEach(tax => {
                             const liveDate = taxValues[tax.taxHeader]?.endDate;
                             const checkDate = liveDate || tax.endDate;
                             if (isDateExpired(checkDate)) expiredNames.add(tax.taxHeader);
                         });

                         if (expiredNames.size === 0) return null;
                         const expiredList = [...expiredNames];
                         return (
                             <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
                                 <AlertTriangle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
                                 <div>
                                     <p className="text-sm font-bold text-red-800">
                                         {expiredList.length} expired tax{expiredList.length > 1 ? 'es' : ''} detected
                                     </p>
                                     <p className="text-xs text-red-600 mt-0.5">
                                         {expiredList.join(', ')} — please update the end date{expiredList.length > 1 ? 's' : ''}.
                                     </p>
                                 </div>
                             </div>
                         );
                     })()}
                     {/* Taxes Table - Direct Edit Format */}
                     <div className="border-b border-slate-200 pb-6">
                         <h3 className="text-sm font-bold text-slate-800 mb-4 uppercase tracking-wide">
                             Edit Taxes for {selectedBusForTaxes?.busNumber || 'Selected Bus'}
                         </h3>
                         <div>
                             <table className="w-full text-left border-collapse">
                                 <thead>
                                     <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500 font-bold tracking-wider">
                                         <th className="px-4 py-3">Tax Header</th>
                                         <th className="px-4 py-3">Amount</th>
                                         <th className="px-4 py-3">End Date</th>
                                         <th className="px-4 py-3 text-right">Actions</th>
                                     </tr>
                                 </thead>
                                 <tbody className="divide-y divide-slate-100">
                                     {taxHeaders.map((header) => {
                                         const taxHeaderName = header.taxName;

                                         // Check if this tax exists on the bus (for determining update vs add)
                                         const taxExistsOnBus = selectedBusForTaxes?.taxes.some(tax =>
                                             tax.taxHeader.toLowerCase() === taxHeaderName.toLowerCase()
                                         ) || false;

                                         // Find the tax ID if it exists on the bus
                                         const existingTax = selectedBusForTaxes?.taxes.find(tax =>
                                             tax.taxHeader.toLowerCase() === taxHeaderName.toLowerCase()
                                         );

                                         // For saved taxes: use taxValues (live input). For un-added: start empty so user must fill in.
                                         const currentValues = taxValues[taxHeaderName] || (taxExistsOnBus
                                             ? {
                                                 amount: existingTax.amount.toString(),
                                                 endDate: existingTax.endDate ? new Date(existingTax.endDate).toISOString().slice(0, 10) : ''
                                               }
                                             : { amount: '', endDate: '' }
                                         );
                                         
                                         // Check if the current end date is expired
                                         const isRowExpired = (() => {
                                             if (!currentValues.endDate) return false;
                                             const d = new Date(currentValues.endDate);
                                             d.setHours(0, 0, 0, 0);
                                             const today = new Date();
                                             today.setHours(0, 0, 0, 0);
                                             return d < today;
                                         })();

                                         return (
                                             <tr key={taxHeaderName} className={`transition-colors ${isRowExpired ? 'bg-red-50/40 hover:bg-red-50/60' : taxExistsOnBus ? 'hover:bg-blue-50/30' : 'bg-slate-50/30 hover:bg-slate-50/60'}`}>
                                                 <td className="px-4 py-3 text-sm font-medium text-slate-800">
                                                     <div className="flex items-center gap-2">
                                                         {taxHeaderName}
                                                         {isRowExpired && (
                                                             <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700">
                                                                 EXPIRED
                                                             </span>
                                                         )}
                                                         {!taxExistsOnBus && (
                                                             <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-500">
                                                                 Not added
                                                             </span>
                                                         )}
                                                     </div>
                                                 </td>
                                                 <td className="px-4 py-3">
                                                     <input
                                                         type="number"
                                                         step="0.01"
                                                         value={currentValues.amount || ''}
                                                         placeholder={taxExistsOnBus ? '' : 'Enter amount'}
                                                         onChange={(e) => {
                                                             setTaxValues(prev => ({
                                                                 ...prev,
                                                                 [taxHeaderName]: {
                                                                     ...prev[taxHeaderName],
                                                                     amount: e.target.value
                                                                 }
                                                             }));
                                                         }}
                                                         className={`w-full px-3 py-2 rounded-lg border text-sm ${!taxExistsOnBus && !currentValues.amount ? 'border-slate-200 bg-slate-50 placeholder-slate-400' : 'border-slate-300 bg-white'}`}
                                                     />
                                                 </td>
                                                 <td className="px-4 py-3">
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
                                                         <p className="text-[10px] text-red-600 mt-1 font-medium">Date has expired — please update</p>
                                                     )}
                                                 </td>
                                                 <td className="px-4 py-3 text-right">
                                                     <div className="flex space-x-2">
                                                         <button
                                                             onClick={() => {
                                                                 // Validate before save
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
                                                             className="flex-1 px-3 py-1.5 bg-purple-600 text-white text-sm font-semibold rounded-lg hover:bg-purple-700 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                                                         >
                                                             {taxExistsOnBus ? 'Update' : 'Add'}
                                                         </button>
                                                         <button
                                                             onClick={async () => {
                                                                 setTaxHistoryData(null);
                                                                 setIsTaxHistoryModalOpen(true);
                                                                 setTaxHistoryLoading(true);
                                                                 try {
                                                                     const isOther = otherVehicles.some(v => v._id === selectedBusForTaxes._id);
                                                                     const baseUrl = isOther ? `${API}/other-vehicles/${selectedBusForTaxes._id}/taxes/history` : `${API}/buses/${selectedBusForTaxes._id}/taxes/history`;
                                                                     const res = await apiFetch(
                                                                         `${baseUrl}?taxHeader=${encodeURIComponent(taxHeaderName)}`
                                                                     );
                                                                     const data = await res.json();
                                                                     setTaxHistoryData(data);
                                                                 } catch (e) {
                                                                     console.error('Error fetching tax history', e);
                                                                 } finally {
                                                                     setTaxHistoryLoading(false);
                                                                 }
                                                             }}
                                                             className="flex-1 px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold rounded-lg hover:bg-slate-300"
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
                 </div>
             </Modal>

            <Modal isOpen={isTaxHeaderModalOpen} onClose={handleCloseTaxHeaderModal} title={editingTaxHeaderId ? "Edit Tax Header" : "Add New Tax Header"}>
                <form onSubmit={(e) => { e.preventDefault(); handleAddOrUpdateTaxHeader(); }} className="space-y-5">
                    <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1.5">Tax Name *</label>
                        <input
                            type="text"
                            value={newTaxHeader.taxName}
                            onChange={(e) => setNewTaxHeader({ ...newTaxHeader, taxName: e.target.value })}
                            placeholder="e.g., GST, Vehicle Tax, Insurance, Road Tax"
                            className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition-all"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1.5">Description</label>
                        <textarea
                            value={newTaxHeader.description}
                            onChange={(e) => setNewTaxHeader({ ...newTaxHeader, description: e.target.value })}
                            placeholder="Optional description for this tax header"
                            rows="2"
                            className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition-all resize-none"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1.5">Default Amount</label>
                        <input
                            type="number"
                            step="0.01"
                            value={newTaxHeader.defaultAmount}
                            onChange={(e) => setNewTaxHeader({ ...newTaxHeader, defaultAmount: e.target.value })}
                            placeholder="e.g., 150.00"
                            className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition-all"
                        />
                    </div>
                    <div className="flex items-center">
                        <input
                            type="checkbox"
                            id="isActiveHeader"
                            checked={newTaxHeader.isActive}
                            onChange={(e) => setNewTaxHeader({ ...newTaxHeader, isActive: e.target.checked })}
                            className="w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-2 focus:ring-purple-500"
                        />
                        <label htmlFor="isActiveHeader" className="ml-2 text-sm font-medium text-slate-700">
                            Active
                        </label>
                    </div>
                    <button
                        type="submit"
                        className="w-full bg-purple-600 text-white font-bold py-3.5 rounded-xl hover:bg-purple-700 transition-colors shadow-lg shadow-purple-200 mt-4"
                    >
                        {editingTaxHeaderId ? 'Update Tax Header' : 'Create Tax Header'}
                    </button>
                </form>
            </Modal>
            
            {/* Tax History Modal */}
            <Modal isOpen={isTaxHistoryModalOpen} onClose={() => {
                setIsTaxHistoryModalOpen(false);
                setTaxHistoryData(null);
            }} title={taxHistoryData ? `Tax History — ${taxHistoryData.history?.[0]?.taxHeader || ''}` : 'Tax History'} maxWidth="max-w-2xl">
                <div className="space-y-5">
                    {taxHistoryLoading ? (
                        <div className="py-10 text-center text-slate-500 text-sm">Loading history...</div>
                    ) : !taxHistoryData || taxHistoryData.history?.length === 0 ? (
                        <div className="py-10 text-center text-slate-400 text-sm">No history recorded yet. Changes made from now on will appear here.</div>
                    ) : (
                        <>
                            {/* Stats summary cards */}
                            {taxHistoryData.stats?.map(stat => (
                                <div key={stat.taxHeader} className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                    <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-center">
                                        <p className="text-2xl font-extrabold text-blue-700">{stat.timesAdded}</p>
                                        <p className="text-xs text-blue-600 mt-0.5 font-medium">Times Added</p>
                                    </div>
                                    <div className="bg-purple-50 border border-purple-100 rounded-xl p-3 text-center">
                                        <p className="text-2xl font-extrabold text-purple-700">{stat.totalUpdates}</p>
                                        <p className="text-xs text-purple-600 mt-0.5 font-medium">Times Updated</p>
                                    </div>
                                    <div className="bg-red-50 border border-red-100 rounded-xl p-3 text-center">
                                        <p className="text-2xl font-extrabold text-red-700">{stat.timesExpiredOnSave}</p>
                                        <p className="text-xs text-red-600 mt-0.5 font-medium">Saved While Expired</p>
                                    </div>
                                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center">
                                        <p className="text-2xl font-extrabold text-slate-700">{stat.timesDeleted}</p>
                                        <p className="text-xs text-slate-500 mt-0.5 font-medium">Times Deleted</p>
                                    </div>
                                </div>
                            ))}

                            {/* Timeline */}
                            <div>
                                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Change Timeline</p>
                                <div className="relative">
                                    {/* vertical line */}
                                    <div className="absolute left-4 top-0 bottom-0 w-px bg-slate-200" />
                                    <div className="space-y-4 pl-10">
                                        {taxHistoryData.history.map((h, i) => {
                                            const actionColor = h.action === 'added'
                                                ? 'bg-green-100 text-green-700 border-green-200'
                                                : h.action === 'deleted'
                                                ? 'bg-red-100 text-red-700 border-red-200'
                                                : 'bg-blue-100 text-blue-700 border-blue-200';
                                            const dotColor = h.action === 'added'
                                                ? 'bg-green-500'
                                                : h.action === 'deleted'
                                                ? 'bg-red-500'
                                                : 'bg-blue-500';
                                            const actionLabel = h.action === 'added' ? 'Added' : h.action === 'deleted' ? 'Deleted' : 'Updated';
                                            const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
                                            const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

                                            return (
                                                <div key={h._id || i} className="relative">
                                                    {/* dot */}
                                                    <div className={`absolute -left-6 top-2 w-3 h-3 rounded-full border-2 border-white ${dotColor}`} />
                                                    <div className={`rounded-xl border p-3.5 ${h.wasExpiredAtAction ? 'bg-red-50 border-red-200' : 'bg-white border-slate-200'}`}>
                                                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                                                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${actionColor}`}>
                                                                {actionLabel}
                                                            </span>
                                                            {h.wasExpiredAtAction && (
                                                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700 border border-red-200">
                                                                    Was Expired
                                                                </span>
                                                            )}
                                                            <span className="text-[10px] text-slate-400 ml-auto">{fmtDateTime(h.actionAt)}</span>
                                                        </div>
                                                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600">
                                                            <div>
                                                                <span className="font-semibold text-slate-700">Amount: </span>
                                                                ₹{h.amount?.toFixed(2) ?? '—'}
                                                                {h.action === 'updated' && h.previousAmount != null && h.previousAmount !== h.amount && (
                                                                    <span className="text-slate-400 ml-1">(was ₹{h.previousAmount.toFixed(2)})</span>
                                                                )}
                                                            </div>
                                                            <div>
                                                                <span className="font-semibold text-slate-700">End Date: </span>
                                                                {fmtDate(h.endDate)}
                                                                {h.action === 'updated' && h.previousEndDate && fmtDate(h.previousEndDate) !== fmtDate(h.endDate) && (
                                                                    <span className="text-slate-400 ml-1">(was {fmtDate(h.previousEndDate)})</span>
                                                                )}
                                                            </div>
                                                            {h.changedBy && (
                                                                <div className="col-span-2">
                                                                    <span className="font-semibold text-slate-700">By: </span>{h.changedBy}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </Modal>
        </Layout>
    );
};

export default BusManagement;
