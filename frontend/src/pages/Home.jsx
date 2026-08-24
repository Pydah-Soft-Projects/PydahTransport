import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import PwaInstallBanner from '../components/PwaInstallBanner';
import {
    ArrowRight,
    ShieldCheck,
} from 'lucide-react';
import { isAuthenticated } from '../utils/api';
import { canUseOfflineVerify } from '../utils/qrVerification';

const Home = () => {
    const navigate = useNavigate();
    const [offlineReady, setOfflineReady] = useState(false);
    const loggedIn = isAuthenticated();

    useEffect(() => {
        let cancelled = false;
        canUseOfflineVerify().then((ready) => {
            if (!cancelled) setOfflineReady(ready);
        });
        return () => { cancelled = true; };
    }, []);

    return (
        <div className="min-h-screen bg-[#060b1a] flex flex-col relative overflow-hidden font-outfit">
            <PwaInstallBanner variant="overlay" />
            <div className="absolute inset-0 z-0 bg-slate-950">
                <img
                    src="/Transport_background.jpg"
                    alt="Pydah Transport Background"
                    className="w-full h-full object-cover opacity-80"
                />
                <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/30 to-transparent"></div>
            </div>

            <nav className="relative z-10 px-6 py-6 md:px-12 flex items-center justify-between animate-in fade-in slide-in-from-top-4 duration-700">
                <div className="flex items-center gap-3">
                    <div className="bg-white p-1.5 rounded-xl shadow-lg h-11 w-11 flex items-center justify-center">
                        <img
                            src="/Gemini_Generated_Image_uu0hhduu0hhduu0h.png"
                            alt="Logo"
                            className="h-8 w-8 object-contain"
                        />
                    </div>
                    <div className="flex flex-col justify-center">
                        <span className="text-white font-black text-xl tracking-tighter uppercase leading-none">Pydah</span>
                        <span className="text-blue-500 font-bold text-[10px] uppercase tracking-widest leading-none mt-1">Transport</span>
                    </div>
                </div>
            </nav>

            <main className="flex-1 relative z-10 flex flex-col items-center lg:items-start justify-center px-6 md:px-12 lg:px-24">
                <div className="max-w-4xl space-y-8 animate-in fade-in slide-in-from-left-12 duration-1000">
                    <div className="space-y-4">
                        <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-500/10 border border-blue-500/20 rounded-full">
                            <span className="relative flex h-1.5 w-1.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-500"></span>
                            </span>
                            <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Student Management</span>
                        </div>

                        <h1 className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-black text-white leading-[0.9] tracking-tighter">
                            SMART <br />
                            <span className="shimmer-text-blue">TRANSPORT</span> <br />
                            SYSTEMS.
                        </h1>

                        <p className="max-w-xl text-lg md:text-xl text-slate-300 font-medium leading-relaxed">
                            An advanced student transportation management system designed for Pydah&apos;s educational network. Ensure safe, efficient, and precise transit for every student.
                        </p>
                    </div>

                    <div className="flex flex-col sm:flex-row items-center gap-4">
                        <Link
                            to={loggedIn ? '/dashboard' : '/login'}
                            className="group flex items-center justify-center gap-4 bg-white hover:bg-slate-100 text-slate-950 px-8 py-5 rounded-2xl font-black transition-all hover:shadow-[0_20px_40px_rgba(255,255,255,0.1)] hover:-translate-y-1 active:scale-[0.98] tracking-widest uppercase"
                        >
                            {loggedIn ? 'Open Dashboard' : 'Access Dashboard'}
                            <div className="bg-blue-600 p-1 rounded-lg text-white">
                                <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
                            </div>
                        </Link>

                        {(loggedIn || offlineReady) && (
                            <button
                                type="button"
                                onClick={() => navigate('/verify')}
                                className="group flex items-center justify-center gap-3 bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-5 rounded-2xl font-black transition-all hover:-translate-y-1 active:scale-[0.98] tracking-widest uppercase"
                            >
                                <ShieldCheck size={20} />
                                QR Verify
                            </button>
                        )}
                    </div>
                </div>
            </main>

            <footer className="relative z-10 py-10 px-6 md:px-12 animate-in fade-in duration-1000 delay-700">
                <div className="flex flex-col md:flex-row items-center justify-between gap-4 border-t border-white/10 pt-8">
                    <p className="text-slate-500 text-[11px] font-bold tracking-widest uppercase">
                        © {new Date().getFullYear()} Pydah Educational Institutions
                    </p>
                    <div className="flex items-center gap-6">
                        <span className="text-slate-600 text-[10px] font-black uppercase tracking-widest">Logistics Control Center</span>
                    </div>
                </div>
            </footer>
        </div>
    );
};

export default Home;
