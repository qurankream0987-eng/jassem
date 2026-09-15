/**
 * MainChat - Gifted Chat Style Component
 * /المحادثة الرئيسية - مكون محادثة نمط Gifted Chat
 *
 * Full-featured chat component with message rendering,
 * typing indicators, and bubble actions
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Dimensions,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const { width } = Dimensions.get('window');

export interface ChatMessage {
  id: string;
  text: string;
  sender: 'user' | 'jasim';
  timestamp: Date;
  avatar?: string;
  bubbles?: Array<{
    type: string;
    theme: string;
    data: Record<string, any>;
    priority: number;
  }>;
}

interface MainChatProps {
  messages: ChatMessage[];
  onBubblePress?: (action: string) => void;
  onQuickReply?: (reply: string) => void;
}

const QUICK_REPLIES = [
  'اطلب أكل',
  'تسوق',
  'وين طلبي',
  'احسب زكاتي',
  'ابحث عن وظيفة',
];

export default function MainChat({ messages, onBubblePress, onQuickReply }: MainChatProps) {
  const renderMessage = ({ item, index }: { item: ChatMessage; index: number }) => {
    const isUser = item.sender === 'user';
    const showAvatar = index === 0 || messages[index - 1]?.sender !== item.sender;

    return (
      <View style={[styles.messageRow, isUser ? styles.userRow : styles.jasimRow]}>
        {!isUser && showAvatar && (
          <View style={styles.jasimAvatar}>
            <Text style={styles.avatarText}>ج</Text>
          </View>
        )}
        {!isUser && !showAvatar && <View style={styles.avatarSpacer} />}

        <View style={[
          styles.bubble,
          isUser ? styles.userBubble : styles.jasimBubble,
        ]}>
          <Text style={[styles.messageText, isUser ? styles.userText : styles.jasimText]}>
            {item.text}
          </Text>

          {/* Action bubbles */}
          {item.bubbles && item.bubbles.length > 0 && (
            <View style={styles.bubblesContainer}>
              {item.bubbles.map((bubble, i) => (
                <TouchableOpacity
                  key={i}
                  style={[styles.actionBubble, { backgroundColor: getBubbleColor(bubble.theme) }]}
                  onPress={() => onBubblePress?.(bubble.type)}
                >
                  <Ionicons name={getBubbleIcon(bubble.type)} size={16} color="#fff" />
                  <Text style={styles.actionBubbleText}>{getBubbleLabel(bubble.type)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <Text style={[styles.timestamp, isUser ? styles.userTimestamp : styles.jasimTimestamp]}>
            {formatTime(item.timestamp)}
          </Text>
        </View>

        {isUser && showAvatar && (
          <View style={styles.userAvatar}>
            <Text style={styles.avatarText}>أ</Text>
          </View>
        )}
        {isUser && !showAvatar && <View style={styles.avatarSpacer} />}
      </View>
    );
  };

  const renderQuickReplies = () => (
    <View style={styles.quickRepliesContainer}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickRepliesScroll}>
        {QUICK_REPLIES.map((reply, i) => (
          <TouchableOpacity
            key={i}
            style={styles.quickReplyButton}
            onPress={() => onQuickReply?.(reply)}
          >
            <Text style={styles.quickReplyText}>{reply}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={messages}
        renderItem={renderMessage}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.messagesList}
        showsVerticalScrollIndicator={false}
      />
      {messages.length > 0 && messages[messages.length - 1].sender === 'jasim' && renderQuickReplies()}
    </View>
  );
}

// Helper functions
function getBubbleColor(theme: string): string {
  const colors: Record<string, string> = {
    food: '#FF6B35',
    fashion: '#4ECDC4',
    map: '#45B7D1',
    payment: '#96CEB4',
    haggle: '#FFEAA7',
    job: '#DDA0DD',
    islamic: '#98D8C8',
    default: '#00d4ff',
  };
  return colors[theme] || colors.default;
}

function getBubbleIcon(type: string): string {
  const icons: Record<string, string> = {
    restaurant_search: 'restaurant',
    product_grid: 'cart',
    order_map: 'map',
    payment_methods: 'card',
    haggle_interface: 'pricetag',
    job_list: 'briefcase',
    zakat_calculator: 'moon',
    quick_menu: 'apps',
  };
  return icons[type] || 'ellipse';
}

function getBubbleLabel(type: string): string {
  const labels: Record<string, string> = {
    restaurant_search: 'مطاعم',
    product_grid: 'منتجات',
    order_map: 'خريطة',
    payment_methods: 'ادفع',
    haggle_interface: 'فاصل',
    job_list: 'وظائف',
    zakat_calculator: 'زكاة',
    quick_menu: 'قائمة',
  };
  return labels[type] || type;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
}

// ScrollView import needed for quick replies
import { ScrollView } from 'react-native';

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  messagesList: {
    padding: 12,
    paddingBottom: 8,
  },
  messageRow: {
    flexDirection: 'row',
    marginBottom: 8,
    alignItems: 'flex-end',
  },
  userRow: {
    justifyContent: 'flex-end',
  },
  jasimRow: {
    justifyContent: 'flex-start',
  },
  jasimAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#00d4ff',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  userAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#4ECDC4',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  avatarSpacer: {
    width: 40,
  },
  avatarText: {
    color: '#000',
    fontWeight: 'bold',
    fontSize: 14,
  },
  bubble: {
    maxWidth: width * 0.65,
    padding: 10,
    borderRadius: 16,
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
  timestamp: {
    fontSize: 10,
    marginTop: 4,
  },
  userTimestamp: {
    color: 'rgba(0,0,0,0.5)',
    textAlign: 'right',
  },
  jasimTimestamp: {
    color: '#888',
    textAlign: 'left',
  },
  bubblesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  actionBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 4,
  },
  actionBubbleText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  quickRepliesContainer: {
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#1a1a3e',
  },
  quickRepliesScroll: {
    paddingHorizontal: 12,
    gap: 8,
  },
  quickReplyButton: {
    backgroundColor: '#1a1a3e',
    borderWidth: 1,
    borderColor: '#00d4ff40',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  quickReplyText: {
    color: '#00d4ff',
    fontSize: 13,
  },
});
