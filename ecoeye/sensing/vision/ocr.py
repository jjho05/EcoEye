"""
EcoEye OCR Reader — Optical Character Recognition for Smart Glasses.

Extracts printed and sign text from camera frames, performs noise filtering
and linguistic normalization, prevents repetitive audio announcements via
hash-based debouncing, and verbalizes text for visually impaired users.

Supports both live frame processing (OpenCV + pytesseract) and
autonomous simulation mode for continuous edge evaluation and testing.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import random
import re
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple

from ecoeye.core.models import OCRTextReading

logger = logging.getLogger("ecoeye.sensing.vision.ocr")

# Realistic assistive text snippets for simulation and demo scenarios
_SIMULATED_TEXT_CORPUS = [
    {"raw": "FARMACIA 24 HORAS", "clean": "Farmacia 24 Horas", "lang": "spa"},
    {"raw": "PARACETAMOL 500 MG\nTomar 1 cada 8 horas", "clean": "Paracetamol 500 miligramos, tomar una cada ocho horas", "lang": "spa"},
    {"raw": "PARADA DE AUTOBUS\nRuta 42 Centro", "clean": "Parada de autobús, Ruta 42 Centro", "lang": "spa"},
    {"raw": "CRUCE PEATONAL\nPrecaución", "clean": "Cruce peatonal, Precaución", "lang": "spa"},
    {"raw": "ALTO", "clean": "Alto", "lang": "spa"},
    {"raw": "LECHE ENTERA 1L\nFecha Cad: 15 OCT 2026", "clean": "Leche entera un litro, caducidad quince de octubre", "lang": "spa"},
    {"raw": "CONSULTORIO MEDICO 4\nDr. Ramirez", "clean": "Consultorio médico cuatro, Doctor Ramírez", "lang": "spa"},
    {"raw": "EMERGENCIA\nSalida a 20 metros", "clean": "Emergencia, Salida a veinte metros", "lang": "spa"},
    {"raw": "SUPERMERCADO\nEntrada Clientes", "clean": "Supermercado, Entrada Clientes", "lang": "spa"},
    {"raw": "BANCO SANTANDER\nCajeros Automaticos", "clean": "Banco, Cajeros Automáticos", "lang": "spa"},
]


def _clean_ocr_text(raw_text: str) -> str:
    """
    Filter optical noise, normalize linebreaks and remove isolated symbols.
    """
    if not raw_text:
        return ""

    # Replace multiple newlines or tabs with a single space
    cleaned = re.sub(r"[\r\n\t]+", " ", raw_text)
    # Remove non-printable or junk characters, preserve latin accents and punctuation
    cleaned = re.sub(r"[^\w\s.,;:¿?¡!áéíóúÁÉÍÓÚñÑüÜ\-\/]", "", cleaned)
    # Collapse repeated punctuation
    cleaned = re.sub(r"!{2,}", "!", cleaned)
    cleaned = re.sub(r"\?{2,}", "?", cleaned)
    # Collapse multiple spaces
    cleaned = re.sub(r"\s{2,}", " ", cleaned).strip()
    return cleaned


class OCRReader:
    """
    Edge Optical Character Recognition Engine.

    Processes camera frames using adaptive binarization + Tesseract OCR,
    filters text for readability, manages deduplication debounce, and
    emits speech synthesis requests.
    """

    def __init__(
        self,
        device_id: str = "edge-node-01",
        default_lang: str = "spa",
        min_confidence: float = 60.0,
        debounce_seconds: float = 10.0,
        on_reading: Optional[Callable[[OCRTextReading], None]] = None,
        on_audio_alert: Optional[Callable[[str, int], None]] = None,
    ) -> None:
        self.device_id = device_id
        self.default_lang = default_lang
        self.min_confidence = min_confidence
        self.debounce_seconds = debounce_seconds
        self.on_reading = on_reading
        self.on_audio_alert = on_audio_alert

        self._running = False
        # Debounce memory: text_hash -> last_announced_timestamp
        self._recent_hashes: Dict[str, float] = {}

    def extract_text_from_frame(self, frame: Any) -> Optional[OCRTextReading]:
        """
        Preprocess image frame and run Tesseract OCR.
        """
        try:
            import cv2
            import numpy as np
            import pytesseract
        except ImportError as exc:
            logger.debug("OpenCV/pytesseract not available: %s", exc)
            return None

        if frame is None:
            return None

        if hasattr(frame, "convert") and not isinstance(frame, np.ndarray):
            frame = np.array(frame)

        if not isinstance(frame, np.ndarray) or frame.size == 0:
            return None

        try:
            # 1. Grayscale conversion
            if len(frame.shape) == 3:
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            else:
                gray = frame

            # 2. Contrast Limited Adaptive Histogram Equalization (CLAHE)
            clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
            enhanced = clahe.apply(gray)

            # 3. Bilateral filter to reduce noise while preserving edges
            denoised = cv2.bilateralFilter(enhanced, 9, 75, 75)

            # 4. Otsu adaptive binarization
            _, binarized = cv2.threshold(denoised, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

            # 5. Tesseract OCR execution
            # Try configured language or fallback to eng
            lang = self.default_lang
            try:
                data = pytesseract.image_to_data(
                    binarized,
                    lang=lang,
                    output_type=pytesseract.Output.DICT,
                )
            except Exception:
                data = pytesseract.image_to_data(
                    binarized,
                    lang="eng",
                    output_type=pytesseract.Output.DICT,
                )
                lang = "eng"

            # Filter tokens by confidence
            valid_words = []
            confidences = []
            x_min, y_min, x_max, y_max = 999999, 999999, 0, 0

            n_boxes = len(data["text"])
            for i in range(n_boxes):
                text = data["text"][i].strip()
                conf = float(data["conf"][i])
                if conf >= self.min_confidence and len(text) > 1:
                    valid_words.append(text)
                    confidences.append(conf)
                    x, y, w, h = data["left"][i], data["top"][i], data["width"][i], data["height"][i]
                    x_min = min(x_min, x)
                    y_min = min(y_min, y)
                    x_max = max(x_max, x + w)
                    y_max = max(y_max, y + h)

            if not valid_words:
                return None

            raw_text = " ".join(valid_words)
            cleaned_text = _clean_ocr_text(raw_text)

            # Require at least 3 alphanumeric characters
            if len(re.sub(r"\W", "", cleaned_text)) < 3:
                return None

            avg_conf = sum(confidences) / max(len(confidences), 1)
            bbox = [x_min, y_min, x_max - x_min, y_max - y_min] if x_max > x_min else None

            reading = OCRTextReading(
                device_id=self.device_id,
                raw_text=raw_text,
                cleaned_text=cleaned_text,
                confidence=round(avg_conf, 1),
                language=lang,
                bbox=bbox,
                audio_announced=False,
                timestamp=datetime.now(timezone.utc),
            )
            return self._dispatch_reading(reading)

        except Exception as exc:
            logger.error("OCR frame processing error: %s", exc)
            return None

    def _dispatch_reading(self, reading: OCRTextReading) -> OCRTextReading:
        """Handle deduplication debounce, TTS notification and callbacks."""
        now = datetime.now(timezone.utc).timestamp()
        text_hash = hashlib.md5(reading.cleaned_text.lower().encode("utf-8")).hexdigest()

        # Prune old hashes from debounce memory
        self._recent_hashes = {
            h: ts for h, ts in self._recent_hashes.items()
            if (now - ts) < self.debounce_seconds
        }

        is_repeat = text_hash in self._recent_hashes

        if not is_repeat:
            self._recent_hashes[text_hash] = now
            reading.audio_announced = True

            logger.info(
                "[OCR] Texto leido: '%s' | conf=%.1f%% | lang=%s",
                reading.cleaned_text, reading.confidence, reading.language,
            )

            if self.on_audio_alert:
                # Priority 2: High priority for text reading
                msg = f"Texto detectado: {reading.cleaned_text}"
                self.on_audio_alert(msg, 2)

        if self.on_reading:
            self.on_reading(reading)

        return reading

    def synthesize_reading(
        self,
        raw_text: Optional[str] = None,
        cleaned_text: Optional[str] = None,
        confidence: Optional[float] = None,
    ) -> OCRTextReading:
        """
        Synthesize a realistic text reading for testing and simulation.
        """
        if raw_text is None or cleaned_text is None:
            sample = random.choice(_SIMULATED_TEXT_CORPUS)
            raw_text = sample["raw"]
            cleaned_text = sample["clean"]
            lang = sample["lang"]
        else:
            lang = self.default_lang

        conf = confidence if confidence is not None else round(random.uniform(85.0, 99.0), 1)

        reading = OCRTextReading(
            device_id=self.device_id,
            raw_text=raw_text,
            cleaned_text=cleaned_text,
            confidence=conf,
            language=lang,
            bbox=[80, 150, 420, 120],
            audio_announced=False,
            timestamp=datetime.now(timezone.utc),
        )
        return self._dispatch_reading(reading)

    async def run_simulation(
        self,
        duration_sec: float = 120.0,
        interval_sec: float = 14.0,
    ) -> None:
        """
        Async simulation loop: emits realistic OCR readings at intervals.
        """
        self._running = True
        logger.info("[MODE] OCR reader simulation started (interval=%.1fs)", interval_sec)
        start_time = asyncio.get_event_loop().time()

        while self._running:
            elapsed = asyncio.get_event_loop().time() - start_time
            if duration_sec > 0 and elapsed >= duration_sec:
                break

            await asyncio.sleep(interval_sec)
            if not self._running:
                break

            self.synthesize_reading()

        logger.info("[SHUTDOWN] OCR reader simulation stopped")

    def stop(self) -> None:
        """Stop any active background loops."""
        self._running = False
