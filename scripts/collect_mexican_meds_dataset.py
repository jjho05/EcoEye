"""
EcoEye Mexican Medications Dataset & Evaluation Utility.

Manages:
  1. Exporting the structured Mexican medication catalog (PLM/COFEPRIS-aligned).
  2. Generating synthetic labeled packaging test cards for vision testing and calibration.
  3. Running benchmark evaluation against positive cases (real Mexican drugs)
     and negative adversarial cases (food, drinks, books, currency) to verify 0% false positives.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path
from typing import Dict, List, Tuple

# Add parent directory to path to allow importing ecoeye modules
project_root = Path(__file__).resolve().parent.parent
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

from ecoeye.sensing.vision.medications_mx import (
    MEXICAN_MEDICATIONS_CATALOG,
    identify_mexican_medication,
    is_strictly_pharmaceutical,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("ecoeye.scripts.meds_dataset")


def export_catalog(output_path: Path) -> None:
    """Exports catalog to a clean JSON file for cross-platform apps and models."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    serialized = []
    for med in MEXICAN_MEDICATIONS_CATALOG:
        serialized.append({
            "id": med.id,
            "active_ingredient": med.active_ingredient,
            "brand_names": med.brand_names,
            "dosages": med.dosages,
            "forms": med.forms,
            "category": med.category,
            "route": med.route,
            "audio_description": med.audio_description,
            "common_warnings": med.common_warnings,
            "aliases": med.aliases,
        })

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(serialized, f, ensure_ascii=False, indent=2)

    logger.info(f"Catalog exported with {len(serialized)} medications to: {output_path}")


def run_benchmark() -> Tuple[float, float]:
    """
    Evaluates the medication classification pipeline against
    a comprehensive benchmark of positive and negative cases.
    """
    positives = [
        # Tempra / Paracetamol variants
        "TEMPRA PARACETAMOL 500 MG TABLETAS CAJA CON 20 TABLETAS REG SSA",
        "PARACETAMOL GENERICO INTERCAMBIABLE GI 500 MG LABORATORIOS PISA",
        "TYLENOL CAPLETS 500MG ACETAMINOFEN ALIVIO DEL DOLOR",
        "TEMPRA INFANTIL JARABE 100 MG/ML PARACETAMOL PEDIATRICO",

        # Ibuprofeno / Actron variants
        "ACTRON 400 MG CAPSULAS DE GEL IBUPROFENO BAYER",
        "ADVIL FORTE 400 MG IBUPROFENO TABLETAS PFIZER",
        "IBUPROFENO 600 MG GENERICO GI FARMACIAS SIMILARES CAJA 10 TABLETAS",

        # Naproxeno / Flanax
        "FLANAX 550 MG NAPROXENO SODICO TABLETAS ALIVIO HASTA POR 24 HORAS",
        "NAPROXENO 250 MG GENERICO GI FARMACIAS DEL AHORRO",

        # Metformina (Diabetes)
        "METFORMINA 850 MG TABLETAS GLUCOPHAGE CONTROL GLUCEMICO SSA REG",
        "METFORMINA 500 MG GENERICO GI TABLETAS TOMAR 1 CON DESAYUNO",

        # Losartán (Hipertensión)
        "LOSARTAN POTASICO 50 MG COZAAR TABLETAS RECUBIERTAS CAJA CON 30",
        "LOSARTAN 50 MG GENERICO GI FARMACIAS GUADALAJARA",

        # Omeprazol (Gastrointestinal)
        "OMEPRAZOL 20 MG CAPSULAS LOSEC PROTECTOR GASTRICO EN AYUNAS",
        "OMEPRAZOL 40 MG GENERICO GI LABORATORIOS SANFER",

        # Antibióticos y Antigripales
        "AMOXICILINA 500 MG CAPSULAS AMOXIL ANTIBIOTICO RECETA MEDICA",
        "ANTIFLU-DES AMANTADINA CLORFENAMINA PARACETAMOL CAPSULAS",
        "TABCIN NOCHE ANTIGRIPAL TABLETAS EFERVESCENTES BAYER",
        "XL-3 EXTRA ANTIGRIPAL PARACETAMOL FENILEFRINA CLORFENAMINA",
        "SALBUTAMOL 100 MCG AEROSOL PARA INHALACION VENTOLIN",
        "PEPTO-BISMOL SUBSALICILATO DE BISMUTO SUSPENSION ORAL",
    ]

    negatives = [
        "COCA COLA 600 ML REFRESCO DE COLA SABOR ORIGINAL",
        "PAPAS SABRITAS CON SAL 45 G BOTANA FRITA",
        "GALLETAS GAMESA CHOCOKIKIS 100 G CON CHISPAS DE CHOCOLATE",
        "LECHE ENTERA LALA ULTRA PASTEURIZADA 1 LITRO",
        "BANCO DE MEXICO 500 PESOS BENITO JUAREZ",
        "BILLETE DE CIEN PESOS SOR JUANA INES DE LA CRUZ BANXICO",
        "CRUCE PEATONAL PRECAUCION TRANSITO DE VEHICULOS",
        "LIBRO DE HISTORIA DE MEXICO TERCER GRADO PAGINA 45",
        "SHAMPOO HEAD & SHOULDERS LIMPIEZA RENOVADORA 400 ML",
        "PARED BLANCA CON LUZ SOLAR DIRECTA",
        "MESA DE MADERA EN SALA DE ESTAR",
    ]

    logger.info(f"Running benchmark: {len(positives)} positive cases, {len(negatives)} negative cases...")

    # Evaluate Positives
    true_positives = 0
    for sample in positives:
        res = identify_mexican_medication(sample)
        if res and res["is_medication"]:
            true_positives += 1
        else:
            logger.warning(f"Failed positive: '{sample}'")

    # Evaluate Negatives (Must NOT be detected as medicine)
    false_positives = 0
    for sample in negatives:
        res = identify_mexican_medication(sample)
        if res and res["is_medication"]:
            false_positives += 1
            logger.warning(f"False positive triggered on: '{sample}' -> {res}")

    tpr = (true_positives / len(positives)) * 100
    fpr = (false_positives / len(negatives)) * 100

    logger.info("=" * 55)
    logger.info(f"BENCHMARK RESULTS:")
    logger.info(f"  Positives Detected (Recall/Sensitivity): {true_positives}/{len(positives)} ({tpr:.1f}%)")
    logger.info(f"  False Positives Rate (Fall-out):         {false_positives}/{len(negatives)} ({fpr:.1f}%)")
    logger.info("=" * 55)

    return tpr, fpr


def main():
    parser = argparse.ArgumentParser(description="Mexican Medications Dataset & Calibration Benchmark")
    parser.add_argument("--export", action="store_true", help="Export structured JSON catalog")
    parser.add_argument("--benchmark", action="store_true", help="Run benchmark against positive & negative sets")
    args = parser.parse_args()

    default_output = project_root / "ecoeye" / "sensing" / "vision" / "medications_mx.json"

    if args.export or (not args.benchmark):
        export_catalog(default_output)

    if args.benchmark or (not args.export):
        tpr, fpr = run_benchmark()
        if fpr > 0:
            logger.error("BENCHMARK FAILED: False positives detected!")
            sys.exit(1)
        if tpr < 90.0:
            logger.error("BENCHMARK FAILED: Sensitivity below 90%!")
            sys.exit(1)
        logger.info("BENCHMARK PASSED: 100% precision with 0% false positives.")


if __name__ == "__main__":
    main()
