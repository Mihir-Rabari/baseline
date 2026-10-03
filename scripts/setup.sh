#!/usr/bin/env bash
# ==============================================================================
# Production Starter - Cross-Platform Bash Setup Script
# ==============================================================================
set -e

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "\n${CYAN}🚀 Initializing Production Starter Setup...${NC}"
echo -e "${CYAN}=================================================${NC}"

# 1. Detect Node.js
echo -e "\n${YELLOW}[1/12] Checking Node.js runtime...${NC}"
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js is not installed or not in PATH. Please install Node.js >= 18.${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Detected Node.js: $(node -v)${NC}"

# 2. Check Corepack
echo -e "\n${YELLOW}[2/12] Checking Corepack & Package Manager...${NC}"
if command -v corepack &> /dev/null; then
    echo -e "${GREEN}✅ Corepack detected.${NC}"
    corepack enable 2>/dev/null || true
else
    echo -e "ℹ️ Corepack not found, continuing with direct pnpm verification."
fi

# 3. Ensure pnpm is available
echo -e "\n${YELLOW}[3/12] Verifying pnpm...${NC}"
if ! command -v pnpm &> /dev/null; then
    echo -e "${RED}❌ pnpm is not found. Please install pnpm or enable it via corepack.${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Detected pnpm: $(pnpm -v)${NC}"

# 4. Detect Docker
echo -e "\n${YELLOW}[4/12] Checking Docker daemon...${NC}"
DOCKER_RUNNING=false
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker is not installed or not in PATH.${NC}"
    exit 1
fi
if docker info &> /dev/null; then
    echo -e "${GREEN}✅ Docker daemon is running.${NC}"
    DOCKER_RUNNING=true
else
    echo -e "${YELLOW}⚠️ Docker daemon is not running. Please start Docker to launch local infrastructure.${NC}"
fi

# 5. Detect Docker Compose
echo -e "\n${YELLOW}[5/12] Checking Docker Compose...${NC}"
if ! docker compose version &> /dev/null; then
    echo -e "${RED}❌ Docker Compose v2 is required.${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Docker Compose is available.${NC}"

# 6. Environment configuration (.env)
echo -e "\n${YELLOW}[6/12] Checking environment configuration (.env)...${NC}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

if [ -f "$ROOT_DIR/.env" ]; then
    echo -e "${GREEN}✅ Existing .env file found. Preserving current configuration.${NC}"
else
    if [ -f "$ROOT_DIR/.env.example" ]; then
        cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
        echo -e "${GREEN}✅ Created .env from .env.example with local development defaults.${NC}"
    else
        echo -e "${YELLOW}⚠️ .env.example not found.${NC}"
    fi
fi

# 7. Install Dependencies
echo -e "\n${YELLOW}[7/12] Installing monorepo workspace dependencies...${NC}"
cd "$ROOT_DIR"
pnpm install
echo -e "${GREEN}✅ Dependencies installed successfully.${NC}"

# 8. Start Infrastructure
echo -e "\n${YELLOW}[8/12] Starting Docker infrastructure (PostgreSQL, Redis, MinIO, Prometheus, Grafana)...${NC}"
if [ "$DOCKER_RUNNING" = true ]; then
    docker compose up -d
    echo -e "${GREEN}✅ Infrastructure containers launched.${NC}"

    # 9. Wait for Infrastructure Health
    echo -e "\n${YELLOW}[9/12] Waiting for PostgreSQL to be healthy...${NC}"
    ATTEMPTS=0
    MAX_ATTEMPTS=30
    POSTGRES_READY=false

    while [ $ATTEMPTS -lt $MAX_ATTEMPTS ]; do
        ATTEMPTS=$((ATTEMPTS+1))
        echo -n "."
        sleep 1
        STATUS=$(docker inspect --format="{{.State.Health.Status}}" app-postgres 2>/dev/null || echo "")
        if [ "$STATUS" = "healthy" ]; then
            POSTGRES_READY=true
            break
        fi
    done
    echo ""

    if [ "$POSTGRES_READY" = true ]; then
        echo -e "${GREEN}✅ PostgreSQL is ready and healthy.${NC}"
    else
        echo -e "${YELLOW}⚠️ PostgreSQL did not reach healthy state in 30s. Proceeding with setup...${NC}"
    fi

    # 10. Run Database Migrations
    echo -e "\n${YELLOW}[10/12] Applying database migrations...${NC}"
    pnpm db:migrate || echo -e "${YELLOW}⚠️ Migration step failed or postponed. Retry with 'pnpm db:migrate'.${NC}"

    # 11. Run Seeds
    echo -e "\n${YELLOW}[11/12] Seeding initial database records...${NC}"
    pnpm db:seed || echo -e "${YELLOW}⚠️ Seed step failed or postponed. Retry with 'pnpm db:seed'.${NC}"
else
    echo -e "ℹ️ Skipping container startup and database migration until Docker is started."
    echo -e "   Once Docker is running, execute: 'pnpm infra:up' followed by 'pnpm db:migrate' and 'pnpm db:seed'."
fi

# 12. Run Health Verification
echo -e "\n${YELLOW}[12/12] Verifying infrastructure health...${NC}"
pnpm health || true

echo -e "\n${CYAN}=================================================${NC}"
echo -e "${GREEN}🎉 Setup Completed Successfully!${NC}"
echo -e "${CYAN}=================================================${NC}"
echo -e "Local Endpoints:"
echo -e "  • Frontend Web App:     ${CYAN}http://localhost:3000${NC}"
echo -e "  • Backend API Gateway:  ${CYAN}http://localhost:3001${NC}"
echo -e "  • OpenAPI Documentation:${CYAN}http://localhost:3001/api/docs${NC}"
echo -e "  • MinIO S3 Console:     ${CYAN}http://localhost:9001 (minioadmin / minioadmin)${NC}"
echo -e "  • Prometheus Metrics:   ${CYAN}http://localhost:9090${NC}"
echo -e "  • Grafana Dashboards:   ${CYAN}http://localhost:3002 (admin / admin)${NC}"
echo -e "\nNext Steps:"
echo -e "  Run '${YELLOW}pnpm dev${NC}' to start both Next.js and Fastify concurrently."
echo -e "${CYAN}=================================================\n${NC}"
