"""
EcoEye Offline-First Database Layer.
Configures SQLite in WAL (Write-Ahead Logging) mode for concurrent
high-throughput edge storage, with schema migrations and connection
lifecycle management.

Table names are aligned with test_storage.py expectations:
  - glucose_readings
  - fall_events
  - obstacle_detections
  - heartbeats
  - telemetry_log
  - sync_queue
"""

from __future__ import annotations

import logging
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, Generator, List, Optional, Tuple

from ecoeye.config import settings

logger = logging.getLogger("ecoeye.storage.db")


SCHEMA_DDL = """\
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

-- Biomedical glucose telemetry (AES-256-GCM encrypted payload at rest)
CREATE TABLE IF NOT EXISTS glucose_readings (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    record_uuid  TEXT NOT NULL UNIQUE,
    timestamp    TEXT NOT NULL,
    sensor_id    TEXT NOT NULL,
    alert_level  TEXT NOT NULL,
    encrypted_data TEXT NOT NULL,
    synced       INTEGER DEFAULT 0,
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_glucose_ts     ON glucose_readings(timestamp);
CREATE INDEX IF NOT EXISTS idx_glucose_synced ON glucose_readings(synced);

-- WiFi-CSI fall detection events (encrypted)
CREATE TABLE IF NOT EXISTS fall_events (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    record_uuid         TEXT NOT NULL UNIQUE,
    timestamp           TEXT NOT NULL,
    device_id           TEXT NOT NULL,
    severity            TEXT NOT NULL,
    confidence          REAL NOT NULL,
    inactivity_secs     REAL NOT NULL,
    location_hint       TEXT NOT NULL,
    is_confirmed        INTEGER DEFAULT 0,
    encrypted_data      TEXT NOT NULL,
    synced              INTEGER DEFAULT 0,
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_fall_ts     ON fall_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_fall_synced ON fall_events(synced);

-- Edge vision obstacle detections
CREATE TABLE IF NOT EXISTS obstacle_detections (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    record_uuid      TEXT NOT NULL UNIQUE,
    timestamp        TEXT NOT NULL,
    sector           TEXT NOT NULL,
    distance_meters  REAL NOT NULL,
    urgency          TEXT NOT NULL,
    audio_message    TEXT NOT NULL,
    audio_played     INTEGER DEFAULT 0,
    label            TEXT,
    synced           INTEGER DEFAULT 0,
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_obs_ts     ON obstacle_detections(timestamp);
CREATE INDEX IF NOT EXISTS idx_obs_sector ON obstacle_detections(sector);

-- Cash currency detections (banknotes / coins)
CREATE TABLE IF NOT EXISTS currency_detections (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    record_uuid      TEXT NOT NULL UNIQUE,
    timestamp        TEXT NOT NULL,
    device_id        TEXT NOT NULL,
    denomination     REAL NOT NULL,
    currency         TEXT NOT NULL DEFAULT 'MXN',
    currency_type    TEXT NOT NULL,
    confidence       REAL NOT NULL,
    label            TEXT NOT NULL,
    bbox_json        TEXT,
    audio_announced  INTEGER DEFAULT 0,
    synced           INTEGER DEFAULT 0,
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_curr_ts     ON currency_detections(timestamp);
CREATE INDEX IF NOT EXISTS idx_curr_denom  ON currency_detections(denomination);

-- OCR text readings from smart glasses
CREATE TABLE IF NOT EXISTS ocr_readings (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    record_uuid      TEXT NOT NULL UNIQUE,
    timestamp        TEXT NOT NULL,
    device_id        TEXT NOT NULL,
    raw_text         TEXT NOT NULL,
    cleaned_text     TEXT NOT NULL,
    confidence       REAL NOT NULL,
    language         TEXT NOT NULL DEFAULT 'spa',
    bbox_json        TEXT,
    audio_announced  INTEGER DEFAULT 0,
    synced           INTEGER DEFAULT 0,
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ocr_ts     ON ocr_readings(timestamp);

-- Device heartbeat / health metrics
CREATE TABLE IF NOT EXISTS heartbeats (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp       TEXT NOT NULL,
    cpu_percent     REAL,
    memory_percent  REAL,
    network_status  TEXT,
    battery_pct     REAL,
    active_sensors  TEXT,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Generic telemetry log for non-critical events
CREATE TABLE IF NOT EXISTS telemetry_log (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp      TEXT NOT NULL,
    telemetry_type TEXT NOT NULL,
    source         TEXT NOT NULL,
    event_type     TEXT NOT NULL,
    payload_json   TEXT NOT NULL,
    synced         INTEGER DEFAULT 0,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_tlog_type   ON telemetry_log(telemetry_type);
CREATE INDEX IF NOT EXISTS idx_tlog_synced ON telemetry_log(synced);

-- Resilient offline sync queue with exponential backoff
CREATE TABLE IF NOT EXISTS sync_queue (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type    TEXT NOT NULL,
    entity_id      TEXT NOT NULL,
    payload        TEXT NOT NULL,
    priority       INTEGER DEFAULT 0,
    retry_count    INTEGER DEFAULT 0,
    status         TEXT DEFAULT 'pending',   -- pending, in_progress, synced, failed
    next_attempt_at TEXT,
    last_error     TEXT,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_sq_status ON sync_queue(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_sq_priority ON sync_queue(priority DESC, id ASC);
"""


class DatabaseManager:
    """
    Manages SQLite database connections, WAL configuration, and DDL schema lifecycle.

    Public API expected by tests and repository layers:
        - fetch_all(sql, params) → List[Dict]
        - fetch_one(sql, params) → Optional[Dict]
        - execute(sql, params)   → sqlite3.Cursor
        - init_db()              → None (idempotent)
        - session()              → context manager
    """

    def __init__(self, db_path: Optional[str] = None):
        self.db_path = Path(db_path or settings.db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.init_db()

    # ------------------------------------------------------------------
    # Connection lifecycle
    # ------------------------------------------------------------------

    def get_connection(self) -> sqlite3.Connection:
        """Return a configured connection with row_factory and WAL pragmas set."""
        conn = sqlite3.connect(
            str(self.db_path),
            timeout=10.0,
            check_same_thread=False,
        )
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode = WAL;")
        conn.execute("PRAGMA synchronous = NORMAL;")
        conn.execute("PRAGMA foreign_keys = ON;")
        conn.execute("PRAGMA busy_timeout = 5000;")
        return conn

    @contextmanager
    def session(self) -> Generator[sqlite3.Connection, None, None]:
        """Transactional context manager — commits on success, rolls back on exception."""
        conn = self.get_connection()
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Schema management
    # ------------------------------------------------------------------

    def init_db(self) -> None:
        """Initialize (or migrate) the schema idempotently using DDL scripts."""
        with self.session() as conn:
            conn.executescript(SCHEMA_DDL)
        logger.info("Database initialized in WAL mode at %s", self.db_path)

    # Alias used by old code that calls initialize_schema()
    def initialize_schema(self) -> None:
        self.init_db()

    # ------------------------------------------------------------------
    # Public query helpers — used by repository and tests
    # ------------------------------------------------------------------

    def fetch_all(
        self,
        sql: str,
        params: Tuple[Any, ...] = (),
    ) -> List[Dict[str, Any]]:
        """Execute a SELECT and return all rows as a list of dicts."""
        with self.session() as conn:
            cursor = conn.execute(sql, params)
            return [dict(row) for row in cursor.fetchall()]

    def fetch_one(
        self,
        sql: str,
        params: Tuple[Any, ...] = (),
    ) -> Optional[Dict[str, Any]]:
        """Execute a SELECT and return the first row as a dict, or None."""
        with self.session() as conn:
            cursor = conn.execute(sql, params)
            row = cursor.fetchone()
            return dict(row) if row else None

    def execute(
        self,
        sql: str,
        params: Tuple[Any, ...] = (),
    ) -> sqlite3.Cursor:
        """Execute a DML statement (INSERT / UPDATE / DELETE) outside a managed session.

        NOTE: For operations requiring atomicity with other statements, use the
        session() context manager directly.
        """
        with self.session() as conn:
            cursor = conn.execute(sql, params)
            return cursor


# Global database manager instance — used as default when no custom path is given
db_manager = DatabaseManager()
