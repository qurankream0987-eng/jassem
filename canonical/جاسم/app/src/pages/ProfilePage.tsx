import React from 'react';

export const ProfilePage: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="bg-white/5 rounded-2xl p-6 border border-white/10">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-2xl font-bold">
            U
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">User Profile</h2>
            <p className="text-slate-400">Member since 2026</p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white/5 rounded-xl p-4">
            <p className="text-slate-400 text-xs">Trust Score</p>
            <p className="text-white text-xl font-bold">85/100</p>
          </div>
          <div className="bg-white/5 rounded-xl p-4">
            <p className="text-slate-400 text-xs">KYC Level</p>
            <p className="text-white text-xl font-bold">Gold</p>
          </div>
          <div className="bg-white/5 rounded-xl p-4">
            <p className="text-slate-400 text-xs">Transactions</p>
            <p className="text-white text-xl font-bold">42</p>
          </div>
          <div className="bg-white/5 rounded-xl p-4">
            <p className="text-slate-400 text-xs">Reviews</p>
            <p className="text-white text-xl font-bold">12</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfilePage;
