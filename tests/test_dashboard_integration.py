"""
EcoEye Integration Tests — Web Dashboard, Static Assets, and Edge Endpoints.

Validates:
  1. Root HTML delivery (/ and /dashboard) with semantic structure and tokens.
  2. Static file serving (/css/tokens.css, /css/layout.css, /css/components.css, /css/animations.css).
  3. Static script serving (/js/app.js, /js/api.js).
  4. Brand asset and SVG delivery (/assets/branding/*.svg, /assets/favicon.svg).
  5. Interactive edge simulation flow and telemetry updates.
"""

import tempfile
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from ecoeye.storage.database import DatabaseManager
from ecoeye.storage.repository import EcoEyeRepository
from ecoeye.storage.sync_queue import SyncQueueManager
from ecoeye.server.api import create_app


@pytest.fixture
def isolated_app():
    """Create a fully isolated FastAPI instance with a temporary SQLite DB."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        db_path = str(Path(tmp_dir) / "test_dashboard.db")
        repo = EcoEyeRepository(db_path=db_path)
        queue_mgr = SyncQueueManager(db_manager=repo.db)

        app = create_app(repo=repo, queue_mgr=queue_mgr)
        client = TestClient(app)
        yield client


def test_root_serves_dashboard_html(isolated_app):
    """Verify GET / returns the full EcoEye dashboard HTML."""
    response = isolated_app.get("/")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    html = response.text
    assert "EcoEye" in html
    assert "Asistencia Visual" in html
    assert 'data-theme="dark"' in html
    assert "ecoeye-logo-full-dark.svg" in html
    assert "app.js" in html


def test_dashboard_route_serves_html(isolated_app):
    """Verify GET /dashboard/ returns the dashboard HTML via StaticFiles mount."""
    response = isolated_app.get("/dashboard/")
    assert response.status_code == 200
    assert "EcoEye" in response.text


def test_css_stylesheets_served(isolated_app):
    """Verify all 4 core CSS stylesheets are served with status 200."""
    css_files = [
        "/css/tokens.css",
        "/css/layout.css",
        "/css/components.css",
        "/css/animations.css",
    ]
    for css_path in css_files:
        resp = isolated_app.get(css_path)
        assert resp.status_code == 200, f"Failed to fetch {css_path}"
        assert "text/css" in resp.headers.get("content-type", "")


def test_js_modules_served(isolated_app):
    """Verify JavaScript module files are served with status 200."""
    js_files = [
        "/js/api.js",
        "/js/app.js",
    ]
    for js_path in js_files:
        resp = isolated_app.get(js_path)
        assert resp.status_code == 200, f"Failed to fetch {js_path}"
        assert "javascript" in resp.headers.get("content-type", "")


def test_branding_svg_assets_served(isolated_app):
    """Verify vectorized SVG brand assets are accessible and valid SVG XML."""
    svg_files = [
        "/assets/branding/ecoeye-logo-full-dark.svg",
        "/assets/branding/ecoeye-logo-full-light.svg",
        "/assets/branding/ecoeye-symbol-dark.svg",
        "/assets/branding/ecoeye-symbol-light.svg",
        "/assets/branding/ecoeye-wordmark-dark.svg",
        "/assets/branding/ecoeye-wordmark-light.svg",
        "/assets/favicon.svg",
    ]
    for svg_path in svg_files:
        resp = isolated_app.get(svg_path)
        assert resp.status_code == 200, f"Failed to fetch {svg_path}"
        assert "svg" in resp.headers.get("content-type", "")
        assert "<svg" in resp.text


def test_dashboard_end_to_end_telemetry_flow(isolated_app):
    """Verify interactive injection updates endpoints consumed by the dashboard."""
    # 1. Initially currency detections are empty
    res_init = isolated_app.get("/api/v1/detections/currency")
    assert res_init.status_code == 200
    assert res_init.json() == []

    # 2. Inject simulated 200 MXN banknote via POST
    res_post_curr = isolated_app.post(
        "/api/v1/vision/currency/process",
        json={"mock_denomination": 200.0},
    )
    assert res_post_curr.status_code == 200
    assert res_post_curr.json()["denomination"] == 200.0

    # 3. Inject simulated OCR reading via POST
    res_post_ocr = isolated_app.post(
        "/api/v1/vision/ocr/process",
        json={"mock_text": "FARMACIA SAN RAFAEL - RECETA MEDICA"},
    )
    assert res_post_ocr.status_code == 200
    assert "FARMACIA SAN RAFAEL" in res_post_ocr.json()["cleaned_text"]

    # 4. Verify telemetry endpoints reflect newly inserted records
    res_curr_updated = isolated_app.get("/api/v1/detections/currency")
    assert len(res_curr_updated.json()) == 1
    assert res_curr_updated.json()[0]["denomination"] == 200.0

    res_ocr_updated = isolated_app.get("/api/v1/readings/ocr")
    assert len(res_ocr_updated.json()) == 1
    assert "FARMACIA SAN RAFAEL" in res_ocr_updated.json()[0]["cleaned_text"]

    # 5. Verify system stats reflect newly stored entities
    res_stats = isolated_app.get("/api/v1/stats")
    assert res_stats.status_code == 200
    data = res_stats.json()
    assert data["storage"]["currency_detections_count"] == 1
    assert data["storage"]["ocr_readings_count"] == 1


def test_multi_view_spa_structure(isolated_app):
    """Verify that all 5 SPA application views and navigation tabs are present in HTML."""
    response = isolated_app.get("/")
    assert response.status_code == 200
    html = response.text

    # 5 Main Views
    assert 'id="view-dashboard"' in html
    assert 'id="view-vision"' in html
    assert 'id="view-history"' in html
    assert 'id="view-config"' in html
    assert 'id="view-audit"' in html

    # Navigation Tabs
    assert 'data-view="dashboard"' in html
    assert 'data-view="vision"' in html
    assert 'data-view="history"' in html
    assert 'data-view="config"' in html
    assert 'data-view="audit"' in html

    # Toast Notifications Container
    assert 'id="toast-container"' in html


def test_auth_modal_and_judge_macros(isolated_app):
    """Verify authentication modal, judge quick-access buttons, and user badge exist."""
    response = isolated_app.get("/")
    assert response.status_code == 200
    html = response.text

    assert 'id="auth-modal"' in html
    assert 'data-user="medico"' in html
    assert 'data-user="cuidador"' in html
    assert 'data-user="admin"' in html
    assert 'id="btn-login-submit"' in html
    assert 'id="user-profile-widget"' in html
    assert 'id="btn-header-logout"' in html

