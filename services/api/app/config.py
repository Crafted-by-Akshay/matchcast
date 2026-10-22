"""Validated API configuration with safe, non-secret readiness diagnostics."""

from __future__ import annotations

import os
from typing import Literal

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, ValidationError, field_validator


class Settings(BaseModel):
    """Runtime settings. Cloud credentials are validated but never logged or returned."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    mode: Literal["local", "cloud"] = "local"
    foundry_project_endpoint: AnyHttpUrl | None = None
    foundry_model_deployment: str | None = None

    @field_validator("foundry_project_endpoint")
    @classmethod
    def endpoint_must_use_https(cls, value: AnyHttpUrl | None) -> AnyHttpUrl | None:
        if value is not None and value.scheme != "https":
            raise ValueError("must use https")
        return value

    @field_validator("foundry_model_deployment")
    @classmethod
    def deployment_must_not_be_blank(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("must not be blank")
        return value


class SettingsResult(BaseModel):
    """Safe result of loading configuration from the process environment."""

    settings: Settings | None
    errors: tuple[str, ...] = ()


def load_settings(environ: dict[str, str] | os._Environ[str] | None = None) -> SettingsResult:
    """Load typed settings, retaining useful validation errors without secret values."""

    source = os.environ if environ is None else environ
    raw = {
        "mode": source.get("MATCHCAST_MODE", "local"),
        "foundry_project_endpoint": source.get("FOUNDRY_PROJECT_ENDPOINT") or None,
        "foundry_model_deployment": source.get("FOUNDRY_MODEL_DEPLOYMENT") or None,
    }
    if raw["mode"] == "cloud":
        missing = []
        if raw["foundry_project_endpoint"] is None:
            missing.append("FOUNDRY_PROJECT_ENDPOINT is required when MATCHCAST_MODE=cloud")
        if raw["foundry_model_deployment"] is None:
            missing.append("FOUNDRY_MODEL_DEPLOYMENT is required when MATCHCAST_MODE=cloud")
        if missing:
            return SettingsResult(
                settings=None,
                errors=tuple(missing),
            )
    try:
        return SettingsResult(settings=Settings.model_validate(raw))
    except ValidationError as exc:
        environment_names = {
            "mode": "MATCHCAST_MODE",
            "foundry_project_endpoint": "FOUNDRY_PROJECT_ENDPOINT",
            "foundry_model_deployment": "FOUNDRY_MODEL_DEPLOYMENT",
        }
        errors = tuple(
            f"{environment_names.get(str(item['loc'][0]), item['loc'][0])}: {item['msg']}"
            for item in exc.errors(include_input=False)
        )
        return SettingsResult(settings=None, errors=errors)
