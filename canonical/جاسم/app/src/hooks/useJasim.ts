import { useState, useCallback, useEffect } from 'react';
import type { BubbleSchema, DnaProfile, IntentResult } from '../core/jasim/types.ts';
import { classifyIntent, generateDnaProfile } from '../core/jasim/dna-router.ts';
import { createPlan } from '../core/jasim/planner.ts';
import { composeExecution, runExecution } from '../core/jasim/composer.ts';
import { generateBubbleSchema } from '../core/jasim/runtime.ts';

export function useJasim() {
  const [schema, setSchema] = useState<BubbleSchema | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [history, setHistory] = useState<BubbleSchema[]>([]);

  const processQuery = useCallback(async (query: string) => {
    if (!query.trim()) return;
    setIsProcessing(true);

    try {
      const intent = classifyIntent(query);
      const profile = generateDnaProfile(intent);
      const plan = createPlan('user-query', [
        { id: '1', name: 'Intent Classification', capability: 'search', dependencies: [], humanGate: false, timeout: 5000, retries: 2, status: 'pending' },
        { id: '2', name: 'DNA Generation', capability: 'recommend', dependencies: ['1'], humanGate: false, timeout: 5000, retries: 2, status: 'pending' },
        { id: '3', name: 'Schema Generation', capability: 'plan', dependencies: ['2'], humanGate: false, timeout: 10000, retries: 2, status: 'pending' },
      ]);
      const context = composeExecution(plan, profile);
      runExecution(context);

      const bubbleSchema = generateBubbleSchema('list', {
        title: `Results for "${query}"`,
        subtitle: `Category: ${intent.category}`,
        items: [
          { id: '1', title: 'Result 1', description: 'Sample result', value: '100 KWD' },
          { id: '2', title: 'Result 2', description: 'Sample result', value: '200 KWD' },
        ],
      }, profile);

      setSchema(bubbleSchema);
      setHistory((prev) => [bubbleSchema, ...prev].slice(0, 10));
    } catch (error) {
      console.error('JASIM error:', error);
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    setSchema(null);
  }, []);

  return {
    schema,
    isProcessing,
    history,
    processQuery,
    clearHistory,
  };
}
