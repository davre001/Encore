"""One-off operational script: delete a single user account across BOTH stores.

Targets the local SQLite DB (DATA_DIR/encore.db) *and* the remote Neon Postgres
(DATABASE_URL) explicitly, because the app's own engine only ever binds one of
them. Never prints the connection secret.

Usage:
    python _ops_account_delete.py            # read-only preview (counts only)
    python _ops_account_delete.py --apply    # actually delete, then re-count
"""

import os
import sys

from dotenv import load_dotenv

load_dotenv()

from sqlalchemy import create_engine, inspect, text  # noqa: E402

# --- Target ----------------------------------------------------------------
USER_ID = "117381132008800318047"
EMAIL = "davemode96@gmail.com"

# Tables carrying a user_id foreign column, in child-first order.
USER_TABLES = ["post_analytics", "playbook_rules", "mind_memories", "chat_messages", "projects"]

APPLY = "--apply" in sys.argv


def _resolve_sqlite_url() -> str:
    here = os.path.dirname(os.path.abspath(__file__))  # .../backend
    data_dir = os.getenv("DATA_DIR", "../data")
    data_dir = data_dir if os.path.isabs(data_dir) else os.path.normpath(os.path.join(here, data_dir))
    db_path = os.path.join(data_dir, "encore.db")
    return f"sqlite:///{db_path}", db_path


def _counts(conn, tables: set[str]) -> dict:
    out = {}
    for t in USER_TABLES:
        if t in tables:
            out[t] = conn.execute(
                text(f"SELECT COUNT(*) FROM {t} WHERE user_id = :uid"), {"uid": USER_ID}
            ).scalar()
    if "password_resets" in tables:
        out["password_resets"] = conn.execute(
            text("SELECT COUNT(*) FROM password_resets WHERE email = :email"), {"email": EMAIL}
        ).scalar()
    if "users" in tables:
        out["users"] = conn.execute(
            text("SELECT COUNT(*) FROM users WHERE id = :uid OR email = :email"),
            {"uid": USER_ID, "email": EMAIL},
        ).scalar()
    return out


def _delete(conn, tables: set[str]) -> None:
    for t in USER_TABLES:
        if t in tables:
            conn.execute(text(f"DELETE FROM {t} WHERE user_id = :uid"), {"uid": USER_ID})
    if "password_resets" in tables:
        conn.execute(text("DELETE FROM password_resets WHERE email = :email"), {"email": EMAIL})
    if "users" in tables:
        conn.execute(
            text("DELETE FROM users WHERE id = :uid OR email = :email"),
            {"uid": USER_ID, "email": EMAIL},
        )


def process(label: str, url: str) -> None:
    print(f"\n=== {label} ===")
    try:
        engine = create_engine(url, pool_pre_ping=True)
        with engine.connect() as conn:
            tables = set(inspect(engine).get_table_names())
            before = _counts(conn, tables)
            print(f"  tables present: {sorted(tables)}")
            print(f"  BEFORE: {before or '(no matching rows)'}")
    except Exception as e:  # noqa: BLE001
        print(f"  !! could not connect/read: {type(e).__name__}: {e}")
        return

    if not APPLY:
        print("  (preview only — pass --apply to delete)")
        return

    with engine.begin() as conn:
        tables = set(inspect(engine).get_table_names())
        _delete(conn, tables)
    with engine.connect() as conn:
        tables = set(inspect(engine).get_table_names())
        after = _counts(conn, tables)
    print(f"  AFTER : {after or '(no matching rows)'}")
    remaining = sum(v for v in after.values())
    print(f"  -> {'CLEAN (0 rows remain)' if remaining == 0 else f'WARNING: {remaining} rows remain'}")


def main() -> None:
    print(f"Account deletion — user_id={USER_ID}  email={EMAIL}")
    print(f"Mode: {'APPLY (destructive)' if APPLY else 'PREVIEW (read-only)'}")

    sqlite_url, sqlite_path = _resolve_sqlite_url()
    if os.path.exists(sqlite_path):
        process(f"SQLite  ({sqlite_path})", sqlite_url)
    else:
        print(f"\n=== SQLite ===\n  file not found at {sqlite_path} — skipping")

    neon_url = os.getenv("DATABASE_URL", "").strip()
    if neon_url:
        if neon_url.startswith("postgres://"):
            neon_url = neon_url.replace("postgres://", "postgresql://", 1)
        # Host only, no credentials, for the label.
        host = neon_url.split("@")[-1].split("/")[0] if "@" in neon_url else "configured"
        process(f"Neon Postgres  (host {host})", neon_url)
    else:
        print("\n=== Neon Postgres ===\n  DATABASE_URL not set — skipping")


if __name__ == "__main__":
    main()
