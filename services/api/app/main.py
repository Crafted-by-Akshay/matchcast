"""Minimal FastAPI application for the MatchCast API."""

from fastapi import FastAPI

app = FastAPI(title="MatchCast API", version="0.1.0")


@app.get("/health", tags=["health"])
async def health() -> dict[str, str]:
    """Report that the API process is ready to serve requests."""
    return {"status": "healthy"}
