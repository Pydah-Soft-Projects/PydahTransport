import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Bus, CheckCircle2, XCircle, ShieldCheck } from 'lucide-react';
import Loader from '../components/Loader';
import { API_BASE } from '../utils/api';
import { normalizeStudentPhoto } from '../utils/studentPhoto';

const formatDate = (value) => {
    if (!value) return '—';
    try {
        return new Date(value).toLocaleDateString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
        });
    } catch {
        return '—';
    }
};

const TransportVerify = () => {
    const { id } = useParams();
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState(null);
    const [error, setError] = useState('');

    useEffect(() => {
        const fetchVerification = async () => {
            if (!id) {
                setError('Invalid verification link.');
                setLoading(false);
                return;
            }
            setLoading(true);
            setError('');
            try {
                const response = await fetch(`${API_BASE}/transport-verify/${encodeURIComponent(id)}`);
                const json = await response.json();
                if (!response.ok) {
                    setError(json.message || 'Unable to verify transport registration.');
                    setData(null);
                } else {
                    setData(json);
                }
            } catch {
                setError('Could not reach the verification service. Please try again later.');
                setData(null);
            } finally {
                setLoading(false);
            }
        };

        fetchVerification();
    }, [id]);

    const photoSrc = normalizeStudentPhoto(data?.student_photo);
    const isRegistered = Boolean(data?.registered);

    return (
        <div className="verify-page min-h-[100dvh] bg-gradient-to-b from-slate-100 to-slate-200 px-3 py-5 sm:px-4 sm:py-8">
            <div className="w-full max-w-lg mx-auto">
                <header className="text-center mb-4 sm:mb-6 px-1">
                    <div className="inline-flex items-center justify-center gap-2 text-blue-900 font-bold text-base sm:text-lg">
                        <Bus size={20} className="sm:w-[22px] sm:h-[22px] shrink-0" />
                        <span className="leading-tight">Campo Transport Verification</span>
                    </div>
                    <p className="text-xs sm:text-sm text-slate-500 mt-1.5">Scan result for bus ID card</p>
                </header>

                {loading ? (
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 py-12 sm:py-16">
                        <Loader text="Verifying registration..." />
                    </div>
                ) : error ? (
                    <div className="bg-white rounded-2xl shadow-sm border border-red-200 p-6 sm:p-8 text-center">
                        <XCircle className="mx-auto text-red-500 mb-3" size={36} />
                        <h1 className="text-base sm:text-lg font-bold text-slate-900 mb-2">Verification failed</h1>
                        <p className="text-sm text-slate-600 leading-relaxed">{error}</p>
                    </div>
                ) : (
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                        <div
                            className={`px-4 py-3.5 sm:px-6 sm:py-4 flex items-start sm:items-center gap-2.5 sm:gap-3 ${
                                isRegistered
                                    ? 'bg-emerald-50 border-b border-emerald-100'
                                    : 'bg-amber-50 border-b border-amber-100'
                            }`}
                        >
                            {isRegistered ? (
                                <CheckCircle2 className="text-emerald-600 shrink-0" size={26} />
                            ) : (
                                <ShieldCheck className="text-amber-600 shrink-0" size={26} />
                            )}
                            <div className="min-w-0 w-full">
                                <p
                                    className={`text-xs sm:text-sm font-black uppercase tracking-wide leading-snug ${
                                        isRegistered ? 'text-emerald-800' : 'text-amber-800'
                                    }`}
                                >
                                    {isRegistered ? 'Registered in transport system' : 'Not active in transport system'}
                                </p>
                                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                                    {data.message
                                        || (isRegistered
                                            ? 'This passenger has an approved transport record.'
                                            : 'No approved transport record found.')}
                                </p>
                            </div>
                        </div>

                        <div className="p-4 sm:p-6">
                            {(data.student_name || data.admission_number) && (
                                <div className="flex flex-col items-center text-center sm:flex-row sm:items-start sm:text-left gap-4 mb-5 sm:mb-6 pb-5 sm:pb-6 border-b border-slate-100">
                                    {photoSrc && (
                                        <div className="shrink-0 w-24 h-28 sm:w-20 sm:h-24 rounded-xl border-2 border-slate-200 overflow-hidden bg-slate-50 shadow-sm">
                                            <img
                                                src={photoSrc}
                                                alt={data.student_name}
                                                className="w-full h-full object-cover object-top"
                                            />
                                        </div>
                                    )}
                                    <div className="min-w-0 w-full">
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                                            Passenger
                                        </p>
                                        <h1 className="text-lg sm:text-xl font-black text-slate-900 uppercase leading-tight break-words">
                                            {data.student_name || '—'}
                                        </h1>
                                        <p className="text-sm font-semibold text-blue-700 mt-1.5 break-all">
                                            {data.admission_number || '—'}
                                        </p>
                                        {data.pin_no && (
                                            <p className="text-xs text-slate-500 mt-1">PIN: {data.pin_no}</p>
                                        )}
                                    </div>
                                </div>
                            )}

                            {isRegistered && (
                                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3">
                                    <Detail label="Type" value={data.user_type === 'employee' ? 'Employee' : 'Student'} />
                                    <Detail label="Academic year" value={data.academic_year || '—'} />
                                    <Detail label="Transport ID" value={data.application_number || '—'} />
                                    <Detail
                                        label="Course"
                                        value={data.course ? `${data.course}${data.branch ? ` (${data.branch})` : ''}` : '—'}
                                    />
                                    <Detail
                                        label="Route"
                                        value={data.route_name ? `${data.route_name}${data.route_id ? ` (${data.route_id})` : ''}` : '—'}
                                        fullWidth
                                    />
                                    <Detail label="Stage" value={data.stage_name || '—'} />
                                    <Detail label="Bus" value={data.bus_id || 'Not assigned'} />
                                    <Detail
                                        label="Fare"
                                        value={data.user_type === 'employee' ? 'Free (₹0)' : `₹${data.fare ?? 0}`}
                                    />
                                    <Detail
                                        label="Pass valid until"
                                        value={data.user_type === 'employee' ? 'N/A' : formatDate(data.effective_expiry_date)}
                                    />
                                    <Detail
                                        label="Pass status"
                                        value={data.is_expired ? 'Expired' : 'Valid'}
                                        valueClass={data.is_expired ? 'text-red-700' : 'text-emerald-700'}
                                    />
                                </div>
                            )}

                            {!isRegistered && !data.student_name && (
                                <p className="text-sm text-slate-600 text-center py-4 leading-relaxed px-1">
                                    This QR code does not match any transport registration in our application.
                                </p>
                            )}
                        </div>
                    </div>
                )}

                <footer className="text-center mt-5 sm:mt-6 px-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
                    <p className="text-[11px] sm:text-xs text-slate-500 leading-relaxed">
                        Campo Transport · Transport Office
                    </p>
                    <p className="mt-3">
                        <Link
                            to="/login"
                            className="inline-block text-xs font-semibold text-blue-700 hover:underline py-2 px-3 -mx-3"
                        >
                            Staff login
                        </Link>
                    </p>
                </footer>
            </div>

            <style>{`
                .verify-page {
                    -webkit-text-size-adjust: 100%;
                    padding-left: max(0.75rem, env(safe-area-inset-left));
                    padding-right: max(0.75rem, env(safe-area-inset-right));
                }
            `}</style>
        </div>
    );
};

const Detail = ({ label, value, valueClass = 'text-slate-900', fullWidth = false }) => (
    <div
        className={`rounded-xl bg-slate-50 border border-slate-100 px-3 py-3 sm:py-2.5 min-w-0 ${
            fullWidth ? 'sm:col-span-2' : ''
        }`}
    >
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{label}</p>
        <p className={`text-sm font-semibold mt-1 leading-snug break-words ${valueClass}`}>{value}</p>
    </div>
);

export default TransportVerify;
