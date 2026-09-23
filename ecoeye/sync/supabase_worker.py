"""
EcoEye Supabase Sync Worker.

Asynchronous background worker that drains the local SQLite sync_queue
and POSTs records to Supabase via its REST API with idempotent UUIDv5 IDs.

Key properties:
  - Idempotency: UUIDv5(namespace=node_id, name=local_uuid) ensures that
    retrying a failed POST never creates duplicate rows in Supabase (ON CONFLICT).
  - Offline-resilience: Falls back gracefully when the network is unavailable;
    items remain pending with exponential backoff + full jitter.
  - Batching: Processes items in configurable batches to reduce HTTP overhead.
  - Observability: Structured log lines for every sync attempt and outcome.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

try:
    import httpx
    _HTTPX_AVAILABLE = True
except ImportError:
    _HTTPX_AVAILABLE = False
    logging.getLogger("ecoeye.sync.supabase").warning(
        "httpx not installed — SupabaseWorker will run in DRY-RUN mode (no HTTP calls)"
    )

from ecoeye.config import settings
from ecoeye.storage.database import DatabaseManager, db_manager
from ecoeye.storage.sync_queue import SyncQueueManager

logger = logging.getLogger("ecoeye.sync.supabase")

# Supabase REST API endpoints (path relative to project URL)
_ALERTS_ENDPOINT = "/rest/v1/alerts"
_TELEMETRY_ENDPOINT = "/rest/v1/device_telemetry"

# Entity type → Supabase table mapping
_ENTITY_TABLE_MAP = {
    "fall": _ALERTS_ENDPOINT,
    "glucose": _ALERTS_ENDPOINT,
    "obstacle": _ALERTS_ENDPOINT,
    "heartbeat": _TELEMETRY_ENDPOINT,
    "telemetry": _TELEMETRY_ENDPOINT,
}

# Alert type mapping from entity_type
_ALERT_TYPE_MAP = {
    "fall": "caida_detectada",
    "glucose": "anomalia_sistema",
    "obstacle": "obstaculo_inminente",
}


def make_idempotent_id(node_id: str, local_id: str) -> str:
    """
    Generate a deterministic UUIDv5 from the node identifier and local record UUID.

    This guarantees that retrying the same record always produces the same UUID,
    enabling Supabase ON CONFLICT DO UPDATE to deduplicate correctly.
    """
    namespace = uuid.uuid5(uuid.NAMESPACE_DNS, node_id)
    return str(uuid.uuid5(namespace, local_id))


def build_alert_payload(
    entity_type: str,
    entity_id: str,
    raw_payload: Dict[str, Any],
    node_id: str,
    user_id: str,
    device_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Build a Supabase-compatible alert record from a sync queue item."""
    idempotent_id = make_idempotent_id(node_id, entity_id)

    severity_map = {
        "fall": "critica",
        "glucose": "advertencia",
        "obstacle": "advertencia",
    }

    # Override severity if payload contains critical level
    payload_severity = raw_payload.get("severity", "")
    if payload_severity in ("critical", "CRITICAL", "critica"):
        severity = "critica"
    elif payload_severity in ("high", "HIGH"):
        severity = "critica"
    else:
        severity = severity_map.get(entity_type, "advertencia")

    return {
        "id": idempotent_id,
        "user_id": user_id,
        "device_id": device_id or settings.device_id,
        "alert_type": _ALERT_TYPE_MAP.get(entity_type, "anomalia_sistema"),
        "severity": severity,
        "status": "activa",
        "payload_json": raw_payload,
        "occurred_at": raw_payload.get(
            "timestamp", datetime.now(timezone.utc).isoformat()
        ),
    }


def build_telemetry_payload(
    entity_id: str,
    raw_payload: Dict[str, Any],
    node_id: str,
    device_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Build a Supabase-compatible device_telemetry record."""
    idempotent_id = make_idempotent_id(node_id, entity_id)
    return {
        "id": idempotent_id,
        "device_id": device_id or settings.device_id,
        "battery_level": raw_payload.get("battery_pct"),
        "cpu_temp": raw_payload.get("cpu_percent"),
        "uptime_seconds": raw_payload.get("uptime_seconds"),
        "network_latency_ms": raw_payload.get("network_latency_ms"),
        "recorded_at": raw_payload.get(
            "timestamp", datetime.now(timezone.utc).isoformat()
        ),
    }


class SupabaseWorker:
    """
    Async background worker that syncs pending queue items to Supabase.

    Args:
        supabase_url: Supabase project URL (e.g. https://xxx.supabase.co).
        supabase_key: Supabase anon/service_role API key.
        user_id: UUID of the patient user in Supabase (for RLS).
        device_id: UUID of the registered device in Supabase.
        batch_size: Number of queue items to process per sync cycle.
        sync_interval_sec: Seconds between sync cycles when queue is empty.
        db: Optional custom DatabaseManager.
    """

    def __init__(
        self,
        supabase_url: Optional[str] = None,
        supabase_key: Optional[str] = None,
        user_id: str = "00000000-0000-0000-0000-000000000001",
        device_id: Optional[str] = None,
        batch_size: int = 10,
        sync_interval_sec: float = 15.0,
        db: Optional[DatabaseManager] = None,
    ):
        self.supabase_url = (supabase_url or "").rstrip("/")
        self.supabase_key = supabase_key or ""
        self.user_id = user_id
        self.device_id = device_id or settings.device_id
        self.batch_size = batch_size
        self.sync_interval_sec = sync_interval_sec
        self.node_id = settings.device_id

        _db = db or db_manager
        self.queue_mgr = SyncQueueManager(db_manager=_db)
        self._running = False

    def _build_http_headers(self) -> Dict[str, str]:
        return {
            "apikey": self.supabase_key,
            "Authorization": f"Bearer {self.supabase_key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates",  # ON CONFLICT DO UPDATE
        }

    async def _post_record(
        self,
        client: "httpx.AsyncClient",
        endpoint: str,
        payload: Dict[str, Any],
    ) -> bool:
        """
        POST a single record to Supabase REST API.
        Returns True on 200/201, False on any error.
        """
        url = f"{self.supabase_url}{endpoint}"
        try:
            response = await client.post(
                url,
                json=payload,
                headers=self._build_http_headers(),
                timeout=10.0,
            )
            if response.status_code in (200, 201):
                return True
            else:
                logger.warning(
                    "Supabase POST %s → HTTP %d: %s",
                    endpoint, response.status_code, response.text[:200],
                )
                return False
        except Exception as exc:
            logger.error("HTTP error posting to %s: %s", endpoint, exc)
            return False

    async def _sync_batch(self) -> None:
        """Process one batch from the sync queue."""
        pending = self.queue_mgr.get_pending_items(batch_size=self.batch_size)
        if not pending:
            return

        item_ids = [item["id"] for item in pending]
        self.queue_mgr.mark_in_progress(item_ids)

        if not _HTTPX_AVAILABLE or not self.supabase_url or not self.supabase_key:
            # DRY-RUN mode: log the payload and mark as synced
            for item in pending:
                logger.info(
                    "[DRY-RUN] Would sync %s/%s to Supabase",
                    item["entity_type"], item["entity_id"],
                )
                self.queue_mgr.mark_success(item["id"])
            return

        async with httpx.AsyncClient() as client:
            for item in pending:
                item_id = item["id"]
                entity_type = item["entity_type"]
                entity_id = item["entity_id"]

                try:
                    raw_payload = json.loads(item["payload"])
                except json.JSONDecodeError as exc:
                    logger.error("Invalid payload JSON for item %d: %s", item_id, exc)
                    self.queue_mgr.record_failure(item_id, error_message=str(exc))
                    continue

                # Route to the correct endpoint and build payload
                endpoint = _ENTITY_TABLE_MAP.get(entity_type, _ALERTS_ENDPOINT)

                if entity_type in _ALERT_TYPE_MAP:
                    post_payload = build_alert_payload(
                        entity_type=entity_type,
                        entity_id=entity_id,
                        raw_payload=raw_payload,
                        node_id=self.node_id,
                        user_id=self.user_id,
                        device_id=self.device_id,
                    )
                else:
                    post_payload = build_telemetry_payload(
                        entity_id=entity_id,
                        raw_payload=raw_payload,
                        node_id=self.node_id,
                        device_id=self.device_id,
                    )

                success = await self._post_record(client, endpoint, post_payload)
                if success:
                    self.queue_mgr.mark_success(item_id)
                    logger.info(
                        "[SYNC_OK] Synced %s/%s → Supabase %s",
                        entity_type, entity_id, endpoint,
                    )
                else:
                    self.queue_mgr.record_failure(
                        item_id,
                        error_message=f"Supabase POST failed for {entity_type}/{entity_id}",
                    )

    async def run(self) -> None:
        """
        Main async loop: sync pending items, then sleep until next cycle.
        Runs indefinitely until stop() is called.
        """
        self._running = True
        logger.info(
            "SupabaseWorker started (interval=%.0fs, batch=%d, url=%s)",
            self.sync_interval_sec, self.batch_size,
            self.supabase_url or "DRY-RUN",
        )

        while self._running:
            try:
                await self._sync_batch()
            except Exception as exc:
                logger.error("Unexpected error in sync batch: %s", exc, exc_info=True)

            await asyncio.sleep(self.sync_interval_sec)

        logger.info("SupabaseWorker stopped")

    def stop(self) -> None:
        """Signal the sync loop to exit after the current batch."""
        self._running = False
