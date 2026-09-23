"""
EcoEye Storage Repository.

Provides high-level CRUD operations for biomedical, ambient, and spatial
sensing telemetry, with transparent AES-256-GCM encryption at rest and
atomic dual-write (entity table + sync_queue in one transaction).

Public API aligned with test_storage.py contract:
  - EcoEyeRepository(db_path=None, crypto_engine=None)
  - save_glucose_reading(reading)  → int
  - get_recent_glucose_readings(limit) → List[GlucoseReading]
  - save_fall_event(event)         → int
  - get_recent_fall_events(limit)  → List[FallEvent]
  - save_obstacle_detection(obs)   → int
  - get_recent_obstacles(limit, sector=None) → List[dict]
  - save_heartbeat(...)            → int
  - get_system_stats()             → dict
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from ecoeye.core.models import (
    CurrencyDetection,
    CurrencyType,
    FallEvent,
    FallSeverity,
    FallStatus,
    GlucoseAlertLevel,
    GlucoseReading,
    GlucoseTrend,
    ObstacleDetection,
    ObstacleSector,
    ObstacleUrgency,
    OCRTextReading,
)
from ecoeye.core.security import CryptoEngine, crypto_engine as _default_crypto
from ecoeye.storage.database import DatabaseManager, db_manager

logger = logging.getLogger("ecoeye.storage.repository")


class EcoEyeRepository:
    """
    Encapsulates data persistence and retrieval with transparent encryption
    for all sensitive biomedical and sensing events.

    Atomic guarantee: every save_* method writes to the entity table AND
    enqueues the sync payload in a single SQLite transaction. If either
    INSERT fails, both are rolled back — no orphan records, no missing queue items.
    """

    def __init__(
        self,
        db_path: Optional[str] = None,
        crypto_engine: Optional[CryptoEngine] = None,
    ):
        # Allow custom db_path for test isolation (tempfile pattern)
        if db_path is not None:
            self.db = DatabaseManager(db_path=db_path)
        else:
            self.db = db_manager

        self.crypto = crypto_engine or _default_crypto

    # ------------------------------------------------------------------
    # Glucose Telemetry (Biomedical — Encrypted at Rest)
    # ------------------------------------------------------------------

    def save_glucose_reading(self, reading: GlucoseReading) -> int:
        """
        Encrypt and store a biomedical glucose reading, then enqueue for sync.
        Returns the SQLite rowid (integer PK) of the inserted record.
        Atomic: both writes occur in one transaction.
        """
        reading_dict = reading.model_dump(mode="json")
        encrypted_data = self.crypto.encrypt_json(reading_dict)
        now_iso = datetime.now(timezone.utc).isoformat()

        sql_record = """
        INSERT INTO glucose_readings
            (record_uuid, timestamp, sensor_id, alert_level, encrypted_data, synced)
        VALUES (?, ?, ?, ?, ?, 0)
        ON CONFLICT(record_uuid) DO UPDATE SET
            alert_level    = excluded.alert_level,
            encrypted_data = excluded.encrypted_data;
        """

        sql_queue = """
        INSERT INTO sync_queue
            (entity_type, entity_id, payload, priority, retry_count, status, next_attempt_at)
        VALUES (?, ?, ?, 1, 0, 'pending', ?)
        ON CONFLICT(entity_type, entity_id) DO NOTHING;
        """

        row_id: int = 0
        with self.db.session() as conn:
            cursor = conn.execute(
                sql_record,
                (
                    reading.id,
                    reading.timestamp.isoformat(),
                    reading.sensor_id,
                    reading.alert_level.value,
                    encrypted_data,
                ),
            )
            row_id = cursor.lastrowid or 0
            conn.execute(
                sql_queue,
                ("glucose", reading.id, json.dumps(reading_dict), now_iso),
            )

        logger.debug(
            "Saved encrypted glucose reading %s (%.1f mg/dL) → row %d",
            reading.id, reading.glucose_mg_dl, row_id,
        )
        return row_id

    def get_recent_glucose_readings(self, limit: int = 50) -> List[GlucoseReading]:
        """Fetch latest glucose records, decrypting each payload transparently."""
        sql = """
        SELECT id, record_uuid, encrypted_data
        FROM glucose_readings
        ORDER BY timestamp DESC
        LIMIT ?;
        """
        results: List[GlucoseReading] = []
        with self.db.session() as conn:
            cursor = conn.execute(sql, (limit,))
            for row in cursor.fetchall():
                try:
                    decrypted = self.crypto.decrypt_json(row["encrypted_data"])
                    results.append(GlucoseReading.model_validate(decrypted))
                except Exception as err:
                    logger.error(
                        "Failed to decrypt glucose record row %s: %s",
                        row["record_uuid"], err,
                    )
        return results

    # ------------------------------------------------------------------
    # Fall Events (WiFi-CSI — Encrypted at Rest)
    # ------------------------------------------------------------------

    def save_fall_event(self, event: FallEvent) -> int:
        """
        Encrypt and store a classified fall event, then enqueue for sync.
        Returns the SQLite rowid of the inserted record.
        Atomic: both writes in one transaction.
        """
        event_dict = event.model_dump(mode="json")
        encrypted_data = self.crypto.encrypt_json(event_dict)
        now_iso = datetime.now(timezone.utc).isoformat()

        sql_record = """
        INSERT INTO fall_events (
            record_uuid, timestamp, device_id, severity,
            confidence, inactivity_secs, location_hint,
            is_confirmed, encrypted_data, synced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(record_uuid) DO UPDATE SET
            confidence     = excluded.confidence,
            is_confirmed   = excluded.is_confirmed,
            encrypted_data = excluded.encrypted_data;
        """

        sql_queue = """
        INSERT INTO sync_queue
            (entity_type, entity_id, payload, priority, retry_count, status, next_attempt_at)
        VALUES (?, ?, ?, 2, 0, 'pending', ?)
        ON CONFLICT(entity_type, entity_id) DO NOTHING;
        """

        row_id: int = 0
        with self.db.session() as conn:
            cursor = conn.execute(
                sql_record,
                (
                    event.id,
                    event.timestamp.isoformat(),
                    event.device_id,
                    event.severity.value,
                    event.confidence,
                    event.inactivity_duration_sec,
                    event.location_hint,
                    1 if event.is_confirmed else 0,
                    encrypted_data,
                ),
            )
            row_id = cursor.lastrowid or 0
            conn.execute(
                sql_queue,
                ("fall", event.id, json.dumps(event_dict), now_iso),
            )

        logger.info(
            "Saved fall event %s at %s (conf=%.2f, sev=%s) → row %d",
            event.id, event.location_hint, event.confidence, event.severity.value, row_id,
        )
        return row_id

    def get_recent_fall_events(self, limit: int = 50) -> List[FallEvent]:
        """Fetch latest fall events, decrypting each payload."""
        sql = """
        SELECT record_uuid, encrypted_data
        FROM fall_events
        ORDER BY timestamp DESC
        LIMIT ?;
        """
        results: List[FallEvent] = []
        with self.db.session() as conn:
            cursor = conn.execute(sql, (limit,))
            for row in cursor.fetchall():
                try:
                    decrypted = self.crypto.decrypt_json(row["encrypted_data"])
                    results.append(FallEvent.model_validate(decrypted))
                except Exception as err:
                    logger.error(
                        "Failed to decrypt fall record %s: %s",
                        row["record_uuid"], err,
                    )
        return results

    # ------------------------------------------------------------------
    # Obstacle Detections (Edge Vision)
    # ------------------------------------------------------------------

    def save_obstacle_detection(self, obs: ObstacleDetection) -> int:
        """
        Persist a detected obstacle and enqueue for sync.
        Returns the SQLite rowid.
        Atomic: both writes in one transaction.
        """
        obs_dict = obs.model_dump(mode="json")
        now_iso = datetime.now(timezone.utc).isoformat()

        sql_record = """
        INSERT INTO obstacle_detections (
            record_uuid, timestamp, sector, distance_meters,
            urgency, audio_message, audio_played, label, synced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(record_uuid) DO NOTHING;
        """

        sql_queue = """
        INSERT INTO sync_queue
            (entity_type, entity_id, payload, priority, retry_count, status, next_attempt_at)
        VALUES (?, ?, ?, 0, 0, 'pending', ?)
        ON CONFLICT(entity_type, entity_id) DO NOTHING;
        """

        row_id: int = 0
        with self.db.session() as conn:
            cursor = conn.execute(
                sql_record,
                (
                    obs.id,
                    obs.timestamp.isoformat(),
                    obs.sector.value,
                    obs.distance_meters,
                    obs.urgency.value,
                    obs.audio_message,
                    1 if obs.audio_alert_played else 0,
                    obs.label,
                ),
            )
            row_id = cursor.lastrowid or 0
            conn.execute(
                sql_queue,
                ("obstacle", obs.id, json.dumps(obs_dict), now_iso),
            )

        logger.debug(
            "Saved obstacle detection %s (%s @ %.1fm) → row %d",
            obs.id, obs.sector.value, obs.distance_meters, row_id,
        )
        return row_id

    def get_recent_obstacles(
        self,
        limit: int = 50,
        sector: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Fetch latest obstacle detections as plain dicts.
        Optionally filtered by sector (e.g. 'center', 'left', 'right').
        """
        if sector:
            sql = """
            SELECT id, record_uuid, timestamp, sector, distance_meters,
                   urgency, audio_message, audio_played, label
            FROM obstacle_detections
            WHERE sector = ?
            ORDER BY timestamp DESC
            LIMIT ?;
            """
            params = (sector, limit)
        else:
            sql = """
            SELECT id, record_uuid, timestamp, sector, distance_meters,
                   urgency, audio_message, audio_played, label
            FROM obstacle_detections
            ORDER BY timestamp DESC
            LIMIT ?;
            """
            params = (limit,)

        with self.db.session() as conn:
            cursor = conn.execute(sql, params)
            return [dict(row) for row in cursor.fetchall()]

    # ------------------------------------------------------------------
    # Currency Detections (Banknotes / Coins)
    # ------------------------------------------------------------------

    def save_currency_detection(self, det: CurrencyDetection) -> int:
        """
        Persist cash currency detection with atomic dual-write to sync_queue.
        Returns the inserted rowid.
        """
        record_uuid = str(uuid.uuid4())
        now_iso = det.timestamp.isoformat()
        det_dict = det.model_dump(mode="json")
        bbox_json = json.dumps(det.bbox) if det.bbox else None

        sql_record = """
        INSERT INTO currency_detections
            (record_uuid, timestamp, device_id, denomination, currency, currency_type, confidence, label, bbox_json, audio_announced)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        """
        sql_queue = """
        INSERT INTO sync_queue
            (entity_type, entity_id, payload, priority, retry_count, status, next_attempt_at)
        VALUES (?, ?, ?, 0, 0, 'pending', ?)
        ON CONFLICT(entity_type, entity_id) DO NOTHING;
        """

        row_id: int = 0
        with self.db.session() as conn:
            cursor = conn.execute(
                sql_record,
                (
                    record_uuid,
                    now_iso,
                    det.device_id,
                    det.denomination,
                    det.currency,
                    det.currency_type.value,
                    det.confidence,
                    det.label,
                    bbox_json,
                    1 if det.audio_announced else 0,
                ),
            )
            row_id = cursor.lastrowid or 0
            conn.execute(
                sql_queue,
                ("currency", record_uuid, json.dumps(det_dict), now_iso),
            )

        logger.debug("Saved currency detection %s (%s) → row %d", record_uuid, det.label, row_id)
        return row_id

    def get_recent_currency_detections(self, limit: int = 50) -> List[CurrencyDetection]:
        """Fetch latest currency detections."""
        sql = """
        SELECT id, record_uuid, timestamp, device_id, denomination, currency,
               currency_type, confidence, label, bbox_json, audio_announced
        FROM currency_detections
        ORDER BY timestamp DESC
        LIMIT ?;
        """
        with self.db.session() as conn:
            cursor = conn.execute(sql, (limit,))
            rows = cursor.fetchall()

        results = []
        for r in rows:
            row_dict = dict(r)
            bbox = json.loads(row_dict["bbox_json"]) if row_dict.get("bbox_json") else None
            results.append(
                CurrencyDetection(
                    id=row_dict["id"],
                    device_id=row_dict["device_id"],
                    denomination=float(row_dict["denomination"]),
                    currency=row_dict["currency"],
                    currency_type=CurrencyType(row_dict["currency_type"]),
                    confidence=float(row_dict["confidence"]),
                    label=row_dict["label"],
                    bbox=bbox,
                    audio_announced=bool(row_dict["audio_announced"]),
                    timestamp=datetime.fromisoformat(row_dict["timestamp"]),
                )
            )
        return results

    # ------------------------------------------------------------------
    # OCR Text Readings
    # ------------------------------------------------------------------

    def save_ocr_reading(self, ocr: OCRTextReading) -> int:
        """
        Persist OCR text reading with atomic dual-write to sync_queue.
        Returns the inserted rowid.
        """
        record_uuid = str(uuid.uuid4())
        now_iso = ocr.timestamp.isoformat()
        ocr_dict = ocr.model_dump(mode="json")
        bbox_json = json.dumps(ocr.bbox) if ocr.bbox else None

        sql_record = """
        INSERT INTO ocr_readings
            (record_uuid, timestamp, device_id, raw_text, cleaned_text, confidence, language, bbox_json, audio_announced)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
        """
        sql_queue = """
        INSERT INTO sync_queue
            (entity_type, entity_id, payload, priority, retry_count, status, next_attempt_at)
        VALUES (?, ?, ?, 0, 0, 'pending', ?)
        ON CONFLICT(entity_type, entity_id) DO NOTHING;
        """

        row_id: int = 0
        with self.db.session() as conn:
            cursor = conn.execute(
                sql_record,
                (
                    record_uuid,
                    now_iso,
                    ocr.device_id,
                    ocr.raw_text,
                    ocr.cleaned_text,
                    ocr.confidence,
                    ocr.language,
                    bbox_json,
                    1 if ocr.audio_announced else 0,
                ),
            )
            row_id = cursor.lastrowid or 0
            conn.execute(
                sql_queue,
                ("ocr", record_uuid, json.dumps(ocr_dict), now_iso),
            )

        logger.debug("Saved OCR text reading %s ('%s') → row %d", record_uuid, ocr.cleaned_text[:30], row_id)
        return row_id

    def get_recent_ocr_readings(self, limit: int = 50) -> List[OCRTextReading]:
        """Fetch latest OCR text readings."""
        sql = """
        SELECT id, record_uuid, timestamp, device_id, raw_text, cleaned_text,
               confidence, language, bbox_json, audio_announced
        FROM ocr_readings
        ORDER BY timestamp DESC
        LIMIT ?;
        """
        with self.db.session() as conn:
            cursor = conn.execute(sql, (limit,))
            rows = cursor.fetchall()

        results = []
        for r in rows:
            row_dict = dict(r)
            bbox = json.loads(row_dict["bbox_json"]) if row_dict.get("bbox_json") else None
            results.append(
                OCRTextReading(
                    id=row_dict["id"],
                    device_id=row_dict["device_id"],
                    raw_text=row_dict["raw_text"],
                    cleaned_text=row_dict["cleaned_text"],
                    confidence=float(row_dict["confidence"]),
                    language=row_dict["language"],
                    bbox=bbox,
                    audio_announced=bool(row_dict["audio_announced"]),
                    timestamp=datetime.fromisoformat(row_dict["timestamp"]),
                )
            )
        return results

    # ------------------------------------------------------------------
    # Heartbeats & System Health
    # ------------------------------------------------------------------

    def save_heartbeat(
        self,
        cpu_percent: float,
        memory_percent: float,
        network_status: str,
        active_sensors: List[str],
        battery_pct: Optional[float] = None,
    ) -> int:
        """Record node heartbeat telemetry. Returns rowid."""
        now_iso = datetime.now(timezone.utc).isoformat()
        sql = """
        INSERT INTO heartbeats
            (timestamp, cpu_percent, memory_percent, network_status, battery_pct, active_sensors)
        VALUES (?, ?, ?, ?, ?, ?);
        """
        with self.db.session() as conn:
            cursor = conn.execute(
                sql,
                (
                    now_iso,
                    cpu_percent,
                    memory_percent,
                    network_status,
                    battery_pct,
                    json.dumps(active_sensors),
                ),
            )
            return cursor.lastrowid or 0

    def get_system_stats(self) -> Dict[str, Any]:
        """Return aggregated counts for telemetry and sync queue status."""
        with self.db.session() as conn:
            g_count = conn.execute("SELECT COUNT(*) FROM glucose_readings;").fetchone()[0]
            f_count = conn.execute("SELECT COUNT(*) FROM fall_events;").fetchone()[0]
            o_count = conn.execute("SELECT COUNT(*) FROM obstacle_detections;").fetchone()[0]
            c_count = conn.execute("SELECT COUNT(*) FROM currency_detections;").fetchone()[0]
            ocr_count = conn.execute("SELECT COUNT(*) FROM ocr_readings;").fetchone()[0]
            sq_pending = conn.execute(
                "SELECT COUNT(*) FROM sync_queue WHERE status = 'pending';"
            ).fetchone()[0]
            sq_synced = conn.execute(
                "SELECT COUNT(*) FROM sync_queue WHERE status = 'synced';"
            ).fetchone()[0]
            last_hb = conn.execute(
                "SELECT * FROM heartbeats ORDER BY id DESC LIMIT 1;"
            ).fetchone()

        return {
            "glucose_readings_count": g_count,
            "fall_events_count": f_count,
            "obstacle_detections_count": o_count,
            "currency_detections_count": c_count,
            "ocr_readings_count": ocr_count,
            "sync_pending_count": sq_pending,
            "sync_synced_count": sq_synced,
            "last_heartbeat": dict(last_hb) if last_hb else None,
        }

    def get_caregivers(self) -> List[Dict[str, Any]]:
        """Return all registered emergency caregivers."""
        sql = "SELECT * FROM caregivers ORDER BY is_primary DESC, id ASC;"
        try:
            with self.db.session() as conn:
                cursor = conn.execute(sql)
                return [dict(row) for row in cursor.fetchall()]
        except Exception:
            return []

    def save_caregiver(
        self,
        full_name: str,
        phone_e164: str,
        relationship: str = "Familiar",
        is_primary: bool = True,
        notify_whatsapp: bool = True,
    ) -> Dict[str, Any]:
        """Insert or update a caregiver contact."""
        rec_uuid = str(uuid.uuid4())
        sql = """
        INSERT INTO caregivers
            (record_uuid, full_name, phone_e164, relationship, is_primary, notify_whatsapp)
        VALUES (?, ?, ?, ?, ?, ?);
        """
        with self.db.session() as conn:
            cursor = conn.execute(
                sql,
                (
                    rec_uuid,
                    full_name.strip(),
                    phone_e164.strip(),
                    relationship.strip(),
                    1 if is_primary else 0,
                    1 if notify_whatsapp else 0,
                ),
            )
            return {
                "id": cursor.lastrowid or 0,
                "record_uuid": rec_uuid,
                "full_name": full_name,
                "phone_e164": phone_e164,
                "relationship": relationship,
                "is_primary": is_primary,
                "notify_whatsapp": notify_whatsapp,
            }


# Backward-compatible alias — old code importing StorageRepository still works
StorageRepository = EcoEyeRepository

# Global singleton for non-test usage
repository = EcoEyeRepository()
