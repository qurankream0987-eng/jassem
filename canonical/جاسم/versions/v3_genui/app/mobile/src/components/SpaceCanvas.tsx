/**
 * SpaceCanvas - Animated Starfield Background
 * /كانفاس الفضاء - خلفية النجوم المتحركة
 *
 * Animated starfield with twinkling stars for the home screen
 * Uses React Native Animated API (no react-native-canvas needed)
 */

import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Dimensions } from 'react-native';

const { width, height } = Dimensions.get('window');

interface Star {
  id: number;
  x: number;
  y: number;
  size: number;
  opacity: Animated.Value;
  duration: number;
}

export default function SpaceCanvas() {
  const starsRef = useRef<Star[]>([]);

  // Generate stars on mount
  if (starsRef.current.length === 0) {
    const starCount = 100;
    for (let i = 0; i < starCount; i++) {
      starsRef.current.push({
        id: i,
        x: Math.random() * width,
        y: Math.random() * height,
        size: Math.random() * 2.5 + 0.5,
        opacity: new Animated.Value(Math.random()),
        duration: 1500 + Math.random() * 3000,
      });
    }
  }

  useEffect(() => {
    const animations = starsRef.current.map(star =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(star.opacity, {
            toValue: 1,
            duration: star.duration / 2,
            useNativeDriver: true,
          }),
          Animated.timing(star.opacity, {
            toValue: 0.2,
            duration: star.duration / 2,
            useNativeDriver: true,
          }),
        ])
      )
    );

    Animated.stagger(50, animations).start();

    return () => {
      animations.forEach(anim => anim.stop());
    };
  }, []);

  return (
    <View style={styles.container}>
      {/* Deep space background */}
      <View style={styles.gradient} />

      {/* Nebula effects */}
      <View style={[styles.nebula, styles.nebula1]} />
      <View style={[styles.nebula, styles.nebula2]} />
      <View style={[styles.nebula, styles.nebula3]} />

      {/* Stars */}
      {starsRef.current.map(star => (
        <Animated.View
          key={star.id}
          style={[
            styles.star,
            {
              left: star.x,
              top: star.y,
              width: star.size,
              height: star.size,
              opacity: star.opacity,
              shadowRadius: star.size * 2,
            },
          ]}
        />
      ))}

      {/* Shooting star */}
      <ShootingStar />
    </View>
  );
}

function ShootingStar() {
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animate = () => {
      translateX.setValue(0);
      translateY.setValue(0);
      opacity.setValue(0);

      Animated.sequence([
        Animated.delay(3000 + Math.random() * 5000),
        Animated.parallel([
          Animated.timing(translateX, {
            toValue: width * 0.6,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(translateY, {
            toValue: height * 0.3,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true,
          }),
        ]),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start(() => animate());
    };

    animate();
  }, []);

  return (
    <Animated.View
      style={[
        styles.shootingStar,
        {
          transform: [{ translateX }, { translateY }],
          opacity,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    width,
    height,
  },
  gradient: {
    position: 'absolute',
    width,
    height,
    backgroundColor: '#050510',
  },
  nebula: {
    position: 'absolute',
    borderRadius: 999,
    opacity: 0.06,
  },
  nebula1: {
    width: 300,
    height: 300,
    top: 50,
    left: -50,
    backgroundColor: '#00d4ff',
  },
  nebula2: {
    width: 250,
    height: 250,
    bottom: 100,
    right: -30,
    backgroundColor: '#FF6B35',
  },
  nebula3: {
    width: 200,
    height: 200,
    top: height * 0.4,
    left: width * 0.3,
    backgroundColor: '#4ECDC4',
  },
  star: {
    position: 'absolute',
    borderRadius: 999,
    backgroundColor: '#fff',
    shadowColor: '#fff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
  },
  shootingStar: {
    position: 'absolute',
    top: 80,
    left: 50,
    width: 80,
    height: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    borderRadius: 1,
  },
});
