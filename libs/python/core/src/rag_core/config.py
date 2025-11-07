import os
from pathlib import Path
from typing import Any, Optional

import yaml

from .paths import workspace_root


def load_yaml_config(path: Path) -> dict[str, Any]:
  if not path.exists():
    raise FileNotFoundError(f"Config path not found: {path}")
  with path.open("r", encoding="utf-8") as handle:
    data = yaml.safe_load(handle) or {}
  if not isinstance(data, dict):
    raise ValueError(f"Expected mapping in config file: {path}")
  return data


def resolve_path(base_dir: Path, value: Path) -> Path:
  return value if value.is_absolute() else (base_dir / value).resolve()


def default_config_path(env_var: str, relative_path: str, fallback: Optional[Path] = None) -> Path:
  env_override = os.getenv(env_var)
  if env_override:
    return Path(env_override).expanduser()
  root = workspace_root()
  candidate = root / relative_path
  if candidate.exists() or fallback is None:
    return candidate
  return fallback
