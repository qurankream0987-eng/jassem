import { useState, useRef, useCallback, useEffect } from 'react';
import { Send, Paperclip, Mic, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ChatInputProps {
  onSend: (content: string, files?: File[]) => void;
  disabled?: boolean;
  isLoading?: boolean;
  placeholder?: string;
  showVoiceButton?: boolean;
  showEmojiButton?: boolean;
  rtl?: boolean;
}

// ── RTL Detection ────────────────────────────────────────────────────────────

function detectRtl(text: string): boolean {
  const rtlRegex = /[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFF]/;
  return rtlRegex.test(text);
}

// ── Component ──────────────────────────────────────────────────────────────────

export function ChatInput({
  onSend,
  disabled = false,
  isLoading = false,
  placeholder = 'Message JASIM...',
  showVoiceButton = true,
  rtl: propRtl,
}: ChatInputProps) {
  const [content, setContent] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  // Starts Arabic. It still follows what the user types — someone writing in
  // English gets an LTR field — but the resting state of an Arabic-first
  // product is Arabic.
  const [isRtl, setIsRtl] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-detect RTL
  useEffect(() => {
    if (propRtl !== undefined) {
      setIsRtl(propRtl);
    } else {
      // An empty field is not an English field. `detectRtl('')` is false, so
      // the Arabic-first default was overwritten on first render and the
      // composer hint shipped in English under an Arabic placeholder.
      setIsRtl(content.trim().length === 0 ? true : detectRtl(content));
    }
  }, [content, propRtl]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      const newHeight = Math.min(textarea.scrollHeight, 200);
      textarea.style.height = `${newHeight}px`;
    }
  }, [content]);

  const handleSend = useCallback(() => {
    if (!content.trim() && files.length === 0) return;
    onSend(content, files.length > 0 ? files : undefined);
    setContent('');
    setFiles([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [content, files, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles((prev) => [...prev, ...Array.from(e.target.files || [])]);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      setFiles((prev) => [...prev, ...imageFiles]);
    }
  }, []);

  return (
    <div className="border-t border-[var(--jasim-border)] bg-[var(--jasim-bg)]/85 backdrop-blur-xl">
      {/* File Attachments Preview */}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 pt-3">
          {files.map((file, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-300 group"
            >
              <span className="truncate max-w-[120px]">{file.name}</span>
              <button
                onClick={() => removeFile(i)}
                className="p-0.5 rounded hover:bg-slate-700 text-slate-500 hover:text-slate-200 transition"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input Area */}
      <div className="flex items-end gap-2 px-4 py-3">
        {/* File Upload */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="flex-shrink-0 h-10 w-10 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled || isLoading}
              >
                <Paperclip className="w-5 h-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p className="text-xs">Attach file</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileChange}
          accept="image/*,.pdf,.doc,.docx,.txt,.csv,.json,.md"
        />

        {/* Textarea */}
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            dir={isRtl ? 'rtl' : 'ltr'}
            placeholder={placeholder}
            disabled={disabled || isLoading}
            rows={1}
            className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/20 resize-none text-sm leading-relaxed min-h-[40px] max-h-[200px] disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ direction: isRtl ? 'rtl' : 'ltr' }}
          />
        </div>

        {/* Voice Button */}
        {showVoiceButton && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`flex-shrink-0 h-10 w-10 rounded-xl transition ${
                    isRecording
                      ? 'text-red-400 bg-red-500/10 hover:bg-red-500/20 animate-pulse'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  }`}
                  onClick={() => setIsRecording((prev) => !prev)}
                  disabled={disabled || isLoading}
                >
                  <Mic className="w-5 h-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p className="text-xs">{isRecording ? 'Recording...' : 'Voice input'}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {/* Send Button */}
        <Button
          onClick={handleSend}
          disabled={disabled || isLoading || (!content.trim() && files.length === 0)}
          className="flex-shrink-0 h-10 w-10 rounded-xl bg-blue-600 hover:bg-blue-500 text-white p-0 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {isLoading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Send className="w-5 h-5" />
          )}
        </Button>
      </div>

      {/* Footer hint */}
      <div className="px-4 pb-2 text-[10px] text-slate-600 text-center">
        {isRtl ? 'Shift + Enter لسطر جديد | Enter للإرسال' : 'Shift + Enter for new line | Enter to send'}
      </div>
    </div>
  );
}
