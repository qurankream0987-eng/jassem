/**
 * Merchant Screen - Merchant Dashboard
 * /شاشة التاجر - لوحة تحكم التاجر
 *
 * Features:
 * - Sales overview with charts
 * - Order management
 * - Product listing
 * - Revenue analytics
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const { width } = Dimensions.get('window');

const RECENT_ORDERS = [
  { id: 'ORD-001', customer: 'أحمد', total: 25, status: 'pending', time: '2m ago' },
  { id: 'ORD-002', customer: 'محمد', total: 42, status: 'confirmed', time: '5m ago' },
  { id: 'ORD-003', customer: 'سعيد', total: 18, status: 'delivered', time: '15m ago' },
  { id: 'ORD-004', customer: 'خالد', total: 65, status: 'processing', time: '30m ago' },
];

const STATUS_COLORS: Record<string, string> = {
  pending: '#FF6B35',
  confirmed: '#4ECDC4',
  processing: '#45B7D1',
  delivered: '#58D68D',
  cancelled: '#E74C3C',
};

const STATUS_AR: Record<string, string> = {
  pending: 'معلق',
  confirmed: 'مؤكد',
  processing: 'قيد التنفيذ',
  delivered: 'تم التوصيل',
  cancelled: 'ملغي',
};

export default function MerchantScreen() {
  const [activeTab, setActiveTab] = useState('overview');

  const renderOverview = () => (
    <View>
      {/* Stats Cards */}
      <View style={styles.statsGrid}>
        <StatCard
          icon="cash-outline"
          label="الإيرادات"
          value="2,840 KWD"
          change="+12%"
          color="#4ECDC4"
        />
        <StatCard
          icon="cube-outline"
          label="الطلبات"
          value="156"
          change="+8%"
          color="#45B7D1"
        />
        <StatCard
          icon="star-outline"
          label="التقييم"
          value="4.7"
          change="+0.2"
          color="#FFEAA7"
        />
        <StatCard
          icon="people-outline"
          label="العملاء"
          value="89"
          change="+15%"
          color="#DDA0DD"
        />
      </View>

      {/* Revenue Chart Placeholder */}
      <View style={styles.chartCard}>
        <Text style={styles.chartTitle}>إيرادات الأسبوع</Text>
        <View style={styles.chartBars}>
          {['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'].map((day, i) => {
            const heights = [60, 80, 45, 90, 70, 55, 85];
            return (
              <View key={day} style={styles.barContainer}>
                <View style={[styles.bar, { height: heights[i], backgroundColor: i === 3 ? '#00d4ff' : '#1a1a3e' }]} />
                <Text style={styles.barLabel}>{day}</Text>
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );

  const renderOrders = () => (
    <View>
      <Text style={styles.sectionTitle}>الطلبات الحديثة</Text>
      {RECENT_ORDERS.map(order => (
        <View key={order.id} style={styles.orderCard}>
          <View style={styles.orderHeader}>
            <Text style={styles.orderId}>{order.id}</Text>
            <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[order.status] + '20' }]}>
              <Text style={[styles.statusText, { color: STATUS_COLORS[order.status] }]}>
                {STATUS_AR[order.status]}
              </Text>
            </View>
          </View>
          <View style={styles.orderDetails}>
            <Text style={styles.orderCustomer}>{order.customer}</Text>
            <Text style={styles.orderTotal}>{order.total} KWD</Text>
            <Text style={styles.orderTime}>{order.time}</Text>
          </View>
        </View>
      ))}
    </View>
  );

  const renderProducts = () => (
    <View>
      <Text style={styles.sectionTitle}>المنتجات</Text>
      {[
        { name: 'كبسة دجاج', price: 5, sales: 120, stock: 45 },
        { name: 'مندي لحم', price: 8, sales: 80, stock: 22 },
        { name: 'برياني', price: 4.5, sales: 95, stock: 30 },
        { name: 'شاورما', price: 2, sales: 200, stock: 60 },
      ].map((product, i) => (
        <View key={i} style={styles.productCard}>
          <View style={styles.productInfo}>
            <Text style={styles.productName}>{product.name}</Text>
            <Text style={styles.productPrice}>{product.price} KWD</Text>
          </View>
          <View style={styles.productStats}>
            <View style={styles.statItem}>
              <Ionicons name="cart-outline" size={14} color="#888" />
              <Text style={styles.statText}>{product.sales}</Text>
            </View>
            <View style={styles.statItem}>
              <Ionicons name="cube-outline" size={14} color={product.stock < 30 ? '#FF6B35' : '#58D68D'} />
              <Text style={[styles.statText, product.stock < 30 && { color: '#FF6B35' }]}>
                {product.stock}
              </Text>
            </View>
          </View>
        </View>
      ))}

      <TouchableOpacity style={styles.addButton}>
        <Ionicons name="add" size={24} color="#000" />
        <Text style={styles.addButtonText}>إضافة منتج جديد</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>لوحة التحكم</Text>
        <Text style={styles.headerSubtitle}>مطعم الأصالة</Text>
      </View>

      {/* Tabs */}
      <View style={styles.tabsContainer}>
        {[
          { key: 'overview', label: 'نظرة عامة', icon: 'stats-chart' },
          { key: 'orders', label: 'الطلبات', icon: 'cube' },
          { key: 'products', label: 'المنتجات', icon: 'fast-food' },
        ].map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Ionicons
              name={tab.icon as any}
              size={18}
              color={activeTab === tab.key ? '#00d4ff' : '#888'}
            />
            <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {activeTab === 'overview' && renderOverview()}
        {activeTab === 'orders' && renderOrders()}
        {activeTab === 'products' && renderProducts()}
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

function StatCard({ icon, label, value, change, color }: {
  icon: string; label: string; value: string; change: string; color: string;
}) {
  return (
    <View style={[styles.statCard, { borderLeftColor: color }]}>
      <Ionicons name={icon as any} size={20} color={color} />
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={[styles.statChange, { color }]}>{change}</Text>
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
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#00d4ff',
    marginTop: 4,
  },
  tabsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 8,
    marginBottom: 16,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#0a0a1a',
    gap: 6,
  },
  tabActive: {
    backgroundColor: '#00d4ff20',
    borderWidth: 1,
    borderColor: '#00d4ff40',
  },
  tabText: {
    color: '#888',
    fontSize: 12,
  },
  tabTextActive: {
    color: '#00d4ff',
    fontWeight: '600',
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 20,
  },
  statCard: {
    width: (width - 52) / 2,
    backgroundColor: '#0a0a1a',
    borderRadius: 12,
    padding: 14,
    borderLeftWidth: 3,
  },
  statLabel: {
    fontSize: 12,
    color: '#888',
    marginTop: 8,
  },
  statValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 4,
  },
  statChange: {
    fontSize: 12,
    marginTop: 4,
  },
  chartCard: {
    backgroundColor: '#0a0a1a',
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
  },
  chartTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 16,
    textAlign: 'right',
  },
  chartBars: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: 100,
    paddingBottom: 20,
  },
  barContainer: {
    alignItems: 'center',
    flex: 1,
  },
  bar: {
    width: 24,
    borderRadius: 4,
  },
  barLabel: {
    color: '#888',
    fontSize: 10,
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 12,
    marginTop: 8,
    textAlign: 'right',
  },
  orderCard: {
    backgroundColor: '#0a0a1a',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  orderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  orderId: {
    color: '#00d4ff',
    fontWeight: '600',
    fontSize: 14,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  orderDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  orderCustomer: {
    color: '#fff',
    fontSize: 14,
  },
  orderTotal: {
    color: '#4ECDC4',
    fontWeight: '600',
  },
  orderTime: {
    color: '#888',
    fontSize: 12,
  },
  productCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0a0a1a',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  productInfo: {
    flex: 1,
  },
  productName: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '500',
  },
  productPrice: {
    color: '#4ECDC4',
    marginTop: 4,
  },
  productStats: {
    flexDirection: 'row',
    gap: 16,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statText: {
    color: '#888',
    fontSize: 13,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#00d4ff',
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 10,
    gap: 8,
  },
  addButtonText: {
    color: '#000',
    fontWeight: '600',
    fontSize: 15,
  },
});
