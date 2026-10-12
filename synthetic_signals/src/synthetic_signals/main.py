from __future__ import annotations

import argparse
import asyncio

from .config import load_settings
from .service import PaperSignalService


def main() -> None:
    parser = argparse.ArgumentParser(description="Señales paper para Boom 1000; no ejecuta operaciones.")
    parser.add_argument("--config", default="config.yaml")
    args = parser.parse_args()
    asyncio.run(PaperSignalService(load_settings(args.config)).run())


if __name__ == "__main__":
    main()
