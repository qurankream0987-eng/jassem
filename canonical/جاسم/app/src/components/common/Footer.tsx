import React from 'react';

export const Footer: React.FC = () => {
  return (
    <footer className="bg-slate-900 border-t border-white/10 py-6">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-xs">
              J
            </div>
            <span className="text-white font-semibold text-sm">JASIM</span>
          </div>

          <div className="flex items-center gap-6 text-sm text-slate-400">
            <a href="#" className="hover:text-white transition">About</a>
            <a href="#" className="hover:text-white transition">Privacy</a>
            <a href="#" className="hover:text-white transition">Terms</a>
            <a href="#" className="hover:text-white transition">Contact</a>
          </div>

          <p className="text-slate-500 text-xs">
            JASIM v33.1 — Unified Marketplace Platform
          </p>
        </div>
      </div>
    </footer>
  );
};
