import { Sparkles, FileText, Image, BarChart3, Search, HelpCircle } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

export interface Suggestion {
  id: string;
  label: string;
  prompt: string;
  icon?: React.ReactNode;
}

export interface ChatSuggestionsProps {
  suggestions?: Suggestion[];
  onSuggestionClick: (suggestion: Suggestion) => void;
  rtl?: boolean;
  visible?: boolean;
}

// ── Default Suggestions ──────────────────────────────────────────────────────

const DEFAULT_SUGGESTIONS: Suggestion[] = [
  {
    id: 'form',
    label: 'إنشاء نموذج',
    prompt: 'Create a registration form with name, email, phone, and country fields.',
    icon: <FileText className="w-3.5 h-3.5" />,
  },
  {
    id: 'compare',
    label: 'قارن الخيارات',
    prompt: 'Compare three different pricing plans with features and ratings.',
    icon: <BarChart3 className="w-3.5 h-3.5" />,
  },
  {
    id: 'gallery',
    label: 'عرض معرض الصور',
    prompt: 'Show me a gallery of sample product images.',
    icon: <Image className="w-3.5 h-3.5" />,
  },
  {
    id: 'search',
    label: 'نتائج بحث',
    prompt: 'Show search results for top rated services.',
    icon: <Search className="w-3.5 h-3.5" />,
  },
  {
    id: 'help',
    label: 'ماذا تستطيع أن تفعل؟',
    prompt: 'What can you help me with? Show me your capabilities.',
    icon: <HelpCircle className="w-3.5 h-3.5" />,
  },
];

// ── Component ──────────────────────────────────────────────────────────────────

export function ChatSuggestions({
  suggestions = DEFAULT_SUGGESTIONS,
  onSuggestionClick,
  rtl = false,
  visible = true,
}: ChatSuggestionsProps) {
  if (!visible || suggestions.length === 0) return null;

  return (
    <div
      className="flex flex-wrap gap-2 px-4 py-2"
      dir={rtl ? 'rtl' : 'ltr'}
    >
      {suggestions.map((suggestion) => (
        <button
          key={suggestion.id}
          onClick={() => onSuggestionClick(suggestion)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-800/80 border border-slate-700/50 text-xs text-slate-300 hover:bg-slate-700/80 hover:text-slate-100 hover:border-slate-600 transition-colors group"
        >
          <span className="text-slate-500 group-hover:text-slate-300 transition-colors">
            {suggestion.icon || <Sparkles className="w-3.5 h-3.5" />}
          </span>
          <span>{suggestion.label}</span>
        </button>
      ))}
    </div>
  );
}

export { DEFAULT_SUGGESTIONS };
