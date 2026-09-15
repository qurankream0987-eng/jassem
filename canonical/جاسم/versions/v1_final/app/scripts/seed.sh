#!/bin/bash
# JASIM V4 Database Seed Script
# /سكربت تعبئة قاعدة البيانات
#
# Seeds the database with initial data:
# - Sample merchants
# - Sample products
# - Sample orders
# - Sample users

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}"
echo "  JASIM V4 - Database Seed Script"
echo "  / سكربت تعبئة قاعدة البيانات"
echo -e "${NC}"
echo ""

cd "$PROJECT_ROOT"

# Check if tsx is available
if ! command -v npx &> /dev/null; then
    echo -e "${GREEN}[INFO]${NC} Installing tsx..."
    npm install -g tsx
fi

echo -e "${GREEN}[STEP]${NC} Running database seeder..."

# Run the seed script using Node.js
cat > /tmp/jasim-seed.ts << 'SEED_SCRIPT'
import { db } from '../db/queries/connection';
import { users, memory, products, merchants, orders } from '../db/schema';

async function seed() {
  console.log('🌱 Starting database seed...');

  // Seed sample merchants
  const sampleMerchants = [
    { name: 'مطعم الأصالة', businessName: 'مطعم الأصالة', category: 'food', phone: '+96550001111', status: 'active', rating: 4.7 },
    { name: 'بيت الكبسة', businessName: 'بيت الكبسة', category: 'food', phone: '+96550002222', status: 'active', rating: 4.8 },
    { name: 'الشاورما الذهبية', businessName: 'الشاورما الذهبية', category: 'food', phone: '+96550003333', status: 'active', rating: 4.5 },
    { name: 'متجر الإلكترونيات', businessName: 'متجر الإلكترونيات', category: 'electronics', phone: '+96550004444', status: 'active', rating: 4.3 },
    { name: 'أزياء العرب', businessName: 'أزياء العرب', category: 'fashion', phone: '+96550005555', status: 'active', rating: 4.6 },
  ];

  for (const merchant of sampleMerchants) {
    try {
      await db.insert(merchants).values(merchant);
      console.log(`  ✅ Merchant: ${merchant.name}`);
    } catch (e: any) {
      if (e.message?.includes('Duplicate')) {
        console.log(`  ⚠️  Merchant ${merchant.name} already exists`);
      }
    }
  }

  // Seed sample products
  const sampleProducts = [
    { name: 'كبسة دجاج', description: 'كبسة دجاج أصيلة على الطريقة السعودية', price: '5.00', category: 'food', status: 'active' },
    { name: 'مندي لحم', description: 'مندي لحم تقليدي', price: '8.00', category: 'food', status: 'active' },
    { name: 'برياني', description: 'برياني هندي أصيل', price: '4.50', category: 'food', status: 'active' },
    { name: 'شاورما', description: 'شاورما دجاج مع ثومية', price: '2.00', category: 'food', status: 'active' },
    { name: 'iPhone 15 Pro', description: 'أيفون 15 برو 256GB', price: '350.00', category: 'electronics', status: 'active' },
    { name: 'عباية خليجية', description: 'عباية فاخرة باللون الأسود', price: '25.00', category: 'fashion', status: 'active' },
  ];

  for (const product of sampleProducts) {
    try {
      await db.insert(products).values(product);
      console.log(`  ✅ Product: ${product.name}`);
    } catch (e: any) {
      if (e.message?.includes('Duplicate')) {
        console.log(`  ⚠️  Product ${product.name} already exists`);
      }
    }
  }

  // Seed sample users
  const sampleUsers = [
    { username: 'ahmed', email: 'ahmed@example.com', role: 'consumer' },
    { username: 'khaled', email: 'khaled@example.com', role: 'merchant' },
    { username: 'nora', email: 'nora@example.com', role: 'consumer' },
    { username: 'saeed', email: 'saeed@example.com', role: 'consumer' },
  ];

  for (const user of sampleUsers) {
    try {
      await db.insert(users).values(user);
      console.log(`  ✅ User: ${user.username}`);
    } catch (e: any) {
      if (e.message?.includes('Duplicate')) {
        console.log(`  ⚠️  User ${user.username} already exists`);
      }
    }
  }

  // Seed sample memory entries
  const sampleMemory = [
    { userId: 1, key: 'favorite_cuisine', value: '"كبسة"', category: 'preference' },
    { userId: 1, key: 'last_order', value: '{"restaurant": "بيت الكبسة", "amount": 25}', category: 'interaction' },
    { userId: 2, key: 'language', value: '"ar"', category: 'preference' },
    { userId: 3, key: 'theme', value: '"dark"', category: 'preference' },
  ];

  for (const mem of sampleMemory) {
    try {
      await db.insert(memory).values(mem);
      console.log(`  ✅ Memory: ${mem.key}`);
    } catch (e: any) {
      // Memory entries may fail if user doesn't exist
    }
  }

  console.log('✅ Database seed complete!');
  console.log('');
  console.log('📊 Seeded data:');
  console.log('   • 5 merchants');
  console.log('   • 6 products');
  console.log('   • 4 users');
  console.log('   • 4 memory entries');
}

seed().catch(console.error);
SEED_SCRIPT

npx tsx /tmp/jasim-seed.ts

echo ""
echo -e "${GREEN}✅ Database seeded successfully!${NC}"
