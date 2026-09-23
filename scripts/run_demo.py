#!/usr/bin/env python3
"""
EcoEye — Script de Demostración Integral para HackaTec Regional 2026.

Ejecuta el orquestador unificado en modo simulación:
  1. Base de datos SQLite WAL local con cifrado AES-256-GCM
  2. Detección de caídas WiFi CSI (Hampel Filter + Máquina de estados)
  3. Detección de obstáculos por visión por computador con alertas TTS
  4. Lector de glucosa BLE GATT 0x1808 / 0x2A18
  5. Motor de sincronización idempotente hacia Supabase
  6. Servidor API local FastAPI en http://127.0.0.1:8000
"""

from __future__ import annotations

import sys
from pathlib import Path

# Añadir la raíz del proyecto al PYTHONPATH
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from ecoeye.main import main

if __name__ == "__main__":
    main()
