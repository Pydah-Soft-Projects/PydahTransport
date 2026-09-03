import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import { apiFetch, API_BASE } from '../utils/api';
import {
  MessageSquare,
  Plus,
  Trash2,
  Edit2,
  Save,
  Loader2,
  Send,
  RefreshCw,
  Users,
  Bus,
  Map as MapIcon,
  X,
  Bell,
  BarChart3,
  FileText,
  Search,
  ChevronRight,
  Clock,
} from 'lucide-react';

const AUTO_ACTION_META = {
  transfer_stage: {
    label: 'Stage Migration',
    description: 'When a stage is moved from one route to another, all passengers on that stage receive SMS.',
    icon: MapIcon,
  },
  transfer_passengers: {
    label: 'Passenger Transfer',
    description: 'When selected students/employees are transferred to another route and stage.',
    icon: Users,
  },
  bus_route_mapping: {
    label: 'Bus–Route Mapping',
    description: 'When a bus is attached or detached from a route and passenger bus assignments update.',
    icon: Bus,
  },
};

const EMPTY_TEMPLATE = {
  name: '',
  dltTemplateId: '',
  body: '',
  description: '',
  varMappings: [],
  unicode: false,
  isActive: true,
};

const PLACEHOLDER_HINT = 'Use {#var#} for each value. Transport fields: Passenger Name, Admission/Emp No, Route ID, Route Name, Stage, Bus Number. For transfers: Old/New Route, Stage, Bus fields.';

const VAR_FIELD_OPTIONS = [
  { value: 'name', label: 'Passenger Name' },
  { value: 'admission_number', label: 'Admission Number (Student)' },
  { value: 'emp_no', label: 'Employee Number' },
  { value: 'route_id', label: 'Route ID' },
  { value: 'route_name', label: 'Route Name' },
  { value: 'stage_name', label: 'Boarding Stage' },
  { value: 'bus_id', label: 'Bus Number' },
  { value: 'old_route_id', label: 'Old Route ID' },
  { value: 'new_route_id', label: 'New Route ID' },
  { value: 'old_route_name', label: 'Old Route Name' },
  { value: 'new_route_name', label: 'New Route Name' },
  { value: 'old_stage_name', label: 'Old Stage' },
  { value: 'new_stage_name', label: 'New Stage' },
  { value: 'old_bus_id', label: 'Old Bus Number' },
  { value: 'new_bus_id', label: 'New Bus Number' },
];

const countDltVars = (body = '') => {
  // Support normal DLT tokens and common paste variants
  const text = String(body || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\{\s*#\s*var\s*#\s*\}/gi, '{#var#}');
  const matches = text.match(/\{#var#\}/gi);
  return matches ? matches.length : 0;
};

const normalizeDltBody = (body = '') => (
  String(body || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\{\s*#\s*var\s*#\s*\}/gi, '{#var#}')
);

const emptyVarMapping = () => ({ type: 'field', field: '', value: '' });

export default function Communications() {
  const [activeTab, setActiveTab] = useState('templates');
  const [templates, setTemplates] = useState([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [templateForm, setTemplateForm] = useState(EMPTY_TEMPLATE);
  const [message, setMessage] = useState(null);

  const [routes, setRoutes] = useState([]);
  const [buses, setBuses] = useState([]);
  const [configStatus, setConfigStatus] = useState({ configured: false, senderId: '' });
  const [balance, setBalance] = useState(null);

  const [sendForm, setSendForm] = useState({
    templateId: '',
    audience: 'students',
    filterBy: 'route',
    routeId: '',
    busId: '',
  });
  const [recipients, setRecipients] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState(null);

  const [autoSettings, setAutoSettings] = useState([]);
  const [loadingAutoSettings, setLoadingAutoSettings] = useState(false);
  const [savingAutoSettings, setSavingAutoSettings] = useState(false);
  const [autoLogs, setAutoLogs] = useState([]);
  const [autoLogStats, setAutoLogStats] = useState({
    dispatches: 0,
    sentCount: 0,
    failedCount: 0,
    noPhoneCount: 0,
    skippedDispatches: 0,
    byAction: [],
  });
  const [loadingAutoLogs, setLoadingAutoLogs] = useState(false);
  const [selectedLogId, setSelectedLogId] = useState(null);
  const [messageSearch, setMessageSearch] = useState('');
  const [debouncedMessageSearch, setDebouncedMessageSearch] = useState('');
  const [logActionFilter, setLogActionFilter] = useState('');
  const [logsPage, setLogsPage] = useState(1);
  const [logsPagination, setLogsPagination] = useState({ page: 1, pages: 1, total: 0 });

  const selectedTemplate = useMemo(
    () => templates.find((t) => t._id === sendForm.templateId) || null,
    [templates, sendForm.templateId]
  );

  const templateBodyVarCount = useMemo(
    () => countDltVars(templateForm.body),
    [templateForm.body]
  );

  const selectedTemplateBody = useMemo(
    () => normalizeDltBody(selectedTemplate?.body || ''),
    [selectedTemplate]
  );

  const selectedTemplatePreview = useMemo(() => {
    if (!selectedTemplateBody) return '';
    const mappings = Array.isArray(selectedTemplate?.varMappings) ? selectedTemplate.varMappings : [];
    if (mappings.length === 0) return selectedTemplateBody;

    const sample = recipients.find((r) => selectedIds.includes(r.id)) || recipients[0] || null;
    let index = 0;
    return selectedTemplateBody.replace(/\{#\s*var\s*#\}/gi, () => {
      const mapping = mappings[index];
      index += 1;
      if (!mapping) return '{#var#}';
      if (mapping.type === 'custom') return mapping.value || `[Custom ${index}]`;
      if (!mapping.field) return `[Variable ${index}]`;
      if (!sample) {
        const opt = VAR_FIELD_OPTIONS.find((o) => o.value === mapping.field);
        return `[${opt?.label || mapping.field}]`;
      }
      return sample.params?.[mapping.field] || sample[mapping.field] || '';
    });
  }, [selectedTemplateBody, selectedTemplate, recipients, selectedIds]);

  // Keep Variable 1..N in sync while editing template body
  useEffect(() => {
    const count = templateBodyVarCount;
    setTemplateForm((prev) => {
      const current = Array.isArray(prev.varMappings) ? prev.varMappings : [];
      if (count <= 0) {
        if (current.length === 0) return prev;
        return { ...prev, varMappings: [] };
      }
      const next = Array.from({ length: count }, (_, i) => current[i] || emptyVarMapping());
      const same = next.length === current.length
        && next.every((m, i) => (
          m.type === current[i]?.type
          && m.field === current[i]?.field
          && m.value === current[i]?.value
        ));
      if (same) return prev;
      return { ...prev, varMappings: next };
    });
  }, [templateBodyVarCount]);

  const updateTemplateVarMapping = (idx, patch) => {
    setTemplateForm((prev) => ({
      ...prev,
      varMappings: (prev.varMappings || []).map((item, i) => (
        i === idx ? { ...item, ...patch } : item
      )),
    }));
  };

  const showMessage = (type, text) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  const loadTemplates = useCallback(async () => {
    setLoadingTemplates(true);
    try {
      const res = await apiFetch(`${API_BASE}/communications/templates`);
      const json = await res.json();
      if (json.success) setTemplates(json.data || []);
    } catch (err) {
      showMessage('error', err.message || 'Failed to load templates');
    } finally {
      setLoadingTemplates(false);
    }
  }, []);

  const loadLookups = useCallback(async () => {
    try {
      const [routesRes, busesRes, configRes] = await Promise.all([
        apiFetch(`${API_BASE}/routes`),
        apiFetch(`${API_BASE}/buses`),
        apiFetch(`${API_BASE}/communications/config-status`),
      ]);
      const routesJson = await routesRes.json();
      const busesJson = await busesRes.json();
      const configJson = await configRes.json();

      setRoutes(Array.isArray(routesJson) ? routesJson : (routesJson.data || []));
      setBuses(Array.isArray(busesJson) ? busesJson : (busesJson.data || []));
      if (configJson.success) setConfigStatus(configJson);
    } catch {
      // ignore lookup failures
    }
  }, []);

  const loadBalance = async () => {
    try {
      const res = await apiFetch(`${API_BASE}/communications/balance`);
      const json = await res.json();
      if (json.success) setBalance(json.label || (json.balance != null ? `${json.balance} credits` : null));
      else showMessage('error', json.message || 'Failed to fetch balance');
    } catch (err) {
      showMessage('error', err.message || 'Failed to fetch balance');
    }
  };

  useEffect(() => {
    loadTemplates();
    loadLookups();
  }, [loadTemplates, loadLookups]);

  const loadAutoSettings = useCallback(async () => {
    setLoadingAutoSettings(true);
    try {
      const res = await apiFetch(`${API_BASE}/communications/auto-notifications`);
      const json = await res.json();
      if (json.success) setAutoSettings(json.data || []);
    } catch (err) {
      showMessage('error', err.message || 'Failed to load auto notification settings');
    } finally {
      setLoadingAutoSettings(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'auto') loadAutoSettings();
  }, [activeTab, loadAutoSettings]);

  const loadAutoLogs = useCallback(async () => {
    setLoadingAutoLogs(true);
    try {
      const params = new URLSearchParams({
        page: String(logsPage),
        limit: '25',
      });
      if (logActionFilter) params.set('action', logActionFilter);
      if (debouncedMessageSearch.trim()) params.set('search', debouncedMessageSearch.trim());
      const res = await apiFetch(`${API_BASE}/communications/auto-notifications/logs?${params.toString()}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'Failed to load delivery logs');
      const rows = json.data || [];
      setAutoLogs(rows);
      setAutoLogStats(json.stats || {
        dispatches: 0,
        sentCount: 0,
        failedCount: 0,
        noPhoneCount: 0,
        skippedDispatches: 0,
        byAction: [],
      });
      setLogsPagination(json.pagination || { page: 1, pages: 1, total: 0 });
      setSelectedLogId((prev) => {
        if (prev && rows.some((row) => String(row._id) === String(prev))) return prev;
        return rows[0]?._id || null;
      });
    } catch (err) {
      showMessage('error', err.message || 'Failed to load auto notification logs');
    } finally {
      setLoadingAutoLogs(false);
    }
  }, [logsPage, logActionFilter, debouncedMessageSearch]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedMessageSearch(messageSearch);
      setLogsPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [messageSearch]);

  useEffect(() => {
    if (activeTab === 'auto') loadAutoLogs();
  }, [activeTab, loadAutoLogs]);

  const selectedAutoLog = useMemo(
    () => autoLogs.find((log) => String(log._id) === String(selectedLogId)) || null,
    [autoLogs, selectedLogId]
  );

  const filteredMessages = useMemo(() => {
    const messages = Array.isArray(selectedAutoLog?.messages) ? selectedAutoLog.messages : [];
    const query = messageSearch.trim().toLowerCase();
    if (!query) return messages;

    return messages.filter((entry) => [
      entry.recipientName,
      entry.recipientId,
      entry.recipientType,
      entry.phone,
      entry.message,
      entry.status,
      entry.error,
    ].some((value) => String(value || '').toLowerCase().includes(query)));
  }, [selectedAutoLog, messageSearch]);

  const formatLogDate = (value) => {
    if (!value) return '—';
    return new Date(value).toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const statusTone = (status) => {
    if (status === 'sent') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (status === 'partial') return 'bg-amber-50 text-amber-700 border-amber-200';
    if (status === 'failed') return 'bg-red-50 text-red-700 border-red-200';
    return 'bg-slate-50 text-slate-600 border-slate-200';
  };

  const messageStatusTone = (status) => {
    if (status === 'sent') return 'text-emerald-700 bg-emerald-50';
    if (status === 'failed') return 'text-red-700 bg-red-50';
    if (status === 'no_phone') return 'text-amber-700 bg-amber-50';
    return 'text-slate-600 bg-slate-100';
  };

  const updateAutoSetting = (action, patch) => {
    setAutoSettings((prev) => prev.map((s) => (
      s.action === action ? { ...s, ...patch } : s
    )));
  };

  const handleSaveAutoSettings = async () => {
    setSavingAutoSettings(true);
    try {
      const payload = autoSettings.map((s) => ({
        action: s.action,
        enabled: Boolean(s.enabled),
        templateId: s.templateId?._id || s.templateId || null,
        notifyStudents: s.notifyStudents !== false,
        notifyEmployees: s.notifyEmployees !== false,
      }));
      const res = await apiFetch(`${API_BASE}/communications/auto-notifications`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: payload }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'Save failed');
      setAutoSettings(json.data || []);
      showMessage('success', 'Auto notification settings saved');
    } catch (err) {
      showMessage('error', err.message || 'Failed to save auto notification settings');
    } finally {
      setSavingAutoSettings(false);
    }
  };

  const resetTemplateForm = () => {
    setEditingTemplate(null);
    setTemplateForm(EMPTY_TEMPLATE);
  };

  const handleSaveTemplate = async () => {
    if (!templateForm.name.trim() || !templateForm.body.trim()) {
      return showMessage('error', 'Template name and body are required');
    }
    if (!templateForm.dltTemplateId.trim()) {
      return showMessage('error', 'DLT Template ID is required');
    }

    const varCount = countDltVars(templateForm.body);
    if (varCount > 0) {
      const mappings = templateForm.varMappings || [];
      if (mappings.length !== varCount) {
        return showMessage('error', `Map all ${varCount} variables before saving`);
      }
      for (let i = 0; i < mappings.length; i += 1) {
        const mapping = mappings[i];
        if (mapping.type === 'field' && !mapping.field) {
          return showMessage('error', `Select a transport field for Variable ${i + 1}`);
        }
        if (mapping.type === 'custom' && !String(mapping.value || '').trim()) {
          return showMessage('error', `Enter a custom value for Variable ${i + 1}`);
        }
      }
    }

    setSavingTemplate(true);
    try {
      const url = editingTemplate
        ? `${API_BASE}/communications/templates/${editingTemplate._id}`
        : `${API_BASE}/communications/templates`;
      const res = await apiFetch(url, {
        method: editingTemplate ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...templateForm,
          body: normalizeDltBody(templateForm.body),
          varMappings: varCount > 0 ? templateForm.varMappings : [],
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'Save failed');
      showMessage('success', editingTemplate ? 'Template updated' : 'Template created');
      resetTemplateForm();
      loadTemplates();
    } catch (err) {
      showMessage('error', err.message || 'Failed to save template');
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleEditTemplate = (template) => {
    setEditingTemplate(template);
    const body = normalizeDltBody(template.body || '');
    const count = countDltVars(body);
    const saved = Array.isArray(template.varMappings) ? template.varMappings : [];
    setTemplateForm({
      name: template.name || '',
      dltTemplateId: template.dltTemplateId || '',
      body,
      description: template.description || '',
      varMappings: Array.from({ length: count }, (_, i) => saved[i] || emptyVarMapping()),
      unicode: Boolean(template.unicode),
      isActive: template.isActive !== false,
    });
  };

  const handleDeleteTemplate = async (id) => {
    if (!window.confirm('Delete this template?')) return;
    try {
      const res = await apiFetch(`${API_BASE}/communications/templates/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'Delete failed');
      showMessage('success', 'Template deleted');
      if (editingTemplate?._id === id) resetTemplateForm();
      loadTemplates();
    } catch (err) {
      showMessage('error', err.message || 'Failed to delete template');
    }
  };

  const loadRecipients = async () => {
    if (sendForm.filterBy === 'route' && !sendForm.routeId) {
      return showMessage('error', 'Select a route first');
    }
    if (sendForm.filterBy === 'bus' && !sendForm.busId) {
      return showMessage('error', 'Select a bus first');
    }

    setLoadingRecipients(true);
    setSendResult(null);
    try {
      const params = new URLSearchParams({
        audience: sendForm.audience,
        filterBy: sendForm.filterBy,
        routeId: sendForm.routeId || '',
        busId: sendForm.busId || '',
      });
      const res = await apiFetch(`${API_BASE}/communications/recipients?${params}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'Failed to load recipients');

      const list = json.data?.recipients || [];
      setRecipients(list);
      setSelectedIds(list.filter((r) => r.phone).map((r) => r.id));
    } catch (err) {
      showMessage('error', err.message || 'Failed to load recipients');
      setRecipients([]);
      setSelectedIds([]);
    } finally {
      setLoadingRecipients(false);
    }
  };

  const toggleRecipient = (id) => {
    setSelectedIds((prev) => (
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    ));
  };

  const toggleAllWithPhone = () => {
    const withPhone = recipients.filter((r) => r.phone).map((r) => r.id);
    if (selectedIds.length === withPhone.length) setSelectedIds([]);
    else setSelectedIds(withPhone);
  };

  const handleSend = async () => {
    if (!sendForm.templateId) return showMessage('error', 'Select a template');
    if (!selectedTemplate?.dltTemplateId) {
      return showMessage('error', 'Selected template has no DLT Template ID. Edit it first.');
    }
    if (selectedIds.length === 0) return showMessage('error', 'Select at least one recipient');

    const savedCount = countDltVars(selectedTemplate.body || '');
    const savedMappings = Array.isArray(selectedTemplate.varMappings) ? selectedTemplate.varMappings : [];
    if (savedCount > 0 && savedMappings.length !== savedCount) {
      return showMessage('error', 'Selected template has incomplete variable mappings. Edit the template first.');
    }

    if (!window.confirm(`Send SMS to ${selectedIds.length} recipient(s)?`)) return;

    setSending(true);
    setSendResult(null);
    try {
      const res = await apiFetch(`${API_BASE}/communications/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: sendForm.templateId,
          audience: sendForm.audience,
          filterBy: sendForm.filterBy,
          routeId: sendForm.routeId || undefined,
          busId: sendForm.busId || undefined,
          selectedIds,
        }),
      });
      const json = await res.json();
      if (!json.success && !json.sent) {
        throw new Error(json.message || 'Send failed');
      }
      setSendResult(json);
      showMessage('success', `Sent: ${json.sent || 0}, Failed: ${json.failed || 0}`);
    } catch (err) {
      showMessage('error', err.message || 'Failed to send SMS');
    } finally {
      setSending(false);
    }
  };

  return (
    <Layout>
      <div className="space-y-4 font-sans text-slate-800">
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-sm shrink-0">
              <MessageSquare size={18} />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 tracking-tight leading-none">Communications</h1>
              <p className="text-xs text-slate-500 mt-1">
                SMS templates &amp; BulkSMS delivery
                {configStatus.senderId ? ` • Sender: ${configStatus.senderId}` : ''}
                {balance !== null ? ` • Balance: ${balance}` : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={loadBalance}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center gap-1.5"
            >
              <RefreshCw size={12} /> Check Balance
            </button>
            <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs font-semibold gap-1">
              <button
                onClick={() => setActiveTab('templates')}
                className={`px-4 py-1.5 rounded-md transition-all ${activeTab === 'templates' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
              >
                Templates
              </button>
              <button
                onClick={() => setActiveTab('send')}
                className={`px-4 py-1.5 rounded-md transition-all ${activeTab === 'send' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
              >
                Send SMS
              </button>
              <button
                onClick={() => setActiveTab('auto')}
                className={`px-4 py-1.5 rounded-md transition-all flex items-center gap-1.5 ${activeTab === 'auto' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
              >
                <Bell size={12} /> Auto Notifications
              </button>
            </div>
          </div>
        </div>

        {message && (
          <div className={`text-sm px-4 py-2 rounded-lg border ${message.type === 'success' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
            {message.text}
          </div>
        )}

        {!configStatus.configured && (
          <div className="text-sm px-4 py-2 rounded-lg border bg-amber-50 text-amber-800 border-amber-200">
            BulkSMS API key is not configured. Add <code>BULKSMS_API_KEY</code> in backend .env.
          </div>
        )}

        {activeTab === 'templates' ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-800">
                  {editingTemplate ? 'Edit Template' : 'New Template'}
                </h2>
                {editingTemplate && (
                  <button onClick={resetTemplateForm} className="text-slate-400 hover:text-slate-600">
                    <X size={16} />
                  </button>
                )}
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Name</label>
                <input
                  value={templateForm.name}
                  onChange={(e) => setTemplateForm((p) => ({ ...p, name: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="e.g. Route Delay Notice"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">DLT Template ID</label>
                <input
                  value={templateForm.dltTemplateId}
                  onChange={(e) => setTemplateForm((p) => ({ ...p, dltTemplateId: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono"
                  placeholder="e.g. 120716XXXXXXXXXXXXX"
                />
                <p className="text-[10px] text-slate-400 mt-1">Required. Use the approved Content Template ID from DLT portal.</p>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Description</label>
                <input
                  value={templateForm.description}
                  onChange={(e) => setTemplateForm((p) => ({ ...p, description: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="Optional note"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Message Body</label>
                <textarea
                  value={templateForm.body}
                  onChange={(e) => setTemplateForm((p) => ({ ...p, body: e.target.value }))}
                  rows={6}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="Dear Parent, {#var#} bus {#var#} on route {#var#} from stage {#var#}. - PYDAH Transport"
                />
                <p className="text-[10px] text-slate-400 mt-1">{PLACEHOLDER_HINT}</p>
              </div>

              {templateBodyVarCount > 0 && (
                <div className="border border-blue-200 bg-blue-50/40 rounded-lg p-3 space-y-3">
                  <div>
                    <p className="text-xs font-bold text-blue-900">Variable Mapping ({templateBodyVarCount})</p>
                    <p className="text-[11px] text-blue-700/80 mt-0.5">
                      Map each {'{#var#}'} now. These mappings are saved with the template and used when sending.
                    </p>
                  </div>

                  <div className="space-y-2">
                    {Array.from({ length: templateBodyVarCount }).map((_, idx) => {
                      const mapping = templateForm.varMappings?.[idx] || emptyVarMapping();
                      return (
                        <div key={`tpl-var-${idx}`} className="bg-white border border-slate-200 rounded-lg p-3 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <label className="text-xs font-bold text-slate-800">Variable {idx + 1}</label>
                            <span className="text-[10px] font-mono text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">{'{#var#}'}</span>
                          </div>
                          <select
                            value={mapping.type === 'custom' ? 'custom' : (mapping.field || '')}
                            onChange={(e) => {
                              const value = e.target.value;
                              if (value === 'custom') {
                                updateTemplateVarMapping(idx, { type: 'custom', field: '', value: mapping.value || '' });
                              } else {
                                updateTemplateVarMapping(idx, { type: 'field', field: value, value: '' });
                              }
                            }}
                            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                          >
                            <option value="">— Select transport field —</option>
                            {VAR_FIELD_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                            <option value="custom">Custom text…</option>
                          </select>
                          {mapping.type === 'custom' && (
                            <input
                              type="text"
                              value={mapping.value || ''}
                              onChange={(e) => updateTemplateVarMapping(idx, { value: e.target.value })}
                              placeholder={`Enter value for Variable ${idx + 1}`}
                              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-4 text-xs">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={templateForm.unicode}
                    onChange={(e) => setTemplateForm((p) => ({ ...p, unicode: e.target.checked }))}
                  />
                  Unicode (non-English)
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={templateForm.isActive}
                    onChange={(e) => setTemplateForm((p) => ({ ...p, isActive: e.target.checked }))}
                  />
                  Active
                </label>
              </div>

              <button
                onClick={handleSaveTemplate}
                disabled={savingTemplate}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-lg disabled:opacity-50"
              >
                {savingTemplate ? <Loader2 size={14} className="animate-spin" /> : editingTemplate ? <Save size={14} /> : <Plus size={14} />}
                {editingTemplate ? 'Update Template' : 'Create Template'}
              </button>
            </div>

            <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-800">Saved Templates</h2>
                {loadingTemplates && <Loader2 size={14} className="animate-spin text-blue-500" />}
              </div>
              {templates.length === 0 && !loadingTemplates ? (
                <div className="p-8 text-center text-sm text-slate-400 italic">No templates yet.</div>
              ) : (
                <div className="divide-y divide-slate-50">
                  {templates.map((t) => (
                    <div key={t._id} className="p-4 hover:bg-slate-50/50 flex gap-3 items-start">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-slate-900">{t.name}</span>
                          {t.dltTemplateId && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono">
                              DLT: {t.dltTemplateId}
                            </span>
                          )}
                          {!t.isActive && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">Inactive</span>
                          )}
                          {t.unicode && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600">Unicode</span>
                          )}
                        </div>
                        {t.description && <p className="text-[11px] text-slate-400 mt-0.5">{t.description}</p>}
                        {Array.isArray(t.varMappings) && t.varMappings.length > 0 && (
                          <p className="text-[11px] text-slate-500 mt-1">
                            Mapped: {t.varMappings.map((m, i) => {
                              const label = m.type === 'custom'
                                ? `"${m.value || ''}"`
                                : (VAR_FIELD_OPTIONS.find((o) => o.value === m.field)?.label || m.field || '—');
                              return `V${i + 1}=${label}`;
                            }).join(' • ')}
                          </p>
                        )}
                        <p className="text-xs text-slate-600 mt-2 whitespace-pre-wrap break-words">{t.body}</p>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button onClick={() => handleEditTemplate(t)} className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded">
                          <Edit2 size={14} />
                        </button>
                        <button onClick={() => handleDeleteTemplate(t._id)} className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : activeTab === 'auto' ? (
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-4 items-start">
            {/* Left column — Auto notification settings */}
            <div className="space-y-4">
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <Bell size={15} className="text-blue-600" /> Notification Settings
                  </h2>
                  <p className="text-[11px] text-slate-500 mt-1">Configure templates and triggers for automatic SMS on route actions.</p>
                </div>
                <button
                  onClick={handleSaveAutoSettings}
                  disabled={savingAutoSettings || loadingAutoSettings}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 disabled:opacity-50 shadow-sm shrink-0"
                >
                  {savingAutoSettings ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  Save Settings
                </button>
              </div>

              {loadingAutoSettings ? (
                <div className="flex items-center justify-center py-16 text-slate-400 text-sm gap-2 bg-white rounded-xl border border-slate-200">
                  <Loader2 size={18} className="animate-spin" /> Loading settings…
                </div>
              ) : (
                <>
                  <div className="space-y-4">
                    {autoSettings.map((setting) => {
                      const meta = AUTO_ACTION_META[setting.action] || {
                        label: setting.action,
                        description: '',
                        icon: Bell,
                      };
                      const Icon = meta.icon;
                      const linkedTemplate = setting.templateId && typeof setting.templateId === 'object'
                        ? setting.templateId
                        : templates.find((t) => t._id === setting.templateId);
                      const activeTemplates = templates.filter((t) => t.isActive !== false);

                      return (
                        <div key={setting.action} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3">
                              <div className="w-9 h-9 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
                                <Icon size={16} />
                              </div>
                              <div>
                                <h3 className="text-sm font-bold text-slate-900">{meta.label}</h3>
                                <p className="text-xs text-slate-500 mt-0.5">{meta.description}</p>
                              </div>
                            </div>
                            <label className="flex items-center gap-2 text-xs font-bold text-slate-600 shrink-0 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={Boolean(setting.enabled)}
                                onChange={(e) => updateAutoSetting(setting.action, { enabled: e.target.checked })}
                                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                              />
                              Enabled
                            </label>
                          </div>

                          <div className="space-y-3 pt-1">
                            <div>
                              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">SMS Template</label>
                              <select
                                value={linkedTemplate?._id || setting.templateId || ''}
                                onChange={(e) => {
                                  const tpl = activeTemplates.find((t) => t._id === e.target.value);
                                  updateAutoSetting(setting.action, { templateId: tpl || e.target.value || null });
                                }}
                                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
                              >
                                <option value="">— Select template —</option>
                                {activeTemplates.map((t) => (
                                  <option key={t._id} value={t._id}>{t.name}</option>
                                ))}
                              </select>
                            </div>
                            <div className="flex flex-wrap items-center gap-4">
                              <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={setting.notifyStudents !== false}
                                  onChange={(e) => updateAutoSetting(setting.action, { notifyStudents: e.target.checked })}
                                  className="rounded border-slate-300 text-blue-600"
                                />
                                Notify students
                              </label>
                              <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={setting.notifyEmployees !== false}
                                  onChange={(e) => updateAutoSetting(setting.action, { notifyEmployees: e.target.checked })}
                                  className="rounded border-slate-300 text-blue-600"
                                />
                                Notify employees
                              </label>
                            </div>
                          </div>

                          {linkedTemplate && (
                            <div className="bg-slate-50 border border-slate-100 rounded-lg p-3 text-xs">
                              <p className="font-bold text-slate-700 mb-1">Template preview</p>
                              <p className="text-slate-600 whitespace-pre-wrap font-mono text-[11px] leading-relaxed">
                                {linkedTemplate.body}
                              </p>
                              {linkedTemplate.description && (
                                <p className="text-slate-400 mt-2 italic">{linkedTemplate.description}</p>
                              )}
                            </div>
                          )}

                          {setting.enabled && !linkedTemplate && (
                            <p className="text-xs text-amber-700 font-semibold">Select a template to enable sending.</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {/* Right column — Delivery stats & message details */}
            <div className="space-y-4">
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <BarChart3 size={15} className="text-blue-600" /> Message Stats
                  </h2>
                  <p className="text-[11px] text-slate-500 mt-1">Delivery history and the exact SMS content sent to each recipient.</p>
                </div>
                <button
                  type="button"
                  onClick={loadAutoLogs}
                  className="px-3 py-1.5 text-[10px] font-bold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center gap-1 shrink-0"
                >
                  <RefreshCw size={11} /> Refresh
                </button>
              </div>

              {loadingAutoLogs ? (
                <div className="flex items-center justify-center py-16 text-slate-400 text-sm gap-2 bg-white rounded-xl border border-slate-200">
                  <Loader2 size={18} className="animate-spin" /> Loading delivery stats…
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="bg-white rounded-xl border border-slate-200 p-3">
                      <p className="text-[10px] font-bold uppercase text-slate-400">Dispatches</p>
                      <p className="text-xl font-black text-slate-900 mt-1">{autoLogStats.dispatches}</p>
                    </div>
                    <div className="bg-white rounded-xl border border-emerald-100 p-3">
                      <p className="text-[10px] font-bold uppercase text-emerald-600">Messages Sent</p>
                      <p className="text-xl font-black text-emerald-700 mt-1">{autoLogStats.sentCount}</p>
                    </div>
                    <div className="bg-white rounded-xl border border-red-100 p-3">
                      <p className="text-[10px] font-bold uppercase text-red-500">Failed</p>
                      <p className="text-xl font-black text-red-700 mt-1">{autoLogStats.failedCount}</p>
                    </div>
                    <div className="bg-white rounded-xl border border-amber-100 p-3">
                      <p className="text-[10px] font-bold uppercase text-amber-600">No Phone</p>
                      <p className="text-xl font-black text-amber-700 mt-1">{autoLogStats.noPhoneCount}</p>
                    </div>
                  </div>

                  <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
                    <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide">Filter by Action</h3>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => { setLogActionFilter(''); setLogsPage(1); }}
                        className={`px-2.5 py-1 rounded-md text-[10px] font-bold border ${!logActionFilter ? 'bg-blue-600 text-white border-blue-600' : 'bg-slate-50 text-slate-600 border-slate-200'}`}
                      >
                        All
                      </button>
                      {Object.entries(AUTO_ACTION_META).map(([action, meta]) => (
                        <button
                          key={action}
                          type="button"
                          onClick={() => { setLogActionFilter(action); setLogsPage(1); }}
                          className={`px-2.5 py-1 rounded-md text-[10px] font-bold border ${logActionFilter === action ? 'bg-blue-600 text-white border-blue-600' : 'bg-slate-50 text-slate-600 border-slate-200'}`}
                        >
                          {meta.label}
                        </button>
                      ))}
                    </div>

                    {(autoLogStats.byAction || []).length > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                        {autoLogStats.byAction.map((row) => {
                          const meta = AUTO_ACTION_META[row.action] || { label: row.action };
                          return (
                            <div key={row.action} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                              <p className="text-[11px] font-bold text-slate-800">{meta.label}</p>
                              <p className="text-[10px] text-slate-500 mt-1">
                                {row.dispatches} dispatches · {row.sentCount} sent
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <Clock size={15} className="text-blue-600" /> Recent Dispatches
                    </h3>
                    <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                      {autoLogs.length === 0 ? (
                        <p className="text-xs text-slate-400 italic py-4 text-center">No auto notification deliveries logged yet.</p>
                      ) : (
                        autoLogs.map((log) => {
                          const meta = AUTO_ACTION_META[log.action] || { label: log.action };
                          const isSelected = String(log._id) === String(selectedLogId);
                          return (
                            <button
                              key={log._id}
                              type="button"
                              onClick={() => setSelectedLogId(log._id)}
                              className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors ${isSelected ? 'border-blue-300 bg-blue-50' : 'border-slate-100 bg-white hover:bg-slate-50'}`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="text-xs font-bold text-slate-800 truncate">{meta.label}</p>
                                  <p className="text-[10px] text-slate-500 mt-0.5">{formatLogDate(log.createdAt)}</p>
                                  <p className="text-[10px] text-slate-500 mt-1 truncate">
                                    {log.templateName || 'No template'} · {log.sentCount || 0} sent
                                  </p>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full border ${statusTone(log.status)}`}>
                                    {log.status}
                                  </span>
                                  <ChevronRight size={14} className="text-slate-400" />
                                </div>
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>

                    {logsPagination.pages > 1 && (
                      <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                        <button
                          type="button"
                          disabled={logsPage <= 1}
                          onClick={() => setLogsPage((p) => Math.max(1, p - 1))}
                          className="px-2.5 py-1 text-[10px] font-bold rounded border border-slate-200 disabled:opacity-40"
                        >
                          Prev
                        </button>
                        <span className="text-[10px] text-slate-500 font-semibold">
                          Page {logsPagination.page} of {logsPagination.pages}
                        </span>
                        <button
                          type="button"
                          disabled={logsPage >= logsPagination.pages}
                          onClick={() => setLogsPage((p) => p + 1)}
                          className="px-2.5 py-1 text-[10px] font-bold rounded border border-slate-200 disabled:opacity-40"
                        >
                          Next
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                    <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                          <FileText size={15} className="text-blue-600" /> Message Details
                        </h3>
                        <div className="relative w-full max-w-[220px]">
                          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                          <input
                            type="search"
                            value={messageSearch}
                            onChange={(e) => setMessageSearch(e.target.value)}
                            disabled={!selectedAutoLog}
                            placeholder="Search messages..."
                            aria-label="Search message details"
                            className="w-full rounded-md border border-slate-200 bg-white py-1.5 pl-8 pr-2 text-[11px] text-slate-700 outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-1 focus:ring-blue-200 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                          />
                        </div>
                      </div>
                      {selectedAutoLog ? (
                        <p className="text-[11px] text-slate-500 mt-1">
                          {(AUTO_ACTION_META[selectedAutoLog.action]?.label || selectedAutoLog.action)}
                          {' · '}
                          {formatLogDate(selectedAutoLog.createdAt)}
                          {' · '}
                          {selectedAutoLog.templateName || 'No template'}
                          {selectedAutoLog.skipReason ? ` · ${selectedAutoLog.skipReason}` : ''}
                        </p>
                      ) : (
                        <p className="text-[11px] text-slate-500 mt-1">Select a dispatch above to view message content.</p>
                      )}
                    </div>

                    {!selectedAutoLog ? (
                      <div className="flex items-center justify-center text-sm text-slate-400 p-10 text-center min-h-[200px]">
                        Delivery details will appear here once a dispatch is selected.
                      </div>
                    ) : (
                      <div className="overflow-auto max-h-[420px]">
                        <div className="px-4 py-3 grid grid-cols-2 md:grid-cols-4 gap-3 border-b border-slate-100 text-[11px]">
                          <div>
                            <p className="text-slate-400 font-bold uppercase text-[9px]">Status</p>
                            <p className="font-bold text-slate-800 mt-0.5 capitalize">{selectedAutoLog.status}</p>
                          </div>
                          <div>
                            <p className="text-slate-400 font-bold uppercase text-[9px]">Sent</p>
                            <p className="font-bold text-emerald-700 mt-0.5">{selectedAutoLog.sentCount || 0}</p>
                          </div>
                          <div>
                            <p className="text-slate-400 font-bold uppercase text-[9px]">Failed</p>
                            <p className="font-bold text-red-700 mt-0.5">{selectedAutoLog.failedCount || 0}</p>
                          </div>
                          <div>
                            <p className="text-slate-400 font-bold uppercase text-[9px]">Recipients</p>
                            <p className="font-bold text-slate-800 mt-0.5">{selectedAutoLog.totalRecipients || 0}</p>
                          </div>
                        </div>

                        {Array.isArray(selectedAutoLog.messages) && selectedAutoLog.messages.length > 0 ? (
                          <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse min-w-[640px]">
                              <thead>
                                <tr className="bg-slate-50 border-b border-slate-100 text-[10px] uppercase tracking-wider text-slate-400 font-bold">
                                  <th className="px-3 py-2.5">Recipient</th>
                                  <th className="px-3 py-2.5">Type</th>
                                  <th className="px-3 py-2.5">Phone</th>
                                  <th className="px-3 py-2.5">Message Sent</th>
                                  <th className="px-3 py-2.5 text-right">Status</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-50">
                                {filteredMessages.map((entry, idx) => (
                                  <tr key={`${entry.recipientId || entry.phone || idx}`} className="text-xs align-top">
                                    <td className="px-3 py-2.5">
                                      <p className="font-semibold text-slate-800">{entry.recipientName || '—'}</p>
                                      {entry.recipientId && (
                                        <p className="text-[10px] text-slate-400 font-mono mt-0.5">{entry.recipientId}</p>
                                      )}
                                    </td>
                                    <td className="px-3 py-2.5 capitalize text-slate-600">{entry.recipientType || '—'}</td>
                                    <td className="px-3 py-2.5 font-mono text-slate-700">{entry.phone || '—'}</td>
                                    <td className="px-3 py-2.5">
                                      <p className="text-slate-700 whitespace-pre-wrap leading-relaxed font-mono text-[11px]">
                                        {entry.message || '—'}
                                      </p>
                                      {entry.error && (
                                        <p className="text-[10px] text-red-600 mt-1">{entry.error}</p>
                                      )}
                                    </td>
                                    <td className="px-3 py-2.5 text-right">
                                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${messageStatusTone(entry.status)}`}>
                                        {(entry.status || 'unknown').replace('_', ' ')}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {filteredMessages.length === 0 && (
                              <p className="p-6 text-center text-sm text-slate-400">No messages match your search.</p>
                            )}
                          </div>
                        ) : (
                          <div className="p-6 text-sm text-slate-500">
                            {selectedAutoLog.skipReason || selectedAutoLog.error || 'No individual message records for this dispatch.'}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Template</label>
                  <select
                    value={sendForm.templateId}
                    onChange={(e) => setSendForm((p) => ({ ...p, templateId: e.target.value }))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="">— Select Template —</option>
                    {templates.filter((t) => t.isActive !== false).map((t) => (
                      <option key={t._id} value={t._id}>{t.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Audience</label>
                  <select
                    value={sendForm.audience}
                    onChange={(e) => setSendForm((p) => ({ ...p, audience: e.target.value }))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="students">Students</option>
                    <option value="employees">Employees</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Filter By</label>
                  <select
                    value={sendForm.filterBy}
                    onChange={(e) => setSendForm((p) => ({ ...p, filterBy: e.target.value, routeId: '', busId: '' }))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="route">Route Wise</option>
                    <option value="bus">Bus Wise</option>
                  </select>
                </div>

                {sendForm.filterBy === 'route' ? (
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Route</label>
                    <select
                      value={sendForm.routeId}
                      onChange={(e) => setSendForm((p) => ({ ...p, routeId: e.target.value }))}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="">— Select Route —</option>
                      {routes.map((r) => (
                        <option key={r._id || r.routeId} value={r.routeId}>
                          {r.routeId} — {r.routeName}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Bus</label>
                    <select
                      value={sendForm.busId}
                      onChange={(e) => setSendForm((p) => ({ ...p, busId: e.target.value }))}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="">— Select Bus —</option>
                      {buses.map((b) => (
                        <option key={b._id} value={b.busNumber || b.busId || b._id}>
                          {b.busNumber || b.busId} {b.assignedRouteId ? `(${b.assignedRouteId})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="flex items-end">
                  <button
                    onClick={loadRecipients}
                    disabled={loadingRecipients}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white text-sm font-bold rounded-lg disabled:opacity-50"
                  >
                    {loadingRecipients ? <Loader2 size={14} className="animate-spin" /> : <Users size={14} />}
                    Load Recipients
                  </button>
                </div>
              </div>

              {selectedTemplate && (
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-600 space-y-1">
                  <div>
                    <span className="font-semibold text-slate-800">DLT Template ID: </span>
                    <span className="font-mono">{selectedTemplate.dltTemplateId || '—'}</span>
                  </div>
                  {Array.isArray(selectedTemplate.varMappings) && selectedTemplate.varMappings.length > 0 && (
                    <div>
                      <span className="font-semibold text-slate-800">Saved mappings: </span>
                      {selectedTemplate.varMappings.map((m, i) => {
                        const label = m.type === 'custom'
                          ? `"${m.value || ''}"`
                          : (VAR_FIELD_OPTIONS.find((o) => o.value === m.field)?.label || m.field || '—');
                        return `V${i + 1}=${label}`;
                      }).join(' • ')}
                    </div>
                  )}
                  <div>
                    <span className="font-semibold text-slate-800">Template: </span>
                    {selectedTemplateBody}
                  </div>
                  {recipients.length > 0 && (
                    <div>
                      <span className="font-semibold text-slate-800">Preview: </span>
                      {selectedTemplatePreview}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-bold text-slate-800 flex items-center gap-2">
                  {sendForm.filterBy === 'route' ? <MapIcon size={14} /> : <Bus size={14} />}
                  Recipients ({recipients.length})
                  <span className="text-[11px] font-medium text-slate-400">
                    Selected: {selectedIds.length} • With phone: {recipients.filter((r) => r.phone).length}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={toggleAllWithPhone}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                  >
                    Toggle All (with phone)
                  </button>
                  <button
                    onClick={handleSend}
                    disabled={sending || selectedIds.length === 0 || !sendForm.templateId}
                    className="px-4 py-1.5 text-xs font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                    Send SMS
                  </button>
                </div>
              </div>

              {recipients.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-400 italic">
                  Load recipients using route or bus filters above.
                </div>
              ) : (
                <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 sticky top-0">
                      <tr className="text-[10px] uppercase text-slate-400 font-bold tracking-wider">
                        <th className="px-4 py-2 w-10"></th>
                        <th className="px-4 py-2">Name</th>
                        <th className="px-4 py-2">ID</th>
                        <th className="px-4 py-2">Phone</th>
                        <th className="px-4 py-2">Route</th>
                        <th className="px-4 py-2">Stage</th>
                        <th className="px-4 py-2">Bus</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {recipients.map((r) => (
                        <tr key={r.id} className={!r.phone ? 'bg-amber-50/40 text-slate-400' : 'hover:bg-slate-50/50'}>
                          <td className="px-4 py-2">
                            <input
                              type="checkbox"
                              disabled={!r.phone}
                              checked={selectedIds.includes(r.id)}
                              onChange={() => toggleRecipient(r.id)}
                            />
                          </td>
                          <td className="px-4 py-2 font-semibold text-slate-800">{r.name || '—'}</td>
                          <td className="px-4 py-2 font-mono">{r.identifier || '—'}</td>
                          <td className="px-4 py-2 font-mono">{r.phone || 'No phone'}</td>
                          <td className="px-4 py-2">{r.route_id} {r.route_name ? `• ${r.route_name}` : ''}</td>
                          <td className="px-4 py-2">{r.stage_name || '—'}</td>
                          <td className="px-4 py-2">{r.bus_id || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {sendResult && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 text-xs space-y-1">
                <p className="font-bold text-slate-800">Send Result</p>
                <p>Mode: {sendResult.mode}</p>
                <p>Sent: {sendResult.sent || 0} • Failed: {sendResult.failed || 0}</p>
                {sendResult.response && <p className="text-slate-500 break-all">API: {sendResult.response}</p>}
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
