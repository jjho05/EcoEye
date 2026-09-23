"""
EcoEye Core Domain Models.
Strict Pydantic v2 data models for ubiquitous ambient sensing,
biomedical telemetry, and edge-cloud synchronization.

Contract is aligned with test_storage.py to ensure consistent
end-to-end data flow: Sensor → EventBus → SQLite → SyncQueue → Supabase.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, field_validator, model_validator


# ================================================================
# Core Enums — Shared across sensing subsystems
# ================================================================

class EventSeverity(str, Enum):
    """Generic severity scale for any system event."""
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


class FallSeverity(str, Enum):
    """Severity classification for WiFi-CSI fall detection events."""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class FallStatus(str, Enum):
    """Life-cycle status of a classified fall event."""
    DETECTED = "detected"
    CONFIRMED = "confirmed"
    FALSE_POSITIVE = "false_positive"


class GlucoseTrend(str, Enum):
    """CGM trend arrow — aligned with GATT 0x2A18 trend field values."""
    FALLING_FAST = "falling_fast"
    FALLING = "falling"
    FLAT = "flat"          # test alias for STEADY
    STEADY = "steady"
    RISING = "rising"
    RISING_FAST = "rising_fast"
    UNKNOWN = "unknown"


class GlucoseAlertLevel(str, Enum):
    """Clinical glucose alert threshold classification."""
    NORMAL = "normal"
    HYPO = "hypo"               # < 70 mg/dL
    SEVERE_HYPO = "severe_hypo" # < 54 mg/dL
    HYPER = "hyper"             # > 180 mg/dL
    SEVERE_HYPER = "severe_hyper" # > 250 mg/dL
    SENSOR_ERROR = "sensor_error"


class ObstacleDirection(str, Enum):
    """Spatial direction of detected obstacle (vision system)."""
    LEFT = "left"
    CENTER = "center"
    RIGHT = "right"


# Alias used by tests and external code — maps to ObstacleDirection
class ObstacleSector(str, Enum):
    """Sector classification — preferred name in test and user-facing API."""
    LEFT = "left"
    CENTER = "center"
    RIGHT = "right"


class ObstacleUrgency(str, Enum):
    """Urgency level for obstacle proximity alerts."""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class TelemetryType(str, Enum):
    """Classification of local telemetry messages persisted to telemetry_log."""
    GLUCOSE = "glucose"
    FALL = "fall"
    OBSTACLE = "obstacle"
    HEARTBEAT = "heartbeat"
    SYSTEM = "system"
    AUDIO = "audio"


# ================================================================
# Raw Sensor Models
# ================================================================

class CSIFrame(BaseModel):
    """Raw or filtered CSI frame captured across OFDM subcarriers."""
    timestamp: float = Field(
        default_factory=lambda: datetime.now(timezone.utc).timestamp()
    )
    subcarrier_amplitudes: List[float] = Field(
        ...,
        description="Amplitudes across OFDM subcarriers (e.g. 64 subcarriers)"
    )
    rssi: float = Field(..., description="Received Signal Strength Indicator in dBm")
    noise_floor: float = Field(default=-90.0, description="Estimated noise floor in dBm")
    carrier_frequency_ghz: float = Field(default=5.0, description="WiFi band (2.4 or 5 GHz)")
    channel: int = Field(default=36, description="WiFi channel index")

    @field_validator("subcarrier_amplitudes")
    @classmethod
    def validate_subcarriers(cls, v: List[float]) -> List[float]:
        if not v or len(v) < 16:
            raise ValueError("CSI frame must contain at least 16 subcarriers")
        return v


# ================================================================
# Domain Events — aligned with test_storage.py contract
# ================================================================

class GlucoseReading(BaseModel):
    """
    Biomedical glucose telemetry via BLE GATT Profile (0x1808 / 0x2A18).
    Fields aligned with test_storage.py expectations.
    """
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    sensor_id: str = Field(..., description="Unique MAC or identifier of the CGM/BLE device")

    # Primary glucose value — both field names accepted for compatibility
    glucose_mg_dl: float = Field(..., ge=20.0, le=500.0, description="Blood glucose in mg/dL")

    trend: GlucoseTrend = Field(default=GlucoseTrend.STEADY)
    alert_level: GlucoseAlertLevel = Field(default=GlucoseAlertLevel.NORMAL)

    # Clinical threshold flags (aligned with Dexcom G7 / Libre 3 data model)
    is_urgent_low: bool = Field(
        default=False, description="True if glucose < 54 mg/dL (urgent hypoglycemia)"
    )
    is_low: bool = Field(
        default=False, description="True if glucose < 70 mg/dL (hypoglycemia)"
    )
    is_high: bool = Field(
        default=False, description="True if glucose > 180 mg/dL (hyperglycemia)"
    )
    is_urgent_high: bool = Field(
        default=False, description="True if glucose > 250 mg/dL (urgent hyperglycemia)"
    )

    transmitter_battery_pct: Optional[int] = Field(default=None, ge=0, le=100)
    raw_hex_packet: Optional[str] = Field(
        default=None, description="Original GATT hex payload for audit"
    )

    @model_validator(mode="after")
    def derive_alert_level_and_flags(self) -> "GlucoseReading":
        """Auto-derive alert_level and boolean flags from glucose_mg_dl value."""
        v = self.glucose_mg_dl
        if v < 54.0:
            self.alert_level = GlucoseAlertLevel.SEVERE_HYPO
            self.is_urgent_low = True
            self.is_low = True
        elif v < 70.0:
            self.alert_level = GlucoseAlertLevel.HYPO
            self.is_low = True
        elif v > 250.0:
            self.alert_level = GlucoseAlertLevel.SEVERE_HYPER
            self.is_urgent_high = True
            self.is_high = True
        elif v > 180.0:
            self.alert_level = GlucoseAlertLevel.HYPER
            self.is_high = True
        else:
            self.alert_level = GlucoseAlertLevel.NORMAL
        return self

    @classmethod
    def evaluate_alert(cls, value_mg_dl: float) -> GlucoseAlertLevel:
        """Static helper to evaluate alert level from a raw glucose value."""
        if value_mg_dl < 54.0:
            return GlucoseAlertLevel.SEVERE_HYPO
        elif value_mg_dl < 70.0:
            return GlucoseAlertLevel.HYPO
        elif value_mg_dl > 250.0:
            return GlucoseAlertLevel.SEVERE_HYPER
        elif value_mg_dl > 180.0:
            return GlucoseAlertLevel.HYPER
        return GlucoseAlertLevel.NORMAL

    # Backward-compat property for code that uses value_mg_dl
    @property
    def value_mg_dl(self) -> float:
        return self.glucose_mg_dl

    @property
    def battery_level_pct(self) -> Optional[int]:
        return self.transmitter_battery_pct


class FallEvent(BaseModel):
    """
    Event emitted when abrupt vertical mobility drop followed by stillness
    is classified by the WiFi-CSI detector.
    Fields aligned with test_storage.py expectations.
    """
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    device_id: str = Field(
        default="ecoeye-edge-001", description="Sensor node identifier"
    )

    severity: FallSeverity = Field(default=FallSeverity.HIGH)
    confidence: float = Field(..., ge=0.0, le=1.0, description="Detection confidence [0,1]")
    inactivity_duration_sec: float = Field(
        ..., ge=0.0, description="Duration of post-fall stillness in seconds"
    )
    location_hint: str = Field(
        default="desconocida", description="Sensory zone label (e.g. baño, sala)"
    )
    is_confirmed: bool = Field(
        default=False, description="True after manual or automated confirmation"
    )
    status: FallStatus = Field(default=FallStatus.DETECTED)
    metadata: Dict[str, Any] = Field(
        default_factory=dict, description="Raw inference metrics (variance, doppler, etc.)"
    )

    # Extended signal metrics
    spectral_energy_ratio: float = Field(
        default=0.0, description="Doppler spectral burst ratio"
    )
    hampel_anomaly_score: float = Field(
        default=0.0, description="Outlier amplitude deviation score"
    )

    # Backward-compat properties
    @property
    def location(self) -> str:
        return self.location_hint

    @property
    def duration_stillness_sec(self) -> float:
        return self.inactivity_duration_sec

    @property
    def raw_metrics(self) -> Dict[str, Any]:
        return self.metadata


class ObstacleDetection(BaseModel):
    """
    Spatial obstacle detected by edge vision system for visually impaired navigation.
    Fields aligned with test_storage.py expectations.
    """
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    # Sector/direction of the obstacle
    sector: ObstacleSector = Field(
        default=ObstacleSector.CENTER, description="Spatial sector of detection"
    )
    distance_meters: float = Field(..., ge=0.0, le=20.0, description="Estimated distance")
    urgency: ObstacleUrgency = Field(
        default=ObstacleUrgency.MEDIUM, description="Proximity urgency level"
    )

    # Audio feedback
    audio_alert_played: bool = Field(
        default=False, description="True if audio alert was successfully played"
    )
    audio_message: str = Field(..., description="TTS message content for audio cue")

    # Optional vision metadata
    label: Optional[str] = Field(
        default=None, description="YOLO classification label (e.g. escalón, persona)"
    )
    confidence: float = Field(default=0.9, ge=0.0, le=1.0)

    # Backward-compat properties
    @property
    def direction(self) -> ObstacleDirection:
        return ObstacleDirection(self.sector.value)

    @property
    def spoken_message(self) -> str:
        return self.audio_message

    @property
    def urgent(self) -> bool:
        return self.urgency in (ObstacleUrgency.HIGH, ObstacleUrgency.CRITICAL)


# ================================================================
# Telemetry & Sync Envelope Models
# ================================================================

class TelemetryMessage(BaseModel):
    """Generic edge telemetry envelope persisted and queued for synchronization."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    source: str = Field(..., description="Sensor subsystem (wifi_csi, vision, glucose_ble, voice)")
    event_type: str = Field(..., description="Event classification name")
    telemetry_type: TelemetryType = Field(default=TelemetryType.SYSTEM)
    payload: Dict[str, Any] = Field(..., description="Deserialized event payload")
    is_encrypted: bool = Field(
        default=False, description="Flag indicating if payload is encrypted in storage"
    )
    synced: bool = Field(default=False, description="Cloud sync acknowledgement status")


class SyncPacket(BaseModel):
    """Idempotent batch payload sent from Edge node to Central Gateway."""
    batch_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    node_id: str = Field(default="ecoeye-edge-node-01")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    messages: List[TelemetryMessage] = Field(default_factory=list)
    checksum: str = Field(..., description="HMAC-SHA256 of batch contents")


# ================================================================
# Remote Supabase / PostgreSQL Models
# Aligned with schema_supabase.sql
# ================================================================

class RemoteDeviceType(str, Enum):
    WIFI_CSI_NODE = "wifi_csi_node"
    CAMERA_DEVICE = "camera_device"
    WEARABLE_HUB = "wearable_hub"
    OTHER = "other"


class RemoteDeviceStatus(str, Enum):
    ACTIVO = "activo"
    INACTIVO = "inactivo"
    OFFLINE = "offline"
    MANTENIMIENTO = "mantenimiento"


class RemoteAlertType(str, Enum):
    CAIDA_DETECTADA = "caida_detectada"
    OBSTACULO_INMINENTE = "obstaculo_inminente"
    DISPOSITIVO_OFFLINE = "dispositivo_offline"
    BATERIA_BAJA = "bateria_baja"
    ANOMALIA_SISTEMA = "anomalia_sistema"
    PRUEBA_SISTEMA = "prueba_sistema"


class RemoteAlertSeverity(str, Enum):
    INFO = "info"
    ADVERTENCIA = "advertencia"
    CRITICA = "critica"


class RemoteAlertStatus(str, Enum):
    ACTIVA = "activa"
    RECONOCIDA = "reconocida"
    FALSA_ALARMA = "falsa_alarma"
    RESUELTA = "resuelta"


class RemoteCaregiverStatus(str, Enum):
    PENDIENTE = "pendiente"
    ACTIVO = "activo"
    REVOCADO = "revocado"


class RemoteAlertRecord(BaseModel):
    """
    Registro alineado con public.alerts en Supabase.
    El id es un UUID generado en el Edge para garantizar idempotencia en reintentos.
    """
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str = Field(..., description="UUID del usuario dueño en Supabase")
    device_id: Optional[str] = Field(default=None, description="UUID del dispositivo sensor")
    alert_type: RemoteAlertType = Field(..., description="Tipo de alerta del enum remoto")
    severity: RemoteAlertSeverity = Field(default=RemoteAlertSeverity.ADVERTENCIA)
    status: RemoteAlertStatus = Field(default=RemoteAlertStatus.ACTIVA)
    payload_json: Dict[str, Any] = Field(
        default_factory=dict, description="Métricas de inferencia en JSONB"
    )
    occurred_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    synced_at: Optional[datetime] = None
    acknowledged_at: Optional[datetime] = None
    acknowledged_by: Optional[str] = None


class RemoteTelemetryRecord(BaseModel):
    """Registro alineado con public.device_telemetry en Supabase."""
    id: Optional[str] = Field(default_factory=lambda: str(uuid.uuid4()))
    device_id: str = Field(..., description="UUID del dispositivo registrado en public.devices")
    battery_level: Optional[float] = Field(default=None, ge=0.0, le=100.0)
    cpu_temp: Optional[float] = Field(default=None)
    uptime_seconds: Optional[int] = Field(default=None)
    network_latency_ms: Optional[int] = Field(default=None)
    recorded_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
