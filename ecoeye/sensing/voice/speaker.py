"""
EcoEye Audio Speaker — TTS and Spatial Audio Cues.

Generates voice alerts for obstacle detections and fall events using
offline Text-to-Speech (pyttsx3). Falls back gracefully if pyttsx3 is
not available (logs the message instead — useful in headless CI environments).

Priority queue: CRITICAL alerts preempt lower-priority messages.
"""

from __future__ import annotations

import asyncio
import logging
import queue
import threading
from dataclasses import dataclass, field
from enum import IntEnum
from typing import Optional

logger = logging.getLogger("ecoeye.sensing.voice")


class AlertPriority(IntEnum):
    """Lower integer = higher urgency (heapq min-heap semantics)."""
    CRITICAL = 0
    HIGH = 1
    MEDIUM = 2
    LOW = 3
    INFO = 4


@dataclass(order=True)
class AudioRequest:
    """Prioritized TTS request for the speaker queue."""
    priority: int
    message: str = field(compare=False)
    lang: str = field(default="es", compare=False)


class AudioSpeaker:
    """
    Offline TTS speaker with a prioritized message queue.

    Uses pyttsx3 for on-device synthesis (no cloud dependency).
    If pyttsx3 is unavailable (e.g., no audio device in CI),
    messages are logged at WARNING level instead.

    Args:
        rate: Speech rate in words per minute (default: 170).
        volume: Volume level [0.0, 1.0] (default: 1.0).
        lang: Default language/voice to use (hint for pyttsx3 voice selection).
        max_queue_size: Maximum pending messages before dropping LOW/INFO alerts.
    """

    def __init__(
        self,
        rate: int = 170,
        volume: float = 1.0,
        lang: str = "es",
        max_queue_size: int = 10,
    ):
        self.rate = rate
        self.volume = volume
        self.lang = lang
        self._pq: queue.PriorityQueue[AudioRequest] = queue.PriorityQueue(
            maxsize=max_queue_size
        )
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._engine = None
        self._available = self._init_engine()

    def _init_engine(self) -> bool:
        """Attempt to initialize pyttsx3. Returns True if successful."""
        try:
            import pyttsx3
            engine = pyttsx3.init()
            engine.setProperty("rate", self.rate)
            engine.setProperty("volume", self.volume)

            # Try to set a Spanish voice
            voices = engine.getProperty("voices")
            for voice in voices:
                if "es" in voice.id.lower() or "spanish" in voice.name.lower():
                    engine.setProperty("voice", voice.id)
                    break

            self._engine = engine
            logger.info("pyttsx3 TTS engine initialized (rate=%d, vol=%.1f)", self.rate, self.volume)
            return True
        except Exception as exc:
            logger.warning(
                "pyttsx3 unavailable (%s) — audio alerts will be logged only", exc
            )
            return False

    def speak(self, message: str, priority: AlertPriority = AlertPriority.MEDIUM) -> None:
        """
        Enqueue a TTS message for playback.
        Drops low-priority messages if the queue is full (backpressure).
        """
        request = AudioRequest(priority=int(priority), message=message, lang=self.lang)
        try:
            self._pq.put_nowait(request)
            logger.debug("Queued audio [P%d]: %s", priority, message)
        except queue.Full:
            if priority <= AlertPriority.HIGH:
                # Critical/High alerts force-clear and re-insert
                try:
                    self._pq.get_nowait()
                except queue.Empty:
                    pass
                self._pq.put_nowait(request)
                logger.warning("Audio queue full — dropped lower-priority message for: %s", message)
            else:
                logger.debug("Audio queue full — dropped low-priority message: %s", message)

    def speak_obstacle(
        self,
        message: str,
        urgency: str = "medium",
    ) -> None:
        """Convenience method for obstacle audio alerts."""
        priority_map = {
            "critical": AlertPriority.CRITICAL,
            "high": AlertPriority.HIGH,
            "medium": AlertPriority.MEDIUM,
            "low": AlertPriority.LOW,
        }
        prio = priority_map.get(urgency.lower(), AlertPriority.MEDIUM)
        self.speak(message, priority=prio)

    def speak_fall_alert(self, location: str = "zona desconocida") -> None:
        """Emit a high-priority fall alert audio message."""
        msg = f"Alerta, posible caída detectada en {location}. Verificando."
        self.speak(msg, priority=AlertPriority.CRITICAL)

    def speak_glucose_alert(self, glucose_mg_dl: float, alert_level: str) -> None:
        """Emit a glucose alert audio message."""
        alert_map = {
            "severe_hypo": f"Alerta crítica. Glucosa muy baja: {glucose_mg_dl:.0f}. Busca ayuda inmediata.",
            "hypo": f"Glucosa baja: {glucose_mg_dl:.0f}. Consume carbohidratos.",
            "hyper": f"Glucosa alta: {glucose_mg_dl:.0f}. Consulta con tu médico.",
            "severe_hyper": f"Alerta. Glucosa muy alta: {glucose_mg_dl:.0f}. Busca atención médica.",
        }
        msg = alert_map.get(alert_level, f"Lectura de glucosa: {glucose_mg_dl:.0f}.")
        priority = (
            AlertPriority.CRITICAL
            if alert_level in ("severe_hypo", "severe_hyper")
            else AlertPriority.HIGH
        )
        self.speak(msg, priority=priority)

    def _playback_worker(self) -> None:
        """Background thread: drain the priority queue and synthesize speech."""
        while self._running or not self._pq.empty():
            try:
                request = self._pq.get(timeout=0.5)
            except queue.Empty:
                continue

            if self._available and self._engine:
                try:
                    self._engine.say(request.message)
                    self._engine.runAndWait()
                except Exception as exc:
                    logger.error("TTS playback error: %s", exc)
            else:
                # Headless fallback — log as audible substitute
                logger.warning("🔊 AUDIO [P%d]: %s", request.priority, request.message)

            self._pq.task_done()

    def start(self) -> None:
        """Start the background TTS playback thread."""
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(
            target=self._playback_worker,
            name="ecoeye-audio-speaker",
            daemon=True,
        )
        self._thread.start()
        logger.info("AudioSpeaker started")

    def stop(self, drain: bool = True) -> None:
        """
        Stop the playback thread.

        Args:
            drain: If True, waits for all queued messages to finish before stopping.
        """
        if drain:
            self._pq.join()
        self._running = False
        if self._thread:
            self._thread.join(timeout=5.0)
        logger.info("AudioSpeaker stopped")

    def __enter__(self) -> "AudioSpeaker":
        self.start()
        return self

    def __exit__(self, *_: object) -> None:
        self.stop()
