"""
EcoEye — Main Orchestrator.

Single entry point that bootstraps all subsystems:
  1. Database (SQLite WAL, schema init)
  2. EventBus (async pub/sub)
  3. Sensor modules (WiFi-CSI, Vision, Glucose BLE, Audio)
  4. Supabase sync worker
  5. Heartbeat loop (battery, CPU, network → sync_queue every 30s)
  6. FastAPI server (health, stats, alerts, readings endpoints)

Run with:
    python3 -m ecoeye.main
    python3 ecoeye/main.py
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
import time
from datetime import datetime, timezone
from typing import Optional

# ── configure logging before any imports that log at module level ──────────
logging.basicConfig(
    level=logging.DEBUG if os.getenv("ECOEYE_DEBUG", "true").lower() == "true" else logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("ecoeye.main")

from ecoeye.config import settings
from ecoeye.core.bus import EventBus
from ecoeye.core.models import (
    CurrencyDetection,
    FallEvent,
    GlucoseReading,
    GlucoseAlertLevel,
    ObstacleDetection,
    OCRTextReading,
)
from ecoeye.storage.database import DatabaseManager
from ecoeye.storage.repository import EcoEyeRepository
from ecoeye.storage.sync_queue import SyncQueueManager
from ecoeye.sensing.wifi_csi.detector import FallDetector
from ecoeye.sensing.vision.detector import ObstacleDetector
from ecoeye.sensing.vision.currency import CurrencyDetector
from ecoeye.sensing.vision.ocr import OCRReader
from ecoeye.sensing.glucose_ble.reader import GlucoseReader
from ecoeye.sensing.voice.speaker import AudioSpeaker, AlertPriority
from ecoeye.sync.supabase_worker import SupabaseWorker


# ── helper: get system metrics ─────────────────────────────────────────────
def _get_system_metrics() -> dict:
    """Read lightweight system health metrics. psutil is optional."""
    try:
        import psutil
        cpu = psutil.cpu_percent(interval=0.1)
        mem = psutil.virtual_memory().percent
        bat = psutil.sensors_battery()
        battery_pct = bat.percent if bat else None
        network_status = "online"
    except ImportError:
        cpu = 0.0
        mem = 0.0
        battery_pct = None
        network_status = "unknown"
    return {
        "cpu_percent": cpu,
        "memory_percent": mem,
        "battery_pct": battery_pct,
        "network_status": network_status,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ── main orchestrator ───────────────────────────────────────────────────────
class EcoEyeOrchestrator:
    """
    Bootstraps, coordinates, and gracefully shuts down all EcoEye subsystems.
    """

    def __init__(self, simulation_mode: bool = True):
        self.simulation_mode = simulation_mode

        # Storage
        self.db = DatabaseManager()
        self.repo = EcoEyeRepository(crypto_engine=None)  # uses default crypto
        self.queue_mgr = SyncQueueManager(db_manager=self.db)

        # Event bus
        self.bus = EventBus()

        # Audio
        self.speaker = AudioSpeaker()

        # Sensors (wired to callbacks → repo + bus)
        self.fall_detector = FallDetector(
            on_fall=self._on_fall,
            simulation_mode=simulation_mode,
            location="sala",
        )
        self.vision_detector = ObstacleDetector(
            on_obstacle=self._on_obstacle,
            simulation_mode=simulation_mode,
        )
        self.currency_detector = CurrencyDetector(
            device_id=settings.device_id,
            on_detection=self._on_currency,
            on_audio_alert=self._on_audio_alert,
        )
        self.ocr_reader = OCRReader(
            device_id=settings.device_id,
            on_reading=self._on_ocr,
            on_audio_alert=self._on_audio_alert,
        )
        self.glucose_reader = GlucoseReader(
            on_reading=self._on_glucose,
            simulation_mode=simulation_mode,
        )

        # Supabase sync worker
        self.supabase_worker = SupabaseWorker(
            supabase_url=os.getenv("ECOEYE_SUPABASE_URL", ""),
            supabase_key=os.getenv("ECOEYE_SUPABASE_KEY", ""),
            user_id=os.getenv("ECOEYE_USER_ID", "00000000-0000-0000-0000-000000000001"),
            device_id=settings.device_id,
            batch_size=10,
            sync_interval_sec=15.0,
            db=self.db,
        )

    # ── event handlers ────────────────────────────────────────────────────

    def _on_audio_alert(self, message: str, priority: int = 2) -> None:
        """Generic speech alert dispatcher with priority."""
        self.speaker.speak(message, priority=priority)

    def _on_currency(self, det: CurrencyDetection) -> None:
        """Persist cash currency detection and broadcast event."""
        try:
            row_id = self.repo.save_currency_detection(det)
            logger.debug("Currency detection persisted → row %d", row_id)
        except Exception as exc:
            logger.error("Failed to persist currency detection: %s", exc)

        asyncio.get_event_loop().create_task(
            self.bus.publish("currency_detected", det)
        )

    def _on_ocr(self, ocr: OCRTextReading) -> None:
        """Persist OCR text reading and broadcast event."""
        try:
            row_id = self.repo.save_ocr_reading(ocr)
            logger.debug("OCR reading persisted → row %d", row_id)
        except Exception as exc:
            logger.error("Failed to persist OCR reading: %s", exc)

        asyncio.get_event_loop().create_task(
            self.bus.publish("ocr_text_read", ocr)
        )

    def _on_fall(self, event: FallEvent) -> None:
        """Persist fall event, enqueue for sync, emit audio alert."""
        try:
            row_id = self.repo.save_fall_event(event)
            logger.info("Fall event persisted → row %d", row_id)
        except Exception as exc:
            logger.error("Failed to persist fall event: %s", exc)

        self.speaker.speak_fall_alert(location=event.location_hint)
        asyncio.get_event_loop().create_task(
            self.bus.publish("fall_detected", event)
        )

    def _on_obstacle(self, obs: ObstacleDetection) -> None:
        """Persist obstacle detection and emit spatial audio cue."""
        try:
            row_id = self.repo.save_obstacle_detection(obs)
            logger.debug("Obstacle persisted → row %d", row_id)
        except Exception as exc:
            logger.error("Failed to persist obstacle: %s", exc)

        self.speaker.speak_obstacle(obs.audio_message, urgency=obs.urgency.value)
        asyncio.get_event_loop().create_task(
            self.bus.publish("obstacle_detected", obs)
        )

    def _on_glucose(self, reading: GlucoseReading) -> None:
        """Persist glucose reading, emit alert if clinically significant."""
        try:
            row_id = self.repo.save_glucose_reading(reading)
            logger.debug("Glucose reading persisted → row %d", row_id)
        except Exception as exc:
            logger.error("Failed to persist glucose reading: %s", exc)

        if reading.alert_level not in (GlucoseAlertLevel.NORMAL,):
            self.speaker.speak_glucose_alert(
                reading.glucose_mg_dl, reading.alert_level.value
            )
        asyncio.get_event_loop().create_task(
            self.bus.publish("glucose_reading", reading)
        )

    # ── heartbeat loop ────────────────────────────────────────────────────

    async def _heartbeat_loop(self, interval_sec: float = 30.0) -> None:
        """Emit system health metrics to the sync queue every `interval_sec`."""
        logger.info("Heartbeat loop started (interval=%.0fs)", interval_sec)
        while True:
            metrics = _get_system_metrics()
            try:
                self.repo.save_heartbeat(
                    cpu_percent=metrics["cpu_percent"],
                    memory_percent=metrics["memory_percent"],
                    network_status=metrics["network_status"],
                    active_sensors=["wifi_csi", "vision", "glucose_ble"],
                    battery_pct=metrics.get("battery_pct"),
                )
                self.queue_mgr.enqueue(
                    entity_type="heartbeat",
                    entity_id=f"hb_{int(time.time())}",
                    payload=metrics,
                    priority=0,
                )
                logger.debug(
                    "Heartbeat — CPU:%.1f%% MEM:%.1f%% BAT:%s NET:%s",
                    metrics["cpu_percent"],
                    metrics["memory_percent"],
                    metrics.get("battery_pct"),
                    metrics["network_status"],
                )
            except Exception as exc:
                logger.error("Heartbeat error: %s", exc)

            await asyncio.sleep(interval_sec)

    # ── main run loop ─────────────────────────────────────────────────────

    async def run(self) -> None:
        """Start all subsystems and run until Ctrl-C or SIGTERM."""
        logger.info("=" * 60)
        logger.info("[INIT] EcoEye Edge Node starting up")
        logger.info("   device_id   : %s", settings.device_id)
        logger.info("   db_path     : %s", settings.db_path)
        logger.info("   simulation  : %s", self.simulation_mode)
        logger.info("=" * 60)

        self.speaker.start()

        tasks = [
            asyncio.create_task(self._heartbeat_loop(30.0), name="heartbeat"),
            asyncio.create_task(self.supabase_worker.run(), name="supabase-sync"),
        ]

        if self.simulation_mode:
            # Run all sensors in simulation mode concurrently
            tasks += [
                asyncio.create_task(
                    self.fall_detector.run_simulation(
                        duration_sec=120.0, fall_at_sec=15.0
                    ),
                    name="csi-sim",
                ),
                asyncio.create_task(
                    self.vision_detector.run_simulation(
                        duration_sec=120.0, detection_interval_sec=4.0
                    ),
                    name="vision-sim",
                ),
                asyncio.create_task(
                    self.currency_detector.run_simulation(
                        duration_sec=120.0, interval_sec=16.0
                    ),
                    name="currency-sim",
                ),
                asyncio.create_task(
                    self.ocr_reader.run_simulation(
                        duration_sec=120.0, interval_sec=18.0
                    ),
                    name="ocr-sim",
                ),
                asyncio.create_task(
                    self.glucose_reader.run_simulation(
                        duration_sec=120.0, fast_mode=True
                    ),
                    name="glucose-sim",
                ),
            ]
            logger.info("[MODE] Simulation mode: all sensors running with synthetic data")
        else:
            logger.info("[MODE] Production mode: connect physical sensors")

        # Try to start FastAPI if available
        try:
            from ecoeye.server.api import create_app
            import uvicorn
            app = create_app(repo=self.repo, queue_mgr=self.queue_mgr)
            config = uvicorn.Config(
                app,
                host=settings.api_host,
                port=settings.api_port,
                log_level="warning",
            )
            server = uvicorn.Server(config)
            tasks.append(asyncio.create_task(server.serve(), name="api-server"))
            logger.info("[API] FastAPI server starting at http://%s:%d", settings.api_host, settings.api_port)
        except ImportError:
            logger.info("uvicorn/FastAPI not available — skipping API server")

        try:
            await asyncio.gather(*tasks)
        except KeyboardInterrupt:
            logger.info("Shutdown signal received — stopping gracefully")
        except asyncio.CancelledError:
            pass
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            self.speaker.stop(drain=False)
            logger.info("[SHUTDOWN] EcoEye shut down cleanly")

    def shutdown(self) -> None:
        """External shutdown hook."""
        self.fall_detector.stop()
        self.vision_detector.stop()
        self.currency_detector.stop()
        self.ocr_reader.stop()
        self.glucose_reader.stop()
        self.supabase_worker.stop()
        self.speaker.stop(drain=False)


def main() -> None:
    orchestrator = EcoEyeOrchestrator(simulation_mode=True)
    try:
        asyncio.run(orchestrator.run())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
