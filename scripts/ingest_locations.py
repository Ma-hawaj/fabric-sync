"""Capability-aware branch selection shared by the legacy importers."""

CAPABILITIES = ("receives_orders", "holds_stock", "produces_orders")


def _capability(capability: str) -> str:
    # Only these fixed column names may be interpolated into SQL.
    if capability not in CAPABILITIES:
        raise ValueError(f"unknown location capability: {capability}")
    return capability


def _usable(row: tuple, capability: str) -> tuple[object, str]:
    branch_id, name, active, capable = row
    if not active or not capable:
        raise ValueError(f"branch {name!r} must be active with {capability} enabled")
    return branch_id, name


def require_branch(conn, branch_id: object, capability: str) -> tuple[object, str]:
    capability = _capability(capability)
    with conn.cursor() as cur:
        cur.execute(f"SELECT id, name, is_active, {capability} FROM branch WHERE id = %s",
                    (branch_id,))
        row = cur.fetchone()
    if row is None:
        raise ValueError(f"branch {branch_id!s} does not exist")
    return _usable(row, capability)


def select_branch(conn, name: str | None, capability: str,
                  default_name: str | None, report) -> tuple[object, str]:
    """Use a named branch or the first eligible branch, ordered by id.

    Missing named branches are created with only the requested capability.
    A default name allows creating a pickup/stock branch on an empty database;
    production requires an existing eligible branch or an explicit name.
    """
    capability = _capability(capability)
    with conn.cursor() as cur:
        if name is None:
            cur.execute(f"SELECT id, name FROM branch WHERE is_active AND {capability} "
                        "ORDER BY id LIMIT 1")
            row = cur.fetchone()
            if row is not None:
                return row
            if default_name is None:
                raise ValueError("no active production branch; enable Produces orders "
                                 "on a location or pass --production-branch NAME")
            name = default_name
        # Look up all rows, including inactive/ineligible ones, so a bad explicit
        # choice gets a useful error rather than a duplicate-name constraint.
        cur.execute(f"SELECT id, name, is_active, {capability} FROM branch WHERE name = %s",
                    (name,))
        row = cur.fetchone()
        if row is not None:
            return _usable(row, capability)
        cur.execute(
            "INSERT INTO branch (name, receives_orders, holds_stock, produces_orders, is_active) "
            "VALUES (%s, %s, %s, %s, TRUE) RETURNING id",
            (name, *(capability == flag for flag in CAPABILITIES)),
        )
        branch_id = cur.fetchone()[0]
    report.count(f"branch created: {name}")
    return branch_id, name
