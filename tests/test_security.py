"""
Unit tests for EcoEye Security & Cryptography Engine.
Validates AES-256-GCM authenticated encryption, PBKDF2 derivation,
and HMAC integrity protection.
"""

import pytest
from ecoeye.core.security import (
    CryptoEngine,
    DecryptionError,
    compute_hmac,
    verify_hmac,
    compute_sha256,
)


def test_encryption_roundtrip_string():
    engine = CryptoEngine(master_password="test-secret-key-32bytes-passw!", iterations=1000)
    original = "Glucosa del paciente: 110 mg/dL - Normal"
    encrypted_b64 = engine.encrypt_string(original)
    assert isinstance(encrypted_b64, str)
    assert encrypted_b64 != original

    decrypted = engine.decrypt_string(encrypted_b64)
    assert decrypted == original


def test_encryption_roundtrip_dict():
    engine = CryptoEngine(master_password="test-secret-key-32bytes-passw!", iterations=1000)
    data = {
        "glucose_mg_dl": 85.5,
        "device_id": "cgm-dexcom-01",
        "trend": "STABLE",
        "raw_voltage": 1.28
    }
    encrypted_b64 = engine.encrypt_dict(data)
    decrypted_data = engine.decrypt_dict(encrypted_b64)
    assert decrypted_data == data


def test_encryption_is_probabilistic_with_unique_salts():
    """Two encryptions of the same plaintext must produce distinct ciphertexts."""
    engine = CryptoEngine(master_password="test-secret-key-32bytes-passw!", iterations=1000)
    msg = "Paciente en reposo"
    enc1 = engine.encrypt_string(msg)
    enc2 = engine.encrypt_string(msg)
    assert enc1 != enc2


def test_associated_data_authentication():
    """Ensure Associated Data (AAD) binds context (e.g. record_id or timestamp)."""
    engine = CryptoEngine(master_password="test-secret-key-32bytes-passw!", iterations=1000)
    plaintext = b"Sensitive telemetry"
    aad_correct = b"patient-id:12345"
    aad_wrong = b"patient-id:99999"

    encrypted = engine.encrypt_bytes(plaintext, associated_data=aad_correct)
    
    # Decrypt with correct AAD succeeds
    assert engine.decrypt_bytes(encrypted, associated_data=aad_correct) == plaintext

    # Decrypt with wrong AAD must raise DecryptionError
    with pytest.raises(DecryptionError):
        engine.decrypt_bytes(encrypted, associated_data=aad_wrong)


def test_tampered_ciphertext_detection():
    """Modifying even 1 bit in ciphertext or tag must cause authentication failure."""
    engine = CryptoEngine(master_password="test-secret-key-32bytes-passw!", iterations=1000)
    plaintext = b"Critical alert: Fall detected"
    encrypted = bytearray(engine.encrypt_bytes(plaintext))

    # Tamper with the last byte of tag/ciphertext
    encrypted[-1] ^= 0x01

    with pytest.raises(DecryptionError):
        engine.decrypt_bytes(bytes(encrypted))


def test_payload_too_short():
    engine = CryptoEngine(master_password="test-secret-key-32bytes-passw!", iterations=1000)
    with pytest.raises(DecryptionError):
        engine.decrypt_bytes(b"short")


def test_hmac_computation_and_verification():
    secret = "hmac-shared-key-12345"
    message = '{"event": "fall", "confidence": 0.98}'
    sig = compute_hmac(message, secret)

    assert isinstance(sig, str)
    assert len(sig) == 64  # SHA-256 hex string

    # Correct signature verifies
    assert verify_hmac(message, sig, secret) is True

    # Tampered message fails
    assert verify_hmac(message + " ", sig, secret) is False

    # Wrong secret fails
    assert verify_hmac(message, sig, "wrong-secret") is False


def test_sha256_hash():
    data = "EcoEye Telemetry"
    h1 = compute_sha256(data)
    h2 = compute_sha256(data.encode("utf-8"))
    assert h1 == h2
    assert len(h1) == 64
