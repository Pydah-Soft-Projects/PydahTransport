import React, { useEffect, useState } from 'react';
import { Settings as SettingsIcon, Save, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import Layout from '../components/Layout';
import Loader from '../components/Loader';
import { apiFetch, API_BASE } from '../utils/api';

const Settings = () => {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [feeHeadsLoading, setFeeHeadsLoading] = useState(true);
    const [feeHeads, setFeeHeads] = useState([]);
    const [message, setMessage] = useState({ text: '', type: '' });
    const [form, setForm] = useState({
        enabled: false,
        feeHeadId: '',
        feeHeadCode: '',
        feeHeadName: '',
        minPaidAmount: 0,
        updatedBy: '',
        updatedAt: null,
    });

    const loadFeeHeads = async () => {
        setFeeHeadsLoading(true);
        try {
            const res = await apiFetch(`${API_BASE}/settings/fee-heads`);
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                setFeeHeads(Array.isArray(data.feeHeads) ? data.feeHeads : []);
            } else {
                setFeeHeads([]);
                setMessage({ text: data.message || 'Failed to load fee heads from Fee Management.', type: 'error' });
            }
        } catch (err) {
            setFeeHeads([]);
            setMessage({ text: 'Error loading fee heads.', type: 'error' });
        } finally {
            setFeeHeadsLoading(false);
        }
    };

    const loadSettings = async () => {
        setLoading(true);
        try {
            const res = await apiFetch(`${API_BASE}/settings/request-eligibility`);
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                setForm({
                    enabled: Boolean(data.enabled),
                    feeHeadId: data.feeHeadId || '',
                    feeHeadCode: data.feeHeadCode || '',
                    feeHeadName: data.feeHeadName || '',
                    minPaidAmount: Number(data.minPaidAmount) || 0,
                    updatedBy: data.updatedBy || '',
                    updatedAt: data.updatedAt || null,
                });
            } else {
                setMessage({ text: data.message || 'Failed to load settings.', type: 'error' });
            }
        } catch (err) {
            setMessage({ text: 'Error loading settings.', type: 'error' });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadFeeHeads();
        loadSettings();
    }, []);

    const handleFeeHeadChange = (feeHeadId) => {
        const selected = feeHeads.find((h) => String(h.id) === String(feeHeadId));
        setForm((prev) => ({
            ...prev,
            feeHeadId: feeHeadId || '',
            feeHeadCode: selected?.code || '',
            feeHeadName: selected?.name || '',
        }));
    };

    const handleSave = async (e) => {
        e.preventDefault();
        if (form.enabled && !form.feeHeadId) {
            setMessage({ text: 'Select a fee head before enabling this check.', type: 'error' });
            return;
        }
        const amount = Number(form.minPaidAmount);
        if (!Number.isFinite(amount) || amount < 0) {
            setMessage({ text: 'Minimum paid amount must be a non-negative number.', type: 'error' });
            return;
        }

        setSaving(true);
        setMessage({ text: '', type: '' });
        try {
            const res = await apiFetch(`${API_BASE}/settings/request-eligibility`, {
                method: 'PUT',
                body: JSON.stringify({
                    enabled: form.enabled,
                    feeHeadId: form.feeHeadId,
                    feeHeadCode: form.feeHeadCode,
                    feeHeadName: form.feeHeadName,
                    minPaidAmount: amount,
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                setForm({
                    enabled: Boolean(data.enabled),
                    feeHeadId: data.feeHeadId || '',
                    feeHeadCode: data.feeHeadCode || '',
                    feeHeadName: data.feeHeadName || '',
                    minPaidAmount: Number(data.minPaidAmount) || 0,
                    updatedBy: data.updatedBy || '',
                    updatedAt: data.updatedAt || null,
                });
                setMessage({ text: 'Settings saved successfully.', type: 'success' });
            } else {
                setMessage({ text: data.message || 'Failed to save settings.', type: 'error' });
            }
        } catch (err) {
            setMessage({ text: 'Error saving settings.', type: 'error' });
        } finally {
            setSaving(false);
        }
    };

    return (
        <Layout>
            <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800 tracking-tight flex items-center gap-2">
                        <SettingsIcon className="text-blue-600" size={24} />
                        Settings
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                        Configure request eligibility rules for Raise Request and Renewals.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => {
                        loadFeeHeads();
                        loadSettings();
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                    <RefreshCw size={13} /> Refresh
                </button>
            </div>

            {message.text && (
                <div
                    className={`mb-5 p-3.5 rounded-xl border flex items-start gap-2.5 text-sm ${
                        message.type === 'success'
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                            : 'bg-red-50 border-red-200 text-red-800'
                    }`}
                >
                    {message.type === 'success' ? <CheckCircle2 size={18} className="shrink-0 mt-0.5" /> : <AlertTriangle size={18} className="shrink-0 mt-0.5" />}
                    <span className="font-medium">{message.text}</span>
                </div>
            )}

            {loading ? (
                <div className="py-16">
                    <Loader size={36} text="Loading settings..." />
                </div>
            ) : (
                <form onSubmit={handleSave} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 max-w-2xl space-y-5">
                    <div>
                        <h3 className="text-sm font-bold text-slate-800">Request Fee Eligibility</h3>
                        <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                            When enabled, a student transport request (raise or renew) is allowed only if the student has paid at least the minimum amount toward the selected fee head for that academic year.
                        </p>
                    </div>

                    <label className="flex items-center gap-3 cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={form.enabled}
                            onChange={(e) => setForm((prev) => ({ ...prev, enabled: e.target.checked }))}
                            className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-sm font-semibold text-slate-700">Enable fee payment check</span>
                    </label>

                    <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Fee Head</label>
                        <select
                            value={form.feeHeadId}
                            onChange={(e) => handleFeeHeadChange(e.target.value)}
                            disabled={feeHeadsLoading}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                        >
                            <option value="">{feeHeadsLoading ? 'Loading fee heads…' : 'Select fee head'}</option>
                            {feeHeads.map((h) => (
                                <option key={h.id} value={h.id}>
                                    {h.code ? `${h.code} — ${h.name}` : h.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Minimum Paid Amount (₹)</label>
                        <input
                            type="number"
                            min="0"
                            step="1"
                            value={form.minPaidAmount}
                            onChange={(e) => setForm((prev) => ({ ...prev, minPaidAmount: e.target.value }))}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                            placeholder="e.g. 10000"
                        />
                        <p className="text-[11px] text-slate-400">
                            Student must have paid at least this amount for the selected fee head in the request academic year.
                        </p>
                    </div>

                    {(form.updatedAt || form.updatedBy) && (
                        <p className="text-[11px] text-slate-400">
                            Last updated{form.updatedBy ? ` by ${form.updatedBy}` : ''}
                            {form.updatedAt ? ` · ${new Date(form.updatedAt).toLocaleString()}` : ''}
                        </p>
                    )}

                    <div className="pt-1">
                        <button
                            type="submit"
                            disabled={saving}
                            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold shadow-sm disabled:opacity-50 cursor-pointer"
                        >
                            <Save size={15} />
                            {saving ? 'Saving…' : 'Save Settings'}
                        </button>
                    </div>
                </form>
            )}
        </Layout>
    );
};

export default Settings;
