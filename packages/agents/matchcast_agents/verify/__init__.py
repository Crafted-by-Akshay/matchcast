"""Deterministic Verifier checks 1 to 5 (04-agents.md §5); AGT-7 adds 6 and 7; CREW-4.1 adds the
adversarial pass (8a), which tries to falsify each line against its claims."""

from .checks import extract_names, extract_numbers, run_checks

__all__ = ["extract_names", "extract_numbers", "run_checks"]
