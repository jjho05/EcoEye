"""
EcoEye WiFi-CSI Fall Detector.

Classifies falls from WiFi Channel State Information (CSI) amplitude matrices
without invasive cameras. Algorithm:
  1. Circular buffer of CSI amplitude frames
  2. Rolling variance over a sliding window
  3. Hampel outlier filter to suppress multipath noise
  4. Impact spike detection → stillness confirmation window
  5. Emission of FallEvent to the EventBus

Can run in SIMULATION mode (no physical WiFi NIC required) for demo purposes.
"""

from __future__ import annotations

import asyncio
import logging
import math
import random
import statistics
from collections import deque
from datetime import datetime, timezone
from typing import Callable, Deque, List, Optional

from ecoeye.config import settings
from ecoeye.core.models import CSIFrame, FallEvent, FallSeverity, FallStatus

logger = logging.getLogger("ecoeye.sensing.wifi_csi")

# ---------------------------------------------------------------------------
# Hampel identifier — robust outlier detection for CSI amplitude series
# ---------------------------------------------------------------------------

def hampel_filter(
    values: List[float],
    window_half: int = 5,
    n_sigma: float = 3.0,
) -> List[float]:
    """
    Replace outlier values with local median (Hampel identifier).

    Args:
        values: 1-D time series of CSI amplitude values.
        window_half: Half-width of the sliding window (total = 2*w+1).
        n_sigma: Threshold in units of scaled MAD (≈σ) to flag outliers.

    Returns:
        Cleaned series with outlier values replaced by local medians.
    """
    n = len(values)
    cleaned = list(values)
    k = 1.4826  # Consistency factor for normal distribution

    for i in range(n):
        lo = max(0, i - window_half)
        hi = min(n - 1, i + window_half)
        window = values[lo : hi + 1]
        med = statistics.median(window)
        mad = statistics.median([abs(x - med) for x in window])
        threshold = n_sigma * k * mad
        if abs(values[i] - med) > threshold:
            cleaned[i] = med

    return cleaned


# ---------------------------------------------------------------------------
# Core detector
# ---------------------------------------------------------------------------

class FallDetector:
    """
    WiFi-CSI based fall detector using variance spike + stillness confirmation.

    The detector maintains an internal circular buffer of per-frame mean amplitudes.
    When the rolling variance exceeds `variance_threshold` and the subsequent
    `inactivity_window_sec` shows low variance (stillness), a FallEvent is emitted.

    Args:
        on_fall: Async callback invoked with a FallEvent when a fall is classified.
        simulation_mode: If True, generates synthetic CSI frames for testing.
        variance_threshold: Normalized variance spike threshold (default from settings).
        inactivity_window_sec: Post-fall stillness confirmation window in seconds.
        sample_rate_hz: CSI frames per second.
        buffer_size: Rolling buffer capacity (frames).
    """

    def __init__(
        self,
        on_fall: Optional[Callable[[FallEvent], None]] = None,
        simulation_mode: bool = True,
        variance_threshold: float = None,
        inactivity_window_sec: float = None,
        sample_rate_hz: int = None,
        buffer_size: int = 200,
        location: str = "sala",
    ):
        self.on_fall = on_fall
        self.simulation_mode = simulation_mode
        self.variance_threshold = variance_threshold or settings.csi_fall_threshold_variance
        self.inactivity_window_sec = inactivity_window_sec or settings.csi_inactivity_window_sec
        self.sample_rate_hz = sample_rate_hz or settings.csi_sample_rate_hz
        self.location = location

        # Circular buffer: stores per-frame mean amplitude
        self._buffer: Deque[float] = deque(maxlen=buffer_size)

        # State machine
        self._spike_detected: bool = False
        self._spike_timestamp: Optional[float] = None
        self._stillness_accumulator: int = 0

        # Inactivity confirmation threshold in frames
        self._inactivity_frames = int(self.inactivity_window_sec * self.sample_rate_hz)
        self._running = False

    def ingest_frame(self, frame: CSIFrame) -> Optional[FallEvent]:
        """
        Feed one CSI frame into the detector pipeline.
        Returns a FallEvent if a fall is classified, else None.
        """
        # Step 1: mean amplitude across subcarriers
        mean_amp = statistics.mean(frame.subcarrier_amplitudes)
        self._buffer.append(mean_amp)

        if len(self._buffer) < 30:
            # Not enough frames to compute meaningful statistics
            return None

        buf = list(self._buffer)

        # Step 2: Hampel filter on the buffer
        clean = hampel_filter(buf, window_half=5, n_sigma=3.0)

        # Step 3: Rolling variance (last 50 samples = ~0.5s at 100Hz)
        window = clean[-50:]
        try:
            variance = statistics.variance(window)
        except statistics.StatisticsError:
            return None

        # Step 4: Impact spike detection
        if not self._spike_detected:
            if variance > self.variance_threshold:
                self._spike_detected = True
                self._spike_timestamp = frame.timestamp
                self._stillness_accumulator = 0
                logger.debug(
                    "CSI impact spike detected (variance=%.3f > threshold=%.3f)",
                    variance, self.variance_threshold,
                )
        else:
            # Monitoring post-spike stillness
            quiet_threshold = self.variance_threshold * 0.15
            if variance < quiet_threshold:
                self._stillness_accumulator += 1
            else:
                # Abrupt movement reset — false positive
                self._stillness_accumulator = max(0, self._stillness_accumulator - 5)
                if self._stillness_accumulator == 0:
                    logger.debug("CSI spike cancelled — movement resumed before stillness threshold")
                    self._spike_detected = False
                    return None

            # Stillness confirmed
            if self._stillness_accumulator >= self._inactivity_frames:
                duration = self._stillness_accumulator / self.sample_rate_hz
                confidence = min(
                    0.99,
                    0.6 + (variance / (self.variance_threshold * 4)) * 0.35,
                )

                # Hampel anomaly score: max deviation in filtered clean signal
                hampel_score = max(
                    abs(a - b) for a, b in zip(buf[-10:], clean[-10:])
                ) if len(buf) >= 10 else 0.0

                severity = (
                    FallSeverity.CRITICAL if confidence > 0.90
                    else FallSeverity.HIGH if confidence > 0.75
                    else FallSeverity.MEDIUM
                )

                event = FallEvent(
                    timestamp=datetime.now(timezone.utc),
                    device_id=settings.device_id,
                    severity=severity,
                    confidence=round(confidence, 4),
                    inactivity_duration_sec=round(duration, 2),
                    location_hint=self.location,
                    is_confirmed=False,
                    status=FallStatus.DETECTED,
                    spectral_energy_ratio=round(variance, 4),
                    hampel_anomaly_score=round(hampel_score, 4),
                    metadata={
                        "raw_variance": variance,
                        "stillness_frames": self._stillness_accumulator,
                        "sample_rate_hz": self.sample_rate_hz,
                    },
                )

                logger.info(
                    "🚨 FALL DETECTED — conf=%.2f, sev=%s, stillness=%.1fs, loc=%s",
                    confidence, severity.value, duration, self.location,
                )

                # Reset state machine
                self._spike_detected = False
                self._stillness_accumulator = 0

                if self.on_fall:
                    self.on_fall(event)
                return event

        return None

    # ------------------------------------------------------------------
    # Simulation loop
    # ------------------------------------------------------------------

    def _generate_simulated_frame(self, inject_fall: bool = False) -> CSIFrame:
        """Generate a realistic synthetic CSI frame for demo/testing."""
        noise_floor = -90.0
        if inject_fall:
            # Sharp amplitude spike simulating rapid movement
            amps = [random.gauss(8.0, 3.0) for _ in range(64)]
        else:
            # Normal ambient WiFi: low-variance OFDM pattern
            amps = [random.gauss(1.5, 0.3) for _ in range(64)]

        return CSIFrame(
            subcarrier_amplitudes=amps,
            rssi=random.gauss(-55.0, 3.0),
            noise_floor=noise_floor,
        )

    async def run_simulation(
        self,
        duration_sec: float = 30.0,
        fall_at_sec: float = 10.0,
    ) -> None:
        """
        Run the simulated CSI detection loop for `duration_sec` seconds,
        injecting a synthetic fall event at `fall_at_sec`.
        """
        self._running = True
        start = asyncio.get_event_loop().time()
        frame_interval = 1.0 / self.sample_rate_hz

        logger.info(
            "CSI simulation started (%.0fs, fall injection at %.0fs)",
            duration_sec, fall_at_sec,
        )

        while self._running:
            elapsed = asyncio.get_event_loop().time() - start
            if elapsed >= duration_sec:
                break

            # Inject a 1-second burst of "fall frames" at fall_at_sec
            inject = fall_at_sec <= elapsed <= fall_at_sec + 1.0
            frame = self._generate_simulated_frame(inject_fall=inject)
            self.ingest_frame(frame)

            await asyncio.sleep(frame_interval)

        logger.info("CSI simulation ended after %.1fs", elapsed)

    def stop(self) -> None:
        """Signal the simulation loop to stop."""
        self._running = False
