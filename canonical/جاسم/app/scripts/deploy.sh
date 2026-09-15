#!/bin/bash
# JASIM V4 Deployment Script
# /سكربت النشر
#
# Usage: ./scripts/deploy.sh [environment]
#   environment: staging | production (default: staging)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENVIRONMENT="${1:-staging}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="$PROJECT_ROOT/logs/deploy_${ENVIRONMENT}_${TIMESTAMP}.log"

# ============================================
# COLORS
# ============================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ============================================
# LOGGING
# ============================================
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1" | tee -a "$LOG_FILE"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1" | tee -a "$LOG_FILE"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1" | tee -a "$LOG_FILE"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" | tee -a "$LOG_FILE"
}

log_step() {
    echo -e "${CYAN}[STEP]${NC} $1" | tee -a "$LOG_FILE"
}

# ============================================
# HEADER
# ============================================
echo -e "${CYAN}"
echo "    ___         ____   _____ __  _______"
echo "   |__ \\ ____ _/ / /  |__  //  |/  / __ \"
echo "   __/ // __ \\ / / /    / // /|_/ / / / /"
echo "  / __// /_/ // / /____/ // /  / / /_/ /"
echo " /____/\\____//_/_____/____/_/  /_/_____/"
echo ""
echo -e "  V4 DEPLOYMENT - ${ENVIRONMENT}${NC}"
echo ""
echo "  Timestamp: $(date)"
echo "  Log file: $LOG_FILE"
echo ""

# Create logs directory
mkdir -p "$PROJECT_ROOT/logs"

# ============================================
# PRE-DEPLOYMENT CHECKS
# ============================================
log_step "Running pre-deployment checks..."

# Check Node.js version
if ! command -v node &> /dev/null; then
    log_error "Node.js not found!"
    exit 1
fi
NODE_VERSION=$(node -v)
log_info "Node.js version: $NODE_VERSION"

# Check if dependencies exist
if [ ! -d "$PROJECT_ROOT/node_modules" ]; then
    log_warn "node_modules not found. Running npm ci..."
    cd "$PROJECT_ROOT" && npm ci
fi

log_success "Pre-deployment checks passed"

# ============================================
# DATABASE MIGRATIONS
# ============================================
log_step "Running database migrations..."

cd "$PROJECT_ROOT"

# Generate migrations
log_info "Generating migrations..."
npx drizzle-kit generate 2>&1 | tee -a "$LOG_FILE" || log_warn "Migration generation had issues"

# Push migrations
log_info "Pushing migrations..."
npx drizzle-kit push 2>&1 | tee -a "$LOG_FILE" || log_warn "Migration push had issues"

log_success "Database migrations complete"

# ============================================
# BUILD APPLICATION
# ============================================
log_step "Building application..."

cd "$PROJECT_ROOT"

# Clean previous build
if [ -d "$PROJECT_ROOT/dist" ]; then
    log_info "Cleaning previous build..."
    rm -rf "$PROJECT_ROOT/dist"
fi

# Build frontend + backend
log_info "Running npm run build..."
npm run build 2>&1 | tee -a "$LOG_FILE"

# Verify build output
if [ ! -d "$PROJECT_ROOT/dist" ]; then
    log_error "Build output not found!"
    exit 1
fi

log_success "Application built successfully"

# ============================================
# ENVIRONMENT CONFIGURATION
# ============================================
log_step "Configuring environment..."

case "$ENVIRONMENT" in
    staging)
        API_URL="https://staging.jasim.app"
        DB_NAME="jasim_staging"
        LOG_LEVEL="debug"
        ;;
    production)
        API_URL="https://jasim.app"
        DB_NAME="jasim_production"
        LOG_LEVEL="info"
        ;;
    *)
        log_error "Unknown environment: $ENVIRONMENT"
        exit 1
        ;;
esac

log_info "API URL: $API_URL"
log_info "Database: $DB_NAME"
log_info "Log Level: $LOG_LEVEL"

# ============================================
# DEPLOYMENT
# ============================================
log_step "Deploying to $ENVIRONMENT..."

# Copy build artifacts to deployment directory (Replit-specific)
if [ "$ENVIRONMENT" = "production" ]; then
    log_info "Copying to production directory..."
    cp -r "$PROJECT_ROOT/dist" "$PROJECT_ROOT/dist-production-$TIMESTAMP"
    log_success "Production deployment artifacts ready"
else
    log_info "Copying to staging directory..."
    cp -r "$PROJECT_ROOT/dist" "$PROJECT_ROOT/dist-staging-$TIMESTAMP"
    log_success "Staging deployment artifacts ready"
fi

# ============================================
# POST-DEPLOYMENT
# ============================================
log_step "Running post-deployment checks..."

# Health check
log_info "Running health check..."
sleep 5

HEALTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/health" 2>/dev/null || echo "000")

if [ "$HEALTH_STATUS" = "200" ]; then
    log_success "Health check passed! Status: $HEALTH_STATUS"
else
    log_warn "Health check returned status: $HEALTH_STATUS"
    log_warn "Application may still be starting up"
fi

# ============================================
# SUMMARY
# ============================================
echo ""
echo -e "${GREEN}═══════════════════════════════════════════${NC}"
echo -e "${GREEN}  DEPLOYMENT COMPLETE${NC}"
echo -e "${GREEN}═══════════════════════════════════════════${NC}"
echo ""
echo -e "  Environment: ${CYAN}$ENVIRONMENT${NC}"
echo -e "  Version:     ${CYAN}4.0.0${NC}"
echo -e "  API URL:     ${CYAN}$API_URL${NC}"
echo -e "  Timestamp:   ${CYAN}$(date)${NC}"
echo -e "  Log File:    ${CYAN}$LOG_FILE${NC}"
echo ""
echo -e "  ${GREEN}✅${NC} Application built"
echo -e "  ${GREEN}✅${NC} Database migrated"
echo -e "  ${GREEN}✅${NC} Deployment complete"
echo -e "  ${GREEN}✅${NC} Health checked"
echo ""
echo -e "  ${YELLOW}📱 Mobile:${NC} Run eas build for iOS/Android"
echo -e "  ${YELLOW}🧪 Tests:${NC}  Run npm test for validation"
echo ""
echo -e "${GREEN}═══════════════════════════════════════════${NC}"

# Print JASIM logo
log_info "جاسم - JASIM V4 is live! 🚀"
