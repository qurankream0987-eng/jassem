# JASIM V4 Setup Guide
# / دليل الإعداد

## Prerequisites / المتطلبات

- Node.js 20+ (`node -v`)
- npm 10+ (`npm -v`)
- Git (`git --version`)
- MySQL 8+ or compatible

---

## Quick Start / البدء السريع

### 1. Clone Repository / استنساخ المستودع

```bash
git clone <repository-url>
cd app-v4-deployment
```

### 2. Install Dependencies / تثبيت الاعتماديات

```bash
npm ci
```

### 3. Configure Environment / إعداد البيئة

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```env
# Database
DATABASE_URL=mysql://user:password@localhost:3306/jasim_v4

# Authentication
JWT_SECRET=your-super-secret-key-here

# AWS S3 (for file uploads)
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=me-south-1
S3_BUCKET=jasim-v4-uploads

# AI Services
OPENAI_API_KEY=your-openai-key
ELEVENLABS_API_KEY=your-elevenlabs-key

# Payment Gateway
PAYMENT_GATEWAY_URL=https://payment.knet.com

# Market Configuration
DEFAULT_MARKET=KW
SUPPORTED_MARKETS=KW,SA,AE,QA,BH,OM
```

### 4. Setup Database / إعداد قاعدة البيانات

```bash
# Generate migrations
npm run db:generate

# Push migrations
npm run db:push

# Seed sample data (optional)
bash scripts/seed.sh
```

### 5. Run Development Server / تشغيل خادم التطوير

```bash
npm run dev
```

The application will be available at:
- **Frontend:** http://localhost:5173
- **API:** http://localhost:3000
- **tRPC Playground:** http://localhost:3000/api/trpc

---

## Mobile App Setup / إعداد تطبيق الجوال

### Prerequisites
- Expo CLI: `npm install -g expo-cli`
- EAS CLI: `npm install -g eas-cli`
- Android Studio (for Android emulator)
- Xcode (for iOS simulator, macOS only)

### Setup

```bash
cd mobile

# Install dependencies
npm install

# Start Expo development server
npx expo start

# Run on Android emulator
npx expo start --android

# Run on iOS simulator
npx expo start --ios
```

---

## Development Workflow / سير العمل

### Running Tests / تشغيل الاختبارات

```bash
# Run all tests
npm test

# Run with coverage
npm test -- --coverage

# Run specific test files
npx vitest run tests/unit/intent-parser.test.ts
npx vitest run tests/integration/order-flow.test.ts

# Run in watch mode
npx vitest
```

### Linting & Formatting / التنسيق والفحص

```bash
# Run ESLint
npm run lint

# Fix ESLint issues
npm run lint -- --fix

# Run TypeScript check
npm run check

# Format code
npm run format
```

### Database Operations / عمليات قاعدة البيانات

```bash
# Generate migration
npm run db:generate

# Run migration
npm run db:migrate

# Push schema changes (development)
npm run db:push
```

---

## Project Structure / هيكل المشروع

```
app-v4-deployment/
├── api/                    # Backend API
│   ├── core/               # Core AI engine
│   │   ├── intent-parser.ts     # NLP intent parsing
│   │   ├── memory-engine.ts     # Vector memory
│   │   ├── agent-router.ts      # Agent routing
│   │   └── types.ts             # Core types
│   ├── routers/            # tRPC routers (25)
│   │   ├── agents.ts
│   │   ├── orders.ts
│   │   ├── payments.ts
│   │   ├── zakat.ts
│   │   └── ...
│   ├── trpc.ts             # tRPC setup
│   └── boot.ts             # Server entry
├── db/                     # Database
│   ├── schema.ts           # Drizzle schema
│   ├── queries/            # Query helpers
│   └── seed.ts             # Seed data
├── contracts/              # Shared types
│   ├── types.ts
│   └── constants.ts
├── tests/                  # Test suites
│   ├── unit/               # Unit tests
│   ├── integration/        # Integration tests
│   └── e2e/                # E2E tests
├── mobile/                 # React Native app
│   ├── src/
│   │   ├── screens/        # App screens
│   │   ├── components/     # UI components
│   │   ├── hooks/          # Custom hooks
│   │   └── providers/      # Context providers
│   ├── App.tsx
│   └── package.json
├── docs/                   # Documentation
│   ├── API.md              # API docs
│   ├── SETUP.md            # This file
│   └── DEPLOYMENT.md       # Deployment guide
├── scripts/                # Utility scripts
│   ├── deploy.sh
│   └── seed.sh
└── .github/
    └── workflows/          # CI/CD pipelines
        ├── ci.yml
        └── deploy.yml
```

---

## Environment Variables / متغيرات البيئة

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | MySQL connection string |
| `JWT_SECRET` | Yes | JWT signing secret |
| `AWS_ACCESS_KEY_ID` | No | AWS access key |
| `AWS_SECRET_ACCESS_KEY` | No | AWS secret key |
| `S3_BUCKET` | No | S3 bucket name |
| `OPENAI_API_KEY` | No | OpenAI API key |
| `DEFAULT_MARKET` | No | Default market (KW) |
| `NODE_ENV` | No | Environment mode |

---

## Troubleshooting / حل المشكلات

### Common Issues

**Port 3000 already in use:**
```bash
# Find and kill process
lsof -i :3000
kill -9 <PID>
```

**Database connection failed:**
```bash
# Verify MySQL is running
mysql -u root -p -e "SHOW DATABASES;"

# Create database if not exists
mysql -u root -p -e "CREATE DATABASE jasim_v4;"
```

**Node modules issues:**
```bash
rm -rf node_modules package-lock.json
npm ci
```

---

## Support / الدعم

For issues and questions:
- Email: support@jasim.app
- GitHub Issues: [repository-url]/issues

---

*JASIM V4 - Setup Guide / دليل الإعداد*
