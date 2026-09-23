"""
EcoEye Glucose BLE Reader.

Reads CGM (Continuous Glucose Monitor) data via Bluetooth Low Energy (BLE)
using the GATT Glucose Profile (service 0x1808, characteristic 0x2A18).

Parses the standard 10-byte GATT packet:
  Byte 0:    Flags byte
  Bytes 1-2: Sequence number (uint16 LE)
  Bytes 3-9: Base time (uint16 year + uint8 month/day/hour/min/sec)
  Byte 10:   Type & Sample Location nibbles
  Bytes 11-12: Glucose concentration (SFLOAT IEEE-11073, mg/dL or mmol/L)
  Byte 13:   Sensor status annunciation

Runs in SIMULATION mode (no physical BLE device required) for demo purposes.
"""

from __future__ import annotations

import asyncio
import logging
import random
import struct
from datetime import datetime, timezone
from typing import Callable, List, Optional, Tuple

from ecoeye.config import settings
from ecoeye.core.models import GlucoseAlertLevel, GlucoseReading, GlucoseTrend

logger = logging.getLogger("ecoeye.sensing.glucose_ble")

# Simulated sensor configuration
_DEFAULT_SENSOR_ID = "DEXCOM_G7_SIM_001"
_TREND_WEIGHTS = {
    GlucoseTrend.STEADY: 0.45,
    GlucoseTrend.RISING: 0.15,
    GlucoseTrend.FALLING: 0.15,
    GlucoseTrend.RISING_FAST: 0.05,
    GlucoseTrend.FALLING_FAST: 0.05,
    GlucoseTrend.FLAT: 0.15,
}


def _weighted_random_trend() -> GlucoseTrend:
    """Select a plausible trend with weighted probability distribution."""
    trends = list(_TREND_WEIGHTS.keys())
    weights = list(_TREND_WEIGHTS.values())
    return random.choices(trends, weights=weights, k=1)[0]


def parse_gatt_glucose_packet(raw_hex: str) -> Optional[Tuple[float, GlucoseTrend]]:
    """
    Parse a raw GATT 0x2A18 hex packet into (glucose_mg_dl, trend).
    Returns None if the packet is malformed or uses an unsupported flag combination.

    This is a simplified parser covering the most common CGM packet formats.
    """
    try:
        raw_bytes = bytes.fromhex(raw_hex.replace(" ", ""))
    except ValueError:
        logger.warning("Invalid hex packet: %s", raw_hex)
        return None

    if len(raw_bytes) < 10:
        logger.warning("GATT packet too short (%d bytes)", len(raw_bytes))
        return None

    flags = raw_bytes[0]
    units_mmol = bool(flags & 0x04)  # Bit 2: mmol/L if set, mg/dL if clear

    # Glucose concentration bytes 11-12 as IEEE-11073 SFLOAT (little-endian)
    if len(raw_bytes) >= 13:
        sfloat_raw = struct.unpack("<H", raw_bytes[11:13])[0]
        mantissa = sfloat_raw & 0x0FFF
        exponent = (sfloat_raw >> 12) & 0x0F
        if exponent > 7:
            exponent -= 16  # Sign-extend 4-bit signed exponent
        concentration = mantissa * (10 ** exponent)

        if units_mmol:
            glucose_mg_dl = concentration * 18.0  # mmol/L → mg/dL
        else:
            glucose_mg_dl = concentration

        # Trend nibble at byte 13 bits [3:0] if present
        trend = GlucoseTrend.UNKNOWN
        if len(raw_bytes) >= 14:
            trend_nibble = raw_bytes[13] & 0x0F
            trend_map = {
                1: GlucoseTrend.RISING_FAST,
                2: GlucoseTrend.RISING,
                3: GlucoseTrend.RISING,
                4: GlucoseTrend.STEADY,
                5: GlucoseTrend.FALLING,
                6: GlucoseTrend.FALLING,
                7: GlucoseTrend.FALLING_FAST,
            }
            trend = trend_map.get(trend_nibble, GlucoseTrend.UNKNOWN)

        return glucose_mg_dl, trend

    return None


class GlucoseReader:
    """
    BLE Glucose Monitor reader for CGM devices via GATT profile.

    In SIMULATION mode: generates a realistic physiological glucose curve
    with trend continuity (each reading is correlated with the previous).

    In PRODUCTION: replace `_read_ble_characteristic()` with actual
    Bleak (Python BLE) characteristic subscription code.

    Args:
        on_reading: Callback invoked with a GlucoseReading when a new value arrives.
        sensor_id: BLE device MAC or identifier.
        simulation_mode: If True, generates synthetic readings.
        read_interval_sec: Polling interval (CGMs typically update every 5 minutes).
    """

    def __init__(
        self,
        on_reading: Optional[Callable[[GlucoseReading], None]] = None,
        sensor_id: str = _DEFAULT_SENSOR_ID,
        simulation_mode: bool = True,
        read_interval_sec: float = 300.0,  # 5 minutes (CGM standard)
    ):
        self.on_reading = on_reading
        self.sensor_id = sensor_id
        self.simulation_mode = simulation_mode
        self.read_interval_sec = read_interval_sec
        self._running = False

        # Simulation state: maintain physiological continuity
        self._sim_glucose = random.uniform(90.0, 140.0)
        self._sim_trend = GlucoseTrend.STEADY
        self._sim_battery = random.randint(60, 100)

    def build_reading(
        self,
        glucose_mg_dl: float,
        trend: GlucoseTrend,
        battery_pct: Optional[int] = None,
        raw_hex: Optional[str] = None,
    ) -> GlucoseReading:
        """Construct a validated GlucoseReading from parsed values."""
        reading = GlucoseReading(
            timestamp=datetime.now(timezone.utc),
            sensor_id=self.sensor_id,
            glucose_mg_dl=round(glucose_mg_dl, 1),
            trend=trend,
            transmitter_battery_pct=battery_pct,
            raw_hex_packet=raw_hex,
        )
        logger.info(
            "📊 GLUCOSE — %.1f mg/dL | trend=%s | alert=%s | battery=%s%%",
            reading.glucose_mg_dl,
            reading.trend.value,
            reading.alert_level.value,
            battery_pct,
        )
        if self.on_reading:
            self.on_reading(reading)
        return reading

    def _simulate_next_reading(self) -> GlucoseReading:
        """
        Advance the simulated glucose state with physiological noise.
        Applies trend drift + Gaussian noise for realistic CGM behavior.
        """
        trend_delta = {
            GlucoseTrend.FALLING_FAST: -3.5,
            GlucoseTrend.FALLING: -1.5,
            GlucoseTrend.FLAT: 0.0,
            GlucoseTrend.STEADY: 0.0,
            GlucoseTrend.RISING: +1.5,
            GlucoseTrend.RISING_FAST: +3.5,
            GlucoseTrend.UNKNOWN: 0.0,
        }
        delta = trend_delta.get(self._sim_trend, 0.0) + random.gauss(0, 1.5)
        self._sim_glucose = max(20.0, min(500.0, self._sim_glucose + delta))

        # Probabilistically shift trend
        self._sim_trend = _weighted_random_trend()

        # Slow battery drain
        if random.random() < 0.05:
            self._sim_battery = max(0, self._sim_battery - 1)

        return self.build_reading(
            glucose_mg_dl=self._sim_glucose,
            trend=self._sim_trend,
            battery_pct=self._sim_battery,
        )

    async def run_simulation(
        self,
        duration_sec: float = 600.0,
        fast_mode: bool = True,
    ) -> None:
        """
        Run simulated CGM reading loop for `duration_sec`.

        Args:
            duration_sec: Total simulation time.
            fast_mode: If True, read every 5 seconds instead of every 5 minutes
                       (useful for demo to show multiple readings quickly).
        """
        self._running = True
        interval = 5.0 if fast_mode else self.read_interval_sec
        start = asyncio.get_event_loop().time()

        logger.info(
            "Glucose simulation started (%.0fs, interval=%.0fs)",
            duration_sec, interval,
        )

        while self._running:
            elapsed = asyncio.get_event_loop().time() - start
            if elapsed >= duration_sec:
                break
            self._simulate_next_reading()
            await asyncio.sleep(interval)

        logger.info("Glucose simulation ended")

    def stop(self) -> None:
        """Signal the simulation loop to stop."""
        self._running = False
