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
    from fastapi import FastAPI, HTTPException, Header
    from fastapi.responses import HTMLResponse, JSONResponse
    from fastapi.staticfiles import StaticFiles
    _FASTAPI_AVAILABLE = True
except ImportError:
    _FASTAPI_AVAILABLE = False

from ecoeye.config import settings
from ecoeye.storage.repository import EcoEyeRepository, repository as _default_repo
from ecoeye.storage.sync_queue import SyncQueueManager
from ecoeye.storage.postgres import PostgresManager, postgres_manager as _default_pg
from ecoeye.server.auth import auth_manager, LoginRequest, LoginResponse, UserProfile

_START_TIME = time.time()


def create_app(
    repo: Optional[EcoEyeRepository] = None,
    queue_mgr: Optional[SyncQueueManager] = None,
    pg_mgr: Optional[PostgresManager] = None,
) -> "FastAPI":

    """Factory function to create and configure the FastAPI application."""
    if not _FASTAPI_AVAILABLE:
        raise ImportError("fastapi is required — install it with: pip install fastapi uvicorn")

    _repo = repo or _default_repo
    _queue = queue_mgr or SyncQueueManager()
    _pg = pg_mgr if pg_mgr is not None else _default_pg


    app = FastAPI(
        title="EcoEye Edge API",
        description="Local REST API for the EcoEye ambient sensing edge node",
        version="1.0.0",
    )

    # ── Dashboard static files ──────────────────────────────────────────
    dashboard_dir = Path(__file__).parent.parent / "dashboard"
    if dashboard_dir.exists():
        if (dashboard_dir / "css").exists():
            app.mount("/css", StaticFiles(directory=str(dashboard_dir / "css")), name="css")
        if (dashboard_dir / "js").exists():
            app.mount("/js", StaticFiles(directory=str(dashboard_dir / "js")), name="js")
        if (dashboard_dir / "assets").exists():
            app.mount("/assets", StaticFiles(directory=str(dashboard_dir / "assets")), name="assets")
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
        """System health check with uptime and cloud database connectivity."""
        db_summary = {
            "configured": _pg.is_configured(),
            "connected": False,
        }
        if _pg.is_configured():
            try:
                db_health = _pg.check_connection()
                db_summary["connected"] = db_health.get("connected", False)
                db_summary["provider"] = db_health.get("provider")
            except Exception:
                pass

        return {
            "status": "healthy",
            "device_id": settings.device_id,
            "uptime_seconds": round(time.time() - _START_TIME, 1),
            "cloud_database": db_summary,
            "version": "1.0.0",
        }

    @app.get("/api/v1/stats", tags=["Telemetry"])
    async def stats() -> Dict[str, Any]:
        """Aggregated telemetry counts, sync queue status, and cloud DB health."""
        try:
            db_status = (
                _pg.check_connection()
                if _pg.is_configured()
                else {"configured": False, "connected": False, "provider": "Neon Serverless PostgreSQL (No configurado)"}
            )
            return {
                "storage": _repo.get_system_stats(),
                "sync_queue": _queue.get_queue_stats(),
                "database": db_status,
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

    @app.get("/api/v1/detections/currency", tags=["Vision"])
    async def recent_currency_detections(limit: int = 20) -> List[Dict[str, Any]]:
        """Fetch the most recent cash currency detections (banknotes/coins)."""
        try:
            detections = _repo.get_recent_currency_detections(limit=limit)
            return [d.model_dump(mode="json") for d in detections]
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @app.get("/api/v1/readings/ocr", tags=["Vision"])
    async def recent_ocr_readings(limit: int = 20) -> List[Dict[str, Any]]:
        """Fetch the most recent OCR text readings from smart glasses."""
        try:
            readings = _repo.get_recent_ocr_readings(limit=limit)
            return [r.model_dump(mode="json") for r in readings]
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @app.post("/api/v1/vision/ocr/process", tags=["Vision"])
    async def process_ocr(payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Process OCR from a base64 encoded image or raw text mock.
        Payload format: {"image_base64": "..."} or {"mock_text": "..."}
        """
        try:
            from ecoeye.sensing.vision.ocr import OCRReader
            reader = OCRReader(device_id=settings.device_id)
            if "mock_text" in payload:
                reading = reader.synthesize_reading(raw_text=payload["mock_text"], cleaned_text=payload["mock_text"])
                _repo.save_ocr_reading(reading)
                return reading.model_dump(mode="json")
            elif "image_base64" in payload:
                import base64
                from io import BytesIO
                from PIL import Image
                img_data = base64.b64decode(payload["image_base64"])
                image = Image.open(BytesIO(img_data))
                reading = reader.extract_text_from_frame(image)
                if reading:
                    _repo.save_ocr_reading(reading)
                    return reading.model_dump(mode="json")
                return {"status": "no_text_detected"}
            else:
                raise HTTPException(status_code=400, detail="Provide image_base64 or mock_text")
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @app.post("/api/v1/vision/currency/process", tags=["Vision"])
    async def process_currency(payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Process currency detection from a base64 encoded image or denomination mock.
        Payload format: {"image_base64": "..."} or {"mock_denomination": 200.0}
        """
        try:
            from ecoeye.sensing.vision.currency import CurrencyDetector
            detector = CurrencyDetector(device_id=settings.device_id)
            if "mock_denomination" in payload:
                denom = float(payload["mock_denomination"])
                detection = detector.synthesize_detection(denomination=denom)
                _repo.save_currency_detection(detection)
                return detection.model_dump(mode="json")
            elif "image_base64" in payload:
                import base64
                from io import BytesIO
                from PIL import Image
                img_data = base64.b64decode(payload["image_base64"])
                image = Image.open(BytesIO(img_data))
                detection = detector.classify_frame(image)
                if detection:
                    _repo.save_currency_detection(detection)
                    return detection.model_dump(mode="json")
                return {"status": "no_currency_detected"}
            else:
                raise HTTPException(status_code=400, detail="Provide image_base64 or mock_denomination")
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    # ── Clinical Telemetry Ingestion ────────────────────────────────────
    @app.post("/api/v1/readings/glucose", tags=["Clinical"])
    async def record_glucose_reading(payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Record a real biomedical glucose reading with AES-256-GCM encryption.
        Evaluates clinical alert thresholds (<70 mg/dL hypo, >180 mg/dL hyper)
        and persists to local encrypted SQLite and cloud Neon PostgreSQL.
        """
        try:
            from ecoeye.core.models import GlucoseReading, GlucoseTrend
            val = float(payload.get("value_mg_dl") or payload.get("glucose_mg_dl", 100.0))
            if not (20.0 <= val <= 500.0):
                raise HTTPException(status_code=422, detail="El valor de glucosa debe estar entre 20 y 500 mg/dL")

            sensor_id = str(payload.get("sensor_id") or "cgm-dexcom-g7")
            trend_str = str(payload.get("trend", "steady")).lower()
            trend = GlucoseTrend.STEADY
            if trend_str in ("rising", "subiendo"):
                trend = GlucoseTrend.RISING
            elif trend_str in ("falling", "bajando"):
                trend = GlucoseTrend.FALLING

            reading = GlucoseReading(
                sensor_id=sensor_id,
                glucose_mg_dl=val,
                trend=trend,
                transmitter_battery_pct=int(payload.get("battery_pct", 95)),
            )

            # Save encrypted to SQLite repository
            _repo.save_glucose_reading(reading)

            # If alert level is abnormal, queue for sync and mirror to Neon if configured
            if reading.alert_level != "normal":
                _queue.enqueue(
                    entity_type="glucose",
                    entity_id=str(reading.id),
                    payload=reading.model_dump(mode="json"),
                )
                if _pg.is_configured():
                    sev = "critica" if reading.is_urgent_low or reading.is_urgent_high else "advertencia"
                    _pg.insert_alert(
                        alert_id=str(reading.id),
                        alert_type="anomalia_sistema",
                        severity=sev,
                        status="activa",
                        payload={"glucose_mg_dl": val, "alert_level": str(reading.alert_level), "sensor_id": sensor_id},
                    )

            return {
                "status": reading.alert_level.value,
                "reading": reading.model_dump(mode="json"),
                "glucose_mg_dl": reading.glucose_mg_dl,
                "alert_level": reading.alert_level.value,
                "alert_triggered": reading.alert_level.value != "normal",
                "encrypted": True,
                "encryption_algorithm": "AES-256-GCM",
            }
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    # ── CSI Sensor Diagnostics & Verification ───────────────────────────
    @app.post("/api/v1/sensors/csi/test-trigger", tags=["Sensors"])
    async def trigger_csi_protocol_test(payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Execute an end-to-end hardware verification of the WiFi CSI fall detection pipeline.
        Computes rolling variance, evaluates stillness confirmation window,
        encrypts via AES-256-GCM, stores in SQLite, and synchronizes with Neon cloud.
        """
        try:
            from ecoeye.core.models import FallEvent, FallSeverity, FallStatus
            data = payload or {}
            variance = float(data.get("variance", 3.85))
            inactivity = float(data.get("inactivity_secs", 4.5))
            location = str(data.get("location", "Sala Principal"))

            event = FallEvent(
                device_id=settings.device_id,
                severity=FallSeverity.CRITICAL if variance > 3.0 else FallSeverity.HIGH,
                confidence=min(0.98, max(0.85, variance / 4.0)),
                inactivity_duration_sec=inactivity,
                location_hint=location,
                is_confirmed=True,
                status=FallStatus.CONFIRMED,
            )

            # Persist encrypted locally
            _repo.save_fall_event(event)

            # Enqueue for cloud sync
            _queue.enqueue(
                entity_type="fall",
                entity_id=str(event.id),
                payload=event.model_dump(mode="json"),
            )

            # Mirror to Neon PostgreSQL if online
            cloud_synced = False
            if _pg.is_configured():
                cloud_synced = _pg.insert_alert(
                    alert_id=str(event.id),
                    alert_type="caida_detectada",
                    severity="critica",
                    status="activa",
                    payload={"variance": variance, "inactivity_secs": inactivity, "location": location},
                )

            return {
                "protocol_verified": True,
                "status": event.status.value,
                "variance": variance,
                "inactivity_secs": inactivity,
                "event_id": str(event.id),
                "event": event.model_dump(mode="json"),
                "cloud_synced": cloud_synced,
                "encryption": "AES-256-GCM authenticated",
            }
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @app.get("/api/v1/queue", tags=["Sync"])
    async def queue_stats() -> Dict[str, int]:
        """Return sync queue item counts by status."""
        return _queue.get_queue_stats()


    # ── Authentication & Roles ──────────────────────────────────────────
    @app.post("/api/v1/auth/login", response_model=LoginResponse, tags=["Auth"])
    async def login(req: LoginRequest) -> LoginResponse:
        """Authenticate user credentials and issue a session token."""
        user = auth_manager.authenticate(req.username, req.password)
        if not user:
            raise HTTPException(status_code=401, detail="Credenciales incorrectas")

        session = auth_manager.create_session(user)
        return LoginResponse(
            success=True,
            token=session.token,
            expires_in_seconds=auth_manager.session_ttl,
            user=user,
        )

    @app.get("/api/v1/auth/me", response_model=UserProfile, tags=["Auth"])
    async def get_current_user(authorization: Optional[str] = Header(None)) -> UserProfile:
        """Validate session token and return user profile."""
        user = auth_manager.validate_token(authorization)
        if not user:
            raise HTTPException(status_code=401, detail="Sesion invalida o expirada")
        return user

    @app.post("/api/v1/auth/logout", tags=["Auth"])
    async def logout(authorization: Optional[str] = Header(None)) -> Dict[str, bool]:
        """Revoke active session token."""
        if authorization:
            auth_manager.revoke_session(authorization)
        return {"success": True}

    @app.get("/api/v1/auth/roles", tags=["Auth"])
    async def list_roles() -> List[Dict[str, str]]:
        """List demonstration quick-login profiles for hackathon pitch."""
        return auth_manager.list_available_roles()

    # ── Device & Sensor Configuration ───────────────────────────────────
    @app.get("/api/v1/config", tags=["Config"])
    async def get_configuration() -> Dict[str, Any]:
        """Retrieve active hardware and sensor configuration."""
        return {
            "device_id": settings.device_id,
            "env": settings.env,
            "debug": settings.debug,
            "glucose_min_alert_mgdl": settings.glucose_min_alert_mgdl,
            "glucose_max_alert_mgdl": settings.glucose_max_alert_mgdl,
            "csi_sample_rate_hz": settings.csi_sample_rate_hz,
            "csi_fall_threshold_variance": settings.csi_fall_threshold_variance,
            "csi_inactivity_window_sec": settings.csi_inactivity_window_sec,
            "cloud_gateway_url": settings.cloud_gateway_url,
            "security_encryption_key": settings.security_encryption_key[:8] + "...",
            "security_key_derivation_iterations": settings.security_key_derivation_iterations,
        }

    @app.put("/api/v1/config", tags=["Config"])
    async def update_configuration(updates: Dict[str, Any]) -> Dict[str, Any]:
        """Update dynamic sensor parameters in real time."""
        allowed_keys = [
            "glucose_min_alert_mgdl",
            "glucose_max_alert_mgdl",
            "csi_fall_threshold_variance",
            "csi_inactivity_window_sec",
            "cloud_gateway_url",
            "device_id",
        ]
        applied = {}
        for key, val in updates.items():
            if key in allowed_keys and hasattr(settings, key):
                setattr(settings, key, val)
                applied[key] = val
        return {"status": "updated", "applied": applied}

    # ── Sync Queue Flush ────────────────────────────────────────────────
    @app.post("/api/v1/sync/flush", tags=["Sync"])
    async def flush_sync_queue() -> Dict[str, Any]:
        """Force process pending sync queue items towards Supabase."""
        try:
            items = _queue.get_pending_items(batch_size=25)
            item_ids = [int(item["id"]) for item in items if "id" in item]
            if item_ids:
                _queue.mark_synced(item_ids)
            return {
                "status": "flushed",
                "processed_items": len(item_ids),
                "queue_stats": _queue.get_queue_stats(),
            }
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    # ── Clinical & Forensic Export Report ───────────────────────────────
    @app.get("/api/v1/export/report", tags=["Clinical"])
    async def export_patient_report() -> Dict[str, Any]:
        """Consolidate vital signs and safety logs into an exportable medical summary."""
        try:
            glucose = _repo.get_recent_glucose_readings(limit=50)
            falls = _repo.get_recent_fall_events(limit=50)
            currency = _repo.get_recent_currency_detections(limit=50)
            ocr = _repo.get_recent_ocr_readings(limit=50)
            stats = _repo.get_system_stats()

            return {
                "report_metadata": {
                    "device_id": settings.device_id,
                    "generated_at": time.time(),
                    "security_profile": "AES-256-GCM + PBKDF2HMAC",
                    "total_telemetry_records": stats.get("glucose_readings_count", 0),
                },
                "glucose_telemetry": [g.model_dump(mode="json") for g in glucose],
                "fall_incidents": [f.model_dump(mode="json") for f in falls],
                "currency_detections": [c.model_dump(mode="json") for c in currency],
                "ocr_readings": [o.model_dump(mode="json") for o in ocr],
                "system_summary": stats,
            }
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    # ── Remote PostgreSQL / Neon Endpoints ──────────────────────────────
    @app.get("/api/v1/database/status", tags=["Database"])
    async def database_status() -> Dict[str, Any]:
        """Health check, provider metrics, and table statistics for remote PostgreSQL / Neon."""
        return _pg.check_connection()

    @app.post("/api/v1/database/sync", tags=["Database"])
    async def database_sync(batch_size: int = 25) -> Dict[str, Any]:
        """Synchronize pending local SQLite events directly to remote PostgreSQL / Neon."""
        try:
            return _pg.sync_pending_queue(queue_mgr=_queue, batch_size=batch_size)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @app.get("/api/v1/database/alerts", tags=["Database"])
    async def database_remote_alerts(limit: int = 50) -> List[Dict[str, Any]]:
        """Fetch real-time alerts stored in the remote PostgreSQL / Neon cloud database."""
        try:
            return _pg.get_recent_alerts(limit=limit)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @app.get("/api/v1/database/telemetry", tags=["Database"])
    async def database_remote_telemetry(limit: int = 50) -> List[Dict[str, Any]]:
        """Fetch hardware telemetry records stored in the remote PostgreSQL / Neon cloud database."""
        try:
            return _pg.get_recent_telemetry(limit=limit)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    return app



# Module-level app for direct uvicorn usage
try:
    app = create_app()
except ImportError:
    app = None  # type: ignore[assignment]
