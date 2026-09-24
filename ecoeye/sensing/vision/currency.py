"""
EcoEye Currency Detector - Cash Banknote and Coin Recognition.

Primary inference path: Gemini gemini-3.8-flash (via api.py /vision/currency/process).
This module is the LOCAL FALLBACK used only when Gemini is unavailable (offline, no API key).

Detection pipeline (three-stage gate):
    1. Texture gate: reject uniform flat-color regions (walls, clothing, furniture).
    2. Aspect ratio gate: Banxico banknotes are 65 x 130 mm (approx 2:1 landscape).
    3. Dominant hue classification: tight hue ranges per denomination.

The old single-stage color ratio (12% threshold) was removed because it triggered
false positives on green walls, blue shirts, red backgrounds, and similar surfaces.
"""

from __future__ import annotations

import asyncio
import logging
import random
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple

from ecoeye.core.models import CurrencyDenomination, CurrencyDetection, CurrencyType

logger = logging.getLogger("ecoeye.sensing.vision.currency")

# Banxico MXN banknote profiles.
# Hue ranges use OpenCV HSV convention [0-179].
# These are TIGHT ranges: only valid when texture + aspect ratio also pass.
_BANKNOTE_PROFILES: Dict[float, Dict] = {
    20.0: {
        "name": "Billete de veinte pesos",
        "type": CurrencyType.BANKNOTE,
        "color_desc": "azul/cyan",
        # Cyan-blue band (modern polymer 20-peso note)
        "hue_lo": (98, 60, 60),
        "hue_hi": (128, 255, 255),
    },
    50.0: {
        "name": "Billete de cincuenta pesos",
        "type": CurrencyType.BANKNOTE,
        "color_desc": "magenta/rosa",
        # Magenta-pink (50-peso note)
        "hue_lo": (145, 55, 55),
        "hue_hi": (175, 255, 255),
    },
    100.0: {
        "name": "Billete de cien pesos",
        "type": CurrencyType.BANKNOTE,
        "color_desc": "rojo/cafe",
        # Red-brick (100-peso note, Sor Juana / Nezahualcoyotl) - saturation floor at 120 avoids finger skin
        "hue_lo": (0, 120, 70),
        "hue_hi": (12, 255, 255),
    },
    200.0: {
        "name": "Billete de doscientos pesos",
        "type": CurrencyType.BANKNOTE,
        "color_desc": "verde",
        # Green (200-peso note, Sor Juana)
        "hue_lo": (38, 55, 55),
        "hue_hi": (82, 255, 255),
    },
    500.0: {
        "name": "Billete de quinientos pesos",
        "type": CurrencyType.BANKNOTE,
        "color_desc": "azul marino",
        # Deep blue (500-peso note, Benito Juarez)
        "hue_lo": (102, 65, 55),
        "hue_hi": (130, 255, 255),
    },
    1000.0: {
        "name": "Billete de mil pesos",
        "type": CurrencyType.BANKNOTE,
        "color_desc": "gris/violeta",
        # Violet-grey (1000-peso note)
        "hue_lo": (128, 35, 45),
        "hue_hi": (155, 190, 190),
    },
}

_COIN_PROFILES: Dict[float, Dict] = {
    1.0: {"name": "Moneda de un peso", "type": CurrencyType.COIN},
    2.0: {"name": "Moneda de dos pesos", "type": CurrencyType.COIN},
    5.0: {"name": "Moneda de cinco pesos", "type": CurrencyType.COIN},
    10.0: {"name": "Moneda de diez pesos", "type": CurrencyType.COIN},
}

# Aspect ratio window for Banxico banknotes (width / height in landscape orientation).
# Physical: 130 mm wide x 65 mm tall -> ratio 2.0
# Tolerance applied: 1.4 to 2.7 (covers viewfinder crops, angled shots, perspective distortion).
_BANKNOTE_RATIO_MIN = 1.4
_BANKNOTE_RATIO_MAX = 2.7

# Minimum fraction of matched pixels required AFTER the texture gate passes.
# Raised from 0.12 to 0.18 to reduce hue-only false positives.
_MIN_HUE_RATIO = 0.18

# Minimum texture variance score: images below this are too uniform to be a banknote.
# Banknotes have fine intaglio printing; a green wall is uniformly smooth (< 20).
_MIN_TEXTURE_VARIANCE = 70.0


def _compute_texture_variance(frame_np: Any) -> float:
    """
    Compute a proxy for image texture richness using pixel variance.
    Returns the mean of per-channel variance across the frame center crop.
    A purely flat color surface (wall, floor) will score near 0.
    A printed banknote with intaglio patterns will score > 200.
    """
    import numpy as np

    h, w = frame_np.shape[:2]
    # Sample the center third of the image to focus on the held object
    y0, y1 = h // 3, 2 * h // 3
    x0, x1 = w // 3, 2 * w // 3
    crop = frame_np[y0:y1, x0:x1]
    if crop.size == 0:
        return 0.0
    return float(np.mean(np.var(crop.reshape(-1, crop.shape[2] if len(crop.shape) == 3 else 1), axis=0)))


class CurrencyDetector:
    """
    Edge Currency Recognition System for Smart Glasses.

    This is the LOCAL FALLBACK detector. The primary path is Gemini gemini-3.8-flash.
    Use this when the device is offline or the Gemini API key is not configured.

    Multi-stage detection gate:
        Stage 1 - Texture variance: rejects walls, clothing, and uniform surfaces.
        Stage 2 - Aspect ratio: validates rectangular landscape orientation.
        Stage 3 - Dominant hue match: identifies denomination from tight color range.
    """

    def __init__(
        self,
        device_id: str = "edge-node-01",
        currency: str = "MXN",
        min_confidence: float = 0.72,
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

        Returns a CurrencyDetection if a banknote passes all three stages,
        or None if the frame is rejected at any gate.
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
            frame = np.array(frame.convert("RGB"))

        if not isinstance(frame, np.ndarray) or frame.size == 0:
            return None

        if len(frame.shape) < 2:
            return None

        h, w = frame.shape[:2]
        total_pixels = h * w

        # STAGE 1: Texture variance gate
        # Rejects uniform backgrounds (walls, floors, plain clothing).
        texture_score = _compute_texture_variance(frame)
        if texture_score < _MIN_TEXTURE_VARIANCE:
            logger.debug(
                "[CURRENCY] Rejected by texture gate: variance=%.1f < %.1f",
                texture_score, _MIN_TEXTURE_VARIANCE,
            )
            return None

        # STAGE 2: Aspect ratio gate
        # Banknotes are landscape and approximately 2:1 (width:height).
        if h == 0:
            return None
        aspect_ratio = w / h
        if not (_BANKNOTE_RATIO_MIN <= aspect_ratio <= _BANKNOTE_RATIO_MAX):
            # If a full-frame camera photo (4:3, 16:9, or mobile portrait) was supplied,
            # crop the central region of interest corresponding to the banknote reticle (1.85:1).
            target_ratio = 1.85
            if aspect_ratio < target_ratio:
                crop_w = int(w * 0.85)
                crop_h = int(crop_w / target_ratio)
            else:
                crop_h = int(h * 0.85)
                crop_w = int(crop_h * target_ratio)

            if crop_w > 10 and crop_h > 10 and crop_w <= w and crop_h <= h:
                y0 = (h - crop_h) // 2
                x0 = (w - crop_w) // 2
                frame = frame[y0:y0 + crop_h, x0:x0 + crop_w]
                h, w = frame.shape[:2]
                total_pixels = h * w
                aspect_ratio = w / h
            else:
                return None

        if not (_BANKNOTE_RATIO_MIN <= aspect_ratio <= _BANKNOTE_RATIO_MAX):
            logger.debug(
                "[CURRENCY] Rejected by aspect ratio gate: ratio=%.2f not in [%.1f, %.1f]",
                aspect_ratio, _BANKNOTE_RATIO_MIN, _BANKNOTE_RATIO_MAX,
            )
            return None

        # STAGE 3: Dominant hue classification
        best_denomination: Optional[float] = None
        best_score: float = 0.0

        if has_cv2:
            if len(frame.shape) == 2:
                frame = cv2.cvtColor(frame, cv2.COLOR_GRAY2BGR)
            hsv = cv2.cvtColor(frame, cv2.COLOR_RGB2HSV)

            for denom, profile in _BANKNOTE_PROFILES.items():
                lower_np = np.array(profile["hue_lo"], dtype=np.uint8)
                upper_np = np.array(profile["hue_hi"], dtype=np.uint8)
                mask = cv2.inRange(hsv, lower_np, upper_np)
                matched_pixels = cv2.countNonZero(mask)
                ratio = matched_pixels / max(total_pixels, 1)

                if ratio > _MIN_HUE_RATIO and ratio > best_score:
                    best_score = ratio
                    best_denomination = denom

            # Special case: red hue wraps around 0/179 in OpenCV HSV.
            # Handle the 100-peso note's red band with a second mask.
            lower_red2 = np.array((168, 125, 70), dtype=np.uint8)
            upper_red2 = np.array((179, 255, 255), dtype=np.uint8)
            mask_red2 = cv2.inRange(hsv, lower_red2, upper_red2)
            red2_ratio = cv2.countNonZero(mask_red2) / max(total_pixels, 1)
            if red2_ratio > _MIN_HUE_RATIO and red2_ratio > best_score:
                best_score = red2_ratio
                best_denomination = 100.0

        else:
            # Pure NumPy fallback when OpenCV is not installed.
            # Uses tighter channel dominance thresholds to reduce false positives.
            if len(frame.shape) == 2:
                return None

            r = frame[:, :, 0].astype(float)
            g = frame[:, :, 1].astype(float)
            b = frame[:, :, 2].astype(float)

            # Each condition requires a meaningful channel advantage (>35 units)
            # to avoid triggering on near-grey or desaturated colors.
            green_mask = (g > r + 35) & (g > b + 35) & (g > 60)
            blue_mask = (b > r + 35) & (b > g + 30) & (b > 60)
            # Tighter red mask for $100 MXN: rejects human skin tones (which have moderate green)
            red_mask = (r > 130) & (r > g * 1.55) & (r > b * 1.65) & (g < 140)
            pink_mask = (r > 100) & (b > 60) & (g < r - 30) & (b > g - 10)

            candidates = [
                (200.0, float(np.count_nonzero(green_mask)) / max(total_pixels, 1)),
                (500.0, float(np.count_nonzero(blue_mask)) / max(total_pixels, 1)),
                (100.0, float(np.count_nonzero(red_mask)) / max(total_pixels, 1)),
                (50.0, float(np.count_nonzero(pink_mask)) / max(total_pixels, 1)),
            ]
            for denom, ratio in candidates:
                if ratio > _MIN_HUE_RATIO and ratio > best_score:
                    best_score = ratio
                    best_denomination = denom

        if best_denomination is None:
            logger.debug("[CURRENCY] No denomination matched hue gate (best_score=%.3f)", best_score)
            return None

        # All three stages passed: build detection object.
        confidence = min(0.72 + (best_score * 0.55), 0.97)
        profile = _BANKNOTE_PROFILES[best_denomination]
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

            logger.info(
                "[CURRENCY] %s | denom=%.0f %s | conf=%.2f",
                detection.label, detection.denomination, detection.currency, detection.confidence,
            )

            if self.on_audio_alert:
                self.on_audio_alert(f"{detection.label} detectado", 2)

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
