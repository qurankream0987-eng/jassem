import React from 'react';
import type { Agent } from '../../core/agents/AgentBreeder';
import { getAgentPower } from '../../core/agents/AgentBreeder';

interface AgentCardProps {
  agent: Agent;
  onClick?: (agent: Agent) => void;
  onEvolve?: (agent: Agent) => void;
  onTrain?: (agent: Agent) => void;
  compact?: boolean;
}

export const AgentCard: React.FC<AgentCardProps> = ({
  agent,
  onClick,
  onEvolve,
  onTrain,
  compact = false,
}) => {
  if (compact) {
    return (
      <div
        onClick={() => onClick?.(agent)}
        className="flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 cursor-pointer transition"
      >
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
          style={{ background: agent.role.dnaMarkers.length > 0 ? `hsl(${agent.role.dnaMarkers[0] * 360}, 70%, 50%)` : '#3b82f6' }}
        >
          {agent.name.charAt(0)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-medium truncate">{agent.name}</p>
          <p className="text-slate-400 text-xs">{agent.role.name}</p>
        </div>
        <div className={`w-2 h-2 rounded-full ${
          agent.status === 'working' ? 'bg-emerald-500' :
          agent.status === 'resting' ? 'bg-amber-500' :
          agent.status === 'evolving' ? 'bg-purple-500' :
          'bg-blue-500'
        }`} />
      </div>
    );
  }

  return (
    <div className="bg-white/5 rounded-xl p-4 border border-white/10">
      <div className="flex items-center gap-3 mb-3">
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold"
          style={{ background: agent.role.dnaMarkers.length > 0 ? `hsl(${agent.role.dnaMarkers[0] * 360}, 70%, 50%)` : '#3b82f6' }}
        >
          {agent.name.charAt(0)}
        </div>
        <div>
          <h3 className="text-white font-semibold">{agent.name}</h3>
          <p className="text-slate-400 text-sm">{agent.role.name}</p>
        </div>
        <div className={`ml-auto px-2 py-1 rounded-full text-xs ${
          agent.status === 'working' ? 'bg-emerald-500/20 text-emerald-400' :
          agent.status === 'resting' ? 'bg-amber-500/20 text-amber-400' :
          agent.status === 'evolving' ? 'bg-purple-500/20 text-purple-400' :
          'bg-blue-500/20 text-blue-400'
        }`}>
          {agent.status}
        </div>
      </div>

      <div className="space-y-2 mb-3">
        <div className="flex justify-between text-xs">
          <span className="text-slate-400">Energy</span>
          <span className={agent.energy > 50 ? 'text-emerald-400' : agent.energy > 20 ? 'text-amber-400' : 'text-red-400'}>
            {agent.energy.toFixed(0)}%
          </span>
        </div>
        <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              agent.energy > 50 ? 'bg-emerald-500' : agent.energy > 20 ? 'bg-amber-500' : 'bg-red-500'
            }`}
            style={{ width: `${agent.energy}%` }}
          />
        </div>

        <div className="flex justify-between text-xs">
          <span className="text-slate-400">Experience</span>
          <span className="text-white">{agent.experience.toFixed(0)}</span>
        </div>
        <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full bg-blue-500 transition-all"
            style={{ width: `${Math.min(100, (agent.experience % 100))}%` }}
          />
        </div>
      </div>

      <div className="flex justify-between text-sm text-slate-400 mb-3">
        <span>Level {agent.level}</span>
        <span>Power {getAgentPower(agent).toFixed(0)}</span>
      </div>

      <div className="flex gap-2">
        {onEvolve && (
          <button
            onClick={() => onEvolve(agent)}
            className="flex-1 px-3 py-2 rounded-lg bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 text-sm transition"
          >
            Evolve
          </button>
        )}
        {onTrain && (
          <button
            onClick={() => onTrain(agent)}
            className="flex-1 px-3 py-2 rounded-lg bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 text-sm transition"
          >
            Train
          </button>
        )}
      </div>
    </div>
  );
};
