"""Validated API configuration with safe, non-secret readiness diagnostics."""

from __future__ import annotations

import os
from typing import Literal

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, SecretStr, ValidationError, field_validator


class Settings(BaseModel):
    """Runtime settings. Cloud credentials are validated but never logged or returned."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    mode: Literal["local", "cloud"] = "local"
    model_endpoint: AnyHttpUrl | None = None
    model_api_key: SecretStr | None = None

    @field_validator("model_endpoint")
    @classmethod
    def endpoint_must_use_https(cls, value: AnyHttpUrl | None) -> AnyHttpUrl | None:
        if value is not None and value.scheme != "https":
            raise ValueError("must use https")
        return value

    @field_validator("model_api_key")
    @classmethod
    def api_key_must_not_be_blank(cls, value: SecretStr | None) -> SecretStr | None:
        if value is not None and not value.get_secret_value().strip():
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
        "model_endpoint": source.get("MATCHCAST_MODEL_ENDPOINT") or None,
        "model_api_key": source.get("MATCHCAST_MODEL_API_KEY") or None,
    }
    if raw["mode"] == "cloud":
        missing = []
        if raw["model_endpoint"] is None:
            missing.append("MATCHCAST_MODEL_ENDPOINT is required when MATCHCAST_MODE=cloud")
        if raw["model_api_key"] is None:
            missing.append("MATCHCAST_MODEL_API_KEY is required when MATCHCAST_MODE=cloud")
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
            "model_endpoint": "MATCHCAST_MODEL_ENDPOINT",
            "model_api_key": "MATCHCAST_MODEL_API_KEY",
        }
        errors = tuple(
            f"{environment_names.get(str(item['loc'][0]), item['loc'][0])}: {item['msg']}"
            for item in exc.errors(include_input=False)
        )
        return SettingsResult(settings=None, errors=errors)
