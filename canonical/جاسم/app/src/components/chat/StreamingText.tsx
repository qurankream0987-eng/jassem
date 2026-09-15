import { useState, useEffect, useRef } from 'react';
import { SafeMarkdownPreview } from './SafeMarkdownPreview';

// ── Types ────────────────────────────────────────────────────────────────────

export interface StreamingTextProps {
  text: string;
  speedMs?: number;
  onComplete?: () => void;
  className?: string;
  isMarkdown?: boolean;
}

// ── Component ────────────────────────────────────────────────────────────────

export function StreamingText({
  text,
  speedMs = 20,
  onComplete,
  className = '',
  isMarkdown = true,
}: StreamingTextProps) {
  const [displayedText, setDisplayedText] = useState('');
  const [isComplete, setIsComplete] = useState(false);
  const indexRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Reset when text changes
    indexRef.current = 0;
    setDisplayedText('');
    setIsComplete(false);

    intervalRef.current = setInterval(() => {
      indexRef.current += Math.max(1, Math.floor(Math.random() * 3));
      if (indexRef.current >= text.length) {
        setDisplayedText(text);
        setIsComplete(true);
        if (intervalRef.current) clearInterval(intervalRef.current);
        onComplete?.();
      } else {
        setDisplayedText(text.slice(0, indexRef.current));
      }
    }, speedMs);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [text, speedMs, onComplete]);

  // If text is shorter than what's already displayed (e.g., streaming from parent),
  // show the full text immediately
  useEffect(() => {
    if (text.length <= displayedText.length && !isComplete) {
      setDisplayedText(text);
      setIsComplete(true);
      if (intervalRef.current) clearInterval(intervalRef.current);
      onComplete?.();
    }
  }, [text, displayedText, isComplete, onComplete]);

  if (!isMarkdown) {
    return <span className={className}>{displayedText}</span>;
  }

  return (
    <div className={`prose prose-invert prose-sm max-w-none ${className}`}>
      <SafeMarkdownPreview text={displayedText} />
    </div>
  );
}
