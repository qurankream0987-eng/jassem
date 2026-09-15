/**
 * BottomNav - Tab Navigation Component
 * /الشريط السفلي - مكون التنقل بالتبويبات
 *
 * Bottom tab navigation with animated active indicators
 * Note: This is a styled wrapper - actual navigation is in App.tsx
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface NavItem {
  key: string;
  label: string;
  labelAr: string;
  icon: string;
  iconActive: string;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'home', label: 'Home', labelAr: 'الرئيسية', icon: 'home-outline', iconActive: 'home' },
  { key: 'chat', label: 'Chat', labelAr: 'جاسم', icon: 'chatbubble-ellipses-outline', iconActive: 'chatbubble-ellipses' },
  { key: 'merchant', label: 'Store', labelAr: 'متجري', icon: 'storefront-outline', iconActive: 'storefront' },
  { key: 'profile', label: 'Profile', labelAr: 'حسابي', icon: 'person-outline', iconActive: 'person' },
];

interface BottomNavProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  useArabic?: boolean;
}

export default function BottomNav({ activeTab, onTabChange, useArabic = true }: BottomNavProps) {
  return (
    <View style={styles.container}>
      <View style={styles.tabBar}>
        {NAV_ITEMS.map((item) => {
          const isActive = activeTab === item.key;
          return (
            <TouchableOpacity
              key={item.key}
              style={styles.tab}
              onPress={() => onTabChange(item.key)}
              activeOpacity={0.7}
            >
              <Animated.View style={[
                styles.iconContainer,
                isActive && styles.activeIconContainer,
              ]}>
                <Ionicons
                  name={(isActive ? item.iconActive : item.icon) as any}
                  size={22}
                  color={isActive ? '#00d4ff' : '#888'}
                />
              </Animated.View>
              <Text style={[
                styles.label,
                isActive && styles.activeLabel,
              ]}>
                {useArabic ? item.labelAr : item.label}
              </Text>
              {isActive && <View style={styles.activeIndicator} />}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0a0a1a',
    borderTopWidth: 1,
    borderTopColor: '#1a1a3e',
    paddingBottom: 20,
  },
  tabBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    height: 60,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    position: 'relative',
  },
  iconContainer: {
    width: 40,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 10,
  },
  activeIconContainer: {
    backgroundColor: '#00d4ff15',
  },
  label: {
    fontSize: 11,
    color: '#888',
    marginTop: 2,
  },
  activeLabel: {
    color: '#00d4ff',
    fontWeight: '600',
  },
  activeIndicator: {
    position: 'absolute',
    top: 0,
    width: 40,
    height: 3,
    backgroundColor: '#00d4ff',
    borderRadius: 2,
  },
});
