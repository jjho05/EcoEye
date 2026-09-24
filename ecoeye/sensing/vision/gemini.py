"""
EcoEye Gemini Multimodal Vision Integration.

Provides cloud-assisted computer vision and visual question answering (VQA)
using Google Gemini (default model: gemini-3.8-flash).
Assists visually impaired users with real-time scene understanding,
banknote denomination classification, and medicine label OCR reading.
"""

from __future__ import annotations

import base64
import json
import logging
from typing import Any, Dict, Optional, Union

import httpx

from ecoeye.config import settings

logger = logging.getLogger(__name__)


class GeminiVisionClient:
    """
    Client for Google Gemini Multimodal REST API.
    Uses the gemini-3.8-flash model for low-latency visual inference.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        timeout_seconds: float = 15.0,
    ) -> None:
        self.api_key = api_key or settings.gemini_api_key
        self.model = model or settings.gemini_model or "gemini-3.8-flash"
        self.timeout = timeout_seconds
        self.base_url = "https://generativelanguage.googleapis.com/v1beta"

    @property
    def is_configured(self) -> bool:
        """Check if a valid API key has been provided."""
        return bool(self.api_key and self.api_key.strip())

    def _clean_base64(self, raw_b64: str) -> str:
        """Remove data URI scheme prefix if present."""
        if "," in raw_b64:
            return raw_b64.split(",", 1)[1]
        return raw_b64.strip()

    async def generate_multimodal_content(
        self,
        image_base64: str,
        prompt: str,
        mime_type: str = "image/jpeg",
    ) -> Dict[str, Any]:
        """
        Send image and prompt to Google Gemini API.
        Returns parsed API candidate response.
        """
        if not self.is_configured:
            return {
                "success": False,
                "error": "GEMINI_API_KEY no esta configurada. Agrega la variable en el entorno o Vercel.",
                "model": self.model,
            }

        clean_b64 = self._clean_base64(image_base64)
        endpoint = f"{self.base_url}/models/{self.model}:generateContent?key={self.api_key}"

        payload = {
            "contents": [
                {
                    "parts": [
                        {"text": prompt},
                        {
                            "inline_data": {
                                "mime_type": mime_type,
                                "data": clean_b64,
                            }
                        },
                    ]
                }
            ],
            "generationConfig": {
                "temperature": 0.2,
                "topK": 32,
                "topP": 0.95,
                "maxOutputTokens": 1024,
            },
        }

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(endpoint, json=payload)

            if resp.status_code != 200:
                error_detail = resp.text
                try:
                    err_json = resp.json()
                    if "error" in err_json and "message" in err_json["error"]:
                        error_detail = err_json["error"]["message"]
                except Exception:
                    pass
                logger.error("Error en llamada a Gemini (%d): %s", resp.status_code, error_detail)
                return {
                    "success": False,
                    "status_code": resp.status_code,
                    "error": f"Error Gemini API ({resp.status_code}): {error_detail}",
                    "model": self.model,
                }

            data = resp.json()
            candidates = data.get("candidates", [])
            if not candidates:
                return {
                    "success": False,
                    "error": "Gemini no genero candidatos de respuesta para esta imagen.",
                    "model": self.model,
                }

            text_parts = candidates[0].get("content", {}).get("parts", [])
            full_text = "".join(part.get("text", "") for part in text_parts).strip()

            return {
                "success": True,
                "text": full_text,
                "model": self.model,
                "usage": data.get("usageMetadata", {}),
            }

        except httpx.TimeoutException:
            logger.warning("Timeout al conectar con Gemini API (%s)", self.model)
            return {
                "success": False,
                "error": f"Tiempo de espera agotado ({self.timeout}s) contactando Gemini.",
                "model": self.model,
            }
        except Exception as exc:
            logger.error("Excepcion no controlada en GeminiVisionClient: %s", exc)
            return {
                "success": False,
                "error": str(exc),
                "model": self.model,
            }

    async def identify_currency(self, image_base64: str) -> Dict[str, Any]:
        """
        Specialized prompt for Mexican peso banknote and coin identification.
        Returns denomination, currency, confidence, and voice announcement.
        """
        prompt = (
            "Eres el subsistema de vision asistiva de EcoEye para personas con discapacidad visual. "
            "Analiza con precision la imagen para identificar dinero en efectivo de Mexico (billetes o monedas MXN). "
            "Usa esta guia oficial de billetes de Banxico (Familia G y F) para determinar la denominacion:\n"
            "- $20 MXN: Color azul y rojo (Bicentenario) o azul marino/verde (Juarez y Manglares).\n"
            "- $50 MXN: Color morado/magenta (Ajolote de Xochimilco o Jose Maria Morelos).\n"
            "- $100 MXN: Color rojo/terracota (Sor Juana Ines de la Cruz o Nezahualcoyotl).\n"
            "- $200 MXN: Color verde (Miguel Hidalgo y Jose Maria Morelos, o Sor Juana).\n"
            "- $500 MXN: Color azul (Benito Juarez con ballena gris) o cafe/azul (Diego Rivera y Frida Kahlo).\n"
            "- $1000 MXN: Color gris/violeta o sepia (Francisco I. Madero, Hermila Galindo y Carmen Serdan).\n"
            "Presta maxima atencion al color predominante y a cualquier digito visible ('20', '50', '100', '200', '500', '1000').\n"
            "Responde estrictamente con un objeto JSON valido (sin bloques markdown ni explicaciones adicionales):\n"
            "{\n"
            "  \"is_currency\": true/false,\n"
            "  \"denomination\": 20 / 50 / 100 / 200 / 500 / 1000 o null,\n"
            "  \"currency\": \"MXN\",\n"
            "  \"confidence\": 0.0 a 1.0,\n"
            "  \"audio_speech\": \"Billete de X pesos mexicanos\" o \"Moneda de X pesos\",\n"
            "  \"details\": \"Color y motivo identificado\"\n"
            "}"
        )

        res = await self.generate_multimodal_content(image_base64, prompt)
        if not res.get("success"):
            return res

        raw_text = res.get("text", "").strip()
        # Clean potential markdown fences
        if raw_text.startswith("```"):
            lines = raw_text.splitlines()
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].startswith("```"):
                lines = lines[:-1]
            raw_text = "\n".join(lines).strip()

        parsed = None
        try:
            parsed = json.loads(raw_text)
        except Exception:
            import re
            json_match = re.search(r"\{.*\}", raw_text, re.DOTALL)
            if json_match:
                try:
                    parsed = json.loads(json_match.group(0))
                except Exception:
                    pass

        if isinstance(parsed, dict):
            parsed["model"] = self.model
            parsed["provider"] = "Google Gemini"
            return parsed

        return {
            "is_currency": True if ("pesos" in raw_text.lower() or "billete" in raw_text.lower()) else False,
            "denomination": None,
            "currency": "MXN",
            "confidence": 0.85,
            "audio_speech": raw_text[:120],
            "details": raw_text,
            "model": self.model,
            "provider": "Google Gemini",
        }

    async def read_medicine_and_ocr(self, image_base64: str) -> Dict[str, Any]:
        """
        Specialized prompt for Mexican medicine labels, prescriptions, and pharmaceutical packaging.
        Applies strict anti-false-positive verification against non-pharmaceutical items.
        """
        from ecoeye.sensing.vision.medications_mx import identify_mexican_medication

        prompt = (
            "Eres el lector óptico y asistente farmacéutico de EcoEye para personas con discapacidad visual en México. "
            "Tu tarea es identificar con máxima precisión medicamentos del mercado mexicano (cajas, frascos, blísteres, "
            "ampolletas, jarabes, gotas o recetas médicas), tanto marcas de patente (ej. Tempra, Flanax, Actron, Losec, "
            "Aspirina, Pepto-Bismol, Buscapina, Antiflu-Des, Tabcin, XL-3, etc.) como Genéricos Intercambiables (GI / "
            "Farmacias Similares, Farmacias del Ahorro, Farmacias Guadalajara, Sanfer, Pisa, Alpharma, etc.).\n\n"
            "REGLAS CRÍTICAS INNEGOCIABLES:\n"
            "1. ANTI-FALSOS POSITIVOS: Si la imagen NO contiene un empaque de medicamento, caja de medicina, frasco farmacéutico, "
            "blíster o receta (por ejemplo: si es un libro, una revista, una lata de refresco, comida, una pared, dinero, muebles o una persona), "
            "debes responder estrictamente con is_medication: false, has_text: true/false, medicine_name: null, dosage: null, "
            "audio_speech: 'No se detecta un medicamento en la imagen. Enfoque la caja o frasco directamente.', confidence: 0.0.\n"
            "2. SI ES MEDICAMENTO: Extrae con exactitud:\n"
            "   - Sustancia activa y/o nombre comercial mexicano.\n"
            "   - Gramaje o concentración exacta (ej: 500 mg, 850 mg, 20 ml, 100 mcg).\n"
            "   - Forma farmacéutica (Tabletas, Cápsulas, Jarabe, Suspensión infantil, etc.).\n"
            "   - Vía de administración o advertencias clave si están visibles (ej: caducidad, lote, cada cuantas horas).\n"
            "   - audio_speech: Frase clara y concisa en español mexicano para locución al paciente invidente.\n\n"
            "Responde estrictamente con un JSON válido con esta estructura exacta:\n"
            "{\n"
            "  \"has_text\": true,\n"
            "  \"is_medication\": true,\n"
            "  \"full_text\": \"Transcripción de todo el texto visible\",\n"
            "  \"medicine_name\": \"Nombre del fármaco y/o marca\",\n"
            "  \"dosage\": \"Dosis o gramaje identificado (ej. 500 mg)\",\n"
            "  \"form\": \"Tabletas / Cápsulas / Jarabe / etc.\",\n"
            "  \"instructions\": \"Instrucciones o advertencias detectadas\",\n"
            "  \"audio_speech\": \"Mensaje conciso en español para locución al paciente\",\n"
            "  \"confidence\": 0.95\n"
            "}"
        )

        res = await self.generate_multimodal_content(image_base64, prompt)
        if not res.get("success"):
            return res

        raw_text = res.get("text", "").strip()
        if raw_text.startswith("```"):
            lines = raw_text.splitlines()
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].startswith("```"):
                lines = lines[:-1]
            raw_text = "\n".join(lines).strip()

        try:
            parsed = json.loads(raw_text)
            parsed["model"] = self.model
            parsed["provider"] = "Google Gemini"
            # Si el modelo determinó que no es medicamento, asegurar audio speech claro
            if not parsed.get("is_medication"):
                parsed["is_medication"] = False
                parsed["medicine_name"] = None
                parsed["dosage"] = None
                if not parsed.get("audio_speech") or "medicamento" in parsed.get("audio_speech", "").lower() and "detectado" in parsed.get("audio_speech", "").lower():
                    parsed["audio_speech"] = "No se detecta un medicamento en la imagen. Enfoque la caja o frasco directamente."
            return parsed
        except Exception:
            # Fallback a clasificador local de catálogo mexicano
            local_match = identify_mexican_medication(raw_text)
            if local_match:
                local_match["full_text"] = raw_text
                local_match["has_text"] = True
                local_match["model"] = self.model
                local_match["provider"] = "Google Gemini + Local Catalog"
                return local_match

            return {
                "has_text": bool(raw_text),
                "is_medication": False,
                "full_text": raw_text,
                "medicine_name": None,
                "dosage": None,
                "instructions": None,
                "audio_speech": "No se detecta un medicamento en la imagen. Enfoque la caja o frasco directamente.",
                "confidence": 0.0,
                "model": self.model,
                "provider": "Google Gemini",
            }

    async def describe_scene(
        self,
        image_base64: str,
        question: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Comprehensive environmental understanding and visual question answering.
        """
        q_text = question if question else "Describe el entorno frente al usuario."
        prompt = (
            "Eres las gafas inteligentes de EcoEye para una persona con discapacidad visual. "
            "Analiza la escena frente a la camara y responde a esta consulta del usuario: "
            f"\"{q_text}\". "
            "Indica con precision si hay personas, obstaculos en el camino (sillas, puertas, escalones, cables), "
            "objetos de interes y su ubicacion aproximada (frente, izquierda, derecha). "
            "Responde estrictamente con un JSON valido con esta estructura: "
            "{"
            "  \"summary\": \"Resumen conciso en 1 o 2 oraciones para sintesis de voz inmediata\", "
            "  \"detailed_description\": \"Descripcion mas amplia del entorno\", "
            "  \"obstacles_found\": [\"lista de posibles obstaculos\"], "
            "  \"people_detected\": true/false, "
            "  \"safety_recommendation\": \"Consejo de navegacion o paso seguro\""
            "}"
        )

        res = await self.generate_multimodal_content(image_base64, prompt)
        if not res.get("success"):
            return res

        raw_text = res.get("text", "").strip()
        if raw_text.startswith("```"):
            lines = raw_text.splitlines()
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].startswith("```"):
                lines = lines[:-1]
            raw_text = "\n".join(lines).strip()

        try:
            parsed = json.loads(raw_text)
            parsed["model"] = self.model
            parsed["provider"] = "Google Gemini"
            return parsed
        except Exception:
            return {
                "summary": raw_text[:140],
                "detailed_description": raw_text,
                "obstacles_found": [],
                "people_detected": False,
                "safety_recommendation": "Proceda con precaucion.",
                "model": self.model,
                "provider": "Google Gemini",
            }


# Singleton client instance
gemini_client = GeminiVisionClient()
