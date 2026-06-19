import React, { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { apiFetch, API_BASE } from '../utils/api';
import { getDefaultAcademicYear, getAcademicYearOptions } from '../utils/academicYear';

const TransportDues = () => {
    const [academicYear, setAcademicYear] = useState(getDefaultAcademicYear);
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!academicYear) return;
        setLoading(true);
        setError('');
        apiFetch(`${API_BASE}/transport-dues?academicYear=${encodeURIComponent(academicYear)}&onlyUnpaid=1`)
            .then((res) => res.json())
            .then((json) => {
                if (json.message && !json.dues) {
                    setError(json.message);
                    setData(null);
                } else {
                    setData(json);
                    setError('');
                }
            })
            .catch((err) => {
                setError(err.message || 'Failed to load transport dues');
                setData(null);
            })
            .finally(() => setLoading(false));
    }, [academicYear]);

    const options = getAcademicYearOptions();

    return (
        <Layout>
            <div className="mb-8">
                <h2 className="text-3xl font-extrabold text-gray-800 tracking-tight">Transport Dues</h2>
                <p className="text-gray-500 mt-1">Students who have not paid transport fee for the selected academic year (data from Fee Management portal).</p>
            </div>

            <div className="flex flex-wrap items-center gap-4 mb-6">
                <label className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-700">Academic year</span>
                    <select
                        value={academicYear}
                        onChange={(e) => setAcademicYear(e.target.value)}
                        className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    >
                        {options.map((y) => (
                            <option key={y} value={y}>{y}</option>
                        ))}
                    </select>
                </label>
            </div>

            {error && (
                <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 text-red-800">
                    {error}
                </div>
            )}

            {loading && (
                <div className="text-center py-12 text-gray-500">Loading dues from Fee Management…</div>
            )}

            {!loading && data && (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                        <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Students with dues</p>
                            <p className="text-2xl font-bold text-gray-900">{data.count}</p>
                        </div>
                        <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Total due amount</p>
                            <p className="text-2xl font-bold text-amber-700">₹{Number(data.totalDue || 0).toLocaleString()}</p>
                        </div>
                    </div>

                    {data.dues.length === 0 ? (
                        <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
                            <p className="text-gray-500">No transport dues for {data.academicYear}.</p>
                        </div>
                    ) : (
                        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-gray-50 border-b border-gray-100 text-xs uppercase text-gray-500 font-semibold tracking-wider">
                                            <th className="p-4">Admission No</th>
                                            <th className="p-4">Name</th>
                                            <th className="p-4">Course / Branch</th>
                                            <th className="p-4">Year</th>
                                            <th className="p-4">Fee amount</th>
                                            <th className="p-4">Paid</th>
                                            <th className="p-4">Due</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50">
                                        {data.dues.map((row) => (
                                            <tr key={`${row.studentId}-${row.academicYear}`} className="hover:bg-gray-50">
                                                <td className="p-4 font-medium text-blue-600">{row.studentId}</td>
                                                <td className="p-4">{row.studentName}</td>
                                                <td className="p-4 text-sm">{row.course} {row.branch && `/ ${row.branch}`}</td>
                                                <td className="p-4">{row.studentYear}</td>
                                                <td className="p-4">₹{Number(row.feeAmount).toLocaleString()}</td>
                                                <td className="p-4 text-green-600">₹{Number(row.totalPaid).toLocaleString()}</td>
                                                <td className="p-4 font-semibold text-amber-700">₹{Number(row.due).toLocaleString()}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </>
            )}
        </Layout>
    );
};

export default TransportDues;
