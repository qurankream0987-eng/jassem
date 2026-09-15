export const APP_NAME = 'JASIM';
export const APP_VERSION = '33.1';
export const APP_DESCRIPTION = 'Unified Marketplace Platform';

export const SUPPORTED_LANGUAGES = ['ar', 'en'] as const;
export const DEFAULT_LANGUAGE = 'ar' as const;

export const CURRENCY = 'KWD' as const;
export const CURRENCY_SYMBOL = 'KD' as const;

export const KYC_LEVELS = ['bronze', 'silver', 'gold', 'diamond'] as const;

export const SUBSCRIPTION_PLANS = [
  'free',
  'express',
  'pro_seeker',
  'seller_basic',
  'seller_pro',
  'merchant_basic',
  'merchant_pro',
  'merchant_enterprise',
] as const;

export const LISTING_TYPES = [
  'product',
  'service',
  'job',
  'property',
  'bulk',
  'event',
  'vehicle',
  'furniture',
  'freelance',
  'education',
  'healthcare',
  'travel',
  'government',
  'other',
] as const;

export const AGENT_STATUS = [
  'spawning',
  'learning',
  'ready',
  'working',
  'resting',
  'evolving',
  'dormant',
] as const;

export const PLATFORM_STATUS = [
  'concept',
  'designing',
  'building',
  'testing',
  'live',
  'evolving',
  'deprecated',
] as const;

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const ALLOWED_FILE_TYPES = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
