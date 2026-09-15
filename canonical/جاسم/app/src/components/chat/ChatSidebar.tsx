import { useState, useMemo } from 'react';
import { MessageSquarePlus, Search, Trash2, Clock, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import type { Conversation } from '@contracts/jasim';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ChatSidebarProps {
  conversations: Conversation[];
  currentConversationId?: string;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onNewConversation: () => void;
  isOpen: boolean;
  onToggle: () => void;
  rtl?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatConversationTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// ── Component ──────────────────────────────────────────────────────────────────

export function ChatSidebar({
  conversations,
  currentConversationId,
  onSelectConversation,
  onDeleteConversation,
  onNewConversation,
  isOpen,
  onToggle,
  rtl = false,
}: ChatSidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const lower = searchQuery.toLowerCase();
    return conversations.filter(
      (c) =>
        c.title?.toLowerCase().includes(lower) ||
        c.context?.recent?.toString().toLowerCase().includes(lower)
    );
  }, [conversations, searchQuery]);

  if (!isOpen) {
    return (
      <div className="flex-shrink-0 border-r border-slate-800 bg-slate-900/50 backdrop-blur-sm">
        <div className="flex flex-col items-center py-3 gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggle}
            className="h-9 w-9 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800"
          >
            {rtl ? <PanelLeftOpen className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />}
          </Button>
          <div className="w-6 h-px bg-slate-800" />
          <Button
            variant="ghost"
            size="icon"
            onClick={onNewConversation}
            className="h-9 w-9 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800"
          >
            <MessageSquarePlus className="w-5 h-5" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-shrink-0 w-72 border-r border-slate-800 bg-slate-900/80 backdrop-blur-sm flex flex-col transition-all"
      dir={rtl ? 'rtl' : 'ltr'}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-slate-800">
        <h2 className="text-sm font-semibold text-slate-200">Conversations</h2>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={onNewConversation}
            className="h-8 w-8 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800"
          >
            <MessageSquarePlus className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggle}
            className="h-8 w-8 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800"
          >
            {rtl ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search..."
            className="pl-9 h-9 bg-slate-800/50 border-slate-700 text-slate-200 placeholder-slate-500 text-xs rounded-lg focus:border-blue-500/50"
            dir={rtl ? 'rtl' : 'ltr'}
          />
        </div>
      </div>

      {/* Conversation List */}
      <ScrollArea className="flex-1">
        <div className="px-2 py-1 space-y-0.5">
          {filteredConversations.length === 0 && (
            <div className="px-3 py-8 text-center">
              <Clock className="w-8 h-8 text-slate-700 mx-auto mb-2" />
              <p className="text-xs text-slate-500">
                {searchQuery ? 'No conversations found' : 'No conversations yet'}
              </p>
            </div>
          )}

          {filteredConversations.map((conversation) => {
            const isActive = conversation.id === currentConversationId;
            return (
              <div
                key={conversation.id}
                className="group relative"
                onMouseEnter={() => setHoveredId(conversation.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectConversation(conversation.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelectConversation(conversation.id);
                    }
                  }}
                  className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors ${
                    isActive
                      ? 'bg-blue-600/15 border border-blue-500/20'
                      : 'hover:bg-slate-800/60 border border-transparent'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-sm font-medium truncate ${
                          isActive ? 'text-blue-300' : 'text-slate-300'
                        }`}
                      >
                        {conversation.title || 'New Conversation'}
                      </p>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        {formatConversationTime(conversation.updatedAt)}
                      </p>
                    </div>

                    {/* Delete button (visible on hover) */}
                    {(hoveredId === conversation.id || isActive) && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteConversation(conversation.id);
                        }}
                        className="flex-shrink-0 p-1 rounded-md text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="p-3 border-t border-slate-800">
        <p className="text-[10px] text-slate-600 text-center">
          JASIM — General Generative Executable Agent
        </p>
      </div>
    </div>
  );
}
