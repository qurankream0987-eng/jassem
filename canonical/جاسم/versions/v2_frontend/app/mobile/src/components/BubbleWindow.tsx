/**
 * BubbleWindow - Modal Windows for Bubble Interactions
 * /نافذة الفقاعة - نوافذ منبثقة لتفاعلات الفقاعات
 *
 * Renders interactive content windows based on bubble type
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const { width } = Dimensions.get('window');

interface BubbleData {
  type: string;
  theme: string;
  data: Record<string, any>;
  priority: number;
}

interface BubbleWindowProps {
  bubbles: BubbleData[];
  onAction?: (action: string, data?: any) => void;
}

export default function BubbleWindow({ bubbles, onAction }: BubbleWindowProps) {
  const primaryBubble = bubbles[0];

  const renderBubbleContent = () => {
    switch (primaryBubble.type) {
      case 'restaurant_search':
        return <RestaurantSearchBubble data={primaryBubble.data} onAction={onAction} />;
      case 'product_grid':
        return <ProductGridBubble data={primaryBubble.data} onAction={onAction} />;
      case 'order_map':
        return <OrderMapBubble data={primaryBubble.data} />;
      case 'payment_methods':
        return <PaymentMethodsBubble data={primaryBubble.data} onAction={onAction} />;
      case 'haggle_interface':
        return <HaggleInterfaceBubble data={primaryBubble.data} onAction={onAction} />;
      case 'job_list':
        return <JobListBubble data={primaryBubble.data} />;
      case 'zakat_calculator':
        return <ZakatCalculatorBubble data={primaryBubble.data} onAction={onAction} />;
      case 'quick_menu':
        return <QuickMenuBubble data={primaryBubble.data} onAction={onAction} />;
      default:
        return <DefaultBubble data={primaryBubble.data} />;
    }
  };

  return (
    <View style={styles.container}>
      {renderBubbleContent()}
    </View>
  );
}

// ============================================
// INDIVIDUAL BUBBLE COMPONENTS
// ============================================

function RestaurantSearchBubble({ data, onAction }: { data: any; onAction?: Function }) {
  const restaurants = [
    { name: 'بيت الكبسة', rating: 4.8, time: '25 min', cuisine: 'كبسة' },
    { name: 'مطعم الأصالة', rating: 4.7, time: '30 min', cuisine: 'برياني' },
    { name: 'الشاورما الذهبية', rating: 4.5, time: '20 min', cuisine: 'شاورما' },
  ];

  return (
    <View style={styles.window}>
      <View style={styles.windowHeader}>
        <Ionicons name="restaurant" size={18} color="#FF6B35" />
        <Text style={styles.windowTitle}>مطاعم قريبة</Text>
      </View>
      {restaurants.map((r, i) => (
        <TouchableOpacity key={i} style={styles.listItem} onPress={() => onAction?.('select_restaurant', r)}>
          <View style={styles.itemInfo}>
            <Text style={styles.itemName}>{r.name}</Text>
            <Text style={styles.itemMeta}>{r.cuisine} • {r.time}</Text>
          </View>
          <View style={styles.ratingBadge}>
            <Ionicons name="star" size={12} color="#FFEAA7" />
            <Text style={styles.ratingText}>{r.rating}</Text>
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function ProductGridBubble({ data, onAction }: { data: any; onAction?: Function }) {
  return (
    <View style={styles.window}>
      <View style={styles.windowHeader}>
        <Ionicons name="grid" size={18} color="#4ECDC4" />
        <Text style={styles.windowTitle}>منتجات</Text>
      </View>
      <View style={styles.productGrid}>
        {['إلكترونيات', 'ملابس', 'أجهزة', 'منزل'].map((cat, i) => (
          <TouchableOpacity key={i} style={styles.gridItem} onPress={() => onAction?.('category', cat)}>
            <Text style={styles.gridText}>{cat}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

function OrderMapBubble({ data }: { data: any }) {
  return (
    <View style={styles.window}>
      <View style={styles.windowHeader}>
        <Ionicons name="map" size={18} color="#45B7D1" />
        <Text style={styles.windowTitle}>متابعة الطلب</Text>
      </View>
      <View style={styles.mapPlaceholder}>
        <Ionicons name="location" size={40} color="#45B7D1" />
        <Text style={styles.mapText}>السائق في الطريق</Text>
        <Text style={styles.mapSubtext}>الوقت المتوقع: 15 دقيقة</Text>
      </View>
    </View>
  );
}

function PaymentMethodsBubble({ data, onAction }: { data: any; onAction?: Function }) {
  const methods = [
    { name: 'KNET', icon: 'card', color: '#003B5C' },
    { name: 'Apple Pay', icon: 'logo-apple', color: '#000' },
    { name: 'Google Pay', icon: 'logo-google', color: '#4285F4' },
    { name: 'كاش', icon: 'cash', color: '#58D68D' },
  ];

  const amount = data?.amount || '0';

  return (
    <View style={styles.window}>
      <View style={styles.windowHeader}>
        <Ionicons name="card" size={18} color="#96CEB4" />
        <Text style={styles.windowTitle}>الدفع: {amount} د.ك</Text>
      </View>
      {methods.map((m, i) => (
        <TouchableOpacity key={i} style={styles.paymentItem} onPress={() => onAction?.('pay', m.name)}>
          <Ionicons name={m.icon as any} size={20} color="#fff" />
          <Text style={styles.paymentText}>{m.name}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function HaggleInterfaceBubble({ data, onAction }: { data: any; onAction?: Function }) {
  const currentPrice = data?.currentPrice || '0';

  return (
    <View style={styles.window}>
      <View style={styles.windowHeader}>
        <Ionicons name="pricetag" size={18} color="#FFEAA7" />
        <Text style={styles.windowTitle}>فاصل السعر</Text>
      </View>
      <View style={styles.haggleContainer}>
        <Text style={styles.haggleLabel}>السعر الحالي</Text>
        <Text style={styles.hagglePrice}>{currentPrice} د.ك</Text>
        <View style={styles.haggleButtons}>
          <TouchableOpacity style={styles.haggleButton} onPress={() => onAction?.('counter_offer')}>
            <Text style={styles.haggleButtonText}>قدم عرض</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.haggleButton, styles.acceptButton]} onPress={() => onAction?.('accept')}>
            <Text style={styles.haggleButtonText}>اقبل</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

function JobListBubble({ data }: { data: any }) {
  const jobs = [
    { title: 'مهندس برمجيات', company: 'شركة الكويت', salary: '1500' },
    { title: 'مصمم UI/UX', company: 'تقنية العرب', salary: '1200' },
  ];

  return (
    <View style={styles.window}>
      <View style={styles.windowHeader}>
        <Ionicons name="briefcase" size={18} color="#DDA0DD" />
        <Text style={styles.windowTitle}>وظائف شاغرة</Text>
      </View>
      {jobs.map((j, i) => (
        <View key={i} style={styles.listItem}>
          <View style={styles.itemInfo}>
            <Text style={styles.itemName}>{j.title}</Text>
            <Text style={styles.itemMeta}>{j.company} • {j.salary} د.ك</Text>
          </View>
          <TouchableOpacity style={styles.applyButton}>
            <Text style={styles.applyText}>قدم</Text>
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
}

function ZakatCalculatorBubble({ data, onAction }: { data: any; onAction?: Function }) {
  return (
    <View style={styles.window}>
      <View style={styles.windowHeader}>
        <Ionicons name="calculator" size={18} color="#98D8C8" />
        <Text style={styles.windowTitle}>حاسبة الزكاة</Text>
      </View>
      <View style={styles.zakatInputs}>
        {['نقدية', 'ذهب', 'استثمارات', 'ذمم مدينة'].map((field, i) => (
          <View key={i} style={styles.zakatRow}>
            <Text style={styles.zakatLabel}>{field}</Text>
            <View style={styles.zakatInput}>
              <Text style={styles.zatkPlaceholder}>0 د.ك</Text>
            </View>
          </View>
        ))}
        <TouchableOpacity
          style={styles.calcButton}
          onPress={() => onAction?.('calculate_zakat')}
        >
          <Text style={styles.calcButtonText}>احسب الزكاة (2.5%)</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function QuickMenuBubble({ data, onAction }: { data: any; onAction?: Function }) {
  const options = data?.options || [
    { label: 'اطلب أكل', action: 'food_order' },
    { label: 'تسوق', action: 'product_search' },
    { label: 'تابع طلبك', action: 'order_tracking' },
    { label: 'ابحث عن وظيفة', action: 'job_search' },
  ];

  return (
    <View style={styles.quickMenuWindow}>
      {options.map((opt: any, i: number) => (
        <TouchableOpacity
          key={i}
          style={styles.quickMenuItem}
          onPress={() => onAction?.(opt.action || opt.label)}
        >
          <Text style={styles.quickMenuText}>{opt.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function DefaultBubble({ data }: { data: any }) {
  return (
    <View style={styles.window}>
      <Text style={styles.windowTitle}>{data?.text || 'تم فهم طلبك'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 8,
  },
  window: {
    backgroundColor: '#0f0f2a',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1a1a3e',
  },
  quickMenuWindow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  windowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  windowTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  listItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a3e',
  },
  itemInfo: {
    flex: 1,
  },
  itemName: {
    color: '#fff',
    fontSize: 14,
  },
  itemMeta: {
    color: '#888',
    fontSize: 12,
    marginTop: 2,
  },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFEAA720',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    gap: 2,
  },
  ratingText: {
    color: '#FFEAA7',
    fontSize: 12,
    fontWeight: '600',
  },
  productGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  gridItem: {
    width: (width * 0.55 - 28) / 2,
    backgroundColor: '#1a1a3e',
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
  },
  gridText: {
    color: '#e0e0e0',
    fontSize: 12,
  },
  mapPlaceholder: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  mapText: {
    color: '#fff',
    marginTop: 8,
  },
  mapSubtext: {
    color: '#888',
    fontSize: 12,
    marginTop: 4,
  },
  paymentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a3e',
    gap: 10,
  },
  paymentText: {
    color: '#e0e0e0',
    fontSize: 14,
  },
  haggleContainer: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  haggleLabel: {
    color: '#888',
    fontSize: 12,
  },
  hagglePrice: {
    color: '#FFEAA7',
    fontSize: 24,
    fontWeight: 'bold',
    marginVertical: 8,
  },
  haggleButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  haggleButton: {
    backgroundColor: '#1a1a3e',
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  acceptButton: {
    backgroundColor: '#58D68D30',
  },
  haggleButtonText: {
    color: '#fff',
  },
  applyButton: {
    backgroundColor: '#DDA0DD30',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  applyText: {
    color: '#DDA0DD',
    fontWeight: '600',
  },
  zakatInputs: {
    gap: 8,
  },
  zakatRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  zakatLabel: {
    color: '#e0e0e0',
    fontSize: 13,
  },
  zakatInput: {
    backgroundColor: '#1a1a3e',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 80,
    alignItems: 'center',
  },
  zatkPlaceholder: {
    color: '#888',
    fontSize: 13,
  },
  calcButton: {
    backgroundColor: '#98D8C8',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  calcButtonText: {
    color: '#000',
    fontWeight: '600',
  },
  quickMenuItem: {
    backgroundColor: '#1a1a3e',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  quickMenuText: {
    color: '#00d4ff',
    fontSize: 12,
  },
});
