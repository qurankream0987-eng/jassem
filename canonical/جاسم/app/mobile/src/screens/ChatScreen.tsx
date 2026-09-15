/**
 * Chat Screen - Chat Interface with JASIM
 * /شاشة الدردشة - واجهة المحادثة مع جاسم
 *
 * Features:
 * - Gifted Chat style interface
 * - Intent bubbles
 * - Voice input
 * - Typing indicator
 * - Arabic + English support
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRoute } from '@react-navigation/native';
import BubbleWindow from '../components/BubbleWindow';

const { width } = Dimensions.get('window');

interface ChatMessage {
  id: string;
  text: string;
  sender: 'user' | 'jasim';
  timestamp: Date;
  bubbles?: BubbleData[];
}

interface BubbleData {
  type: string;
  theme: string;
  data: Record<string, any>;
  priority: number;
}

const WELCOME_MESSAGE: ChatMessage = {
  id: 'welcome',
  text: 'أهلاً بك! أنا جاسم، مساعدك الذكي للتجارة. كيف أقدر أساعدك اليوم؟\n\nHello! I am JASIM, your AI commerce assistant. How can I help you today?',
  sender: 'jasim',
  timestamp: new Date(),
  bubbles: [
    {
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
    },
  ],
};

export default function ChatScreen() {
  const route = useRoute();
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const initialIntent = (route.params as any)?.initialIntent;

  // Handle initial intent from navigation
  useEffect(() => {
    if (initialIntent) {
      handleIntentSelection(initialIntent);
    }
  }, [initialIntent]);

  const handleSend = useCallback(() => {
    if (!inputText.trim()) return;

    const userMessage: ChatMessage = {
      id: `msg_${Date.now()}`,
      text: inputText.trim(),
      sender: 'user',
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputText('');
    setIsTyping(true);

    // Simulate JASIM processing
    setTimeout(() => {
      const jasimResponse = generateResponse(userMessage.text);
      setMessages(prev => [...prev, jasimResponse]);
      setIsTyping(false);
    }, 800 + Math.random() * 1000);
  }, [inputText]);

  const handleIntentSelection = (intent: string) => {
    const intentMessages: Record<string, ChatMessage> = {
      food_order: {
        id: `jasim_${Date.now()}`,
        text: 'ويش تحب تأكل اليوم؟ عندنا برياني، كبسة، شاورما، ومندي.\n\nWhat would you like to eat today?',
        sender: 'jasim',
        timestamp: new Date(),
        bubbles: [{
          type: 'restaurant_search',
          theme: 'food',
          data: { cuisine: 'all' },
          priority: 90,
        }],
      },
      product_search: {
        id: `jasim_${Date.now()}`,
        text: 'شنو تدور على؟ أقدر أساعدك تلقى أي منتج.\n\nWhat are you looking for?',
        sender: 'jasim',
        timestamp: new Date(),
        bubbles: [{
          type: 'product_grid',
          theme: 'fashion',
          data: { category: 'all' },
          priority: 90,
        }],
      },
      order_tracking: {
        id: `jasim_${Date.now()}`,
        text: 'عطني رقم طلبك وأتبعه لك.\n\nGive me your order number and I will track it.',
        sender: 'jasim',
        timestamp: new Date(),
        bubbles: [{
          type: 'order_map',
          theme: 'map',
          data: { showRoute: true },
          priority: 95,
        }],
      },
      job_search: {
        id: `jasim_${Date.now()}`,
        text: 'تدور وظيفة في أي مجال؟\n\nWhat field are you looking for?',
        sender: 'jasim',
        timestamp: new Date(),
        bubbles: [{
          type: 'job_list',
          theme: 'job',
          data: { location: 'all' },
          priority: 90,
        }],
      },
      zakat_calc: {
        id: `jasim_${Date.now()}`,
        text: 'أحسب زكاتك بكل سهولة. أدخل قيمة أصولك.\n\nCalculate your zakat easily. Enter your asset values.',
        sender: 'jasim',
        timestamp: new Date(),
        bubbles: [{
          type: 'zakat_calculator',
          theme: 'islamic',
          data: { nisabType: 'gold', currency: 'KWD' },
          priority: 95,
        }],
      },
    };

    const response = intentMessages[intent] || {
      id: `jasim_${Date.now()}`,
      text: 'تمام، شلون أقدر أساعدك؟\n\nOkay, how can I help?',
      sender: 'jasim',
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, response]);
  };

  const generateResponse = (userText: string): ChatMessage => {
    const text = userText.toLowerCase();

    if (text.includes('كبسة') || text.includes('برياني') || text.includes('اكل') || text.includes('food')) {
      return {
        id: `jasim_${Date.now()}`,
        text: 'لقيت لك مطاعم كويسة للكبسة:\n\n1. بيت الكبسة - 4.8⭐\n2. مطعم الأصالة - 4.7⭐\n3. كبسة الديرة - 4.5⭐\n\nويش تحب تطلب؟',
        sender: 'jasim',
        timestamp: new Date(),
        bubbles: [{
          type: 'restaurant_search',
          theme: 'food',
          data: { cuisine: 'كبسة' },
          priority: 90,
        }],
      };
    }

    if (text.includes('طلبي') || text.includes('order') || text.includes('وين')) {
      return {
        id: `jasim_${Date.now()}`,
        text: 'طلبك في الطريق! 🚚\n\nالسائق: علي\nالوقت المتوقع: 15 دقيقة\nالموقع: شارع الخليج العربي',
        sender: 'jasim',
        timestamp: new Date(),
        bubbles: [{
          type: 'order_map',
          theme: 'map',
          data: { showRoute: true },
          priority: 95,
        }],
      };
    }

    if (text.includes('دفع') || text.includes('pay')) {
      return {
        id: `jasim_${Date.now()}`,
        text: 'طرق الدفع المتاحة:\n\n• KNET\n• Apple Pay\n• Google Pay\n• بطاقة ائتمان\n• كاش عند الاستلام\n\nاختر الطريقة اللي تناسبك',
        sender: 'jasim',
        timestamp: new Date(),
        bubbles: [{
          type: 'payment_methods',
          theme: 'payment',
          data: { methods: ['knet', 'apple_pay', 'google_pay', 'cash'] },
          priority: 90,
        }],
      };
    }

    if (text.includes('وظيفة') || text.includes('job') || text.includes('شغل')) {
      return {
        id: `jasim_${Date.now()}`,
        text: 'وظائف متاحة:\n\n1. مهندس برمجيات - شركة الكويت\n2. مصمم UI/UX - تقنية العرب\n3. مدير تسويق - السوق المفتوح\n\nابغى تقدم لوظيفة؟',
        sender: 'jasim',
        timestamp: new Date(),
        bubbles: [{
          type: 'job_list',
          theme: 'job',
          data: { location: 'الكويت' },
          priority: 90,
        }],
      };
    }

    if (text.includes('زكاة') || text.includes('zakat')) {
      return {
        id: `jasim_${Date.now()}`,
        text: 'حاسبة الزكاة 🧮\n\nأدخل قيمة أصولك:\n• نقدية\n• ذهب\n• فضة\n• استثمارات\n• ذمم مدينة\n\nسعر الذهب: 20 د.ك/جرام\nالنصاب: 85 جرام ذهب',
        sender: 'jasim',
        timestamp: new Date(),
        bubbles: [{
          type: 'zakat_calculator',
          theme: 'islamic',
          data: { nisabType: 'gold', currency: 'KWD' },
          priority: 95,
        }],
      };
    }

    return {
      id: `jasim_${Date.now()}`,
      text: 'فهمتك! أقدر أساعدك في:\n\n• طلب أكل 🍽️\n• التسوق 🛍️\n• متابعة الطلبات 📦\n• البحث عن وظائف 💼\n• حساب الزكاة 🧮\n• فتح متجر 🏪\n\nقولي ويش تحب؟',
      sender: 'jasim',
      timestamp: new Date(),
    };
  };

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    const isUser = item.sender === 'user';

    return (
      <View style={[styles.messageContainer, isUser ? styles.userMessage : styles.jasimMessage]}>
        {!isUser && (
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>ج</Text>
          </View>
        )}
        <View style={[styles.messageBubble, isUser ? styles.userBubble : styles.jasimBubble]}>
          <Text style={[styles.messageText, isUser ? styles.userText : styles.jasimText]}>
            {item.text}
          </Text>
          {item.bubbles && item.bubbles.length > 0 && (
            <BubbleWindow bubbles={item.bubbles} />
          )}
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      {/* Chat Messages */}
      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderMessage}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.messagesList}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
      />

      {/* Typing Indicator */}
      {isTyping && (
        <View style={styles.typingContainer}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>ج</Text>
          </View>
          <View style={styles.typingBubble}>
            <TypingIndicator />
          </View>
        </View>
      )}

      {/* Input Bar */}
      <View style={styles.inputContainer}>
        <TouchableOpacity style={styles.iconButton}>
          <Ionicons name="attach" size={24} color="#00d4ff" />
        </TouchableOpacity>

        <TextInput
          style={styles.input}
          value={inputText}
          onChangeText={setInputText}
          placeholder="اكتب رسالتك... / Type your message..."
          placeholderTextColor="#666"
          multiline
          maxLength={500}
          onSubmitEditing={handleSend}
        />

        <TouchableOpacity style={styles.iconButton}>
          <Ionicons name="mic" size={24} color="#00d4ff" />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.sendButton, !inputText.trim() && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={!inputText.trim()}
        >
          <Ionicons name="send" size={20} color="#fff" />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

function TypingIndicator() {
  const animations = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];

  useEffect(() => {
    animations.forEach((anim, i) => {
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 150),
          Animated.timing(anim, { toValue: 1, duration: 400, useNativeDriver: true }),
          Animated.timing(anim, { toValue: 0, duration: 400, useNativeDriver: true }),
        ])
      ).start();
    });
  }, []);

  return (
    <View style={styles.typingDots}>
      {animations.map((anim, i) => (
        <Animated.View
          key={i}
          style={[styles.typingDot, { opacity: anim }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050510',
  },
  messagesList: {
    padding: 16,
    paddingBottom: 8,
  },
  messageContainer: {
    flexDirection: 'row',
    marginBottom: 12,
    alignItems: 'flex-end',
  },
  userMessage: {
    justifyContent: 'flex-end',
  },
  jasimMessage: {
    justifyContent: 'flex-start',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#00d4ff',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  avatarText: {
    color: '#000',
    fontWeight: 'bold',
    fontSize: 16,
  },
  messageBubble: {
    maxWidth: width * 0.7,
    padding: 12,
    borderRadius: 18,
  },
  userBubble: {
    backgroundColor: '#00d4ff',
    borderBottomRightRadius: 4,
  },
  jasimBubble: {
    backgroundColor: '#1a1a3e',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(0, 212, 255, 0.2)',
  },
  messageText: {
    fontSize: 14,
    lineHeight: 20,
  },
  userText: {
    color: '#000',
  },
  jasimText: {
    color: '#e0e0e0',
  },
  typingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  typingBubble: {
    backgroundColor: '#1a1a3e',
    borderRadius: 18,
    padding: 12,
    borderBottomLeftRadius: 4,
  },
  typingDots: {
    flexDirection: 'row',
    gap: 4,
  },
  typingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#00d4ff',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#0a0a1a',
    borderTopWidth: 1,
    borderTopColor: '#1a1a3e',
  },
  input: {
    flex: 1,
    backgroundColor: '#1a1a3e',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 14,
    maxHeight: 100,
    marginHorizontal: 8,
  },
  iconButton: {
    padding: 8,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#00d4ff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#333',
  },
});
