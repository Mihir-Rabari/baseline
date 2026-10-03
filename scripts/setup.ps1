# ==============================================================================
# Production Starter - Cross-Platform PowerShell Setup Script
# ==============================================================================

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host ">>> Initializing Production Starter Setup..." -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan

# 1. Detect Node.js
Write-Host ""
Write-Host "[1/12] Checking Node.js runtime..." -ForegroundColor Yellow
$nodeCmd = Get-Command "node" -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Host "[ERROR] Node.js is not installed or not in PATH. Please install Node.js >= 18." -ForegroundColor Red
    exit 1
}
$nodeVersion = node -v
Write-Host "[OK] Detected Node.js: $nodeVersion" -ForegroundColor Green

# 2. Check Corepack / pnpm
Write-Host ""
Write-Host "[2/12] Checking Corepack & Package Manager..." -ForegroundColor Yellow
$corepackCmd = Get-Command "corepack" -ErrorAction SilentlyContinue
if ($corepackCmd) {
    Write-Host "[OK] Corepack detected." -ForegroundColor Green
    try {
        corepack enable
    } catch {
        Write-Host "[INFO] Corepack enable requires elevation or is already configured." -ForegroundColor Gray
    }
} else {
    Write-Host "[INFO] Corepack not found, continuing with direct pnpm verification." -ForegroundColor Gray
}

# 3. Ensure pnpm is available
Write-Host ""
Write-Host "[3/12] Verifying pnpm..." -ForegroundColor Yellow
$pnpmCmd = Get-Command "pnpm" -ErrorAction SilentlyContinue
if (-not $pnpmCmd) {
    Write-Host "[ERROR] pnpm is not found. Please enable it via corepack or install globally." -ForegroundColor Red
    exit 1
}
$pnpmVersion = pnpm -v
Write-Host "[OK] Detected pnpm: $pnpmVersion" -ForegroundColor Green

# 4. Detect Docker
Write-Host ""
Write-Host "[4/12] Checking Docker daemon..." -ForegroundColor Yellow
$dockerCmd = Get-Command "docker" -ErrorAction SilentlyContinue
if (-not $dockerCmd) {
    Write-Host "[ERROR] Docker is not installed or not in PATH." -ForegroundColor Red
    exit 1
}

$dockerRunning = $false
try {
    $dockerInfo = docker info 2>&1
    if ($LASTEXITCODE -eq 0) {
        $dockerRunning = $true
        Write-Host "[OK] Docker daemon is running." -ForegroundColor Green
    } else {
        Write-Host "[WARN] Docker daemon is not running. Please start Docker Desktop to run local infrastructure." -ForegroundColor Yellow
    }
} catch {
    Write-Host "[WARN] Docker daemon is unreachable. Please start Docker Desktop." -ForegroundColor Yellow
}

# 5. Detect Docker Compose
Write-Host ""
Write-Host "[5/12] Checking Docker Compose..." -ForegroundColor Yellow
try {
    $composeVersion = docker compose version 2>&1
    Write-Host "[OK] Docker Compose is available." -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Docker Compose v2 is required." -ForegroundColor Red
    exit 1
}

# 6. Environment configuration (.env)
Write-Host ""
Write-Host "[6/12] Checking environment configuration (.env)..." -ForegroundColor Yellow
$rootPath = Resolve-Path (Join-Path $PSScriptRoot "..")
$envPath = Join-Path $rootPath ".env"
$envExamplePath = Join-Path $rootPath ".env.example"

if (Test-Path $envPath) {
    Write-Host "[OK] Existing .env file found. Preserving current configuration." -ForegroundColor Green
} else {
    if (Test-Path $envExamplePath) {
        Copy-Item $envExamplePath $envPath
        Write-Host "[OK] Created .env from .env.example with local development defaults." -ForegroundColor Green
    } else {
        Write-Host "[WARN] .env.example not found. Please create .env manually." -ForegroundColor Yellow
    }
}

# 7. Install Dependencies
Write-Host ""
Write-Host "[7/12] Installing monorepo workspace dependencies..." -ForegroundColor Yellow
pnpm install
Write-Host "[OK] Dependencies installed successfully." -ForegroundColor Green

# 8. Start Infrastructure (if Docker is active)
Write-Host ""
Write-Host "[8/12] Starting Docker infrastructure (PostgreSQL, Redis, MinIO, Prometheus, Grafana)..." -ForegroundColor Yellow
if ($dockerRunning) {
    docker compose up -d
    Write-Host "[OK] Infrastructure containers launched." -ForegroundColor Green

    # 9. Wait for Infrastructure Health
    Write-Host ""
    Write-Host "[9/12] Waiting for PostgreSQL to be healthy..." -ForegroundColor Yellow
    $maxAttempts = 30
    $attempt = 0
    $postgresReady = $false

    while ($attempt -lt $maxAttempts) {
        $attempt++
        Write-Host -NoNewline "."
        Start-Sleep -Seconds 1
        
        $pgHealth = docker inspect --format="{{.State.Health.Status}}" app-postgres 2>$null
        if ($pgHealth -eq "healthy") {
            $postgresReady = $true
            break
        }
    }
    Write-Host ""

    if ($postgresReady) {
        Write-Host "[OK] PostgreSQL is ready and healthy." -ForegroundColor Green
    } else {
        Write-Host "[WARN] PostgreSQL did not reach healthy state within 30s. Continuing setup..." -ForegroundColor Yellow
    }

    # 10. Run Database Migrations
    Write-Host ""
    Write-Host "[10/12] Applying database migrations..." -ForegroundColor Yellow
    try {
        pnpm db:migrate
        Write-Host "[OK] Database migrations applied." -ForegroundColor Green
    } catch {
        Write-Host "[WARN] Migration step encountered an issue. Retry with 'pnpm db:migrate'." -ForegroundColor Yellow
    }

    # 11. Run Deterministic Seeds
    Write-Host ""
    Write-Host "[11/12] Seeding initial database records..." -ForegroundColor Yellow
    try {
        pnpm db:seed
        Write-Host "[OK] Database seed completed." -ForegroundColor Green
    } catch {
        Write-Host "[WARN] Seed step encountered an issue. Retry with 'pnpm db:seed'." -ForegroundColor Yellow
    }
} else {
    Write-Host "[INFO] Skipping container startup and database migration until Docker Desktop is started." -ForegroundColor Gray
    Write-Host "       Once Docker is running, execute: 'pnpm infra:up' followed by 'pnpm db:migrate' and 'pnpm db:seed'." -ForegroundColor Gray
}

# 12. Run Health Verification & Print Summary
Write-Host ""
Write-Host "[12/12] Verifying infrastructure health..." -ForegroundColor Yellow
try {
    pnpm health
} catch {
    Write-Host "[INFO] Health check probe finished." -ForegroundColor Gray
}

Write-Host ""
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "Production Starter Setup Flow Completed!" -ForegroundColor Green
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "Local Endpoints:" -ForegroundColor White
Write-Host "  - Frontend Web App:      http://localhost:3000" -ForegroundColor Cyan
Write-Host "  - Backend API Gateway:   http://localhost:3001" -ForegroundColor Cyan
Write-Host "  - OpenAPI Documentation: http://localhost:3001/api/docs" -ForegroundColor Cyan
Write-Host "  - MinIO S3 Console:      http://localhost:9001 (minioadmin / minioadmin)" -ForegroundColor Cyan
Write-Host "  - Prometheus Metrics:    http://localhost:9090" -ForegroundColor Cyan
Write-Host "  - Grafana Dashboards:    http://localhost:3002 (admin / admin)" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor White
Write-Host "  Run 'pnpm dev' to start both Next.js and Fastify concurrently." -ForegroundColor Yellow
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host ""
