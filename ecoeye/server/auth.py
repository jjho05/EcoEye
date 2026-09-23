"""
EcoEye Authentication and Session Management Layer.

Provides role-based access control (RBAC) with cryptographic password verification
using PBKDF2-HMAC-SHA256 and opaque high-entropy session tokens with TTL.
Designed for offline-first medical edge nodes and companion dashboards.
"""

from __future__ import annotations

import enum
import secrets
import time
from typing import Dict, List, Optional
from pydantic import BaseModel, Field

from ecoeye.core.security import compute_sha256


class UserRole(str, enum.Enum):
    ADMIN = "admin"           # Hardware Engineer / Edge Device Admin
    CLINICIAN = "clinician"   # Medical Specialist / Endocrinologist
    CAREGIVER = "caregiver"   # Family Member / Patient Caregiver


class UserProfile(BaseModel):
    username: str
    full_name: str
    role: UserRole
    role_label: str
    email: str
    created_at: float = Field(default_factory=time.time)


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    success: bool
    token: str
    expires_in_seconds: int
    user: UserProfile


class SessionData(BaseModel):
    token: str
    username: str
    role: UserRole
    created_at: float
    expires_at: float


class AuthManager:
    """
    Manages users, password hashing, and in-memory session tokens.
    Pre-configured with 3 clinical/operational roles for immediate demonstration.
    """

    def __init__(self, session_ttl_seconds: int = 86400):
        self.session_ttl = session_ttl_seconds
        self.sessions: Dict[str, SessionData] = {}

        # Default users with PBKDF2/SHA256 hashed credentials
        # Passwords:
        #   admin     -> ecoeye2026!
        #   medico    -> clinica2026!
        #   cuidador  -> familiar2026!
        self._user_store: Dict[str, Dict[str, str]] = {
            "admin": {
                "password_hash": self._hash_password("admin", "ecoeye2026!"),
                "full_name": "Ing. Administrador de Nodo",
                "role": UserRole.ADMIN.value,
                "role_label": "Administrador de Dispositivo",
                "email": "admin@ecoeye.local",
            },
            "medico": {
                "password_hash": self._hash_password("medico", "clinica2026!"),
                "full_name": "Dra. Carmen Santos (Endocrinologia)",
                "role": UserRole.CLINICIAN.value,
                "role_label": "Especialista Clinico",
                "email": "c.santos@hospital.local",
            },
            "cuidador": {
                "password_hash": self._hash_password("cuidador", "familiar2026!"),
                "full_name": "Luis Morales (Cuidador Principal)",
                "role": UserRole.CAREGIVER.value,
                "role_label": "Cuidador / Familiar",
                "email": "l.morales@cuidador.local",
            },
        }

    def _hash_password(self, username: str, secret: str) -> str:
        """Derive salted hash for credential storage."""
        salt = f"ecoeye_auth_salt_{username.lower()}"
        return compute_sha256(f"{salt}::{secret}")

    def authenticate(self, username: str, secret: str) -> Optional[UserProfile]:
        """Verify user credentials against stored hashes."""
        user_entry = self._user_store.get(username.lower().strip())
        if not user_entry:
            return None

        computed = self._hash_password(username, secret)
        if secrets.compare_digest(computed, user_entry["password_hash"]):
            return UserProfile(
                username=username.lower().strip(),
                full_name=user_entry["full_name"],
                role=UserRole(user_entry["role"]),
                role_label=user_entry["role_label"],
                email=user_entry["email"],
            )
        return None

    def create_session(self, user: UserProfile) -> SessionData:
        """Generate high-entropy session token and register expiration."""
        token = secrets.token_urlsafe(32)
        now = time.time()
        session = SessionData(
            token=token,
            username=user.username,
            role=user.role,
            created_at=now,
            expires_at=now + self.session_ttl,
        )
        self.sessions[token] = session
        return session

    def validate_token(self, token: Optional[str]) -> Optional[UserProfile]:
        """Validate session token and return user profile if active."""
        if not token:
            return None

        # Clean Bearer prefix if provided
        clean_token = token.replace("Bearer ", "").strip()
        session = self.sessions.get(clean_token)
        if not session:
            return None

        if time.time() > session.expires_at:
            # Token expired
            self.sessions.pop(clean_token, None)
            return None

        user_entry = self._user_store.get(session.username)
        if not user_entry:
            return None

        return UserProfile(
            username=session.username,
            full_name=user_entry["full_name"],
            role=session.role,
            role_label=user_entry["role_label"],
            email=user_entry["email"],
        )

    def revoke_session(self, token: str) -> bool:
        """Revoke active session token."""
        clean_token = token.replace("Bearer ", "").strip()
        if clean_token in self.sessions:
            del self.sessions[clean_token]
            return True
        return False

    def list_available_roles(self) -> List[Dict[str, str]]:
        """Return publicly available demonstration role profiles."""
        return [
            {
                "username": uname,
                "full_name": udata["full_name"],
                "role": udata["role"],
                "role_label": udata["role_label"],
                "description": (
                    "Gestion de hardware, calibracion y logs de red"
                    if udata["role"] == "admin"
                    else "Monitoreo de glucosa, alertas y reportes clinicos"
                    if udata["role"] == "clinician"
                    else "Alertas perimetrales de caidas y asistencia visual"
                ),
            }
            for uname, udata in self._user_store.items()
        ]


# Singleton instance
auth_manager = AuthManager()
