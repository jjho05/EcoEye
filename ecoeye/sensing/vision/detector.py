"""
EcoEye Vision Obstacle Detector.

Detects nearby obstacles using a camera feed and YOLOv8-nano inference,
then classifies them by spatial sector (left/center/right) and urgency
based on proximity and bounding-box size.

Runs in SIMULATION mode (no physical camera required) for demo purposes.
In production, replace the frame capture with OpenCV VideoCapture().
"""

from __future__ import annotations

import asyncio
import logging
import random
import uuid
from datetime import datetime, timezone
from typing import Callable, List, Optional, Tuple

from ecoeye.core.models import ObstacleDetection, ObstacleSector, ObstacleUrgency

logger = logging.getLogger("ecoeye.sensing.vision")

# Urgency thresholds based on estimated distance (meters)
_URGENCY_CRITICAL_M = 0.5
_URGENCY_HIGH_M = 1.0
_URGENCY_MEDIUM_M = 2.0

# Common obstacle labels for simulation and YOLO output mapping
_OBSTACLE_LABELS = [
    "escalón", "puerta", "persona", "silla", "mesa",
    "pared", "poste", "vehículo", "bicicleta", "obstáculo",
]

# Spoken message templates by sector
_AUDIO_TEMPLATES = {
    ObstacleSector.LEFT: "Cuidado, {label} a la izquierda a {dist:.0f} centímetros",
    ObstacleSector.CENTER: "Peligro, {label} al frente a {dist:.0f} centímetros",
    ObstacleSector.RIGHT: "Atención, {label} a la derecha a {dist:.0f} centímetros",
}


def _distance_to_urgency(distance_m: float) -> ObstacleUrgency:
    """Map estimated distance to urgency level."""
    if distance_m <= _URGENCY_CRITICAL_M:
        return ObstacleUrgency.CRITICAL
    elif distance_m <= _URGENCY_HIGH_M:
        return ObstacleUrgency.HIGH
    elif distance_m <= _URGENCY_MEDIUM_M:
        return ObstacleUrgency.MEDIUM
    return ObstacleUrgency.LOW


def _bbox_to_sector(x_center: float, frame_width: float) -> ObstacleSector:
    """
    Classify horizontal position of a bounding box into spatial sector.

    Args:
        x_center: Bounding box center x-coordinate (pixels).
        frame_width: Total frame width (pixels).

    Returns:
        ObstacleSector: LEFT, CENTER, or RIGHT.
    """
    ratio = x_center / frame_width
    if ratio < 0.33:
        return ObstacleSector.LEFT
    elif ratio > 0.67:
        return ObstacleSector.RIGHT
    return ObstacleSector.CENTER


def build_audio_message(
    sector: ObstacleSector,
    label: str,
    distance_m: float,
) -> str:
    """Build the TTS audio cue string for the detected obstacle."""
    dist_cm = distance_m * 100.0
    template = _AUDIO_TEMPLATES.get(sector, _AUDIO_TEMPLATES[ObstacleSector.CENTER])
    return template.format(label=label, dist=dist_cm)


class ObstacleDetector:
    """
    Edge vision obstacle detector for visually impaired navigation.

    In simulation mode, generates plausible detections at random intervals
    to demonstrate the full detection → audio → storage pipeline.

    In production, replace `_capture_frame()` with OpenCV/V4L2 frame capture
    and `_run_inference()` with actual YOLOv8-nano model inference.

    Args:
        on_obstacle: Callback invoked with an ObstacleDetection when a hazard is classified.
        simulation_mode: If True, generates synthetic detections.
        frame_width: Camera frame width in pixels (used for sector classification).
        frame_height: Camera frame height in pixels.
        min_confidence: Minimum inference confidence to emit an alert.
        urgency_threshold: Minimum urgency level to emit an alert.
        fps: Target frames per second (simulation rate).
    """

    def __init__(
        self,
        on_obstacle: Optional[Callable[[ObstacleDetection], None]] = None,
        simulation_mode: bool = True,
        frame_width: int = 640,
        frame_height: int = 480,
        min_confidence: float = 0.55,
        urgency_threshold: ObstacleUrgency = ObstacleUrgency.MEDIUM,
        fps: int = 5,
    ):
        self.on_obstacle = on_obstacle
        self.simulation_mode = simulation_mode
        self.frame_width = frame_width
        self.frame_height = frame_height
        self.min_confidence = min_confidence
        self.urgency_threshold = urgency_threshold
        self.fps = fps
        self._running = False

    def process_detection(
        self,
        label: str,
        distance_m: float,
        x_center: float,
        confidence: float,
        audio_played: bool = False,
    ) -> Optional[ObstacleDetection]:
        """
        Build and emit an ObstacleDetection from raw inference output.
        Returns None if confidence or urgency is below threshold.
        """
        if confidence < self.min_confidence:
            return None

        sector = _bbox_to_sector(x_center, self.frame_width)
        urgency = _distance_to_urgency(distance_m)

        urgency_order = [
            ObstacleUrgency.LOW,
            ObstacleUrgency.MEDIUM,
            ObstacleUrgency.HIGH,
            ObstacleUrgency.CRITICAL,
        ]
        if urgency_order.index(urgency) < urgency_order.index(self.urgency_threshold):
            return None

        audio_msg = build_audio_message(sector, label, distance_m)

        detection = ObstacleDetection(
            id=str(uuid.uuid4()),
            timestamp=datetime.now(timezone.utc),
            sector=sector,
            distance_meters=round(distance_m, 3),
            urgency=urgency,
            audio_message=audio_msg,
            audio_alert_played=audio_played,
            label=label,
            confidence=round(confidence, 4),
        )

        logger.info(
            "🚧 OBSTACLE — %s | %s @ %.2fm | urgency=%s | conf=%.2f",
            label, sector.value, distance_m, urgency.value, confidence,
        )

        if self.on_obstacle:
            self.on_obstacle(detection)

        return detection

    def _generate_simulated_detection(
        self,
    ) -> Tuple[str, float, float, float]:
        """Generate synthetic detection parameters for demo/testing."""
        label = random.choice(_OBSTACLE_LABELS)
        distance_m = random.uniform(0.3, 3.5)
        x_center = random.uniform(0, self.frame_width)
        confidence = random.uniform(0.60, 0.97)
        return label, distance_m, x_center, confidence

    async def run_simulation(
        self,
        duration_sec: float = 60.0,
        detection_interval_sec: float = 3.0,
    ) -> None:
        """
        Run simulated detection loop for `duration_sec`,
        generating a new detection every `detection_interval_sec`.
        """
        self._running = True
        start = asyncio.get_event_loop().time()
        frame_interval = 1.0 / self.fps

        logger.info(
            "Vision simulation started (%.0fs, detections every %.0fs)",
            duration_sec, detection_interval_sec,
        )

        next_detection = asyncio.get_event_loop().time() + detection_interval_sec

        while self._running:
            now = asyncio.get_event_loop().time()
            if now - start >= duration_sec:
                break

            if now >= next_detection:
                label, distance_m, x_center, confidence = self._generate_simulated_detection()
                self.process_detection(
                    label=label,
                    distance_m=distance_m,
                    x_center=x_center,
                    confidence=confidence,
                    audio_played=True,
                )
                next_detection = now + detection_interval_sec

            await asyncio.sleep(frame_interval)

        logger.info("Vision simulation ended")

    def stop(self) -> None:
        """Signal the simulation loop to stop."""
        self._running = False
