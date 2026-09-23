"""
EcoEye - Test Suite de Persistencia, Repositorio y Sync Queue
Valida el almacenamiento cifrado transparente (AES-256-GCM) y la cola resiliente.
"""

import os
import tempfile
import asyncio
from datetime import datetime

from ecoeye.core.models import (
    GlucoseReading,
    GlucoseTrend,
    FallEvent,
    FallSeverity,
    ObstacleDetection,
    ObstacleSector,
    ObstacleUrgency,
    TelemetryMessage,
    TelemetryType,
)
from ecoeye.core.security import CryptoEngine
from ecoeye.storage.database import DatabaseManager
from ecoeye.storage.repository import EcoEyeRepository
from ecoeye.storage.sync_queue import SyncQueueManager


def test_database_initialization():
    """Verifica que la BD SQLite WAL se inicialice correctamente."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tf:
        db_path = tf.name

    try:
        db_mgr = DatabaseManager(db_path=db_path)
        db_mgr.init_db()

        # Verificar tablas creadas
        tables = db_mgr.fetch_all(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
        )
        table_names = [t["name"] for t in tables]
        expected_tables = [
            "fall_events",
            "glucose_readings",
            "heartbeats",
            "obstacle_detections",
            "sync_queue",
            "telemetry_log",
        ]
        for exp in expected_tables:
            assert exp in table_names, f"Falta la tabla {exp} en la BD"
    finally:
        if os.path.exists(db_path):
            os.remove(db_path)


def test_glucose_encrypted_storage_and_retrieval():
    """Verifica el guardado cifrado y lectura descifrada transparente de glucosa."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tf:
        db_path = tf.name

    try:
        crypto = CryptoEngine(master_password="test_storage_secret_key_123")
        repo = EcoEyeRepository(db_path=db_path, crypto_engine=crypto)

        reading = GlucoseReading(
            timestamp=datetime.utcnow(),
            sensor_id="DEXCOM_G7_TEST01",
            glucose_mg_dl=142.5,
            trend=GlucoseTrend.FLAT,
            transmitter_battery_pct=95,
        )

        record_id = repo.save_glucose_reading(reading)
        assert record_id > 0

        # Verificar que en la base de datos cruda el campo esté cifrado
        raw_row = repo.db.fetch_one(
            "SELECT encrypted_data FROM glucose_readings WHERE id = ?", (record_id,)
        )
        assert raw_row is not None
        assert "142.5" not in raw_row["encrypted_data"]

        # Recuperar a través del repositorio y verificar desencriptación
        readings = repo.get_recent_glucose_readings(limit=10)
        assert len(readings) == 1
        saved = readings[0]
        assert saved.glucose_mg_dl == 142.5
        assert saved.sensor_id == "DEXCOM_G7_TEST01"
        assert saved.trend == GlucoseTrend.FLAT
    finally:
        if os.path.exists(db_path):
            os.remove(db_path)


def test_fall_event_encrypted_storage():
    """Verifica el guardado y consulta de eventos de caída cifrados."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tf:
        db_path = tf.name

    try:
        crypto = CryptoEngine(master_password="test_fall_secret_pass_456")
        repo = EcoEyeRepository(db_path=db_path, crypto_engine=crypto)

        event = FallEvent(
            timestamp=datetime.utcnow(),
            device_id="ECOEYE_NODE_01",
            severity=FallSeverity.HIGH,
            confidence=0.94,
            inactivity_duration_sec=32.0,
            location_hint="Sala principal",
            is_confirmed=True,
            metadata={"variance_spike": 4.82, "doppler_shift_hz": 12.5},
        )

        row_id = repo.save_fall_event(event)
        assert row_id > 0

        # Verificar registro crudo cifrado
        raw_row = repo.db.fetch_one(
            "SELECT encrypted_data FROM fall_events WHERE id = ?", (row_id,)
        )
        assert raw_row is not None
        assert "Sala principal" not in raw_row["encrypted_data"]

        # Recuperar descifrado
        events = repo.get_recent_fall_events(limit=5)
        assert len(events) == 1
        retrieved = events[0]
        assert retrieved.severity == FallSeverity.HIGH
        assert retrieved.confidence == 0.94
        assert retrieved.location_hint == "Sala principal"
        assert retrieved.metadata["variance_spike"] == 4.82
    finally:
        if os.path.exists(db_path):
            os.remove(db_path)


def test_obstacle_detection_storage():
    """Verifica persistencia y filtros de detecciones de obstáculos."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tf:
        db_path = tf.name

    try:
        repo = EcoEyeRepository(db_path=db_path)

        obs = ObstacleDetection(
            timestamp=datetime.utcnow(),
            sector=ObstacleSector.CENTER,
            distance_meters=0.75,
            urgency=ObstacleUrgency.CRITICAL,
            audio_alert_played=True,
            audio_message="Peligro obstáculo centro a 75 centímetros",
        )

        row_id = repo.save_obstacle_detection(obs)
        assert row_id > 0

        recent = repo.get_recent_obstacles(limit=10, sector="center")
        assert len(recent) == 1
        assert recent[0]["distance_meters"] == 0.75
        assert recent[0]["urgency"] == "critical"
    finally:
        if os.path.exists(db_path):
            os.remove(db_path)


def test_sync_queue_backoff_and_lifecycle():
    """Verifica ciclo completo de encolado, fallos con backoff exponencial y resolución."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tf:
        db_path = tf.name

    try:
        db_mgr = DatabaseManager(db_path=db_path)
        db_mgr.init_db()
        sync_mgr = SyncQueueManager(db_manager=db_mgr)

        # 1. Encolar items
        item_id = sync_mgr.enqueue(
            entity_type="glucose",
            entity_id=101,
            payload={"glucose_mg_dl": 120, "sensor": "TEST"},
            priority=1,
        )
        assert item_id > 0

        # 2. Obtener pendientes
        pending = sync_mgr.get_pending_items(batch_size=10)
        assert len(pending) == 1
        assert pending[0]["id"] == item_id
        assert pending[0]["retry_count"] == 0

        # 3. Simular fallo 1 (debe calcular backoff exponencial con jitter)
        sync_mgr.record_failure(item_id, error_message="Timeout 504 Gateway")

        # Como next_attempt_at está en el futuro, no debe salir de inmediato
        pending_after_fail = sync_mgr.get_pending_items(batch_size=10)
        assert len(pending_after_fail) == 0

        # Forzar next_attempt_at en el pasado para probar segundo intento
        db_mgr.execute(
            "UPDATE sync_queue SET next_attempt_at = '2020-01-01 00:00:00' WHERE id = ?",
            (item_id,),
        )
        pending_retry = sync_mgr.get_pending_items(batch_size=10)
        assert len(pending_retry) == 1
        assert pending_retry[0]["retry_count"] == 1

        # 4. Marcar éxito
        sync_mgr.mark_success(item_id)
        status_row = db_mgr.fetch_one(
            "SELECT status FROM sync_queue WHERE id = ?", (item_id,)
        )
        assert status_row["status"] == "synced"
    finally:
        if os.path.exists(db_path):
            os.remove(db_path)
