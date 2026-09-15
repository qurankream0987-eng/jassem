/**
 * useChat - Chat Hook
 * /خطاف المحادثة
 *
 * Manages chat state, message sending, and tRPC communication
 * with JASIM's AI backend
 */

import { useState, useCallback, useRef } from 'react';

// ============================================
// TYPES
// ============================================

export interface Message {
  id: string;
  text: string;
  sender: 'user' | 'jasim';
  timestamp: Date;
  bubbles?: BubbleSuggestion[];
  isTyping?: boolean;
}

export interface BubbleSuggestion {
  type: string;
  theme: string;
  data: Record<string, any>;
  priority: number;
}

export interface ChatState {
  messages: Message[];
  isTyping: boolean;
  error: string | null;
  pendingIntent: string | null;
}

// ============================================
// INTENT RESPONSES (Simulated - will be replaced by tRPC)
// ============================================

const INTENT_RESPONSES: Record<string, { text: string; bubbles: BubbleSuggestion[] }> = {
  food_order: {
    text: 'ويش تحب تأكل اليوم؟ عندنا برياني، كبسة، شاورما، ومندي.',
    bubbles: [{
      type: 'restaurant_search',
      theme: 'food',
      data: { cuisine: 'all', location: 'nearby' },
      priority: 90,
    }],
  },
  product_search: {
    text: 'شنو تدور على؟ أقدر أساعدك تلقى أي منتج.',
    bubbles: [{
      type: 'product_grid',
      theme: 'fashion',
      data: { category: 'all' },
      priority: 90,
    }],
  },
  order_tracking: {
    text: 'عطني رقم طلبك وأتبعه لك.',
    bubbles: [{
      type: 'order_map',
      theme: 'map',
      data: { showRoute: true },
      priority: 95,
    }],
  },
  payment: {
    text: 'طرق الدفع المتاحة: KNET، Apple Pay، Google Pay، بطاقة ائتمان، كاش.',
    bubbles: [{
      type: 'payment_methods',
      theme: 'payment',
      data: { methods: ['knet', 'apple_pay', 'google_pay', 'cash'] },
      priority: 90,
    }],
  },
  haggle_request: {
    text: 'نقدر نفاصل السعر! ويش السعر اللي تبي؟',
    bubbles: [{
      type: 'haggle_interface',
      theme: 'haggle',
      data: { currentPrice: '100', productId: '' },
      priority: 95,
    }],
  },
  job_search: {
    text: 'تدور وظيفة في أي مجال؟',
    bubbles: [{
      type: 'job_list',
      theme: 'job',
      data: { location: 'all' },
      priority: 90,
    }],
  },
  zakat_calc: {
    text: 'أحسب زكاتك بكل سهولة. أدخل قيمة أصولك.',
    bubbles: [{
      type: 'zakat_calculator',
      theme: 'islamic',
      data: { nisabType: 'gold', currency: 'KWD' },
      priority: 95,
    }],
  },
  greeting: {
    text: 'أهلاً! أنا جاسم، مساعدك الذكي. كيف أقدر أساعدك؟',
    bubbles: [{
      type: 'quick_menu',
      theme: 'default',
      data: {
        options: [
          { label: 'اطلب أكل', action: 'food_order' },
          { label: 'تسوق', action: 'product_search' },
          { label: 'تابع طلبك', action: 'order_tracking' },
          { label: 'ابحث عن وظيفة', action: 'job_search' },
        ],
      },
      priority: 70,
    }],
  },
  help: {
    text: 'أقدر أساعدك في:\n• طلب أكل\n• التسوق\n• متابعة الطلبات\n• البحث عن وظائف\n• حساب الزكاة\n• فتح متجر\n\nقولي ويش تحب؟',
    bubbles: [],
  },
};

// ============================================
// HOOK
// ============================================

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messageIdRef = useRef(0);

  const generateId = () => `msg_${++messageIdRef.current}_${Date.now()}`;

  const sendMessage = useCallback((text: string) => {
    const userMessage: Message = {
      id: generateId(),
      text,
      sender: 'user',
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setIsTyping(true);
    setError(null);

    // Simulate AI response delay
    setTimeout(() => {
      setIsTyping(false);

      // Simple intent detection
      const lowerText = text.toLowerCase();
      let response = INTENT_RESPONSES.help;

      if (lowerText.includes('اكل') || lowerText.includes('كبسة') || lowerText.includes('برياني') || lowerText.includes('food') || lowerText.includes('order food')) {
        response = INTENT_RESPONSES.food_order;
      } else if (lowerText.includes('طلب') || lowerText.includes('وين') || lowerText.includes('track')) {
        response = INTENT_RESPONSES.order_tracking;
      } else if (lowerText.includes('دفع') || lowerText.includes('pay') || lowerText.includes('payment')) {
        response = INTENT_RESPONSES.payment;
      } else if (lowerText.includes('وظيفة') || lowerText.includes('job') || lowerText.includes('شغل')) {
        response = INTENT_RESPONSES.job_search;
      } else if (lowerText.includes('زكاة') || lowerText.includes('zakat')) {
        response = INTENT_RESPONSES.zakat_calc;
      } else if (lowerText.includes('غالي') || lowerText.includes('خصم') || lowerText.includes('discount')) {
        response = INTENT_RESPONSES.haggle_request;
      } else if (lowerText.includes('مرحبا') || lowerText.includes('hello') || lowerText.includes('hi')) {
        response = INTENT_RESPONSES.greeting;
      } else if (lowerText.includes('تسوق') || lowerText.includes('shop') || lowerText.includes('product')) {
        response = INTENT_RESPONSES.product_search;
      }

      const jasimMessage: Message = {
        id: generateId(),
        text: response.text,
        sender: 'jasim',
        timestamp: new Date(),
        bubbles: response.bubbles,
      };

      setMessages(prev => [...prev, jasimMessage]);
    }, 600 + Math.random() * 800);
  }, []);

  const clearChat = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  const handleBubbleAction = useCallback((action: string) => {
    const actionMessages: Record<string, string> = {
      food_order: 'ابغى أطلب أكل',
      product_search: 'أبي أتسوق',
      order_tracking: 'وين طلبي؟',
      payment: 'كيف أدفع؟',
      job_search: 'أبي وظيفة',
      zakat_calc: 'احسب زكاتي',
      haggle_request: 'فاصل السعر',
    };

    const messageText = actionMessages[action] || action;
    sendMessage(messageText);
  }, [sendMessage]);

  return {
    messages,
    isTyping,
    error,
    sendMessage,
    clearChat,
    handleBubbleAction,
  };
}
