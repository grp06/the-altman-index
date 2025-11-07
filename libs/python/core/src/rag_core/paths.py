from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=1)
def workspace_root(marker: str = ".git") -> Path:
  path = Path(__file__).resolve()
  for candidate in [path] + list(path.parents):
    marker_path = candidate / marker
    if marker_path.exists():
      return candidate if marker_path.is_dir() else candidate.parent
  return Path.cwd()
