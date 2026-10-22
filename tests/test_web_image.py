"""The web image must ship every file the shell loads (a missing script is a 404 in production)."""

import re
from pathlib import Path

UNIFIED = Path(__file__).parents[1] / "apps/unified"


def test_dockerfile_copies_every_local_script_and_data_file_the_shell_loads() -> None:
    shell = (UNIFIED / "index.html").read_text(encoding="utf-8")
    dockerfile = (UNIFIED / "Dockerfile").read_text()
    copied = set(
        re.search(r"cp -r (.*?) /site/", dockerfile, re.S).group(1).replace("\\", " ").split()
    )  # type: ignore[union-attr]
    scripts = set(re.findall(r'<script src="([^"/:]+)"', shell))
    assert scripts, "index.html should load local scripts"
    assert scripts <= copied, f"not in the image: {sorted(scripts - copied)}"
    for name in ("voices.json", "watch", "broadcast", "analyst", "shared"):
        assert name in copied, f"{name} is loaded by the shell but not copied"
