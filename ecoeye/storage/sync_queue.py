"""
EcoEye Resilient Sync Queue Manager.

Offline-first queue with exponential backoff + full jitter and idempotency.
Handles state machine transitions (pending → in_progress → synced / failed),
retry logic with Dead-Letter semantics after max retries, and stale-record recovery.

Public API aligned with test_storage.py:
  - SyncQueueManager(db_manager=None)
  - enqueue(entity_type, entity_id, payload, priority=0) → int
  - get_pending_items(batch_size=25) → List[dict]
  - record_failure(item_id, error_message=None) → None
  - mark_success(item_id) → None
  - mark_in_progress(item_ids) → None  [alias: mark_in_flight]
  - get_queue_stats() → dict
  - cleanup_synced(older_than_days=7) → int
"""

from __future__ import annotations

import json
import logging
import random
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from ecoeye.config import settings
from ecoeye.core.models import SyncPacket, TelemetryMessage
from ecoeye.core.security import CryptoEngine, compute_hmac
from ecoeye.storage.database import DatabaseManager, db_manager

logger = logging.getLogger("ecoeye.storage.sync_queue")

# Backoff constants
_BACKOFF_BASE: float = 2.0
_BACKOFF_CAP_SEC: float = 300.0
_MAX_ATTEMPTS: int = 5
_STALE_INFLIGHT_SEC: int = 60


class SyncQueueManager:
    """
    Manages the local SQLite queue of pending telemetry records waiting
    to be synchronized with the Central Gateway / Supabase.

    State machine:
        pending → in_progress → synced
                              → failed (after max retries)
        in_progress → pending (stale recovery after 60s)
    """

    def __init__(
        self,
        db_manager: Optional[DatabaseManager] = None,
        crypto: Optional[CryptoEngine] = None,
        node_id: Optional[str] = None,
    ):
        self.db = db_manager or _db_manager_default()
        self.crypto = crypto or CryptoEngine()
        self.node_id = node_id or settings.device_id

    # ------------------------------------------------------------------
    # Enqueue
    # ------------------------------------------------------------------

    def enqueue(
        self,
        entity_type: str,
        entity_id: Any,
        payload: Dict[str, Any],
        priority: int = 0,
    ) -> int:
        """
        Insert a new item into the sync queue.
        Returns the rowid of the inserted record (or 0 on conflict skip).
        Idempotent: (entity_type, entity_id) is UNIQUE — duplicate calls are no-ops.
        """
        now_iso = datetime.now(timezone.utc).isoformat()
        sql = """
        INSERT INTO sync_queue
            (entity_type, entity_id, payload, priority, retry_count, status, next_attempt_at)
        VALUES (?, ?, ?, ?, 0, 'pending', ?)
        ON CONFLICT(entity_type, entity_id) DO NOTHING;
        """
        with self.db.session() as conn:
            cursor = conn.execute(
                sql,
                (entity_type, str(entity_id), json.dumps(payload), priority, now_iso),
            )
            row_id = cursor.lastrowid or 0

        if row_id:
            logger.debug(
                "Enqueued %s/%s (priority=%d) → queue row %d",
                entity_type, entity_id, priority, row_id,
            )
        return row_id

    # ------------------------------------------------------------------
    # Fetch pending
    # ------------------------------------------------------------------

    def get_pending_items(self, batch_size: int = 25) -> List[Dict[str, Any]]:
        """
        Fetch pending sync items whose next_attempt_at has passed or is NULL.
        Also recovers stale in_progress records older than 60 seconds.
        """
        now_iso = datetime.now(timezone.utc).isoformat()
        stale_threshold = (
            datetime.now(timezone.utc) - timedelta(seconds=_STALE_INFLIGHT_SEC)
        ).isoformat()

        with self.db.session() as conn:
            # Recover stale in_progress records
            conn.execute(
                """
                UPDATE sync_queue
                SET status = 'pending', updated_at = ?
                WHERE status = 'in_progress' AND updated_at < ?
                """,
                (now_iso, stale_threshold),
            )

            cursor = conn.execute(
                """
                SELECT id, entity_type, entity_id, payload,
                       priority, retry_count, status, next_attempt_at, created_at
                FROM sync_queue
                WHERE status = 'pending'
                  AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
                ORDER BY priority DESC, id ASC
                LIMIT ?
                """,
                (now_iso, batch_size),
            )
            return [dict(row) for row in cursor.fetchall()]

    # ------------------------------------------------------------------
    # State transitions
    # ------------------------------------------------------------------

    def mark_in_progress(self, item_ids: List[int]) -> None:
        """Mark items as currently being transmitted."""
        if not item_ids:
            return
        now_iso = datetime.now(timezone.utc).isoformat()
        placeholders = ",".join("?" for _ in item_ids)
        with self.db.session() as conn:
            conn.execute(
                f"""
                UPDATE sync_queue
                SET status = 'in_progress', updated_at = ?
                WHERE id IN ({placeholders})
                """,
                [now_iso, *item_ids],
            )
        logger.debug("Marked %d items as in_progress", len(item_ids))

    # Alias kept for backward compatibility
    mark_in_flight = mark_in_progress

    def mark_success(self, item_id: int) -> None:
        """Mark a single queue item as successfully synced."""
        now_iso = datetime.now(timezone.utc).isoformat()
        with self.db.session() as conn:
            # Get entity info for cross-table sync flag update
            row = conn.execute(
                "SELECT entity_type, entity_id FROM sync_queue WHERE id = ?",
                (item_id,),
            ).fetchone()

            conn.execute(
                """
                UPDATE sync_queue
                SET status = 'synced', updated_at = ?
                WHERE id = ?
                """,
                (now_iso, item_id),
            )

            if row:
                etype = row["entity_type"]
                eid = row["entity_id"]
                if etype == "glucose":
                    conn.execute(
                        "UPDATE glucose_readings SET synced = 1 WHERE record_uuid = ?", (eid,)
                    )
                elif etype == "fall":
                    conn.execute(
                        "UPDATE fall_events SET synced = 1 WHERE record_uuid = ?", (eid,)
                    )
                elif etype == "obstacle":
                    conn.execute(
                        "UPDATE obstacle_detections SET synced = 1 WHERE record_uuid = ?", (eid,)
                    )

        logger.info("Queue item %d marked as synced", item_id)

    def mark_synced(self, item_ids: List[int]) -> None:
        """Bulk-mark a list of queue items as successfully synced."""
        for item_id in item_ids:
            self.mark_success(item_id)

    def record_failure(
        self,
        item_id: int,
        error_message: Optional[str] = None,
        max_attempts: int = _MAX_ATTEMPTS,
        backoff_base: float = _BACKOFF_BASE,
    ) -> None:
        """
        Increment retry count and compute exponential backoff with full jitter.
        After max_attempts, transitions item to 'failed' (Dead-Letter).

        Full jitter formula (AWS recommendation):
            sleep = random_between(0, min(cap, base^attempt))
        """
        now = datetime.now(timezone.utc)
        now_iso = now.isoformat()

        with self.db.session() as conn:
            row = conn.execute(
                "SELECT retry_count FROM sync_queue WHERE id = ?", (item_id,)
            ).fetchone()

            if not row:
                logger.warning("record_failure called on unknown queue item %d", item_id)
                return

            new_count = row["retry_count"] + 1

            if new_count >= max_attempts:
                conn.execute(
                    """
                    UPDATE sync_queue
                    SET status = 'failed',
                        retry_count = ?,
                        last_error = ?,
                        updated_at = ?
                    WHERE id = ?
                    """,
                    (new_count, error_message or "max retries exceeded", now_iso, item_id),
                )
                logger.warning(
                    "Queue item %d → FAILED after %d attempts. Error: %s",
                    item_id, new_count, error_message,
                )
            else:
                # Full jitter: uniform random in [0, min(cap, base^attempt)]
                raw_delay = min(_BACKOFF_CAP_SEC, backoff_base ** new_count)
                delay_sec = random.uniform(0.0, raw_delay)
                next_attempt = now + timedelta(seconds=delay_sec)

                conn.execute(
                    """
                    UPDATE sync_queue
                    SET status = 'pending',
                        retry_count = ?,
                        next_attempt_at = ?,
                        last_error = ?,
                        updated_at = ?
                    WHERE id = ?
                    """,
                    (new_count, next_attempt.isoformat(), error_message, now_iso, item_id),
                )
                logger.debug(
                    "Queue item %d → retry #%d in %.1fs (at %s)",
                    item_id, new_count, delay_sec, next_attempt.isoformat(),
                )

    # Alias for old code using mark_retry
    def mark_retry(
        self,
        item_id: int,
        error_msg: Optional[str] = None,
        max_attempts: int = _MAX_ATTEMPTS,
        backoff_base: float = _BACKOFF_BASE,
    ) -> None:
        self.record_failure(
            item_id,
            error_message=error_msg,
            max_attempts=max_attempts,
            backoff_base=backoff_base,
        )

    # ------------------------------------------------------------------
    # Batch sync packet builder
    # ------------------------------------------------------------------

    def build_sync_packet(
        self,
        limit: int = 25,
        mark_as_in_progress: bool = True,
    ) -> Optional[Tuple[SyncPacket, List[int]]]:
        """
        Collect pending records, build an HMAC-authenticated SyncPacket,
        and optionally flag items as in_progress.
        """
        pending = self.get_pending_items(batch_size=limit)
        if not pending:
            return None

        item_ids: List[int] = []
        messages: List[TelemetryMessage] = []

        for item in pending:
            item_id = item["id"]
            try:
                raw_payload = json.loads(item["payload"])
                message = TelemetryMessage(
                    id=raw_payload.get("id", str(item["entity_id"])),
                    source=item["entity_type"],
                    event_type=f"{item['entity_type']}_event",
                    payload=raw_payload,
                    is_encrypted=False,
                    synced=False,
                )
                messages.append(message)
                item_ids.append(item_id)
            except Exception as exc:
                logger.error("Failed to parse sync queue item %d: %s", item_id, exc)
                self.record_failure(item_id, error_message=f"JSON parse error: {exc}")

        if not messages:
            return None

        serialized = json.dumps(
            [msg.model_dump(mode="json") for msg in messages],
            sort_keys=True,
        )
        checksum = compute_hmac(serialized, settings.secret_key)

        packet = SyncPacket(
            node_id=self.node_id,
            created_at=datetime.now(timezone.utc),
            messages=messages,
            checksum=checksum,
        )

        if mark_as_in_progress:
            self.mark_in_progress(item_ids)

        return packet, item_ids

    # ------------------------------------------------------------------
    # Utilities
    # ------------------------------------------------------------------

    def get_queue_stats(self) -> Dict[str, int]:
        """Return item counts grouped by status."""
        with self.db.session() as conn:
            cursor = conn.execute(
                "SELECT status, COUNT(*) as count FROM sync_queue GROUP BY status"
            )
            counts = {row["status"]: row["count"] for row in cursor.fetchall()}
        return {
            "pending": counts.get("pending", 0),
            "in_progress": counts.get("in_progress", 0),
            "synced": counts.get("synced", 0),
            "failed": counts.get("failed", 0),
            "total": sum(counts.values()),
        }

    def cleanup_synced(self, older_than_days: int = 7) -> int:
        """Purge synced records older than the specified threshold. Returns deleted count."""
        threshold = (
            datetime.now(timezone.utc) - timedelta(days=older_than_days)
        ).isoformat()
        with self.db.session() as conn:
            cursor = conn.execute(
                "DELETE FROM sync_queue WHERE status = 'synced' AND updated_at < ?",
                (threshold,),
            )
            deleted = cursor.rowcount
        logger.info("Cleaned up %d expired synced items from sync_queue", deleted)
        return deleted


def _db_manager_default() -> DatabaseManager:
    """Deferred import of default db_manager to avoid circular init at module load."""
    from ecoeye.storage.database import db_manager as _dm
    return _dm
