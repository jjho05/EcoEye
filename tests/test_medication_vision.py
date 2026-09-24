"""
EcoEye Unit Tests — Mexican Medications Vision Recognition & Anti-False-Positive Engine.

Validates:
  1. Mexican catalog integrity and structure (brands, dosages, COFEPRIS guidelines).
  2. Precision recognition on top Mexican pharmaceuticals (patent vs GI generics).
  3. Rejection of non-medication objects (drinks, snacks, bills, signs) with 0% false positives.
  4. Dosage, formulation, and audio-speech extraction.
  5. FastAPI OCR endpoint integration for medication classification.
"""

import tempfile
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from ecoeye.sensing.vision.medications_mx import (
    MEXICAN_MEDICATIONS_CATALOG,
    identify_mexican_medication,
    is_strictly_pharmaceutical,
    extract_dosage,
    extract_form,
)
from ecoeye.storage.database import DatabaseManager
from ecoeye.storage.repository import EcoEyeRepository
from ecoeye.storage.sync_queue import SyncQueueManager
from ecoeye.server.api import create_app


# ----------------------------------------------------------------------
# 1. Catalog Integrity Tests
# ----------------------------------------------------------------------

def test_mexican_catalog_integrity():
    """Verify presence and valid structure of major Mexican medications."""
    assert len(MEXICAN_MEDICATIONS_CATALOG) >= 25

    active_ingredients = [m.active_ingredient.lower() for m in MEXICAN_MEDICATIONS_CATALOG]
    assert any("paracetamol" in a for a in active_ingredients)
    assert any("metformina" in a for a in active_ingredients)
    assert any("losartán" in a or "losartan" in a for a in active_ingredients)
    assert any("omeprazol" in a for a in active_ingredients)
    assert any("ibuprofeno" in a for a in active_ingredients)

    for med in MEXICAN_MEDICATIONS_CATALOG:
        assert med.id
        assert med.active_ingredient
        assert len(med.brand_names) >= 1
        assert med.route
        assert med.audio_description
        assert len(med.aliases) >= 1


# ----------------------------------------------------------------------
# 2. Positive Recognition Tests
# ----------------------------------------------------------------------

@pytest.mark.parametrize("sample,expected_substance,expected_dosage", [
    ("TEMPRA PARACETAMOL 500 MG TABLETAS CAJA CON 20 TABLETAS", "Paracetamol", "500 mg"),
    ("ACTRON 400 MG CAPSULAS DE GEL IBUPROFENO BAYER", "Ibuprofeno", "400 mg"),
    ("FLANAX 550 MG NAPROXENO SODICO TABLETAS", "Naproxeno", "550 mg"),
    ("METFORMINA 850 MG TABLETAS GLUCOPHAGE CONTROL GLUCEMICO", "Metformina", "850 mg"),
    ("LOSARTAN POTASICO 50 MG COZAAR TABLETAS RECUBIERTAS", "Losartán", "50 mg"),
    ("OMEPRAZOL 20 MG CAPSULAS LOSEC PROTECTOR GASTRICO", "Omeprazol", "20 mg"),
    ("ASPIRINA PROTECT 100 MG TABLETAS CARDIOPROTECTOR BAYER", "Ácido Acetilsalicílico", "100 mg"),
    ("SALBUTAMOL 100 MCG AEROSOL PARA INHALACION VENTOLIN", "Salbutamol", "100 mcg"),
    ("PARACETAMOL 500 MG GENERICO INTERCAMBIABLE GI FARMACIAS SIMILARES", "Paracetamol", "500 mg"),
])
def test_positive_medication_recognition(sample, expected_substance, expected_dosage):
    """Verify correct identification of common Mexican drugs, dosages and audio."""
    res = identify_mexican_medication(sample)
    assert res is not None
    assert res["is_medication"] is True
    assert res["medicine_name"] == expected_substance
    assert res["dosage"] == expected_dosage
    assert len(res["audio_speech"]) > 10


# ----------------------------------------------------------------------
# 3. Anti-False-Positive Rejection Tests (Zero False Positives)
# ----------------------------------------------------------------------

@pytest.mark.parametrize("adversarial_sample", [
    "COCA COLA 600 ML REFRESCO DE COLA SABOR ORIGINAL",
    "PAPAS SABRITAS CON SAL 45 G BOTANA FRITA",
    "GALLETAS GAMESA CHOCOKIKIS 100 G CON CHISPAS DE CHOCOLATE",
    "LECHE ENTERA LALA ULTRA PASTEURIZADA 1 LITRO",
    "BANCO DE MEXICO 500 PESOS BENITO JUAREZ SERIE G",
    "BILLETE DE CIEN PESOS SOR JUANA INES DE LA CRUZ BANXICO",
    "CRUCE PEATONAL PRECAUCION TRANSITO DE VEHICULOS",
    "LIBRO DE HISTORIA DE MEXICO TERCER GRADO",
    "SHAMPOO HEAD & SHOULDERS LIMPIEZA RENOVADORA 400 ML",
    "PARED BLANCA CON LUZ SOLAR DIRECTA",
    "MESA DE MADERA EN SALA DE ESTAR",
])
def test_anti_false_positive_rejection(adversarial_sample):
    """Verify that non-pharmaceutical items are strictly rejected."""
    is_med, conf, reason = is_strictly_pharmaceutical(adversarial_sample)
    assert is_med is False
    res = identify_mexican_medication(adversarial_sample)
    assert res is None


# ----------------------------------------------------------------------
# 4. Dosage and Pharmaceutical Form Extractors
# ----------------------------------------------------------------------

def test_dosage_and_form_extractors():
    """Verify regex extraction of dosages and formulations."""
    assert extract_dosage("METFORMINA 850 MG TABLETAS") == "850 mg"
    assert extract_dosage("JARABE 100 ML") == "100 ml"
    assert extract_dosage("VENTOLIN 100 MCG") == "100 mcg"
    assert extract_dosage("INSULINA 100 UI/ML") == "100 ui"
    assert extract_dosage("CAJA SIN NUMEROS") is None

    assert extract_form("CAJA CON 20 TABLETAS") == "Tabletas"
    assert extract_form("30 CAPSULAS DE GEL") == "Cápsulas"
    assert extract_form("JARABE INFANTIL") == "Jarabe"
    assert extract_form("AEROSOL PARA INHALACION") == "Aerosol para inhalación"


# ----------------------------------------------------------------------
# 5. FastAPI Integration Tests
# ----------------------------------------------------------------------

def test_api_medication_process_endpoint():
    """Verify /api/v1/vision/ocr/process endpoint with medication payloads."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name

    try:
        repo = EcoEyeRepository(db_path=db_path)
        queue_mgr = SyncQueueManager(db_manager=repo.db)
        app = create_app(repo=repo, queue_mgr=queue_mgr)
        client = TestClient(app)

        # 1. Positive medication text: Paracetamol
        res_pos = client.post(
            "/api/v1/vision/ocr/process",
            json={"mock_text": "TEMPRA PARACETAMOL 500 MG TABLETAS CAJA CON 20"},
        )
        assert res_pos.status_code == 200
        data_pos = res_pos.json()
        assert data_pos["is_medication"] is True
        assert data_pos["medicine_name"] == "Paracetamol"
        assert data_pos["dosage"] == "500 mg"
        assert "Paracetamol" in data_pos["audio_speech"]

        # 2. Negative non-medication text: Soda / Food
        res_neg = client.post(
            "/api/v1/vision/ocr/process",
            json={"mock_text": "COCA COLA 600 ML BEBIDA REFRESCANTE"},
        )
        assert res_neg.status_code == 200
        data_neg = res_neg.json()
        assert data_neg["is_medication"] is False
        assert "No se detecta un medicamento" in data_neg["audio_speech"]

    finally:
        Path(db_path).unlink(missing_ok=True)
