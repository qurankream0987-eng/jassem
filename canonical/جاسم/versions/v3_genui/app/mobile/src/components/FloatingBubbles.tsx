/**
 * FloatingBubbles - Touchable Animated Bubbles
 * /الفقاعات العائمة - فقاعات تفاعلية متحركة
 *
 * Floating touchable bubbles that represent different intents
 * Animated with spring physics
 */

import React, { useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Dimensions,
  PanResponder,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const { width, height } = Dimensions.get('window');

interface Bubble {
  id: string;
  x: number;
  y: number;
  size: number;
  icon: string;
  label: string;
  intent: string;
  color: string;
}

const BUBBLES: Bubble[] = [
  { id: 'b1', x: width * 0.1, y: height * 0.15, size: 70, icon: 'restaurant', label: 'أكل', intent: 'food_order', color: '#FF6B35' },
  { id: 'b2', x: width * 0.65, y: height * 0.12, size: 60, icon: 'cart', label: 'تسوق', intent: 'product_search', color: '#4ECDC4' },
  { id: 'b3', x: width * 0.75, y: height * 0.28, size: 55, icon: 'cube', label: 'طلبات', intent: 'order_tracking', color: '#45B7D1' },
  { id: 'b4', x: width * 0.05, y: height * 0.35, size: 50, icon: 'cash', label: 'دفع', intent: 'payment', color: '#96CEB4' },
  { id: 'b5', x: width * 0.55, y: height * 0.38, size: 45, icon: 'briefcase', label: 'وظيفة', intent: 'job_search', color: '#FFEAA7' },
  { id: 'b6', x: width * 0.3, y: height * 0.25, size: 40, icon: 'moon', label: 'زكاة', intent: 'zakat_calc', color: '#DDA0DD' },
];

interface FloatingBubblesProps {
  onBubblePress: (intent: string) => void;
}

export default function FloatingBubbles({ onBubblePress }: FloatingBubblesProps) {
  const animatedValues = useRef<Record<string, {
    x: Animated.Value;
    y: Animated.Value;
    scale: Animated.Value;
    pulse: Animated.Value;
  }>>({});

  // Initialize animated values
  BUBBLES.forEach(bubble => {
    if (!animatedValues.current[bubble.id]) {
      animatedValues.current[bubble.id] = {
        x: new Animated.Value(bubble.x),
        y: new Animated.Value(bubble.y),
        scale: new Animated.Value(0),
        pulse: new Animated.Value(1),
      };
    }
  });

  useEffect(() => {
    // Entrance animation
    const entranceAnimations = BUBBLES.map((bubble, i) =>
      Animated.spring(animatedValues.current[bubble.id].scale, {
        toValue: 1,
        delay: i * 150,
        friction: 5,
        tension: 40,
        useNativeDriver: true,
      })
    );

    Animated.stagger(100, entranceAnimations).start();

    // Continuous floating animation
    BUBBLES.forEach(bubble => {
      const av = animatedValues.current[bubble.id];
      const floatY = bubble.y;

      Animated.loop(
        Animated.sequence([
          Animated.timing(av.y, {
            toValue: floatY - 10,
            duration: 2000 + Math.random() * 1000,
            useNativeDriver: true,
          }),
          Animated.timing(av.y, {
            toValue: floatY + 10,
            duration: 2000 + Math.random() * 1000,
            useNativeDriver: true,
          }),
        ])
      ).start();

      // Pulse animation
      Animated.loop(
        Animated.sequence([
          Animated.timing(av.pulse, {
            toValue: 1.05,
            duration: 1500,
            useNativeDriver: true,
          }),
          Animated.timing(av.pulse, {
            toValue: 1,
            duration: 1500,
            useNativeDriver: true,
          }),
        ])
      ).start();
    });
  }, []);

  const handlePress = useCallback((intent: string) => {
    onBubblePress(intent);
  }, [onBubblePress]);

  const handlePressIn = useCallback((bubbleId: string) => {
    Animated.spring(animatedValues.current[bubbleId].scale, {
      toValue: 0.85,
      friction: 3,
      useNativeDriver: true,
    }).start();
  }, []);

  const handlePressOut = useCallback((bubbleId: string) => {
    Animated.spring(animatedValues.current[bubbleId].scale, {
      toValue: 1,
      friction: 3,
      useNativeDriver: true,
    }).start();
  }, []);

  return (
    <View style={styles.container} pointerEvents="box-none">
      {BUBBLES.map(bubble => {
        const av = animatedValues.current[bubble.id];
        return (
          <Animated.View
            key={bubble.id}
            style={[
              styles.bubbleWrapper,
              {
                transform: [
                  { translateX: av.x },
                  { translateY: av.y },
                  { scale: Animated.multiply(av.scale, av.pulse) },
                ],
                width: bubble.size,
                height: bubble.size,
              },
            ]}
          >
            <TouchableOpacity
              style={[styles.bubble, { backgroundColor: bubble.color + '25', borderColor: bubble.color + '50' }]}
              onPress={() => handlePress(bubble.intent)}
              onPressIn={() => handlePressIn(bubble.id)}
              onPressOut={() => handlePressOut(bubble.id)}
              activeOpacity={0.6}
            >
              <Ionicons name={bubble.icon as any} size={bubble.size * 0.3} color={bubble.color} />
              <Text style={[styles.bubbleLabel, { color: bubble.color, fontSize: bubble.size * 0.18 }]}>
                {bubble.label}
              </Text>
            </TouchableOpacity>
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    width,
    height,
  },
  bubbleWrapper: {
    position: 'absolute',
  },
  bubble: {
    width: '100%',
    height: '100%',
    borderRadius: 999,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  bubbleLabel: {
    marginTop: 2,
    fontWeight: '600',
  },
});
