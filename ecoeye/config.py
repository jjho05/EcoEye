"""
Configuración centralizada del sistema EcoEye con validación estricta (Pydantic Settings).
"""

import os
from pathlib import Path
from typing import Any, Optional
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import AliasChoices, Field, model_validator



class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="ECOEYE_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    @model_validator(mode="before")
    @classmethod
    def sanitize_empty_env_strings(cls, data: Any) -> Any:
        """Filter out empty string env vars so field defaults are preserved on cloud deployments."""
        if isinstance(data, dict):
            return {
                k: v for k, v in data.items()
                if not (isinstance(v, str) and v.strip() == "")
            }
        return data

    # Entorno
    env: str = Field(default="development", description="Entorno de ejecución (development, test, production)")
    debug: bool = Field(default=True, description="Modo debug para logs detallados")
    device_id: str = Field(default="ecoeye-edge-001", description="Identificador único del nodo Edge")

    # Seguridad Criptográfica
    secret_key: str = Field(
        default="ecoeye-hackatec-regional-2026-master-key-secure-vault",
        description="Clave maestra para derivación PBKDF2 y cifrado AES-256-GCM"
    )
    security_encryption_key: str = Field(
        default="ecoeye-hackatec-regional-2026-master-key-secure-vault",
        description="Clave maestra para derivación PBKDF2 y cifrado AES-256-GCM (alias)"
    )
    security_key_derivation_iterations: int = Field(
        default=100_000,
        description="Número de iteraciones para derivación PBKDF2-HMAC-SHA256"
    )
    salt: str = Field(
        default="ecoeye-salt-32bytes-secure-fixed01",
        description="Sal para derivación PBKDF2-HMAC-SHA256"
    )

    @property
    def SECURITY_ENCRYPTION_KEY(self) -> str:
        return self.security_encryption_key or self.secret_key

    @property
    def SECURITY_KEY_DERIVATION_ITERATIONS(self) -> int:
        return self.security_key_derivation_iterations

    # Persistencia Local Offline-First
    db_path: str = Field(default="ecoeye_local.db", description="Ruta al archivo SQLite local")

    # Persistencia Remota Cloud (PostgreSQL / Neon Serverless)
    database_url: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("ECOEYE_DATABASE_URL", "DATABASE_URL"),
        description="URI de conexión remota PostgreSQL / Neon (ECOEYE_DATABASE_URL o DATABASE_URL)"
    )

    # Inteligencia Artificial Multimodal (Google Gemini)
    gemini_api_key: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices(
            "ECOEYE_GEMINI_API_KEY",
            "GEMINI_API_KEY",
            "GOOGLE_API_KEY",
            "GEMINI_KEY"
        ),
        description="API Key de Google Gemini para visión y análisis multimodal"
    )
    gemini_model: str = Field(
        default="gemini-2.5-flash",
        validation_alias=AliasChoices("ECOEYE_GEMINI_MODEL", "GEMINI_MODEL"),
        description="Modelo de Google Gemini para inferencia multimodal (gemini-2.5-flash)"
    )

    # Sensado WiFi CSI
    csi_sample_rate_hz: int = Field(default=100, description="Frecuencia de muestreo de paquetes CSI")
    csi_num_subcarriers: int = Field(default=64, description="Número de subportadoras OFDM analizadas")
    csi_fall_threshold_variance: float = Field(default=2.8, description="Umbral de varianza normalizada para impacto")
    csi_inactivity_window_sec: float = Field(default=4.0, description="Ventana de confirmación de inmovilidad post-impacto")

    # Telemetría de Glucosa (Normativa 20 - 500 mg/dL)
    glucose_min_alert_mgdl: float = Field(default=70.0, description="Umbral de hipoglucemia severa")
    glucose_max_alert_mgdl: float = Field(default=180.0, description="Umbral de hiperglucemia")

    # Servidor y API Cloud Gateway
    api_host: str = Field(default="0.0.0.0", description="Host de enlace para el servidor FastAPI")
    api_port: int = Field(default=8000, description="Puerto de escucha del servidor FastAPI")
    cloud_gateway_url: str = Field(
        default="http://127.0.0.1:8000/api/v1/sync/telemetry",
        description="Endpoint para sincronización por lotes"
    )

    @property
    def absolute_db_path(self) -> Path:
        """Devuelve la ruta absoluta normalizada a la base de datos SQLite."""
        if os.getenv("VERCEL") or os.getenv("AWS_LAMBDA_FUNCTION_NAME"):
            p = Path(self.db_path)
            return Path("/tmp") / p.name
        p = Path(self.db_path)
        if not p.is_absolute():
            return Path.cwd() / p
        return p


# Instancia singleton para importación en toda la app
settings = Settings()
