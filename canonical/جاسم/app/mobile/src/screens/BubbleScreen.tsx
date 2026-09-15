/**
 * Bubble Screen - Interactive Bubble Details
 * /شاشة الفقاعة - تفاصيل الفقاعة التفاعلية
 *
 * Shows detailed content for a selected bubble
 * with interactive elements based on bubble type
 */

import React, { useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  ScrollView,
  Dimensions,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

const { width } = Dimensions.get('window');

const BUBBLE_THEMES: Record<string, { bg: string; accent: string; icon: string }> = {
  food: { bg: '#FF6B3520', accent: '#FF6B35', icon: 'restaurant' },
  fashion: { bg: '#4ECDC420', accent: '#4ECDC4', icon: 'shirt' },
  map: { bg: '#45B7D120', accent: '#45B7D1', icon: 'map' },
  payment: { bg: '#96CEB420', accent: '#96CEB4', icon: 'card' },
  haggle: { bg: '#FFEAA720', accent: '#FFEAA7', icon: 'pricetag' },
  job: { bg: '#DDA0DD20', accent: '#DDA0DD', icon: 'briefcase' },
  islamic: { bg: '#98D8C820', accent: '#98D8C8', icon: 'moon' },
  cv: { bg: '#F7DC6F20', accent: '#F7DC6F', icon: 'document-text' },
  chart: { bg: '#BB8FCE20', accent: '#BB8FCE', icon: 'trending-up' },
  order: { bg: '#85C1E920', accent: '#85C1E9', icon: 'cube' },
  success: { bg: '#58D68D20', accent: '#58D68D', icon: 'checkmark-circle' },
  default: { bg: '#00d4ff20', accent: '#00d4ff', icon: 'apps' },
};

export default function BubbleScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { bubble } = (route.params as any) || {};
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, friction: 5, useNativeDriver: true }),
    ]).start();
  }, []);

  if (!bubble) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>No bubble data</Text>
      </View>
    );
  }

  const theme = BUBBLE_THEMES[bubble.theme || 'default'] || BUBBLE_THEMES.default;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: theme.bg }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Ionicons name={theme.icon as any} size={40} color={theme.accent} />
        <Text style={styles.title}>{bubble.type}</Text>
        <Text style={styles.subtitle}>Bubble Details</Text>
      </View>

      {/* Content */}
      <ScrollView style={styles.content}>
        <Animated.View style={{ opacity: fadeAnim, transform: [{ scale: scaleAnim }] }}>
          {/* Bubble Info Card */}
          <View style={[styles.card, { borderColor: theme.accent }]}>
            <Text style={styles.cardTitle}>Type</Text>
            <Text style={styles.cardValue}>{bubble.type}</Text>
          </View>

          <View style={[styles.card, { borderColor: theme.accent }]}>
            <Text style={styles.cardTitle}>Theme</Text>
            <Text style={styles.cardValue}>{bubble.theme}</Text>
          </View>

          <View style={[styles.card, { borderColor: theme.accent }]}>
            <Text style={styles.cardTitle}>Priority</Text>
            <View style={styles.priorityBar}>
              <View style={[styles.priorityFill, { width: `${bubble.priority}%`, backgroundColor: theme.accent }]} />
            </View>
            <Text style={styles.cardValue}>{bubble.priority}/100</Text>
          </View>

          {/* Data Display */}
          {bubble.data && (
            <View style={[styles.card, { borderColor: theme.accent }]}>
              <Text style={styles.cardTitle}>Data</Text>
              {Object.entries(bubble.data).map(([key, value]) => (
                <View key={key} style={styles.dataRow}>
                  <Text style={styles.dataKey}>{key}:</Text>
                  <Text style={styles.dataValue}>{JSON.stringify(value)}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Action Buttons */}
          <View style={styles.actionsContainer}>
            <TouchableOpacity style={[styles.actionButton, { backgroundColor: theme.accent }]}>
              <Ionicons name="play" size={20} color="#000" />
              <Text style={styles.actionText}>Execute</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.actionButton, { backgroundColor: '#333' }]}>
              <Ionicons name="share-outline" size={20} color="#fff" />
              <Text style={styles.actionTextLight}>Share</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050510',
  },
  header: {
    paddingTop: 60,
    paddingBottom: 30,
    alignItems: 'center',
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
  },
  backButton: {
    position: 'absolute',
    top: 50,
    left: 20,
    padding: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 10,
    textTransform: 'capitalize',
  },
  subtitle: {
    fontSize: 14,
    color: '#888',
    marginTop: 4,
  },
  content: {
    flex: 1,
    padding: 20,
  },
  card: {
    backgroundColor: '#0a0a1a',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 3,
  },
  cardTitle: {
    fontSize: 12,
    color: '#888',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  cardValue: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '600',
  },
  priorityBar: {
    height: 8,
    backgroundColor: '#1a1a3e',
    borderRadius: 4,
    marginVertical: 8,
    overflow: 'hidden',
  },
  priorityFill: {
    height: '100%',
    borderRadius: 4,
  },
  dataRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a3e',
  },
  dataKey: {
    color: '#888',
    width: 100,
    fontSize: 13,
  },
  dataValue: {
    color: '#00d4ff',
    flex: 1,
    fontSize: 13,
  },
  actionsContainer: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
    marginBottom: 40,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  actionText: {
    color: '#000',
    fontWeight: '600',
    fontSize: 14,
  },
  actionTextLight: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  errorText: {
    color: '#fff',
    fontSize: 18,
    textAlign: 'center',
    marginTop: 100,
  },
});
