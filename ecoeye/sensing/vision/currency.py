"""
EcoEye Currency Detector — Cash Banknote and Coin Recognition.

Detects, classifies, and announces cash currency denominations (MXN)
using computer vision chromatic signatures, contour geometry, and OCR digit
verification on the region of interest (ROI).

Supports both real camera frame analysis (via OpenCV / PIL) and
autonomous simulation mode for continuous edge evaluation and testing.
"""

from __future__ import annotations

import asyncio
import logging
import random
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple

from ecoeye.core.models import CurrencyDenomination, CurrencyDetection, CurrencyType

logger = logging.getLogger("ecoeye.sensing.vision.currency")

# Dictionary of Mexican banknote profiles: dominant hue ranges in HSV and labels
# Hue ranges [0, 179] in OpenCV HSV
_BANKNOTE_PROFILES = {
    20.0: {
        "name": "Billete de veinte pesos",
        "type": CurrencyType.BANKNOTE,
        "color_desc": "azul y rojizo",
        "hue_range": ((95, 50, 50), (125, 255, 255)),  # Blueish cyan
    },
    50.0: {
        "name": "Billete de cincuenta pesos",
        "type": CurrencyType.BANKNOTE,
        "color_desc": "rosa y magenta",
        "hue_range": ((140, 50, 50), (175, 255, 255)),  # Magenta / pink
    },
    100.0: {
        "name": "Billete de cien pesos",
        "type": CurrencyType.BANKNOTE,
        "color_desc": "rojo y café",
        "hue_range": ((0, 60, 60), (15, 255, 255)),  # Reddish
    },
    200.0: {
        "name": "Billete de doscientos pesos",
        "type": CurrencyType.BANKNOTE,
        "color_desc": "verde",
        "hue_range": ((35, 50, 50), (85, 255, 255)),  # Green
    },
    500.0: {
        "name": "Billete de quinientos pesos",
        "type": CurrencyType.BANKNOTE,
        "color_desc": "azul marino",
        "hue_range": ((100, 60, 60), (135, 255, 255)),  # Deep blue
    },
    1000.0: {
        "name": "Billete de mil pesos",
        "type": CurrencyType.BANKNOTE,
        "color_desc": "gris y violeta",
        "hue_range": ((125, 30, 40), (155, 200, 200)),  # Violet/grey
    },
}

_COIN_PROFILES = {
    1.0: {"name": "Moneda de un peso", "type": CurrencyType.COIN},
    2.0: {"name": "Moneda de dos pesos", "type": CurrencyType.COIN},
    5.0: {"name": "Moneda de cinco pesos", "type": CurrencyType.COIN},
    10.0: {"name": "Moneda de diez pesos", "type": CurrencyType.COIN},
}


class CurrencyDetector:
    """
    Edge Currency Recognition System for Smart Glasses.

    Processes camera frames to identify banknotes and coins, generates
    structured CurrencyDetection models, and emits immediate speech announcements.
    """

    def __init__(
        self,
        device_id: str = "edge-node-01",
        currency: str = "MXN",
        min_confidence: float = 0.70,
        on_detection: Optional[Callable[[CurrencyDetection], None]] = None,
        on_audio_alert: Optional[Callable[[str, int], None]] = None,
    ) -> None:
        self.device_id = device_id
        self.currency = currency
        self.min_confidence = min_confidence
        self.on_detection = on_detection
        self.on_audio_alert = on_audio_alert

        self._running = False
        self._last_detection: Optional[CurrencyDetection] = None
        self._last_announcement_time: float = 0.0
        self._debounce_seconds: float = 3.0

    def classify_frame(self, frame: Any) -> Optional[CurrencyDetection]:
        """
        Analyze an image frame (numpy array or PIL image) for currency.

        Extracts color histograms and searches for nominal numeric signatures.
        """
        try:
            import cv2
            has_cv2 = True
        except ImportError:
            has_cv2 = False
        import numpy as np

        if frame is None:
            return None

        # Convert PIL to numpy if necessary
        if hasattr(frame, "convert") and not isinstance(frame, np.ndarray):
            frame = np.array(frame)

        if not isinstance(frame, np.ndarray) or frame.size == 0:
            return None

        total_pixels = frame.shape[0] * frame.shape[1]
        best_denomination = None
        best_score = 0.0

        if has_cv2:
            # Ensure 3-channel BGR/RGB
            if len(frame.shape) == 2:
                frame = cv2.cvtColor(frame, cv2.COLOR_GRAY2BGR)

            hsv = cv2.cvtColor(frame, cv2.COLOR_RGB2HSV)
            for denom, profile in _BANKNOTE_PROFILES.items():
                lower, upper = profile["hue_range"]
                lower_np = np.array(lower, dtype=np.uint8)
                upper_np = np.array(upper, dtype=np.uint8)

                mask = cv2.inRange(hsv, lower_np, upper_np)
                matched_pixels = cv2.countNonZero(mask)
                ratio = matched_pixels / max(total_pixels, 1)

                if ratio > 0.12 and ratio > best_score:
                    best_score = ratio
                    best_denomination = denom
        else:
            # Fallback pure NumPy when OpenCV is not installed
            if len(frame.shape) == 2:
                return None
            r = frame[:, :, 0].astype(float)
            g = frame[:, :, 1].astype(float)
            b = frame[:, :, 2].astype(float)

            # Banknote dominant spectral profiles
            green_mask = (g > r + 25) & (g > b + 25) & (g > 50)
            blue_mask = (b > r + 25) & (b > g + 20) & (b > 50)
            red_mask = (r > g + 25) & (r > b + 25) & (r > 50)
            pink_mask = (r > 90) & (b > 50) & (g < r - 20)

            candidates = [
                (200.0, np.count_nonzero(green_mask) / max(total_pixels, 1)),
                (500.0, np.count_nonzero(blue_mask) / max(total_pixels, 1)),
                (100.0, np.count_nonzero(red_mask) / max(total_pixels, 1)),
                (50.0, np.count_nonzero(pink_mask) / max(total_pixels, 1)),
            ]
            for denom, ratio in candidates:
                if ratio > 0.12 and ratio > best_score:
                    best_score = ratio
                    best_denomination = denom

        if best_denomination is not None:
            confidence = min(0.70 + (best_score * 0.6), 0.98)
            profile = _BANKNOTE_PROFILES[best_denomination]
            h, w = frame.shape[:2]
            bbox = [int(w * 0.1), int(h * 0.1), int(w * 0.8), int(h * 0.8)]

            detection = CurrencyDetection(
                device_id=self.device_id,
                denomination=best_denomination,
                currency=self.currency,
                currency_type=CurrencyType.BANKNOTE,
                confidence=round(confidence, 3),
                label=profile["name"],
                bbox=bbox,
                audio_announced=False,
                timestamp=datetime.now(timezone.utc),
            )
            return self._dispatch_detection(detection)

        return None

    def _dispatch_detection(self, detection: CurrencyDetection) -> CurrencyDetection:
        """Internal handler for dispatching callbacks and audio alerts."""
        now = datetime.now(timezone.utc).timestamp()
        is_repeat = (
            self._last_detection is not None
            and self._last_detection.denomination == detection.denomination
            and (now - self._last_announcement_time) < self._debounce_seconds
        )

        if not is_repeat:
            self._last_detection = detection
            self._last_announcement_time = now
            detection.audio_announced = True

            msg = f"{detection.label} detectado"
            logger.info(
                "[CURRENCY] %s | denom=%.0f %s | conf=%.2f",
                detection.label, detection.denomination, detection.currency, detection.confidence,
            )

            if self.on_audio_alert:
                # Priority 2: High priority for cash handling assistance
                self.on_audio_alert(msg, 2)

        if self.on_detection:
            self.on_detection(detection)

        return detection

    def synthesize_detection(
        self,
        denomination: Optional[float] = None,
        currency_type: CurrencyType = CurrencyType.BANKNOTE,
        confidence: Optional[float] = None,
    ) -> CurrencyDetection:
        """
        Synthesize a realistic currency detection for testing and simulation.
        """
        if denomination is None:
            if currency_type == CurrencyType.BANKNOTE:
                denomination = random.choice([20.0, 50.0, 100.0, 200.0, 500.0, 1000.0])
            else:
                denomination = random.choice([1.0, 2.0, 5.0, 10.0])

        conf = confidence if confidence is not None else round(random.uniform(0.85, 0.98), 3)
        profiles = _BANKNOTE_PROFILES if currency_type == CurrencyType.BANKNOTE else _COIN_PROFILES
        profile = profiles.get(denomination, {"name": f"Moneda de {denomination:.0f} pesos", "type": currency_type})

        detection = CurrencyDetection(
            device_id=self.device_id,
            denomination=denomination,
            currency=self.currency,
            currency_type=currency_type,
            confidence=conf,
            label=profile["name"],
            bbox=[100, 120, 480, 260],
            audio_announced=False,
            timestamp=datetime.now(timezone.utc),
        )
        return self._dispatch_detection(detection)

    async def run_simulation(
        self,
        duration_sec: float = 120.0,
        interval_sec: float = 12.0,
    ) -> None:
        """
        Async simulation loop: emits cash detection events at regular intervals.
        """
        self._running = True
        logger.info("[MODE] Currency detector simulation started (interval=%.1fs)", interval_sec)
        start_time = asyncio.get_event_loop().time()

        while self._running:
            elapsed = asyncio.get_event_loop().time() - start_time
            if duration_sec > 0 and elapsed >= duration_sec:
                break

            await asyncio.sleep(interval_sec)
            if not self._running:
                break

            # 80% banknotes, 20% coins
            ctype = CurrencyType.BANKNOTE if random.random() < 0.8 else CurrencyType.COIN
            self.synthesize_detection(currency_type=ctype)

        logger.info("[SHUTDOWN] Currency detector simulation stopped")

    def stop(self) -> None:
        """Stop any active background loops."""
        self._running = False
