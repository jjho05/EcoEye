"""
Integration and Unit Tests for Remote PostgreSQL & Neon Database Layer.
"""

from __future__ import annotations

import os
import uuid
import pytest
from fastapi.testclient import TestClient

from ecoeye.config import settings
from ecoeye.server.api import create_app
from ecoeye.storage.postgres import PostgresManager


def test_postgres_manager_offline_behavior():
    """Verify safe degradation and offline-first compliance when no database URL is set."""
    mgr = PostgresManager(database_url="")

    # Should not report configured
    assert mgr.is_configured() is False
    assert mgr.database_url is None

    # Methods should return safe defaults without unhandled exceptions
    health = mgr.check_connection()
    assert health["configured"] is False
    assert health["connected"] is False

    assert mgr.insert_alert(alert_type="caida_detectada") is False
    assert mgr.insert_telemetry(battery_level=80.0) is False
    assert mgr.get_recent_alerts() == []
    assert mgr.get_recent_telemetry() == []
    sync_res = mgr.sync_pending_queue()
    assert sync_res["status"] == "unconfigured"


def test_postgres_api_endpoints_mocked_unconfigured():
    """Test API behavior when PostgreSQL is injected as unconfigured."""
    unconfigured_mgr = PostgresManager(database_url="")

    app = create_app(pg_mgr=unconfigured_mgr)
    client = TestClient(app)


    # Health check should indicate unconfigured cloud db
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert "cloud_database" in data
    assert data["cloud_database"]["connected"] is False

    # Status route should return unconfigured
    resp_status = client.get("/api/v1/database/status")
    assert resp_status.status_code == 200
    status_data = resp_status.json()
    assert status_data["connected"] is False


@pytest.mark.skipif(
    not settings.database_url,
    reason="ECOEYE_DATABASE_URL not set in environment or .env"
)
def test_postgres_live_neon_connection_and_crud():
    """Live verification against Neon Serverless PostgreSQL instance."""
    mgr = PostgresManager(database_url=settings.database_url)
    assert mgr.is_configured() is True

    # 1. Health check & version
    health = mgr.check_connection()
    assert health["connected"] is True
    assert "PostgreSQL" in health["version"]
    assert "alerts" in health["tables"]

    # 2. Seed profile & device
    user_uuid, device_uuid = mgr.ensure_seed_records()
    assert len(user_uuid) == 36
    assert len(device_uuid) == 36

    # 3. Insert and retrieve alert
    test_alert_id = str(uuid.uuid4())
    inserted = mgr.insert_alert(
        alert_id=test_alert_id,
        alert_type="prueba_sistema",
        severity="info",
        status="resuelta",
        payload={"integration_test": True, "runner": "pytest"},
    )
    assert inserted is True

    recent = mgr.get_recent_alerts(limit=5)
    assert len(recent) > 0
    found_ids = [r["id"] for r in recent]
    assert test_alert_id in found_ids

    # 4. Insert telemetry
    inserted_telemetry = mgr.insert_telemetry(
        battery_level=95.0,
        cpu_temp=38.5,
        uptime_seconds=7200,
        network_latency_ms=18,
    )
    assert inserted_telemetry is True

    telemetry_records = mgr.get_recent_telemetry(limit=5)
    assert len(telemetry_records) > 0


@pytest.mark.skipif(
    not settings.database_url,
    reason="ECOEYE_DATABASE_URL not set in environment or .env"
)
def test_postgres_api_endpoints_live():
    """Live API route verification with FastAPI TestClient."""
    app = create_app()
    client = TestClient(app)

    # Health check
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["cloud_database"]["connected"] is True

    # Database status
    resp = client.get("/api/v1/database/status")
    assert resp.status_code == 200
    assert resp.json()["connected"] is True

    # Database alerts
    resp = client.get("/api/v1/database/alerts?limit=5")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)

    # Database sync
    resp = client.post("/api/v1/database/sync?batch_size=5")
    assert resp.status_code == 200
    sync_data = resp.json()
    assert "synced" in sync_data
