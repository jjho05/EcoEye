# EcoEye 👁️🌐
> **Sistema de Computación Ubicua e Inteligencia Ambiental Asistencial**
> *HackaTec Regional 2026 — Categoría 5: Software Inteligente*

---

## 🎯 Visión General
**EcoEye** es una solución ubicua e invisible diseñada para la asistencia continua y no invasiva de personas adultas mayores y con debilidad visual o patologías crónicas (diabetes). Opera bajo una estricta política de **Privacidad por Diseño (Zero-Camera Indoors)**:
- **En interiores**: Utiliza señales **WiFi CSI (Channel State Information)** analizando perturbaciones espectrales en 64 subportadoras OFDM para detectar caídas y presencia en recámaras y baños sin usar cámaras.
- **En exteriores**: Visión artificial ligera en el wearable Edge para detección de obstáculos con retroalimentación sonora no intrusiva.
- **Monitoreo Metabólico**: Integración continua con glucómetros BLE (Perfil GATT `0x1808`), validación estricta de límites fisiológicos (20–500 mg/dL) y alarmas inmediatas.
- **Offline-First & Criptografía**: Persistencia local con SQLite WAL, cifrado de telemetría médica en reposo con **AES-256-GCM + PBKDF2-HMAC-SHA256**, y sincronización idempotente hacia el Cloud Gateway.

---

## 🏗️ Arquitectura Técnica

```
[ Wearable Edge Camera ] ----+
[ Glucómetro BLE 0x1808 ] ---+---> [ EcoEye Edge Core ] ---> [ SQLite WAL (AES-256-GCM) ]
[ Router / ESP32 WiFi CSI ] -+          |                          |
                                        v                          v
                                [ Audio Feedback ]         [ Sync Queue Worker ]
                                        |                          |
                                        +-------------------+      v
                                                            +-> [ FastAPI Cloud Gateway ]
                                                                      |
                                                                      v
                                                               [ WebSockets Dashboard ]
```

---

## 🚀 Inicio Rápido

### 1. Requisitos e Instalación
```bash
python3 -m pip install -r requirements.txt
```

### 2. Ejecutar Demostración Integral
```bash
python3 scripts/run_demo.py
```

### 3. Ejecutar Suite de Pruebas
```bash
pytest tests/ -v
```
