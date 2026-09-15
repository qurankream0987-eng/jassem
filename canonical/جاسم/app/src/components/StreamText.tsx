import { useState, useEffect, useRef, useCallback } from 'react';

interface StreamTextProps {
  text: string;
  speed?: number; // ms per character
  onComplete?: () => void;
}

export default function StreamText({ text, speed = 18, onComplete }: StreamTextProps) {
  const [displayed, setDisplayed] = useState('');
  const [isDone, setIsDone] = useState(false);
  const indexRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  const onCompleteRef = useRef(onComplete);

  // Keep callback ref in sync
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  const animate = useCallback(
    (timestamp: number) => {
      if (lastTimeRef.current === 0) {
        lastTimeRef.current = timestamp;
      }

      const elapsed = timestamp - lastTimeRef.current;
      const charsToAdd = Math.floor(elapsed / speed);

      if (charsToAdd > 0) {
        lastTimeRef.current = timestamp;
        indexRef.current = Math.min(indexRef.current + charsToAdd, text.length);
        setDisplayed(text.slice(0, indexRef.current));

        if (indexRef.current >= text.length) {
          setIsDone(true);
          onCompleteRef.current?.();
          return;
        }
      }

      rafRef.current = requestAnimationFrame(animate);
    },
    [text, speed]
  );

  useEffect(() => {
    // Reset state when text changes
    indexRef.current = 0;
    lastTimeRef.current = 0;
    setDisplayed('');
    setIsDone(false);

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [animate, text]);

  return (
    <span style={{ direction: 'rtl', textAlign: 'right', display: 'inline' }}>
      {displayed}
      {!isDone && (
        <span
          style={{
            display: 'inline-block',
            width: '2px',
            height: '1em',
            background: 'var(--cyan)',
            marginRight: '2px',
            verticalAlign: 'text-bottom',
            animation: 'streamCursor 0.8s step-end infinite',
          }}
        />
      )}
    </span>
  );
}
