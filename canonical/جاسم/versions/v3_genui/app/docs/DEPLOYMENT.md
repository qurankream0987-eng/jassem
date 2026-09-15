# JASIM V4 Deployment Guide
# / دليل النشر

## Overview / نظرة عامة

This guide covers deployment options for JASIM V4:
1. **Replit** (Primary) - Cloud-based development and hosting
2. **CI/CD via GitHub Actions** - Automated testing and deployment
3. **Mobile via EAS** - Expo Application Services for iOS/Android

---

## Table of Contents

1. [Deployment Environments](#environments)
2. [Replit Deployment](#replit)
3. [CI/CD Pipeline](#cicd)
4. [Mobile Deployment](#mobile)
5. [Database Migration](#database)
6. [Monitoring](#monitoring)
7. [Rollback](#rollback)

---

## Environments / البيئات

| Environment | URL | Purpose | Auto-Deploy |
|-------------|-----|---------|-------------|
| Local | http://localhost:3000 | Development | Manual |
| Staging | https://staging.jasim.app | Testing | On push to `main` |
| Production | https://jasim.app | Live | After staging passes |

---

## Replit Deployment / النشر على Replit

### Prerequisites
- Replit account with Core/Teams plan
- Environment secrets configured

### Steps

1. **Import from GitHub:**
   ```
   Replit Dashboard → Create → Import from GitHub
   ```

2. **Configure Environment:**
   ```bash
   # In Replit Secrets panel, add:
   DATABASE_URL=mysql://...
   JWT_SECRET=...
   NODE_ENV=production
   ```

3. **Run Deploy Script:**
   ```bash
   bash scripts/deploy.sh production
   ```

4. **Verify Deployment:**
   ```bash
   curl https://jasim.app/health
   # Expected: {"status":"ok","version":"4.0.0"}
   ```

---

## CI/CD Pipeline / خط الأنابيب

### GitHub Actions Workflows

#### 1. CI Pipeline (`.github/workflows/ci.yml`)

Triggers: Push to any branch, Pull request

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  Lint &  │ ──▶ │   Test   │ ──▶ │   Test   │ ──▶ │  Build   │
│ TypeCheck│     │ (Coverage)│    │ 25 Routers│    │          │
└──────────┘     └──────────┘     └──────────┘     └──────────┘
                                                        │
                              (only on main branch)    ▼
                                                  ┌──────────┐
                                                  │  Deploy  │
                                                  │  Replit  │
                                                  └──────────┘
```

**Jobs:**
- `lint` - ESLint + TypeScript + Prettier
- `test` - Full test suite with coverage
- `test-routers` - Individual router validation
- `build` - Frontend + Backend build
- `mobile-check` - Mobile app type check
- `security` - npm audit + CodeQL scan
- `deploy` - Production deployment (main only)

#### 2. CD Pipeline (`.github/workflows/deploy.yml`)

Triggers: Push to main, Manual dispatch

```
┌──────────┐     ┌──────────┐     ┌──────────┐
│  Staging │ ──▶ │   Smoke  │ ──▶ │Production│
│  Deploy  │     │  Tests   │     │  Deploy  │
└──────────┘     └──────────┘     └──────────┘
                                          │
                                          ▼
                                   ┌──────────┐
                                   │  Mobile  │
                                   │  Deploy  │
                                   └──────────┘
```

### Setting Up GitHub Actions

1. **Repository Settings:**
   - Go to `Settings → Secrets and variables → Actions`
   - Add the following secrets:
     - `EXPO_TOKEN` - Expo access token
     - `DATABASE_URL` - Production database URL
     - `JWT_SECRET` - JWT signing secret

2. **Branch Protection:**
   - Go to `Settings → Branches`
   - Add rule for `main`:
     - Require pull request reviews
     - Require status checks to pass (CI)
     - Require branches to be up to date

---

## Mobile Deployment / نشر تطبيق الجوال

### EAS Build Configuration

The `eas.json` file defines build profiles:

```json
{
  "build": {
    "development": { /* Development builds */ },
    "preview": { /* Internal distribution */ },
    "production": { /* Store builds */ }
  }
}
```

### Building for Android

```bash
cd mobile

# Development APK
eas build --platform android --profile development

# Preview (internal distribution)
eas build --platform android --profile preview

# Production AAB (for Google Play)
eas build --platform android --profile production
```

### Building for iOS

```bash
cd mobile

# Development (simulator)
eas build --platform ios --profile development

# Preview (device)
eas build --platform ios --profile preview

# Production (App Store)
eas build --platform ios --profile production
```

### Submitting to App Stores

```bash
# Google Play
eas submit --platform android --profile production

# App Store
eas submit --platform ios --profile production
```

---

## Database Migration / ترحيل قاعدة البيانات

### Migration Strategy

1. **Generate Migration:**
   ```bash
   npm run db:generate
   ```

2. **Review Migration:**
   ```bash
   cat db/migrations/*.sql
   ```

3. **Apply Migration:**
   ```bash
   npm run db:migrate
   ```

4. **Verify:**
   ```bash
   npm run db:check
   ```

### Zero-Downtime Migration

For production deployments:

1. Create migration in development
2. Test on staging environment
3. Apply with `db:migrate` during low-traffic period
4. Verify with health checks
5. Deploy application code

---

## Monitoring / المراقبة

### Health Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Application health check |
| `/health/db` | GET | Database connectivity |
| `/health/ai` | GET | AI services status |

### Metrics

Key metrics to monitor:
- **Response Time:** Target < 200ms for intent parsing
- **Error Rate:** Target < 1%
- **Throughput:** Requests per second
- **Agent Accuracy:** Intent classification accuracy

### Log Format

```json
{
  "timestamp": "2024-01-15T10:00:00Z",
  "level": "info",
  "service": "jasim-v4",
  "requestId": "req_123",
  "intent": "food_order",
  "confidence": 0.95,
  "latency": 45,
  "market": "KW"
}
```

---

## Rollback / التراجع

### Quick Rollback

```bash
# Rollback to previous deployment
git log --oneline -10

# Revert to specific commit
git revert <commit-hash>

# Re-deploy
bash scripts/deploy.sh production
```

### Database Rollback

```bash
# List migrations
npx drizzle-kit check

# Rollback specific migration
# (Use raw SQL or create reverse migration)
```

---

## Checklist / قائمة التحقق

### Pre-Deployment
- [ ] All tests passing (50+ unit, 4 integration, 2 E2E)
- [ ] TypeScript compilation successful
- [ ] Lint checks passing
- [ ] Security audit clean
- [ ] Database migrations reviewed
- [ ] Environment variables configured

### Post-Deployment
- [ ] Health check passing
- [ ] Smoke tests successful
- [ ] API endpoints responding
- [ ] Mobile app connecting
- [ ] Monitoring dashboards updated
- [ ] Team notified

---

## Contact / التواصل

For deployment issues:
- DevOps: devops@jasim.app
- Emergency: +965-XXXX-XXXX

---

*JASIM V4 Deployment Guide / دليل النشر*
*Last Updated: 2024*
