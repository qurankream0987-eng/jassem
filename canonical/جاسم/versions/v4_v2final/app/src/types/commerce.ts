export interface CartItem {
  productId: number;
  name: string;
  price: number;
  currency: string;
  quantity: number;
  imageUrl?: string;
}

export type BusinessType =
  | "restaurant"
  | "pharmacy"
  | "clothing"
  | "grocery"
  | "electronics"
  | "salon"
  | "real_estate"
  | "workshop"
  | "bookstore"
  | "wholesale"
  | "clinic"
  | "other";

export type SubscriptionTier = "starter" | "pro" | "enterprise" | "ultimate";

export type OrderStatus =
  | "pending"
  | "confirmed"
  | "processing"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "returned";

export type PaymentStatus = "pending" | "paid" | "failed" | "refunded";

export interface Merchant {
  id: number;
  userId: number;
  businessName: string;
  businessType: BusinessType;
  crNumber?: string | null;
  licenseUrl?: string | null;
  marketCode: string;
  subscriptionTier: SubscriptionTier;
  commissionRate: number;
  isVerified: boolean;
  isActive: boolean;
  kycStatus: string;
  createdAt: Date;
  updatedAt: Date;
  isHalal?: boolean;
}

export interface Product {
  id: number;
  merchantId: number;
  name: string;
  description?: string | null;
  price: number;
  currency: string;
  category?: string | null;
  imageUrl?: string | null;
  stock: number;
  isHalal: boolean;
  barcode?: string | null;
  tags?: string[] | null;
  createdAt: Date;
  updatedAt: Date;
  merchantName?: string;
}

export interface Order {
  id: number;
  userId: number;
  merchantId: number;
  productIds: number[];
  totalAmount: number;
  commission: number;
  status: OrderStatus;
  paymentMethod?: string | null;
  paymentStatus: PaymentStatus;
  trackingNumber?: string | null;
  deliveryEta?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
