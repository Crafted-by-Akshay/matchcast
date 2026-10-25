"""The api points MATCHCAST_SCOREBOARD_LIVE_RUN at a fixed path inside its image (CREW-5.2), so the
recorded live run ships by committing the file; until then the route shows the rules arms."""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATH = "/app/data/models/scoreboard-live.json"


def test_bicep_sets_the_live_run_path() -> None:
    bicep = (ROOT / "infra" / "modules" / "containerapps.bicep").read_text()
    assert f"{{ name: 'MATCHCAST_SCOREBOARD_LIVE_RUN', value: '{PATH}' }}" in bicep


def test_the_path_is_inside_the_api_image() -> None:
    dockerfile = (ROOT / "services" / "api" / "Dockerfile").read_text()
    assert re.search(r"^WORKDIR /app$", dockerfile, re.M)
    assert re.search(r"^COPY data/models data/models$", dockerfile, re.M)
    assert re.search(r"^COPY --from=build /app /app$", dockerfile, re.M)
