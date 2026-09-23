"""
EcoEye Unit Tests — Vision Features: Currency Detection & OCR Reading.

Validates:
  1. CurrencyDetector: denomination classification, chromatic analysis, speech alerts, debounce.
  2. OCRReader: text cleaning, confidence thresholds, speech alerts, hash-based debounce.
  3. EcoEyeRepository: atomic dual-write (entity + sync_queue) and retrieval for both features.
  4. FastAPI Endpoints: GET and POST processing for currency and OCR.
"""

import tempfile
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from ecoeye.core.models import (
    CurrencyDenomination,
    CurrencyDetection,
    CurrencyType,
    OCRTextReading,
)
from ecoeye.sensing.vision.currency import CurrencyDetector
from ecoeye.sensing.vision.ocr import OCRReader, _clean_ocr_text
from ecoeye.storage.database import DatabaseManager
from ecoeye.storage.repository import EcoEyeRepository
from ecoeye.storage.sync_queue import SyncQueueManager
from ecoeye.server.api import create_app


# ----------------------------------------------------------------------
# 1. CurrencyDetector Tests
# ----------------------------------------------------------------------

def test_currency_synthesis_and_model():
    """Verify CurrencyDetection creation and auto-population of label."""
    det = CurrencyDetection(
        device_id="test-node",
        denomination=200.0,
        currency="MXN",
        currency_type=CurrencyType.BANKNOTE,
        confidence=0.95,
    )
    assert det.label == "Billete de 200 MXN"
    assert det.denomination == 200.0
    assert det.currency == "MXN"
    assert det.audio_announced is False


def test_currency_detector_dispatch_and_debounce():
    """Verify speech alerts and debounce suppression on repeated detections."""
    alerts = []
    detections = []

    detector = CurrencyDetector(
        device_id="test-node",
        on_detection=lambda d: detections.append(d),
        on_audio_alert=lambda msg, p: alerts.append((msg, p)),
    )

    # First detection of $500 bill
    d1 = detector.synthesize_detection(denomination=500.0, currency_type=CurrencyType.BANKNOTE)
    assert len(detections) == 1
    assert len(alerts) == 1
    assert alerts[0][1] == 2  # Priority 2
    assert "quinientos pesos" in alerts[0][0].lower()
    assert d1.audio_announced is True

    # Immediate second detection of the SAME $500 bill within debounce window
    d2 = detector.synthesize_detection(denomination=500.0, currency_type=CurrencyType.BANKNOTE)
    assert len(detections) == 2
    # Alert should NOT be triggered again due to debounce
    assert len(alerts) == 1
    assert d2.audio_announced is False

    # Detection of a DIFFERENT denomination ($100) should trigger alert immediately
    d3 = detector.synthesize_detection(denomination=100.0, currency_type=CurrencyType.BANKNOTE)
    assert len(detections) == 3
    assert len(alerts) == 2
    assert "cien pesos" in alerts[1][0].lower()
    assert d3.audio_announced is True


# ----------------------------------------------------------------------
# 2. OCRReader Tests
# ----------------------------------------------------------------------

def test_ocr_text_cleaner():
    """Verify optical noise removal and whitespace normalization."""
    dirty_text = "   FARMACIA\n\n\t24   HORAS !!!  $$$###   "
    cleaned = _clean_ocr_text(dirty_text)
    assert cleaned == "FARMACIA 24 HORAS !"

    accented = "Atención: Cruce Peatonal a 50m"
    assert _clean_ocr_text(accented) == accented


def test_ocr_reader_dispatch_and_debounce():
    """Verify OCR reading dispatch, TTS priority and hash-based deduplication."""
    alerts = []
    readings = []

    reader = OCRReader(
        device_id="test-node",
        on_reading=lambda r: readings.append(r),
        on_audio_alert=lambda msg, p: alerts.append((msg, p)),
    )

    # First text reading
    r1 = reader.synthesize_reading(
        raw_text="PARACETAMOL 500 MG",
        cleaned_text="Paracetamol 500 miligramos",
        confidence=95.0,
    )
    assert len(readings) == 1
    assert len(alerts) == 1
    assert alerts[0][1] == 2
    assert "Paracetamol 500 miligramos" in alerts[0][0]
    assert r1.audio_announced is True

    # Immediate duplicate reading of the same text
    r2 = reader.synthesize_reading(
        raw_text="PARACETAMOL 500 MG",
        cleaned_text="Paracetamol 500 miligramos",
        confidence=94.0,
    )
    assert len(readings) == 2
    # Alert should be suppressed by hash debounce
    assert len(alerts) == 1
    assert r2.audio_announced is False

    # Different text should trigger a new alert
    r3 = reader.synthesize_reading(
        raw_text="FARMACIA 24 HORAS",
        cleaned_text="Farmacia 24 Horas",
        confidence=98.0,
    )
    assert len(readings) == 3
    assert len(alerts) == 2
    assert "Farmacia 24 Horas" in alerts[1][0]
    assert r3.audio_announced is True


# ----------------------------------------------------------------------
# 3. Storage & Dual-Write Persistence Tests
# ----------------------------------------------------------------------

def test_currency_and_ocr_storage_lifecycle():
    """Verify atomic persistence into SQLite WAL and sync_queue."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name

    try:
        repo = EcoEyeRepository(db_path=db_path)

        # 1. Test Currency Persistence
        det = CurrencyDetection(
            device_id="edge-unit-1",
            denomination=200.0,
            currency="MXN",
            currency_type=CurrencyType.BANKNOTE,
            confidence=0.92,
            label="Billete de doscientos pesos",
            bbox=[50, 60, 300, 150],
            audio_announced=True,
        )
        row_id_curr = repo.save_currency_detection(det)
        assert row_id_curr > 0

        # Retrieve currency
        stored_currencies = repo.get_recent_currency_detections(limit=10)
        assert len(stored_currencies) == 1
        assert stored_currencies[0].denomination == 200.0
        assert stored_currencies[0].currency == "MXN"
        assert stored_currencies[0].currency_type == CurrencyType.BANKNOTE
        assert stored_currencies[0].bbox == [50, 60, 300, 150]

        # 2. Test OCR Persistence
        ocr = OCRTextReading(
            device_id="edge-unit-1",
            raw_text="ALTO TOTAL",
            cleaned_text="Alto Total",
            confidence=89.5,
            language="spa",
            bbox=[100, 120, 200, 80],
            audio_announced=True,
        )
        row_id_ocr = repo.save_ocr_reading(ocr)
        assert row_id_ocr > 0

        # Retrieve OCR
        stored_ocr = repo.get_recent_ocr_readings(limit=10)
        assert len(stored_ocr) == 1
        assert stored_ocr[0].cleaned_text == "Alto Total"
        assert stored_ocr[0].confidence == 89.5
        assert stored_ocr[0].language == "spa"

        # 3. Verify sync_queue dual-write
        with repo.db.session() as conn:
            sq_rows = conn.execute("SELECT entity_type, entity_id, status FROM sync_queue;").fetchall()
            entity_types = [r[0] for r in sq_rows]
            assert "currency" in entity_types
            assert "ocr" in entity_types

        # 4. Verify system stats reflect new counts
        stats = repo.get_system_stats()
        assert stats["currency_detections_count"] == 1
        assert stats["ocr_readings_count"] == 1

    finally:
        Path(db_path).unlink(missing_ok=True)


# ----------------------------------------------------------------------
# 4. FastAPI Endpoints Tests
# ----------------------------------------------------------------------

def test_api_currency_and_ocr_endpoints():
    """Verify REST endpoints for querying and processing currency and OCR."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name

    try:
        repo = EcoEyeRepository(db_path=db_path)
        queue_mgr = SyncQueueManager(db_manager=repo.db)
        app = create_app(repo=repo, queue_mgr=queue_mgr)
        client = TestClient(app)

        # 1. Process mock currency
        res_curr = client.post(
            "/api/v1/vision/currency/process",
            json={"mock_denomination": 500.0},
        )
        assert res_curr.status_code == 200
        curr_data = res_curr.json()
        assert curr_data["denomination"] == 500.0
        assert curr_data["currency"] == "MXN"

        # Query currency list
        res_list_curr = client.get("/api/v1/detections/currency")
        assert res_list_curr.status_code == 200
        assert len(res_list_curr.json()) == 1

        # 2. Process mock OCR
        res_ocr = client.post(
            "/api/v1/vision/ocr/process",
            json={"mock_text": "Farmacia 24 Horas"},
        )
        assert res_ocr.status_code == 200
        ocr_data = res_ocr.json()
        assert "Farmacia 24 Horas" in ocr_data["cleaned_text"]

        # Query OCR list
        res_list_ocr = client.get("/api/v1/readings/ocr")
        assert res_list_ocr.status_code == 200
        assert len(res_list_ocr.json()) == 1

    finally:
        Path(db_path).unlink(missing_ok=True)
