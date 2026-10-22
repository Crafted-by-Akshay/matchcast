"""In-process stand-in for ``TableServiceClient``: just what ``TableStore`` calls.

The query filter grammar is the subset TableStore writes: clauses joined by `` and ``, each
``<column> eq|le|ge <value>`` where a value is a quoted string, a number or an ``@parameter``.
Strings compare by code point, as Table Storage does.
"""

import copy
import re
from typing import Any

from azure.core.exceptions import ResourceExistsError, ResourceNotFoundError

CLAUSE = re.compile(r"^(\w+) (eq|le|ge) (.+)$")


def _value(text: str, parameters: dict[str, Any]) -> Any:
    if text.startswith("@"):
        return parameters[text[1:]]
    if text.startswith("'"):
        return text[1:-1].replace("''", "'")
    return int(text)


def _matches(entity: dict[str, Any], query_filter: str, parameters: dict[str, Any]) -> bool:
    for clause in re.split(r" and (?=\w+ (?:eq|le|ge) )", query_filter):
        column, op, raw = CLAUSE.match(clause.strip()).groups()  # type: ignore[union-attr]
        want = _value(raw, parameters)
        have = entity.get(column)
        if have is None:
            return False
        if (op == "eq" and have != want) or (op == "le" and not have <= want):
            return False
        if op == "ge" and not have >= want:
            return False
    return True


class FakeTable:
    def __init__(self) -> None:
        self.rows: dict[tuple[str, str], dict[str, Any]] = {}

    @staticmethod
    def _check(entity: dict[str, Any]) -> None:
        for (
            name,
            value,
        ) in entity.items():  # Table Storage: a string property is 32,768 UTF-16 units
            if isinstance(value, str) and len(value.encode("utf-16-le")) // 2 > 32_768:
                raise ValueError(f"PropertyValueTooLarge: {name}")

    def upsert_entity(self, entity: dict[str, Any], **_: Any) -> None:
        self._check(entity)
        self.rows[(entity["PartitionKey"], entity["RowKey"])] = copy.deepcopy(entity)

    def create_entity(self, entity: dict[str, Any], **_: Any) -> None:
        self._check(entity)
        key = (entity["PartitionKey"], entity["RowKey"])
        if key in self.rows:
            raise ResourceExistsError("entity already exists")
        self.rows[key] = copy.deepcopy(entity)

    def get_entity(self, partition_key: str, row_key: str, **_: Any) -> dict[str, Any]:
        try:
            return copy.deepcopy(self.rows[(partition_key, row_key)])
        except KeyError:
            raise ResourceNotFoundError("no such entity") from None

    def submit_transaction(self, operations: list[tuple[str, dict[str, Any]]], **_: Any) -> None:
        """All operations apply or none do, in one partition, at most 100 (as Table Storage)."""
        if len(operations) > 100 or len({op[1]["PartitionKey"] for op in operations}) > 1:
            raise ValueError("a transaction is one partition and at most 100 operations")
        saved = copy.deepcopy(self.rows)
        try:
            for kind, entity in operations:
                if kind == "upsert":
                    self.upsert_entity(entity)
                elif kind == "delete":
                    self.delete_entity(entity["PartitionKey"], entity["RowKey"])
                else:
                    raise ValueError(kind)
        except Exception:
            self.rows = saved
            raise

    def delete_entity(self, partition_key: str, row_key: str, **_: Any) -> None:
        if self.rows.pop((partition_key, row_key), None) is None:
            raise ResourceNotFoundError("no such entity")

    def query_entities(self, query_filter: str, parameters: dict[str, Any] | None = None, **_: Any):
        for entity in list(self.rows.values()):
            if _matches(entity, query_filter, parameters or {}):
                yield copy.deepcopy(entity)


class FakeTableService:
    def __init__(self) -> None:
        self.tables: dict[str, FakeTable] = {}

    def create_table_if_not_exists(self, name: str) -> None:
        self.tables.setdefault(name, FakeTable())

    def get_table_client(self, name: str) -> FakeTable:
        return self.tables[name]


class FakeBlob:
    def __init__(self, data: bytes) -> None:
        self._data = data

    def readall(self) -> bytes:
        return self._data


class FakeContainer:
    def __init__(self) -> None:
        self.blobs: dict[str, bytes] = {}

    def upload_blob(self, name: str, data: bytes, overwrite: bool = False) -> None:
        if name in self.blobs and not overwrite:
            raise ResourceExistsError("blob exists")
        self.blobs[name] = data

    def download_blob(self, blob: str) -> FakeBlob:
        return FakeBlob(self.blobs[blob])
