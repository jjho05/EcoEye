"""
EcoEye Remote PostgreSQL & Neon Database Layer.

Provides high-availability connection management, health probes, automated schema
seeding, and synchronization bridging the local offline-first SQLite database
with the central PostgreSQL / Neon cloud repository.
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Dict, Generator, List, Optional, Tuple

from ecoeye.config import settings

logger = logging.getLogger("ecoeye.storage.postgres")

try:
    import psycopg2
    from psycopg2 import pool, sql
    from psycopg2.extras import RealDictCursor
    _PSYCOPG2_AVAILABLE = True
except ImportError:
    _PSYCOPG2_AVAILABLE = False
    logger.warning("psycopg2 is not installed — remote PostgreSQL integration disabled")


class PostgresManager:
    """
    Manages connections and transactions against remote PostgreSQL / Neon instances.
    Implements idempotent seeding, health telemetry, and bidirectional queue drainage.
    """

    def __init__(self, database_url: Optional[str] = None):
        self._url: Optional[str] = database_url
        self._pool: Optional[Any] = None
        self._default_user_uuid = str(uuid.uuid5(uuid.NAMESPACE_DNS, "patient.ecoeye-demo"))
        self._default_device_uuid = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"device.{settings.device_id}"))

    @property
    def database_url(self) -> Optional[str]:
        if self._url is not None:
            return self._url if self._url != "" else None
        return settings.database_url


    def is_configured(self) -> bool:
        """Indica si existe una cadena de conexión configurada y el driver está disponible."""
        return bool(_PSYCOPG2_AVAILABLE and self.database_url)

    @contextmanager
    def get_connection(self) -> Generator[Any, None, None]:
        """
        Context manager que proporciona una conexión segura con timeout de 5 segundos.
        Asegura commit automático en éxito o rollback en excepción.
        """
        if not self.is_configured():
            raise ConnectionError("PostgreSQL database_url no está configurado o psycopg2 no está disponible")

        # Configurar connection timeout
        conn_params = {
            "connect_timeout": 5,
        }
        conn = psycopg2.connect(self.database_url, **conn_params)
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def check_connection(self) -> Dict[str, Any]:
        """
        Verifica el estado de salud, versión del motor, conteo de tablas y latencia de red.
        """
        if not self.is_configured():
            return {
                "configured": False,
                "connected": False,
                "provider": "Neon Serverless PostgreSQL (Desconectado)",
                "error": "ECOEYE_DATABASE_URL no definida o psycopg2 ausente",
                "tables": {},
                "latency_ms": None,
            }

        start = time.perf_counter()
        try:
            with self.get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT version();")
                    ver = cur.fetchone()[0]

                    table_counts: Dict[str, int] = {}
                    for table in ["profiles", "devices", "alerts", "caregivers", "device_telemetry"]:
                        try:
                            cur.execute(sql.SQL("SELECT count(*) FROM public.{}").format(sql.Identifier(table)))
                            table_counts[table] = cur.fetchone()[0]
                        except Exception:
                            table_counts[table] = 0

            latency_ms = round((time.perf_counter() - start) * 1000, 2)
            return {
                "configured": True,
                "connected": True,
                "provider": "Neon Serverless PostgreSQL (AWS us-east-2)",
                "version": ver.split()[0] + " " + ver.split()[1],
                "tables": table_counts,
                "latency_ms": latency_ms,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        except Exception as exc:
            logger.error("Error comprobando salud de PostgreSQL: %s", exc)
            return {
                "configured": True,
                "connected": False,
                "provider": "Neon Serverless PostgreSQL",
                "error": str(exc),
                "tables": {},
                "latency_ms": None,
            }

    def ensure_seed_records(
        self,
        patient_name: str = "Paciente Demostración EcoEye",
        device_name: str = "EcoEye Edge Wearable 001",
    ) -> Tuple[str, str]:
        """
        Garantiza la existencia del usuario base y dispositivo edge en public.profiles y public.devices
        para respetar las restricciones de llave foránea (FK) de PostgreSQL.
        Retorna la tupla (user_uuid, device_uuid).
        """
        if not self.is_configured():
            return self._default_user_uuid, self._default_device_uuid

        user_uuid = self._default_user_uuid
        device_uuid = self._default_device_uuid

        with self.get_connection() as conn:
            with conn.cursor() as cur:
                # 1. Asegurar registro en auth.users (dispara trigger para public.profiles)
                cur.execute(
                    """
                    INSERT INTO auth.users (id, email, raw_user_meta_data)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (id) DO NOTHING;
                    """,
                    (user_uuid, "paciente.demo@ecoeye.lat", json.dumps({"full_name": patient_name}))
                )

                # Asegurar por si el trigger estuviera desactivado
                cur.execute(
                    """
                    INSERT INTO public.profiles (id, full_name, locale, timezone)
                    VALUES (%s, %s, 'es-MX', 'America/Mexico_City')
                    ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name;
                    """,
                    (user_uuid, patient_name)
                )

                # 2. Asegurar dispositivo en public.devices
                cur.execute(
                    """
                    INSERT INTO public.devices (
                        id, user_id, mac_address, device_name, device_type, status, last_heartbeat
                    )
                    VALUES (%s, %s, %s, %s, 'wearable_hub'::public.device_type, 'activo'::public.device_status, NOW())
                    ON CONFLICT (id) DO UPDATE SET
                        last_heartbeat = NOW(),
                        status = 'activo'::public.device_status;
                    """,
                    (device_uuid, user_uuid, settings.device_id, device_name)
                )

        return user_uuid, device_uuid

    def insert_alert(
        self,
        alert_id: Optional[str] = None,
        alert_type: str = "caida_detectada",
        severity: str = "critica",
        status: str = "activa",
        payload: Optional[Dict[str, Any]] = None,
        occurred_at: Optional[str] = None,
    ) -> bool:
        """
        Inserta una alerta con idempotencia (ON CONFLICT DO UPDATE).
        """
        if not self.is_configured():
            return False

        user_uuid, device_uuid = self.ensure_seed_records()
        record_id = alert_id or str(uuid.uuid4())
        occ_dt = occurred_at or datetime.now(timezone.utc).isoformat()
        payload_data = payload or {}

        # Mapear tipos de alerta compatibles con enum en PostgreSQL
        valid_types = {
            "caida_detectada", "obstaculo_inminente", "dispositivo_offline",
            "bateria_baja", "anomalia_sistema", "prueba_sistema"
        }
        safe_alert_type = alert_type if alert_type in valid_types else "anomalia_sistema"

        valid_severities = {"info", "advertencia", "critica"}
        safe_severity = severity if severity in valid_severities else "advertencia"

        valid_statuses = {"activa", "reconocida", "falsa_alarma", "resuelta"}
        safe_status = status if status in valid_statuses else "activa"

        try:
            with self.get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO public.alerts (
                            id, user_id, device_id, alert_type, severity, status,
                            payload_json, occurred_at, synced_at
                        )
                        VALUES (
                            %s, %s, %s,
                            %s::public.alert_type,
                            %s::public.alert_severity,
                            %s::public.alert_status,
                            %s, %s, NOW()
                        )
                        ON CONFLICT (id) DO UPDATE SET
                            status = EXCLUDED.status,
                            payload_json = EXCLUDED.payload_json,
                            synced_at = NOW();
                        """,
                        (
                            record_id,
                            user_uuid,
                            device_uuid,
                            safe_alert_type,
                            safe_severity,
                            safe_status,
                            json.dumps(payload_data),
                            occ_dt,
                        )
                    )
            return True
        except Exception as exc:
            logger.error("Error insertando alerta en PostgreSQL: %s", exc)
            return False

    def insert_telemetry(
        self,
        battery_level: Optional[float] = None,
        cpu_temp: Optional[float] = None,
        uptime_seconds: Optional[int] = None,
        network_latency_ms: Optional[int] = None,
        recorded_at: Optional[str] = None,
    ) -> bool:
        """Inserta una lectura de telemetría de hardware en public.device_telemetry."""
        if not self.is_configured():
            return False

        _, device_uuid = self.ensure_seed_records()
        record_id = str(uuid.uuid4())
        rec_dt = recorded_at or datetime.now(timezone.utc).isoformat()

        try:
            with self.get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO public.device_telemetry (
                            id, device_id, battery_level, cpu_temp, uptime_seconds,
                            network_latency_ms, recorded_at
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s);
                        """,
                        (
                            record_id,
                            device_uuid,
                            battery_level,
                            cpu_temp,
                            uptime_seconds,
                            network_latency_ms,
                            rec_dt,
                        )
                    )
            return True
        except Exception as exc:
            logger.error("Error insertando telemetría en PostgreSQL: %s", exc)
            return False

    def get_recent_alerts(self, limit: int = 50) -> List[Dict[str, Any]]:
        """Obtiene las alertas más recientes sincronizadas en la nube."""
        if not self.is_configured():
            return []

        try:
            with self.get_connection() as conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cur:
                    cur.execute(
                        """
                        SELECT id, alert_type, severity, status, payload_json, occurred_at, synced_at
                        FROM public.alerts
                        ORDER BY occurred_at DESC
                        LIMIT %s;
                        """,
                        (limit,)
                    )
                    rows = cur.fetchall()
                    return [dict(r) for r in rows]
        except Exception as exc:
            logger.error("Error consultando alertas de PostgreSQL: %s", exc)
            return []

    def get_recent_telemetry(self, limit: int = 50) -> List[Dict[str, Any]]:
        """Obtiene lecturas de telemetría recientes desde la nube."""
        if not self.is_configured():
            return []

        try:
            with self.get_connection() as conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cur:
                    cur.execute(
                        """
                        SELECT id, battery_level, cpu_temp, uptime_seconds, network_latency_ms, recorded_at
                        FROM public.device_telemetry
                        ORDER BY recorded_at DESC
                        LIMIT %s;
                        """,
                        (limit,)
                    )
                    rows = cur.fetchall()
                    return [dict(r) for r in rows]
        except Exception as exc:
            logger.error("Error consultando telemetría de PostgreSQL: %s", exc)
            return []

    def sync_pending_queue(self, queue_mgr: Any = None, batch_size: int = 25) -> Dict[str, int]:
        """
        Drena elementos pendientes de la cola de sincronización SQLite y los almacena
        en las tablas correspondientes de PostgreSQL / Neon.
        """
        if not self.is_configured():
            return {"synced": 0, "failed": 0, "status": "unconfigured"}

        if queue_mgr is None:
            from ecoeye.storage.sync_queue import SyncQueueManager
            queue_mgr = SyncQueueManager()

        pending = queue_mgr.get_pending_items(batch_size=batch_size)
        if not pending:
            return {"synced": 0, "failed": 0, "status": "empty"}

        synced_count = 0
        failed_count = 0

        # Mapeo de tipos de entidad SQLite a PostgreSQL
        type_mapping = {
            "fall": ("caida_detectada", "critica"),
            "glucose": ("anomalia_sistema", "advertencia"),
            "obstacle": ("obstaculo_inminente", "advertencia"),
            "currency": ("prueba_sistema", "info"),
            "ocr": ("prueba_sistema", "info"),
        }

        for item in pending:
            item_id = item["id"]
            entity_type = item["entity_type"]
            entity_id = item["entity_id"]

            try:
                raw_payload = json.loads(item["payload"])
            except Exception:
                raw_payload = {"raw": str(item["payload"])}

            success = False
            if entity_type in ("heartbeat", "telemetry"):
                success = self.insert_telemetry(
                    battery_level=raw_payload.get("battery_pct") or raw_payload.get("battery_level"),
                    cpu_temp=raw_payload.get("cpu_percent") or raw_payload.get("cpu_temp"),
                    uptime_seconds=raw_payload.get("uptime_seconds"),
                    network_latency_ms=raw_payload.get("network_latency_ms"),
                    recorded_at=raw_payload.get("timestamp"),
                )
            else:
                alert_type, default_sev = type_mapping.get(entity_type, ("anomalia_sistema", "advertencia"))
                sev = raw_payload.get("severity") or default_sev
                if str(sev).lower() in ("critical", "critica"):
                    sev = "critica"
                elif str(sev).lower() in ("warning", "advertencia"):
                    sev = "advertencia"
                else:
                    sev = "info"

                deterministic_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"{settings.device_id}.{entity_id}"))
                success = self.insert_alert(
                    alert_id=deterministic_id,
                    alert_type=alert_type,
                    severity=sev,
                    status="activa",
                    payload=raw_payload,
                    occurred_at=raw_payload.get("timestamp"),
                )

            if success:
                queue_mgr.mark_success(item_id)
                synced_count += 1
            else:
                queue_mgr.record_failure(item_id, error_message="Fallo al escribir en PostgreSQL")
                failed_count += 1

        return {
            "synced": synced_count,
            "failed": failed_count,
            "status": "success" if failed_count == 0 else "partial_failure",
        }


# Instancia singleton del gestor PostgreSQL
postgres_manager = PostgresManager()
