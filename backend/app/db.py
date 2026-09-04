"""Database setup for Encore using SQLAlchemy and PostgreSQL.

Configurable via DATABASE_URL in .env:
    DATABASE_URL=postgresql://postgres:password@localhost:5432/encore

Defaults to PostgreSQL when set, or SQLite in data/ for local development without Postgres.
Automatically handles 'postgres://' -> 'postgresql://' normalization.
"""

import os
import logging
from typing import Generator
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker, Session

from .config import DATA_DIR

logger = logging.getLogger("encore.db")

raw_url = os.getenv("DATABASE_URL", "").strip()

if raw_url:
    # Heroku / Supabase style postgres:// fix
    if raw_url.startswith("postgres://"):
        raw_url = raw_url.replace("postgres://", "postgresql://", 1)
    db_url = raw_url
    connect_args = {}
else:
    # Safe default: local SQLite database in data directory
    os.makedirs(DATA_DIR, exist_ok=True)
    db_path = os.path.join(DATA_DIR, "encore.db")
    db_url = f"sqlite:///{db_path}"
    connect_args = {"check_same_thread": False}

try:
    engine = create_engine(
        db_url,
        connect_args=connect_args,
        pool_pre_ping=True,
    )
except Exception as e:
    logger.warning(f"Could not connect to configured DATABASE_URL ({e}), falling back to SQLite.")
    os.makedirs(DATA_DIR, exist_ok=True)
    db_path = os.path.join(DATA_DIR, "encore.db")
    db_url = f"sqlite:///{db_path}"
    engine = create_engine(db_url, connect_args={"check_same_thread": False})

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency yielding an isolated database session per request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _sync_missing_columns() -> None:
    """Add model columns that are missing from an existing table across PostgreSQL and SQLite.

    `create_all` only creates absent *tables* — it never alters an existing one,
    so newly-added columns (e.g. Project.verdict/views/post_url/post_id) would be
    missing on older tables. This reconciles missing columns in place with ALTER TABLE.
    """
    from sqlalchemy import inspect as sa_inspect, text as sa_text

    inspector = sa_inspect(engine)
    existing_tables = set(inspector.get_table_names())
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if table.name not in existing_tables:
                continue
            have = {col["name"] for col in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in have:
                    continue
                ddl_type = column.type.compile(dialect=engine.dialect)
                conn.execute(
                    sa_text(
                        f'ALTER TABLE "{table.name}" '
                        f'ADD COLUMN "{column.name}" {ddl_type}'
                    )
                )
                logger.info("Added missing column %s.%s", table.name, column.name)


def init_db() -> None:
    """Create all registered database tables if they do not already exist."""
    Base.metadata.create_all(bind=engine)
    try:
        _sync_missing_columns()
    except Exception as e:  # never block startup on a best-effort column sync
        logger.warning(f"Database column sync skipped: {e}")
