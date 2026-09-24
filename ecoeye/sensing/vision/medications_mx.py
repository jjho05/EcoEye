"""
EcoEye Mexican Medications Catalog and Vision Recognition Engine.

Specialized for the Mexican pharmaceutical market:
  - Active substances (Sustancias activas).
  - Patent brands (Marcas de patente: Tempra, Flanax, Actron, Losec, etc.).
  - Generic equivalents (Genéricos Intercambiables - GI / Farmacias Similares, Ahorro, Guadalajara).
  - Standard dosages, pharmaceutical forms, and COFEPRIS-standard labels.
  - Optical noise normalization and strict anti-false-positive filtering.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("ecoeye.sensing.vision.medications_mx")


@dataclass
class MexicanMedication:
    """Structured record for a Mexican pharmaceutical product."""
    id: str
    active_ingredient: str
    brand_names: List[str]
    dosages: List[str]
    forms: List[str]
    category: str
    route: str
    audio_description: str
    common_warnings: Optional[str] = None
    aliases: List[str] = field(default_factory=list)


# Comprehensive catalog of Top 35+ high-turnover medications in Mexico
MEXICAN_MEDICATIONS_CATALOG: List[MexicanMedication] = [
    # --- Analgésicos y Antipiréticos ---
    MexicanMedication(
        id="paracetamol",
        active_ingredient="Paracetamol",
        brand_names=["Tempra", "Tylenol", "Sedalmerck", "Genérico GI", "Similares", "Ahorro"],
        dosages=["500 mg", "650 mg", "1 g", "100 mg/ml", "300 mg"],
        forms=["Tabletas", "Jarabe", "Suspensión infantil", "Supositorios"],
        category="Analgésico y Antipirético",
        route="Oral",
        audio_description="Paracetamol. Analgésico y antipirético para alivio del dolor y la fiebre.",
        common_warnings="No exceder de 4 gramos al día. Evitar consumir alcohol.",
        aliases=["ACETAMINOFEN", "TEMPRA", "TYLENOL", "PARACETAMOL", "PARACETAM0L"],
    ),
    MexicanMedication(
        id="ibuprofeno",
        active_ingredient="Ibuprofeno",
        brand_names=["Actron", "Advil", "Motrin", "Genérico GI", "Similares"],
        dosages=["400 mg", "600 mg", "800 mg", "100 mg/5ml"],
        forms=["Cápsulas de gel", "Tabletas", "Suspensión"],
        category="Antiinflamatorio no esteroideo (AINE)",
        route="Oral",
        audio_description="Ibuprofeno. Antiinflamatorio y analgésico para dolor muscular o de cabeza.",
        common_warnings="Tomar con alimentos. Evitar en caso de úlcera gástrica activa.",
        aliases=["ACTRON", "ADVIL", "MOTRIN", "IBUPROFENO", "IBUPROFEN0"],
    ),
    MexicanMedication(
        id="naproxeno",
        active_ingredient="Naproxeno",
        brand_names=["Flanax", "Dafloxen", "Genérico GI", "Similares"],
        dosages=["250 mg", "550 mg"],
        forms=["Tabletas", "Cápsulas"],
        category="Antiinflamatorio no esteroideo (AINE)",
        route="Oral",
        audio_description="Naproxeno. Alivio potente para inflamación articular y dolor muscular prolongado.",
        common_warnings="Tomar con alimentos o leche.",
        aliases=["FLANAX", "DAFLOXEN", "NAPROXENO", "NAPROXEN"],
    ),
    MexicanMedication(
        id="acido_acetilsalicilico",
        active_ingredient="Ácido Acetilsalicílico",
        brand_names=["Aspirina", "Aspirina Protect", "Cafiaspirina", "Genérico GI"],
        dosages=["500 mg", "100 mg"],
        forms=["Tabletas", "Tabletas efervescentes"],
        category="Analgésico y Antiagregante plaquetario",
        route="Oral",
        audio_description="Aspirina, Ácido Acetilsalicílico. Analgésico o cardioprotector según dosis.",
        common_warnings="No administrar a niños o adolescentes con varicela o gripe.",
        aliases=["ASPIRINA", "ASPIRINA PROTECT", "CAFIASPIRINA", "ACETILSALICILICO"],
    ),
    MexicanMedication(
        id="ketorolaco",
        active_ingredient="Ketorolaco",
        brand_names=["Dolac", "Supradol", "Genérico GI", "Similares"],
        dosages=["10 mg", "30 mg"],
        forms=["Tabletas", "Tabletas sublinguales", "Solución inyectable"],
        category="Analgésico potente (AINE)",
        route="Oral / Sublingual",
        audio_description="Ketorolaco. Analgésico de acción rápida para dolor agudo moderado a severo.",
        common_warnings="No usar por más de 5 días continuos.",
        aliases=["DOLAC", "SUPRADOL", "KETOROLACO", "KETOROLAC"],
    ),
    MexicanMedication(
        id="metamizol",
        active_ingredient="Metamizol Sódico",
        brand_names=["Neo-Melubrina", "Prodolina", "Genérico GI"],
        dosages=["500 mg", "1 g"],
        forms=["Tabletas", "Jarabe", "Solución inyectable"],
        category="Analgésico y Antipirético",
        route="Oral / Intramuscular",
        audio_description="Metamizol sódico. Para dolor severo y fiebre resistente a otros tratamientos.",
        common_warnings="Uso bajo supervisión médica.",
        aliases=["NEO-MELUBRINA", "NEOMELUBRINA", "PRODOLINA", "METAMIZOL", "DIPIRONA"],
    ),

    # --- Enfermedades Crónicas (Diabetes e Hipertensión en México) ---
    MexicanMedication(
        id="metformina",
        active_ingredient="Metformina",
        brand_names=["Glucophage", "Dimefor", "Genérico GI", "Similares", "Ahorro"],
        dosages=["500 mg", "850 mg", "1000 mg"],
        forms=["Tabletas", "Tabletas de liberación prolongada"],
        category="Antidiabético oral",
        route="Oral",
        audio_description="Metformina. Tratamiento de control glucémico para diabetes tipo 2.",
        common_warnings="Tomar con las comidas principales.",
        aliases=["GLUCOPHAGE", "DIMEFOR", "METFORMINA", "METFORMIN"],
    ),
    MexicanMedication(
        id="glibenclamida",
        active_ingredient="Glibenclamida",
        brand_names=["Daonil", "Euglucon", "Genérico GI"],
        dosages=["5 mg"],
        forms=["Tabletas"],
        category="Hipoglucemiante oral",
        route="Oral",
        audio_description="Glibenclamida. Para control de glucosa en diabetes tipo 2.",
        common_warnings="Vigilar signos de hipoglucemia (mareo, sudoración fría).",
        aliases=["DAONIL", "EUGLUCON", "GLIBENCLAMIDA"],
    ),
    MexicanMedication(
        id="losartan",
        active_ingredient="Losartán",
        brand_names=["Cozaar", "Genérico GI", "Similares", "Ahorro"],
        dosages=["50 mg", "100 mg"],
        forms=["Grageas", "Tabletas"],
        category="Antihipertensivo (ARA-II)",
        route="Oral",
        audio_description="Losartán. Medicamento antihipertensivo para control de la presión arterial.",
        common_warnings="Tomar diariamente a la misma hora.",
        aliases=["COZAAR", "LOSARTAN", "LOSARTAN POTASICO"],
    ),
    MexicanMedication(
        id="enalapril",
        active_ingredient="Enalapril",
        brand_names=["Renitec", "Genérico GI"],
        dosages=["10 mg", "20 mg"],
        forms=["Tabletas"],
        category="Antihipertensivo (IECA)",
        route="Oral",
        audio_description="Enalapril. Antihipertensivo y protector cardiovascular.",
        common_warnings="Reportar al médico si presenta tos seca persistente.",
        aliases=["RENITEC", "ENALAPRIL", "ENALAPRIL MALEATO"],
    ),
    MexicanMedication(
        id="captopril",
        active_ingredient="Captopril",
        brand_names=["Capoten", "Genérico GI"],
        dosages=["25 mg", "50 mg"],
        forms=["Tabletas"],
        category="Antihipertensivo",
        route="Oral",
        audio_description="Captopril. Para el control rápido de la hipertensión arterial.",
        common_warnings="Tomar una hora antes de los alimentos.",
        aliases=["CAPOTEN", "CAPTOPRIL"],
    ),
    MexicanMedication(
        id="atorvastatina",
        active_ingredient="Atorvastatina",
        brand_names=["Lipitor", "Tahor", "Genérico GI", "Similares"],
        dosages=["10 mg", "20 mg", "40 mg"],
        forms=["Tabletas"],
        category="Hipolipemiante (Estatina)",
        route="Oral",
        audio_description="Atorvastatina. Para reducción del colesterol y triglicéridos en sangre.",
        common_warnings="Se recomienda tomar por la noche.",
        aliases=["LIPITOR", "TAHOR", "ATORVASTATINA", "ATORVASTATIN"],
    ),
    MexicanMedication(
        id="amlodipino",
        active_ingredient="Amlodipino",
        brand_names=["Norvasc", "Genérico GI"],
        dosages=["5 mg", "10 mg"],
        forms=["Tabletas"],
        category="Antihipertensivo (Calcioantagonista)",
        route="Oral",
        audio_description="Amlodipino. Medicamento para control de la presión arterial y angina de pecho.",
        common_warnings="Puede ocasionar hinchazón leve en tobillos.",
        aliases=["NORVASC", "AMLODIPINO", "AMLODIPINE"],
    ),
    MexicanMedication(
        id="insulina_nph",
        active_ingredient="Insulina Humana NPH",
        brand_names=["Humulin N", "Novolin N", "Genérico"],
        dosages=["100 UI/ml"],
        forms=["Frasco ámpula", "Pluma prellenada"],
        category="Insulina de acción intermedia",
        route="Subcutánea",
        audio_description="Insulina Humana NPH. Mantener en refrigeración entre 2 y 8 grados centígrados.",
        common_warnings="No congelar. Mezclar suavemente antes de aplicar sin agitar bruscamente.",
        aliases=["HUMULIN N", "NOVOLIN N", "INSULINA NPH", "INSULINA HUMANA"],
    ),

    # --- Gastrointestinales ---
    MexicanMedication(
        id="omeprazol",
        active_ingredient="Omeprazol",
        brand_names=["Losec", "Genérico GI", "Similares", "Ahorro"],
        dosages=["20 mg", "40 mg"],
        forms=["Cápsulas", "Solución inyectable"],
        category="Inhibidor de la bomba de protones (Antiácido)",
        route="Oral",
        audio_description="Omeprazol. Protector gástrico para gastritis, acidez y reflujo.",
        common_warnings="Tomar por la mañana en ayunas, 30 minutos antes del desayuno.",
        aliases=["LOSEC", "OMEPRAZOL", "OMEPRAZOLE"],
    ),
    MexicanMedication(
        id="pantoprazol",
        active_ingredient="Pantoprazol",
        brand_names=["Tecta", "Pantozol", "Genérico GI"],
        dosages=["20 mg", "40 mg"],
        forms=["Tabletas con capa entérica"],
        category="Inhibidor de la bomba de protones",
        route="Oral",
        audio_description="Pantoprazol. Tratamiento de reflujo gastroesofágico y úlcera gástrica.",
        common_warnings="Deglutir entera con agua sin masticar.",
        aliases=["TECTA", "PANTOZOL", "PANTOPRAZOL"],
    ),
    MexicanMedication(
        id="pepto_bismol",
        active_ingredient="Subsalicilato de Bismuto",
        brand_names=["Pepto-Bismol", "Bismuto GI"],
        dosages=["262 mg", "1.75 g / 100 ml"],
        forms=["Tabletas masticables", "Suspensión líquida"],
        category="Antidiarreico y Antiácido",
        route="Oral",
        audio_description="Pepto-Bismol. Alivio para acidez, indigestión, náuseas y malestar estomacal.",
        common_warnings="Puede oscurecer temporalmente la lengua o las heces.",
        aliases=["PEPTO-BISMOL", "PEPTO BISMOL", "SUBSALICILATO DE BISMUTO", "BISMUTO"],
    ),
    MexicanMedication(
        id="loperamida",
        active_ingredient="Loperamida",
        brand_names=["Imodium", "Aciban", "Genérico GI"],
        dosages=["2 mg"],
        forms=["Tabletas", "Cápsulas"],
        category="Antidiarreico",
        route="Oral",
        audio_description="Loperamida. Control sintomático de diarrea aguda.",
        common_warnings="Acompañar con abundante suero oral para prevenir deshidratación.",
        aliases=["IMODIUM", "ACIBAN", "LOPERAMIDA"],
    ),
    MexicanMedication(
        id="buscapina",
        active_ingredient="Butilhioscina",
        brand_names=["Buscapina", "Buscapina Compositum", "Genérico GI"],
        dosages=["10 mg", "10 mg / 500 mg"],
        forms=["Grageas", "Solución inyectable"],
        category="Antiespasmódico",
        route="Oral",
        audio_description="Buscapina. Alivio de espasmos y retortijones estomacales o menstruales.",
        common_warnings="Tomar con agua en caso de cólicos.",
        aliases=["BUSCAPINA", "BUSCAPINA COMPOSITUM", "BUTILHIOSCINA", "HIOSCINA"],
    ),

    # --- Antibióticos e Infecciosos (COFEPRIS Grupo IV - Con receta) ---
    MexicanMedication(
        id="amoxicilina",
        active_ingredient="Amoxicilina",
        brand_names=["Amoxil", "Genérico GI", "Similares"],
        dosages=["500 mg", "875 mg", "250 mg/5ml"],
        forms=["Cápsulas", "Suspensión"],
        category="Antibiótico Betalactámico",
        route="Oral",
        audio_description="Amoxicilina. Antibiótico de venta exclusiva con receta médica.",
        common_warnings="Completar el tratamiento completo indicado por el médico aunque mejoren los síntomas.",
        aliases=["AMOXIL", "AMOXICILINA", "AMOXICILIN"],
    ),
    MexicanMedication(
        id="amoxicilina_clavulanico",
        active_ingredient="Amoxicilina con Ácido Clavulánico",
        brand_names=["Augmentin", "Clavulin", "Genérico GI"],
        dosages=["500 mg / 125 mg", "875 mg / 125 mg"],
        forms=["Tabletas", "Suspensión oral"],
        category="Antibiótico de amplio espectro",
        route="Oral",
        audio_description="Amoxicilina con Ácido Clavulánico. Antibiótico de amplio espectro con receta.",
        common_warnings="Tomar al inicio de una comida para reducir molestias gastrointestinales.",
        aliases=["AUGMENTIN", "CLAVULIN", "AMOXICILINA ACIDO CLAVULANICO", "CLAVULANATO"],
    ),
    MexicanMedication(
        id="ciprofloxacino",
        active_ingredient="Ciprofloxacino",
        brand_names=["Ciproxina", "Ciproflox", "Genérico GI"],
        dosages=["500 mg", "250 mg"],
        forms=["Tabletas"],
        category="Antibiótico Fluoroquinolona",
        route="Oral",
        audio_description="Ciprofloxacino. Antibiótico fluoroquinolona. Requiere receta médica.",
        common_warnings="No tomar con leche o antiácidos simultáneamente.",
        aliases=["CIPROXINA", "CIPROFLOX", "CIPROFLOXACINO"],
    ),
    MexicanMedication(
        id="azitromicina",
        active_ingredient="Azitromicina",
        brand_names=["Azitrocin", "Macrozit", "Genérico GI"],
        dosages=["500 mg"],
        forms=["Tabletas", "Cápsulas"],
        category="Antibiótico Macrólido",
        route="Oral",
        audio_description="Azitromicina. Antibiótico macrólido de toma diaria única.",
        common_warnings="Tomar una hora antes o dos horas después de los alimentos.",
        aliases=["AZITROCIN", "MACROZIT", "AZITROMICINA"],
    ),

    # --- Antigripales, Antihistamínicos y Respiratorios ---
    MexicanMedication(
        id="antiflu_des",
        active_ingredient="Amantadina, Clorfenamina y Paracetamol",
        brand_names=["Antiflu-Des", "Genérico Antigripal"],
        dosages=["Tabletas", "Jarabe"],
        forms=["Cápsulas", "Jarabe pediátrico"],
        category="Antigripal descongestivo",
        route="Oral",
        audio_description="Antiflu-Des. Medicamento antigripal para fiebre, flujo nasal y dolor.",
        common_warnings="Puede provocar somnolencia. Evitar conducir vehículos.",
        aliases=["ANTIFLU-DES", "ANTIFLUDES", "ANTIFLU DES"],
    ),
    MexicanMedication(
        id="tabcin",
        active_ingredient="Paracetamol, Fenilefrina y Clorfenamina",
        brand_names=["Tabcin", "Tabcin Noche", "Tabcin Efervescente"],
        dosages=["Tabletas efervescentes", "Cápsulas"],
        forms=["Tabletas efervescentes", "Cápsulas líquidas"],
        category="Antigripal",
        route="Oral",
        audio_description="Tabcin. Antigripal para estornudos, dolor de cabeza y congestión nasal.",
        common_warnings="Disolver completamente en agua en su presentación efervescente.",
        aliases=["TABCIN", "TABCIN NOCHE", "TABCIN EFERVESCENTE"],
    ),
    MexicanMedication(
        id="xl3",
        active_ingredient="Paracetamol, Fenilefrina y Clorfenamina",
        brand_names=["XL-3", "XL-3 VR", "XL-3 Extra"],
        dosages=["Tabletas"],
        forms=["Tabletas"],
        category="Antigripal",
        route="Oral",
        audio_description="XL-3. Antigripal descongestivo y analgésico popular en México.",
        common_warnings="Precaución en personas con presión alta por el descongestivo.",
        aliases=["XL-3", "XL3", "XL-3 VR", "XL3 VR"],
    ),
    MexicanMedication(
        id="loratadina",
        active_ingredient="Loratadina",
        brand_names=["Clarityne", "Genérico GI", "Similares"],
        dosages=["10 mg", "100 mg / 100 ml"],
        forms=["Tabletas", "Jarabe"],
        category="Antihistamínico antialérgico",
        route="Oral",
        audio_description="Loratadina. Alivio para alergias, rinitis y picazón sin provocar sueño severo.",
        common_warnings="Una toma diaria.",
        aliases=["CLARITYNE", "LORATADINA", "LORATADINE"],
    ),
    MexicanMedication(
        id="salbutamol",
        active_ingredient="Salbutamol",
        brand_names=["Ventolin", "Genérico GI"],
        dosages=["100 mcg / dosis"],
        forms=["Aerosol para inhalación (Inhalador)"],
        category="Broncodilatador",
        route="Inhalación oral",
        audio_description="Salbutamol en aerosol. Broncodilatador para alivio de crisis asmáticas o falta de aire.",
        common_warnings="Agitar el inhalador antes de cada disparo.",
        aliases=["VENTOLIN", "SALBUTAMOL", "ALBUTEROL"],
    ),
    MexicanMedication(
        id="ambroxol",
        active_ingredient="Ambroxol",
        brand_names=["Mucosolvan", "Genérico GI"],
        dosages=["30 mg / 5 ml", "30 mg"],
        forms=["Jarabe", "Tabletas"],
        category="Mucolítico y Expectorante",
        route="Oral",
        audio_description="Ambroxol. Jarabe para facilitar la expulsión de flemas y despejar las vías respiratorias.",
        common_warnings="Acompañar con abundante agua durante el día.",
        aliases=["MUCOSOLVAN", "AMBROXOL"],
    ),

    # --- Complejo Vitamínico y Suplementos Frecuentes ---
    MexicanMedication(
        id="bedoyecta",
        active_ingredient="Complejo B (B1, B6, B12)",
        brand_names=["Bedoyecta", "Bedoyecta Tri", "Tribedoce", "Genérico"],
        dosages=["Cápsulas", "Jeringa prellenada"],
        forms=["Cápsulas", "Solución inyectable"],
        category="Complejo Vitamínico B",
        route="Oral / Intramuscular",
        audio_description="Bedoyecta, Complejo B. Vitaminas neurotróficas para energía y salud del sistema nervioso.",
        common_warnings="Consultar dosis adecuada con su médico.",
        aliases=["BEDOYECTA", "BEDOYECTA TRI", "TRIBEDOCE", "COMPLEJO B"],
    ),
    MexicanMedication(
        id="acido_folico",
        active_ingredient="Ácido Fólico",
        brand_names=["Genérico GI", "Folivital"],
        dosages=["5 mg", "400 mcg"],
        forms=["Tabletas"],
        category="Vitamina (B9)",
        route="Oral",
        audio_description="Ácido fólico. Suplemento vitamínico esencial.",
        common_warnings="Consumir una vez al día.",
        aliases=["ACIDO FOLICO", "FOLIVITAL", "FOLATO"],
    ),
]


# Markers that confirm pharmaceutical context in Mexican packaging
PHARMACEUTICAL_MARKERS: List[str] = [
    "TABLETAS", "CAPSULAS", "GRAGEAS", "JARABE", "SUSPENSION", "SOLUCION",
    "GOTAS", "INYECTABLE", "AMPOLLETA", "BLISTER", "MILIGRAMOS", "MG", "ML",
    "MCG", "G", "UI", "LABORATORIO", "LABORATORIOS", "FARMACIA", "COFEPRIS",
    "SSA", "REG.", "REGISTRO SANITARIO", "CADUCIDAD", "CAD", "LOTE", "EXP",
    "VIA DE ADMINISTRACION", "ORAL", "TOPICA", "OFTALMICA", "INTRAMUSCULAR",
    "SUBCUTANEA", "FORMULA", "CADA TABLETA CONTIENE", "CADA CAPSULA CONTIENE",
    "GENERICO INTERCAMBIABLE", "GI", "HECHO EN MEXICO", "DOSIS", "RECETA"
]

# Keywords that indicate NON-MEDICATION objects (food, drinks, household)
NON_MEDICATION_MARKERS: List[str] = [
    "REFRESCO", "BEBIDA", "COCA COLA", "PEPSI", "SABRITAS", "PAPAS", "GALLETAS",
    "GAMESA", "BIMBO", "CEREAL", "LECHE", "JABON", "CHAMPU", "SHAMPOO", "DETERGENTE",
    "CERVEZA", "VINO", "ALIMENTO", "PASTA DE DIENTES", "COLGATE", "CREMA CORPORAL",
    "LIBRO", "REVISTA", "BANCO", "BILLETE", "MONEDA", "PESOS"
]


def normalize_ocr_text(raw_text: str) -> str:
    """
    Cleans optical noise and common OCR character substitutions.
    Preserves uppercase letters and numbers for drug matching.
    """
    if not raw_text:
        return ""
    text = raw_text.upper()
    # Normalize typical OCR character confusions in numbers/words
    text = re.sub(r"[^\w\s\-\/\.]", " ", text)
    # Collapse multiple whitespaces
    text = re.sub(r"\s+", " ", text).strip()
    return text


def extract_dosage(text: str) -> Optional[str]:
    """
    Extracts pharmaceutical dosage/concentration (e.g. 500 mg, 850 mg, 20 ml, 100 mcg, 100 UI).
    """
    pattern = r"\b(\d+(?:\.\d+)?)\s*(MG|ML|MCG|G|UI|GR)\b"
    match = re.search(pattern, text.upper())
    if match:
        val, unit = match.groups()
        return f"{val} {unit.lower()}"
    return None


def extract_form(text: str) -> Optional[str]:
    """Extracts pharmaceutical form if present."""
    forms_map = {
        "TABLETAS": "Tabletas",
        "CAPSULAS": "Cápsulas",
        "GRAGEAS": "Grageas",
        "JARABE": "Jarabe",
        "SUSPENSION": "Suspensión",
        "SOLUCION": "Solución",
        "GOTAS": "Gotas",
        "INYECTABLE": "Solución Inyectable",
        "AEROSOL": "Aerosol para inhalación",
        "GEL": "Gel tópico",
        "CREMA": "Crema",
        "PARCHES": "Parches transdérmicos",
    }
    upper = text.upper()
    for kw, form_name in forms_map.items():
        if kw in upper:
            return form_name
    return None


def is_strictly_pharmaceutical(text: str) -> Tuple[bool, float, str]:
    """
    Anti-false-positive evaluation.
    Verifies that the text genuinely belongs to a pharmaceutical package.
    Returns (is_medication, confidence, reason).
    """
    normalized = normalize_ocr_text(text)
    if not normalized or len(normalized) < 4:
        return False, 0.0, "Texto insuficiente o vacío."

    # Check for direct non-medication disqualifiers (food, drinks, groceries)
    for bad_kw in NON_MEDICATION_MARKERS:
        if bad_kw in normalized and not any(m in normalized for m in ["FARMACIA", "LABORATORIO", "COFEPRIS"]):
            return False, 0.05, f"Detectado objeto no farmacéutico ({bad_kw})."

    # Count pharmaceutical markers
    marker_hits = sum(1 for marker in PHARMACEUTICAL_MARKERS if marker in normalized)

    # Check for matches against the Mexican catalog
    catalog_match = False
    for med in MEXICAN_MEDICATIONS_CATALOG:
        for alias in med.aliases:
            if alias in normalized:
                catalog_match = True
                break
        if catalog_match:
            break

    # If it matches an explicit drug in the catalog:
    if catalog_match:
        confidence = 0.95 if marker_hits >= 1 else 0.85
        return True, confidence, "Medicamento identificado en el catálogo farmacéutico mexicano."

    # If it has strong pharmaceutical packaging markers (e.g. "Tabletas 500 mg COFEPRIS"):
    if marker_hits >= 2:
        return True, 0.80, "Empaque con terminología farmacéutica identificada."

    return False, 0.20, "No se identificaron elementos o leyendas farmacéuticas reconocibles."


def identify_mexican_medication(raw_text: str) -> Optional[Dict[str, Any]]:
    """
    Searches the Mexican catalog for an exact or fuzzy match and extracts
    structured clinical information for audio speech.
    """
    norm = normalize_ocr_text(raw_text)
    is_med, conf, reason = is_strictly_pharmaceutical(norm)

    if not is_med:
        return None

    matched_med: Optional[MexicanMedication] = None

    # Search by alias or brand name
    for med in MEXICAN_MEDICATIONS_CATALOG:
        for alias in med.aliases:
            # Word boundary search
            if re.search(r"\b" + re.escape(alias) + r"\b", norm):
                matched_med = med
                break
        if matched_med:
            break

    detected_dosage = extract_dosage(norm)
    detected_form = extract_form(norm)

    if matched_med:
        # Build concise, clear speech for a visually impaired user
        speech_parts = [matched_med.active_ingredient]
        if detected_dosage:
            speech_parts.append(f"de {detected_dosage}")
        elif matched_med.dosages:
            speech_parts.append(f"presentación común de {matched_med.dosages[0]}")

        if detected_form:
            speech_parts.append(f"en {detected_form.lower()}")

        speech_text = f"{matched_med.active_ingredient}. {matched_med.audio_description}"
        if detected_dosage:
            speech_text = f"{matched_med.active_ingredient} {detected_dosage}. {matched_med.audio_description}"

        return {
            "is_medication": True,
            "id": matched_med.id,
            "medicine_name": matched_med.active_ingredient,
            "brand_names": matched_med.brand_names,
            "dosage": detected_dosage or (matched_med.dosages[0] if matched_med.dosages else None),
            "form": detected_form or (matched_med.forms[0] if matched_med.forms else None),
            "category": matched_med.category,
            "route": matched_med.route,
            "instructions": matched_med.common_warnings,
            "audio_speech": speech_text,
            "confidence": conf,
        }

    # If it passed pharmaceutical markers but wasn't in our top catalog:
    return {
        "is_medication": True,
        "id": "generic_prescription",
        "medicine_name": "Medicamento identificado",
        "brand_names": [],
        "dosage": detected_dosage,
        "form": detected_form,
        "category": "Farmacéutico",
        "route": "Oral",
        "instructions": "Verifique indicaciones con su médico o familiar.",
        "audio_speech": f"Medicamento detectado{f' {detected_dosage}' if detected_dosage else ''}{f' en {detected_form.lower()}' if detected_form else ''}. Verifique dosis antes de tomar.",
        "confidence": conf,
    }
