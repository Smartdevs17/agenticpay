#!/bin/bash
# Sandbox Setup Script
# Sets up sandbox environment for local development and testing

set -e

echo "🚀 Starting AgenticPay Sandbox Setup..."

# ── Create directories ─────────────────────────────────────────────────────────
echo "📁 Creating sandbox directories..."
mkdir -p sandbox/{data,logs,reports}

# ── Environment setup ──────────────────────────────────────────────────────────
echo "🔧 Setting up environment..."

if [ ! -f .env.sandbox ]; then
    echo "📝 Creating .env.sandbox from template..."
    cp .env.sandbox.example .env.sandbox
    echo "⚠️  Please edit .env.sandbox with your configuration"
else
    echo "✓ .env.sandbox already exists"
fi

# ── Backend setup ──────────────────────────────────────────────────────────────
if [ -d "backend" ]; then
    echo "📦 Setting up backend..."
    cd backend
    
    if [ ! -d "node_modules" ]; then
        echo "📥 Installing dependencies..."
        npm ci
    fi
    
    # Build if not already built
    if [ ! -d "dist" ]; then
        echo "🏗️  Building backend..."
        npm run build
    fi
    
    cd ..
fi

# ── Frontend setup ────────────────────────────────────────────────────────────
if [ -d "frontend" ]; then
    echo "📦 Setting up frontend..."
    cd frontend
    
    if [ ! -d "node_modules" ]; then
        echo "📥 Installing dependencies..."
        npm ci
    fi
    
    # Build Next.js cache
    if [ ! -d ".next" ]; then
        echo "🏗️  Building frontend..."
        npm run build || true
    fi
    
    cd ..
fi

# ── Database initialization (optional) ──────────────────────────────────────────
if command -v docker &> /dev/null; then
    echo "🐳 Docker detected - you can start services with:"
    echo "   docker-compose -f docker-compose.sandbox.yml up -d"
fi

# ── Create API playground symlink ──────────────────────────────────────────────
if [ ! -L "frontend/public/playground" ]; then
    echo "🎮 Creating API playground symlink..."
    ln -s ../../backend/docs/api/explorer frontend/public/playground || true
fi

# ── Generate initial API docs ──────────────────────────────────────────────────
if [ -f "backend/scripts/generate-openapi.ts" ]; then
    echo "📋 Generating API documentation..."
    cd backend
    npx ts-node scripts/generate-openapi.ts || true
    cd ..
fi

# ── Display startup instructions ───────────────────────────────────────────────
echo ""
echo "✨ Sandbox setup complete!"
echo ""
echo "🎯 Next steps:"
echo "   1. Update .env.sandbox with your credentials"
echo "   2. Start backend: cd backend && npm run dev"
echo "   3. Start frontend: cd frontend && npm run dev"
echo "   4. Open browser: http://localhost:3000"
echo "   5. API Playground: http://localhost:3000/api/docs"
echo ""
echo "📚 Documentation:"
echo "   - Sandbox Guide: ./docs/SANDBOX.md"
echo "   - API Docs: ./backend/docs/api/INDEX.md"
echo "   - OpenAPI Spec: ./backend/docs/api/openapi/openapi.json"
echo ""
