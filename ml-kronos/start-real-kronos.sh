#!/bin/bash

# Kronos AI Prediction Engine startup script for launchd
# This script starts the Kronos prediction service

echo "🚀 Starting Kronos AI Prediction Engine..."
echo "=========================================="

# Set working directory
cd /Users/liao/a-stock-analysis-platform/ml-kronos

# Check if Python virtual environment exists
if [ ! -d ".venv" ]; then
    echo "❌ Virtual environment not found, creating..."
    python3 -m venv .venv
    if [ $? -ne 0 ]; then
        echo "❌ Failed to create virtual environment"
        exit 1
    fi
fi

# Activate virtual environment
echo "🔧 Activating virtual environment..."
source .venv/bin/activate

# Check if dependencies are installed
echo "📦 Checking dependencies..."
if ! python3 -c "import torch, transformers, pandas, numpy" &> /dev/null; then
    echo "⚠️  Missing dependencies, installing..."
    python3 -m pip install -r requirements.txt
    if [ $? -ne 0 ]; then
        echo "❌ Dependencies installation failed"
        exit 1
    fi
    echo "✅ Dependencies installation completed"
else
    echo "✅ All dependencies installed"
fi

# Start the prediction service
echo "🤖 Starting Kronos prediction service..."
echo "Service will run in background"
echo ""

# Start the webui service
cd webui
python3 app.py
