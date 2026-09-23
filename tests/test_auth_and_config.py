"""
Unit Tests for Authentication, Configuration, Sync Flush, and Medical Report Export.

Validates:
  1. AuthManager & API Login with PBKDF2 credential verification across roles (Admin, Clinician, Caregiver).
  2. Session validation, bearer token extraction, and revocation on logout.
  3. Dynamic sensor configuration retrieval (GET) and updates (PUT).
  4. Manual sync queue flushing towards cloud.
  5. Consolidated medical report export in structured JSON.
"""

import tempfile
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from ecoeye.storage.database import DatabaseManager
from ecoeye.storage.repository import EcoEyeRepository
from ecoeye.storage.sync_queue import SyncQueueManager
from ecoeye.server.api import create_app
from ecoeye.server.auth import auth_manager


@pytest.fixture
def client_app():
    """Create a fully isolated FastAPI instance with fresh DB."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        db_path = str(Path(tmp_dir) / "test_auth_config.db")
        repo = EcoEyeRepository(db_path=db_path)
        queue_mgr = SyncQueueManager(db_manager=repo.db)
        app = create_app(repo=repo, queue_mgr=queue_mgr)
        client = TestClient(app)
        yield client


def test_auth_login_success_and_roles(client_app):
    """Verify login with all 3 default roles: admin, clinician, caregiver."""
    credentials = [
        ("admin", "ecoeye2026!", "admin", "Administrador de Dispositivo"),
        ("medico", "clinica2026!", "clinician", "Especialista Clinico"),
        ("cuidador", "familiar2026!", "caregiver", "Cuidador / Familiar"),
    ]

    for username, password, expected_role, expected_label in credentials:
        resp = client_app.post(
            "/api/v1/auth/login",
            json={"username": username, "password": password},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert len(data["token"]) >= 32
        assert data["user"]["role"] == expected_role
        assert data["user"]["role_label"] == expected_label


def test_auth_login_invalid_password(client_app):
    """Verify login failure with incorrect credentials."""
    resp = client_app.post(
        "/api/v1/auth/login",
        json={"username": "medico", "password": "wrong_password!"},
    )
    assert resp.status_code == 401
    assert "Credenciales incorrectas" in resp.json()["detail"]


def test_auth_me_and_logout_lifecycle(client_app):
    """Verify session validation via Bearer header and invalidation on logout."""
    # 1. Login
    login_res = client_app.post(
        "/api/v1/auth/login",
        json={"username": "medico", "password": "clinica2026!"},
    )
    token = login_res.json()["token"]

    # 2. Get profile
    me_res = client_app.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert me_res.status_code == 200
    assert me_res.json()["username"] == "medico"
    assert me_res.json()["role"] == "clinician"

    # 3. Logout
    logout_res = client_app.post(
        "/api/v1/auth/logout",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert logout_res.status_code == 200
    assert logout_res.json()["success"] is True

    # 4. Token should now be invalid
    me_after_logout = client_app.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert me_after_logout.status_code == 401


def test_auth_list_roles(client_app):
    """Verify listing available demonstration roles."""
    resp = client_app.get("/api/v1/auth/roles")
    assert resp.status_code == 200
    roles = resp.json()
    assert len(roles) == 3
    usernames = [r["username"] for r in roles]
    assert "admin" in usernames
    assert "medico" in usernames
    assert "cuidador" in usernames


def test_config_get_and_update(client_app):
    """Verify dynamic retrieval and mutation of system/sensor parameters."""
    # 1. Get initial configuration
    get_res = client_app.get("/api/v1/config")
    assert get_res.status_code == 200
    cfg = get_res.json()
    assert "glucose_min_alert_mgdl" in cfg
    assert "csi_fall_threshold_variance" in cfg

    # 2. Update parameters
    put_res = client_app.put(
        "/api/v1/config",
        json={
            "glucose_min_alert_mgdl": 65.0,
            "glucose_max_alert_mgdl": 190.0,
            "csi_fall_threshold_variance": 3.2,
        },
    )
    assert put_res.status_code == 200
    applied = put_res.json()["applied"]
    assert applied["glucose_min_alert_mgdl"] == 65.0
    assert applied["glucose_max_alert_mgdl"] == 190.0
    assert applied["csi_fall_threshold_variance"] == 3.2

    # 3. Verify changes persisted in settings
    get_updated = client_app.get("/api/v1/config")
    assert get_updated.json()["glucose_min_alert_mgdl"] == 65.0


def test_sync_queue_flush_and_export_report(client_app):
    """Verify manual sync flush and clinical report export."""
    # 1. Test queue flush
    flush_res = client_app.post("/api/v1/sync/flush")
    assert flush_res.status_code == 200
    assert flush_res.json()["status"] == "flushed"

    # 2. Test export report
    report_res = client_app.get("/api/v1/export/report")
    assert report_res.status_code == 200
    report = report_res.json()
    assert "report_metadata" in report
    assert "glucose_telemetry" in report
    assert "fall_incidents" in report
    assert "currency_detections" in report
    assert "ocr_readings" in report
