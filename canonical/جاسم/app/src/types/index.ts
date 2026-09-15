export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;
  avatar?: string;
  kycLevel: 'bronze' | 'silver' | 'gold' | 'diamond';
  trustScore: number;
  createdAt: Date;
}

export interface Listing {
  id: string;
  type: string;
  title: string;
  description: string;
  price: number;
  currency: string;
  images: string[];
  location: string;
  sellerId: string;
  status: 'active' | 'inactive' | 'pending' | 'sold';
  createdAt: Date;
}

export interface Transaction {
  id: string;
  buyerId: string;
  sellerId: string;
  listingId: string;
  amount: number;
  currency: string;
  status: 'pending' | 'escrow' | 'completed' | 'disputed' | 'refunded';
  createdAt: Date;
}

export interface Review {
  id: string;
  reviewerId: string;
  targetId: string;
  targetType: string;
  rating: number;
  comment: string;
  createdAt: Date;
}
