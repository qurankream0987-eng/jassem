import React from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fonts, palette } from '@/constants/colors';

interface Props {
  visible: boolean;
  title: string;
  subtitle?: string;
  accentColor?: string;
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * Soap-glass world window: a floating blurred panel over the chat space.
 * Renders via Modal so it works on iOS, Android, and web consistently.
 */
export function GlassWindow({
  visible,
  title,
  subtitle,
  accentColor = palette.cyan,
  onClose,
  children,
}: Props) {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top + 24;
  const bottomPad = Platform.OS === 'web' ? insets.bottom + 34 : insets.bottom + 24;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.window,
            { marginTop: topPad, marginBottom: bottomPad },
          ]}
          onPress={(event) => event.stopPropagation()}
        >
          <BlurView intensity={70} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={[StyleSheet.absoluteFill, styles.windowTint]} />
          <View style={styles.header}>
            <View style={[styles.iconChip, { backgroundColor: `${accentColor}26`, borderColor: `${accentColor}55` }]}>
              <View style={[styles.iconDot, { backgroundColor: accentColor }]} />
            </View>
            <View style={styles.headerText}>
              <Text style={styles.title} numberOfLines={1}>
                {title}
              </Text>
              {subtitle ? (
                <Text style={styles.subtitle} numberOfLines={1}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
            <Pressable
              onPress={onClose}
              style={styles.closeButton}
              testID="window-close"
            >
              <Ionicons name="close" size={18} color={palette.text2} />
            </Pressable>
          </View>
          <ScrollView
            style={styles.content}
            contentContainerStyle={{ paddingBottom: 20 }}
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(1,2,8,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  window: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '78%',
    borderRadius: 28,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  windowTint: {
    backgroundColor: 'rgba(10,14,26,0.55)',
  },
  header: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.10)',
  },
  iconChip: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  iconDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  headerText: {
    flex: 1,
    alignItems: 'flex-end',
  },
  title: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: palette.text,
    textAlign: 'right',
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: palette.text2,
    textAlign: 'right',
  },
  closeButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
});
