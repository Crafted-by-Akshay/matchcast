"""In-process twins of the MCP tools (04-agents.md §6); same names, so AGT-10 is a config switch."""

from .inprocess import TOOL_SCHEMAS, InProcessTools, ToolError

__all__ = ["TOOL_SCHEMAS", "InProcessTools", "ToolError"]
