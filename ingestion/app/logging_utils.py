from __future__ import annotations

import logging
import sys
from typing import Optional


def configure_logging(level: int = logging.INFO) -> None:
  handler = logging.StreamHandler(sys.stdout)
  formatter = logging.Formatter(
    "%(asctime)s | %(levelname)s | %(name)s | %(message)s", "%Y-%m-%d %H:%M:%S"
  )
  handler.setFormatter(formatter)
  root_logger = logging.getLogger()
  root_logger.handlers = [handler]
  root_logger.setLevel(level)


def get_logger(name: Optional[str] = None) -> logging.Logger:
  return logging.getLogger(name or __name__)
