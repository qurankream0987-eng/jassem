import React from 'react';
import type { Platform } from '../../core/agents/PlatformComposer';
import { getPlatformHealth } from '../../core/agents/PlatformComposer';

interface PlatformWindowProps {
  platform: Platform;
  onClose?: () => void;
}

export const PlatformWindow: React.FC<PlatformWindowProps> = ({ platform, onClose }) => {
  const health = getPlatformHealth({ ...platform, agents: [], swarms: [] } as import('../../core/agents/PlatformComposer').Platform & { agents: import('../../core/agents/AgentBreeder').Agent[]; swarms: import('../../core/agents/SwarmCoordinator').Swarm[] });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-slate-900 rounded-2xl w-full max-w-2xl max-h-[80vh] overflow-auto m-4 border border-white/10">
        <div className="p-6 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold"
              style={{ background: platform.dna ? `linear-gradient(135deg, ${platform.dna.sequence ? `hsl(${(platform.dna.sequence.genes[0] ?? 0.5) * 360}, 70%, 50%)` : '#3b82f6'}, ${platform.dna.sequence ? `hsl(${(platform.dna.sequence.genes[8] ?? 0.5) * 360}, 70%, 50%)` : '#1d4ed8'})` : '#3b82f6' }}
            >
              {platform.name.charAt(0)}
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">{platform.name}</h2>
              <p className="text-slate-400 text-sm">{platform.category}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition"
          >
            X
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white/5 rounded-xl p-4">
              <p className="text-slate-400 text-xs mb-1">Status</p>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${
                  platform.status === 'live' ? 'bg-emerald-500' :
                  platform.status === 'evolving' ? 'bg-purple-500' :
                  platform.status === 'building' ? 'bg-amber-500' :
                  'bg-slate-500'
                }`} />
                <span className="text-white font-medium capitalize">{platform.status}</span>
              </div>
            </div>
            <div className="bg-white/5 rounded-xl p-4">
              <p className="text-slate-400 text-xs mb-1">Health</p>
              <p className="text-white font-bold text-lg">{(health * 100).toFixed(1)}%</p>
            </div>
            <div className="bg-white/5 rounded-xl p-4">
              <p className="text-slate-400 text-xs mb-1">Features</p>
              <p className="text-white font-bold text-lg">{platform.features.length}</p>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-white mb-3">Features</h3>
            <div className="flex flex-wrap gap-2">
              {platform.features.map((feature) => (
                <span
                  key={feature}
                  className="px-3 py-1.5 rounded-lg bg-white/5 text-slate-300 text-sm border border-white/10"
                >
                  {feature}
                </span>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-white mb-3">Agents</h3>
            <p className="text-slate-400 text-sm">{(platform.agents || []).length} agents assigned</p>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-white mb-3">Bubbles</h3>
            <p className="text-slate-400 text-sm">0 bubbles active</p>
          </div>
        </div>
      </div>
    </div>
  );
};
