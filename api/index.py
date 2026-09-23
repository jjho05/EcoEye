"""
Vercel Serverless Entrypoint for EcoEye FastAPI Backend.
Routes /api/* and /health to the FastAPI application instance.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# Add project root to sys.path so 'ecoeye' package is discoverable
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

# On Vercel Serverless, filesystem is read-only except /tmp
if os.environ.get("VERCEL") or os.environ.get("AWS_LAMBDA_FUNCTION_NAME"):
    os.environ["ECOEYE_DB_PATH"] = "/tmp/ecoeye_local.db"

from ecoeye.server.api import create_app

# Instantiate FastAPI application for Vercel Serverless ASGI handler
app = create_app()
