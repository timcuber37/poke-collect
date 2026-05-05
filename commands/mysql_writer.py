from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
import config

engine = create_engine(config.MYSQL_URI, pool_pre_ping=True)
Session = sessionmaker(bind=engine)


def _session():
    return Session()


# --- Write operations ---

def insert_collection(collection_id: str, user_id: str, card_id: str, condition: str):
    with _session() as session:
        session.execute(
            text(
                "INSERT INTO collections (collection_id, user_id, card_id, `condition`) "
                "VALUES (:cid, :uid, :kid, :cond)"
            ),
            {"cid": collection_id, "uid": user_id, "kid": card_id, "cond": condition},
        )
        session.commit()


def delete_collection(collection_id: str):
    with _session() as session:
        session.execute(
            text("DELETE FROM collections WHERE collection_id = :cid"),
            {"cid": collection_id},
        )
        session.commit()


# --- Read helpers (only used to populate command-side UI dropdowns) ---

def get_all_cards() -> list[dict]:
    with _session() as session:
        rows = session.execute(
            text("SELECT card_id, name, set_name, rarity FROM cards ORDER BY set_name, name")
        ).mappings().all()
        return [dict(r) for r in rows]


def get_users() -> list[dict]:
    with _session() as session:
        rows = session.execute(
            text("SELECT user_id, username FROM users ORDER BY username")
        ).mappings().all()
        return [dict(r) for r in rows]


def get_card_by_id(card_id: str) -> dict | None:
    with _session() as session:
        row = session.execute(
            text("SELECT * FROM cards WHERE card_id = :cid"),
            {"cid": card_id},
        ).mappings().first()
        return dict(row) if row else None


def find_or_create_card_by_pokewallet_id(
    pokewallet_id: str, name: str, set_name: str, rarity: str, card_type: str
) -> str:
    """
    Idempotently ensure a card exists in the MySQL master catalog and return its card_id.
    Uses pokewallet_id as the natural key. We use the PokéWallet ID as the MySQL card_id too
    so collection rows reference the same identifier the read side uses.
    """
    with _session() as session:
        existing = session.execute(
            text("SELECT card_id FROM cards WHERE pokewallet_id = :pid"),
            {"pid": pokewallet_id},
        ).first()
        if existing:
            return existing[0]

        session.execute(
            text(
                "INSERT INTO cards (card_id, name, set_name, rarity, card_type, pokewallet_id) "
                "VALUES (:cid, :name, :set_name, :rarity, :ctype, :pid)"
            ),
            {
                "cid": pokewallet_id, "name": name, "set_name": set_name,
                "rarity": rarity, "ctype": card_type, "pid": pokewallet_id,
            },
        )
        session.commit()
        return pokewallet_id


def get_collection_entry(collection_id: str) -> dict | None:
    with _session() as session:
        row = session.execute(
            text(
                "SELECT col.collection_id, col.user_id, col.card_id, col.`condition`, "
                "c.name, c.set_name, c.rarity "
                "FROM collections col JOIN cards c ON col.card_id = c.card_id "
                "WHERE col.collection_id = :cid"
            ),
            {"cid": collection_id},
        ).mappings().first()
        return dict(row) if row else None
