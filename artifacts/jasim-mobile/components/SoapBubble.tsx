import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { fonts } from '@/constants/colors';

export interface SoapBubbleSpec {
  id: string;
  label: string;
  value?: string;
  x: number; // normalized 0..1
  y: number; // normalized 0..1
  radius: number;
  colors: readonly [string, string];
}

interface Props {
  spec: SoapBubbleSpec;
  width: number;
  height: number;
  onOpen: (spec: SoapBubbleSpec) => void;
}

export function SoapBubble({ spec, width, height, onOpen }: Props) {
  const diameter = spec.radius * 2;
  const baseX = spec.x * width - spec.radius;
  const baseY = spec.y * height - spec.radius;

  const offsetX = useSharedValue(0);
  const offsetY = useSharedValue(0);
  const floatY = useSharedValue(0);
  const wobble = useSharedValue(1);
  const pop = useSharedValue(1);

  useEffect(() => {
    floatY.value = withRepeat(
      withSequence(
        withTiming(-10, { duration: 2600, easing: Easing.inOut(Easing.sin) }),
        withTiming(10, { duration: 2600, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
    wobble.value = withRepeat(
      withSequence(
        withTiming(1.04, { duration: 1800, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.97, { duration: 1800, easing: Easing.inOut(Easing.quad) }),
        withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
  }, [floatY, wobble]);

  const pan = Gesture.Pan()
    .onChange((event) => {
      offsetX.value += event.changeX;
      offsetY.value += event.changeY;
    })
    .onEnd(() => {
      offsetX.value = withTiming(offsetX.value * 0.9, { duration: 400 });
      offsetY.value = withTiming(offsetY.value * 0.9, { duration: 400 });
    });

  const triggerPop = () => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    pop.value = withTiming(0, { duration: 450, easing: Easing.out(Easing.quad) }, (done) => {
      if (done) {
        runOnJS(scheduleRespawn)();
      }
    });
  };

  const scheduleRespawn = () => {
    setTimeout(() => {
      pop.value = withTiming(1, { duration: 600, easing: Easing.out(Easing.back(1.6)) });
    }, 3000);
  };

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: offsetX.value },
      { translateY: offsetY.value + floatY.value },
      { scale: wobble.value * pop.value },
    ],
    opacity: pop.value,
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[
          styles.bubble,
          {
            left: baseX,
            top: baseY,
            width: diameter,
            height: diameter,
            borderRadius: spec.radius,
            shadowColor: spec.colors[0],
          },
          animatedStyle,
        ]}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onOpen(spec);
          }}
          onLongPress={triggerPop}
          delayLongPress={400}
          testID={`bubble-${spec.id}`}
        >
          <LinearGradient
            colors={[spec.colors[0], spec.colors[1]]}
            start={{ x: 0.15, y: 0.1 }}
            end={{ x: 0.9, y: 0.95 }}
            style={[StyleSheet.absoluteFill, { borderRadius: spec.radius, opacity: 0.32 }]}
          />
          <View
            style={[
              StyleSheet.absoluteFill,
              {
                borderRadius: spec.radius,
                borderWidth: 1.5,
                borderColor: 'rgba(255,255,255,0.35)',
                backgroundColor: 'rgba(255,255,255,0.06)',
              },
            ]}
          />
          <View style={styles.highlight} />
          <View style={styles.labelWrap}>
            {spec.value ? (
              <Text style={styles.value} numberOfLines={1}>
                {spec.value}
              </Text>
            ) : null}
            <Text style={styles.label} numberOfLines={2}>
              {spec.label}
            </Text>
          </View>
        </Pressable>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  bubble: {
    position: 'absolute',
    shadowOpacity: 0.6,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  highlight: {
    position: 'absolute',
    top: '14%',
    left: '20%',
    width: '26%',
    height: '16%',
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.55)',
    transform: [{ rotate: '-18deg' }],
    opacity: 0.7,
  },
  labelWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    gap: 2,
  },
  value: {
    fontFamily: fonts.extraBold,
    fontSize: 15,
    color: '#ffffff',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 6,
    textAlign: 'center',
  },
  label: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: 'rgba(255,255,255,0.95)',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 6,
    textAlign: 'center',
  },
});
