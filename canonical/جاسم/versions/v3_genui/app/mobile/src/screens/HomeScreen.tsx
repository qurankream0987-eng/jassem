/**
 * Home Screen - Space Background + Floating Bubbles
 * /الشاشة الرئيسية - خلفية فضائية + فقاعات
 *
 * Features:
 * - Animated starfield background
 * - Touchable floating bubbles for intents
 * - Quick action buttons
 * - Voice input button
 */

import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Dimensions,
  Easing,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import SpaceCanvas from '../components/SpaceCanvas';
import FloatingBubbles from '../components/FloatingBubbles';

const { width, height } = Dimensions.get('window');

const QUICK_ACTIONS = [
  { icon: 'restaurant-outline' as const, label: 'اطلب أكل', intent: 'food_order', color: '#FF6B35' },
  { icon: 'cart-outline' as const, label: 'تسوق', intent: 'product_search', color: '#4ECDC4' },
  { icon: 'location-outline' as const, label: 'طلباتي', intent: 'order_tracking', color: '#45B7D1' },
  { icon: 'briefcase-outline' as const, label: 'وظائف', intent: 'job_search', color: '#96CEB4' },
  { icon: 'calculator-outline' as const, label: 'زكاة', intent: 'zakat_calc', color: '#FFEAA7' },
  { icon: 'chatbubbles-outline' as const, label: 'دردش', intent: 'general_chat', color: '#DDA0DD' },
];

export default function HomeScreen() {
  const navigation = useNavigation();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 1000,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 800,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const handleBubblePress = (intent: string) => {
    // @ts-ignore
    navigation.navigate('Chat', { initialIntent: intent });
  };

  return (
    <View style={styles.container}>
      {/* Space Background */}
      <SpaceCanvas />

      {/* Floating Bubbles */}
      <FloatingBubbles onBubblePress={handleBubblePress} />

      {/* Content Overlay */}
      <Animated.View style={[styles.overlay, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
        {/* Greeting */}
        <View style={styles.greetingContainer}>
          <Text style={styles.greeting}>أهلاً بك في جاسم</Text>
          <Text style={styles.subGreeting}>JASIM - Your AI Commerce Assistant</Text>
        </View>

        {/* Quick Actions Grid */}
        <View style={styles.actionsContainer}>
          <Text style={styles.sectionTitle}>خدمات سريعة</Text>
          <View style={styles.actionsGrid}>
            {QUICK_ACTIONS.map((action, index) => (
              <AnimatedActionButton
                key={action.intent}
                action={action}
                index={index}
                onPress={() => handleBubblePress(action.intent)}
              />
            ))}
          </View>
        </View>

        {/* Voice Input Button */}
        <TouchableOpacity
          style={styles.voiceButton}
          onPress={() => handleBubblePress('voice_search')}
          activeOpacity={0.8}
        >
          <Ionicons name="mic" size={28} color="#00d4ff" />
          <Text style={styles.voiceText}>تحدث مع جاسم</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

function AnimatedActionButton({
  action,
  index,
  onPress,
}: {
  action: typeof QUICK_ACTIONS[0];
  index: number;
  onPress: () => void;
}) {
  const scaleAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      delay: index * 100,
      friction: 4,
      useNativeDriver: true,
    }).start();
  }, []);

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity style={styles.actionButton} onPress={onPress} activeOpacity={0.7}>
        <View style={[styles.actionIcon, { backgroundColor: action.color + '20' }]}>
          <Ionicons name={action.icon} size={24} color={action.color} />
        </View>
        <Text style={styles.actionLabel}>{action.label}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050510',
  },
  overlay: {
    flex: 1,
    padding: 20,
    justifyContent: 'space-between',
  },
  greetingContainer: {
    alignItems: 'center',
    marginTop: 60,
  },
  greeting: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#ffffff',
    textAlign: 'center',
    textShadowColor: 'rgba(0, 212, 255, 0.5)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 20,
  },
  subGreeting: {
    fontSize: 14,
    color: '#00d4ff',
    marginTop: 8,
    textAlign: 'center',
  },
  actionsContainer: {
    marginTop: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 16,
    textAlign: 'right',
  },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  actionButton: {
    width: (width - 60) / 3,
    alignItems: 'center',
    marginBottom: 16,
  },
  actionIcon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  actionLabel: {
    color: '#ffffff',
    fontSize: 12,
    textAlign: 'center',
  },
  voiceButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 212, 255, 0.15)',
    borderRadius: 30,
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderWidth: 1,
    borderColor: 'rgba(0, 212, 255, 0.3)',
    alignSelf: 'center',
    marginBottom: 20,
  },
  voiceText: {
    color: '#00d4ff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 10,
  },
});
