"""
Tests for Caregiver Management, Alert Dispatch via WhatsApp protocol,
and ToF Sonar Obstacle Ingestion in EcoEye.
"""

from fastapi.testclient import TestClient
from ecoeye.server.api import create_app
from ecoeye.storage.repository import EcoEyeRepository
from ecoeye.storage.database import DatabaseManager


def test_caregivers_crud_and_dispatch(tmp_path):
    db_file = str(tmp_path / "test_cg.db")
    db = DatabaseManager(db_path=db_file)
    repo = EcoEyeRepository(db_path=db_file)
    app = create_app(repo=repo)
    client = TestClient(app)

    # 1. List caregivers (should return default or empty list)
    resp = client.get("/api/v1/caregivers")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) >= 1

    # 2. Create a new caregiver
    new_cg = {
        "full_name": "Dra. Maria Elena",
        "phone_e164": "+525598765432",
        "relationship": "Médico Geriatra",
        "is_primary": True,
        "notify_whatsapp": True,
    }
    create_resp = client.post("/api/v1/caregivers", json=new_cg)
    assert create_resp.status_code == 200
    cg_res = create_resp.json()
    assert cg_res["status"] == "created"
    assert cg_res["caregiver"]["full_name"] == "Dra. Maria Elena"

    # 3. Test alert dispatch to WhatsApp
    dispatch_resp = client.post("/api/v1/alerts/test-event-uuid-123/dispatch")
    assert dispatch_resp.status_code == 200
    disp_data = dispatch_resp.json()
    assert disp_data["status"] == "dispatched"
    assert "https://wa.me/" in disp_data["whatsapp_url"]
    assert "525598765432" in disp_data["whatsapp_url"]
    assert "ALERTA%20ECOEYE" in disp_data["whatsapp_url"] or "ALERTA" in disp_data["whatsapp_url"]


def test_record_obstacle(tmp_path):
    db_file = str(tmp_path / "test_obs.db")
    repo = EcoEyeRepository(db_path=db_file)
    app = create_app(repo=repo)
    client = TestClient(app)

    obs_payload = {
        "sector": "left",
        "distance_meters": 0.45,
        "urgency": "critical",
        "audio_message": "Cuidado: objeto a 45 centímetros a la izquierda",
        "label": "Mesa de centro",
    }
    resp = client.post("/api/v1/obstacles", json=obs_payload)
    assert resp.status_code == 200
    res_data = resp.json()
    assert res_data["status"] == "recorded"
    assert res_data["detection"]["sector"] == "left"
    assert res_data["detection"]["distance_meters"] == 0.45

    # Check recent obstacles
    get_resp = client.get("/api/v1/obstacles")
    assert get_resp.status_code == 200
    assert len(get_resp.json()) >= 1
