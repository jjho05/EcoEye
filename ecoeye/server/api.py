"""
EcoEye FastAPI Local Server.

Lightweight REST API for the local edge node. Exposes:
  GET  /health          — System health and uptime
  GET  /api/v1/stats    — Telemetry counts and sync queue status
  GET  /api/v1/alerts   — Recent fall events
  GET  /api/v1/readings — Recent glucose readings
  GET  /api/v1/queue    — Sync queue statistics
  GET  /                — Dashboard HTML (for demo)

Run standalone:
    uvicorn ecoeye.server.api:app --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    from fastapi import FastAPI, HTTPException
    from fastapi.responses import HTMLResponse, JSONResponse
    from fastapi.staticfiles import StaticFiles
    _FASTAPI_AVAILABLE = True
except ImportError:
    _FASTAPI_AVAILABLE = False

from ecoeye.config import settings
from ecoeye.storage.repository import EcoEyeRepository, repository as _default_repo
from ecoeye.storage.sync_queue import SyncQueueManager

_START_TIME = time.time()


def create_app(
    repo: Optional[EcoEyeRepository] = None,
    queue_mgr: Optional[SyncQueueManager] = None,
) -> "FastAPI":
    """Factory function to create and configure the FastAPI application."""
    if not _FASTAPI_AVAILABLE:
        raise ImportError("fastapi is required — install it with: pip install fastapi uvicorn")

    _repo = repo or _default_repo
    _queue = queue_mgr or SyncQueueManager()

    app = FastAPI(
        title="EcoEye Edge API",
        description="Local REST API for the EcoEye ambient sensing edge node",
        version="1.0.0",
    )

    # ── Dashboard static files ──────────────────────────────────────────
    dashboard_dir = Path(__file__).parent.parent / "dashboard"
    if (dashboard_dir / "index.html").exists():
        app.mount(
            "/dashboard",
            StaticFiles(directory=str(dashboard_dir), html=True),
            name="dashboard",
        )

    # ── Routes ─────────────────────────────────────────────────────────

    @app.get("/", response_class=HTMLResponse, tags=["UI"])
    async def root() -> str:
        """Serve the dashboard or a redirect."""
        dashboard_html = dashboard_dir / "index.html"
        if dashboard_html.exists():
            return dashboard_html.read_text(encoding="utf-8")
        return """
        <html><body style="font-family:monospace;background:#0f172a;color:#94a3b8;padding:2rem">
        <h1>EcoEye Edge Node</h1>
        <p>API running. Visit <a href="/docs" style="color:#38bdf8">/docs</a> for API docs.</p>
        <p><a href="/api/v1/stats" style="color:#38bdf8">/api/v1/stats</a> — System stats</p>
        </body></html>
        """

    @app.get("/health", tags=["System"])
    async def health() -> Dict[str, Any]:
        """System health check with uptime."""
        return {
            "status": "healthy",
            "device_id": settings.device_id,
            "uptime_seconds": round(time.time() - _START_TIME, 1),
            "version": "1.0.0",
        }

    @app.get("/api/v1/stats", tags=["Telemetry"])
    async def stats() -> Dict[str, Any]:
        """Aggregated telemetry counts and sync queue status."""
        try:
            return {
                "storage": _repo.get_system_stats(),
                "sync_queue": _queue.get_queue_stats(),
                "device_id": settings.device_id,
            }
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @app.get("/api/v1/alerts", tags=["Telemetry"])
    async def recent_alerts(limit: int = 20) -> List[Dict[str, Any]]:
        """Fetch the most recent fall events (decrypted)."""
        try:
            events = _repo.get_recent_fall_events(limit=limit)
            return [e.model_dump(mode="json") for e in events]
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @app.get("/api/v1/readings", tags=["Telemetry"])
    async def recent_readings(limit: int = 20) -> List[Dict[str, Any]]:
        """Fetch the most recent glucose readings (decrypted)."""
        try:
            readings = _repo.get_recent_glucose_readings(limit=limit)
            return [r.model_dump(mode="json") for r in readings]
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @app.get("/api/v1/obstacles", tags=["Telemetry"])
    async def recent_obstacles(limit: int = 20, sector: Optional[str] = None) -> List[Dict[str, Any]]:
        """Fetch the most recent obstacle detections."""
        try:
            return _repo.get_recent_obstacles(limit=limit, sector=sector)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @app.get("/api/v1/queue", tags=["Sync"])
    async def queue_stats() -> Dict[str, int]:
        """Return sync queue item counts by status."""
        return _queue.get_queue_stats()

    return app


# Module-level app for direct uvicorn usage
try:
    app = create_app()
except ImportError:
    app = None  # type: ignore[assignment]
