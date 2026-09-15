/**
 * Profile Screen - User Profile & Settings
 * /شاشة الحساب - الملف الشخصي والإعدادات
 *
 * Features:
 * - User profile display
 * - Language switcher (Arabic/English)
 * - Biometric auth toggle
 * - Notification settings
 * - Dark/light theme toggle
 * - Logout
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const MENU_ITEMS = [
  { icon: 'person-outline' as const, label: 'تعديل الملف الشخصي', labelEn: 'Edit Profile', screen: 'EditProfile' },
  { icon: 'location-outline' as const, label: 'العناوين', labelEn: 'Addresses', screen: 'Addresses' },
  { icon: 'card-outline' as const, label: 'طرق الدفع', labelEn: 'Payment Methods', screen: 'Payments' },
  { icon: 'cart-outline' as const, label: 'طلباتي', labelEn: 'My Orders', screen: 'Orders' },
  { icon: 'heart-outline' as const, label: 'المفضلة', labelEn: 'Favorites', screen: 'Favorites' },
  { icon: 'gift-outline' as const, label: 'نقاطي', labelEn: 'My Points', screen: 'Points' },
];

const SETTINGS_ITEMS = [
  { icon: 'notifications-outline' as const, label: 'الإشعارات', labelEn: 'Notifications', key: 'notifications' },
  { icon: 'finger-print-outline' as const, label: 'البيومترية', labelEn: 'Biometric Auth', key: 'biometric' },
  { icon: 'moon-outline' as const, label: 'الوضع الداكن', labelEn: 'Dark Mode', key: 'darkMode' },
  { icon: 'language-outline' as const, label: 'اللغة / Language', labelEn: 'Language', key: 'language' },
];

export default function ProfileScreen() {
  const [lang, setLang] = useState<'ar' | 'en'>('ar');
  const [settings, setSettings] = useState({
    notifications: true,
    biometric: false,
    darkMode: true,
    language: false,
  });

  const toggleSetting = (key: string) => {
    if (key === 'language') {
      setLang(prev => prev === 'ar' ? 'en' : 'ar');
    }
    setSettings(prev => ({ ...prev, [key]: !prev[key as keyof typeof prev] }));
  };

  const t = (ar: string, en: string) => lang === 'ar' ? ar : en;

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Profile Header */}
      <View style={styles.header}>
        <View style={styles.avatarContainer}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>أ</Text>
          </View>
          <TouchableOpacity style={styles.editAvatar}>
            <Ionicons name="camera" size={14} color="#fff" />
          </TouchableOpacity>
        </View>
        <Text style={styles.name}>أحمد محمد</Text>
        <Text style={styles.phone}>+965 5000 1111</Text>
        <View style={styles.badge}>
          <Ionicons name="shield-checkmark" size={14} color="#00d4ff" />
          <Text style={styles.badgeText}>Gold Member</Text>
        </View>
      </View>

      {/* Quick Stats */}
      <View style={styles.statsContainer}>
        <View style={styles.statBox}>
          <Text style={styles.statNumber}>24</Text>
          <Text style={styles.statLabel}>{t('طلب', 'Orders')}</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statBox}>
          <Text style={styles.statNumber}>1,250</Text>
          <Text style={styles.statLabel}>{t('نقطة', 'Points')}</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statBox}>
          <Text style={styles.statNumber}>4.7</Text>
          <Text style={styles.statLabel}>{t('تقييم', 'Rating')}</Text>
        </View>
      </View>

      {/* Menu Items */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('الحساب', 'Account')}</Text>
        {MENU_ITEMS.map((item, index) => (
          <TouchableOpacity key={index} style={styles.menuItem} activeOpacity={0.7}>
            <View style={[styles.menuIcon, { backgroundColor: '#00d4ff15' }]}>
              <Ionicons name={item.icon} size={20} color="#00d4ff" />
            </View>
            <View style={styles.menuText}>
              <Text style={styles.menuLabel}>{t(item.label, item.labelEn)}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#888" />
          </TouchableOpacity>
        ))}
      </View>

      {/* Settings */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('الإعدادات', 'Settings')}</Text>
        {SETTINGS_ITEMS.map((item, index) => (
          <View key={index} style={styles.menuItem}>
            <View style={[styles.menuIcon, { backgroundColor: '#00d4ff15' }]}>
              <Ionicons name={item.icon} size={20} color="#00d4ff" />
            </View>
            <View style={styles.menuText}>
              <Text style={styles.menuLabel}>{t(item.label, item.labelEn)}</Text>
            </View>
            <Switch
              value={settings[item.key as keyof typeof settings]}
              onValueChange={() => toggleSetting(item.key)}
              trackColor={{ false: '#333', true: '#00d4ff50' }}
              thumbColor={settings[item.key as keyof typeof settings] ? '#00d4ff' : '#888'}
            />
          </View>
        ))}
      </View>

      {/* Support */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('الدعم', 'Support')}</Text>
        {[
          { icon: 'help-circle-outline' as const, label: 'مركز المساعدة', labelEn: 'Help Center' },
          { icon: 'chatbubble-outline' as const, label: 'تواصل معنا', labelEn: 'Contact Us' },
          { icon: 'document-text-outline' as const, label: 'الشروط والأحكام', labelEn: 'Terms & Conditions' },
          { icon: 'shield-outline' as const, label: 'سياسة الخصوصية', labelEn: 'Privacy Policy' },
        ].map((item, index) => (
          <TouchableOpacity key={index} style={styles.menuItem} activeOpacity={0.7}>
            <View style={[styles.menuIcon, { backgroundColor: '#00d4ff15' }]}>
              <Ionicons name={item.icon} size={20} color="#00d4ff" />
            </View>
            <View style={styles.menuText}>
              <Text style={styles.menuLabel}>{t(item.label, item.labelEn)}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#888" />
          </TouchableOpacity>
        ))}
      </View>

      {/* Logout */}
      <TouchableOpacity style={styles.logoutButton} activeOpacity={0.8}>
        <Ionicons name="log-out-outline" size={20} color="#E74C3C" />
        <Text style={styles.logoutText}>{t('تسجيل الخروج', 'Logout')}</Text>
      </TouchableOpacity>

      {/* Version */}
      <Text style={styles.version}>JASIM v4.0.0</Text>
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050510',
  },
  header: {
    alignItems: 'center',
    paddingTop: 60,
    paddingBottom: 20,
  },
  avatarContainer: {
    position: 'relative',
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#00d4ff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#000',
  },
  editAvatar: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#1a1a3e',
    borderWidth: 2,
    borderColor: '#00d4ff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  name: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 12,
  },
  phone: {
    fontSize: 14,
    color: '#888',
    marginTop: 4,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#00d4ff20',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginTop: 8,
    gap: 4,
  },
  badgeText: {
    color: '#00d4ff',
    fontSize: 12,
    fontWeight: '600',
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 20,
    marginBottom: 20,
    backgroundColor: '#0a0a1a',
    borderRadius: 16,
    padding: 16,
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  statLabel: {
    fontSize: 12,
    color: '#888',
    marginTop: 4,
  },
  statDivider: {
    width: 1,
    height: 40,
    backgroundColor: '#1a1a3e',
  },
  section: {
    marginHorizontal: 20,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#888',
    marginBottom: 12,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0a0a1a',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  menuIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuText: {
    flex: 1,
    marginLeft: 12,
  },
  menuLabel: {
    color: '#fff',
    fontSize: 15,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E74C3C15',
    borderRadius: 12,
    paddingVertical: 14,
    marginHorizontal: 20,
    marginBottom: 16,
    gap: 8,
  },
  logoutText: {
    color: '#E74C3C',
    fontSize: 16,
    fontWeight: '600',
  },
  version: {
    textAlign: 'center',
    color: '#555',
    fontSize: 12,
    marginBottom: 20,
  },
});
