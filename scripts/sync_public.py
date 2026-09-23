#!/usr/bin/env python3
"""Synchronize ecoeye/dashboard assets into public/ for Vercel deployment."""

from __future__ import annotations

import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "ecoeye" / "dashboard"
DST = ROOT / "public"


def sync() -> None:
    if not SRC.exists():
        print(f"Source {SRC} does not exist!")
        return
    DST.mkdir(parents=True, exist_ok=True)
    for item in SRC.iterdir():
        target = DST / item.name
        if item.is_dir():
            if target.exists():
                shutil.rmtree(target)
            shutil.copytree(item, target)
        else:
            shutil.copy2(item, target)
    print(f"Synced {SRC} -> {DST} successfully.")


if __name__ == "__main__":
    sync()
