from dataclasses import dataclass, asdict
from datetime import datetime
import uuid
import json


@dataclass
class CardAddedToCollection:
    user_id:          str
    card_id:          str
    card_name:        str
    set_name:         str
    rarity:           str
    condition:        str
    collection_id:    str
    market_price_usd: float | None = None   # live price fetched from PokéWallet at command time
    event_type:       str = "card_added_to_collection"
    event_id:         str = ""
    timestamp:        str = ""

    def __post_init__(self):
        if not self.event_id:
            self.event_id = str(uuid.uuid4())
        if not self.timestamp:
            self.timestamp = datetime.utcnow().isoformat()

    def to_json(self) -> str:
        return json.dumps(asdict(self))


@dataclass
class CardRemovedFromCollection:
    user_id:       str
    card_id:       str
    card_name:     str
    collection_id: str
    event_type:    str = "card_removed_from_collection"
    event_id:      str = ""
    timestamp:     str = ""

    def __post_init__(self):
        if not self.event_id:
            self.event_id = str(uuid.uuid4())
        if not self.timestamp:
            self.timestamp = datetime.utcnow().isoformat()

    def to_json(self) -> str:
        return json.dumps(asdict(self))


@dataclass
class CardListedForTrade:
    user_id:       str
    card_id:       str
    card_name:     str
    collection_id: str
    listing_id:    str
    event_type:    str = "card_listed_for_trade"
    event_id:      str = ""
    timestamp:     str = ""

    def __post_init__(self):
        if not self.event_id:
            self.event_id = str(uuid.uuid4())
        if not self.timestamp:
            self.timestamp = datetime.utcnow().isoformat()

    def to_json(self) -> str:
        return json.dumps(asdict(self))


@dataclass
class TradeCompleted:
    trade_id:         str
    initiator_id:     str
    receiver_id:      str
    initiator_card:   str
    receiver_card:    str
    event_type:       str = "trade_completed"
    event_id:         str = ""
    timestamp:        str = ""

    def __post_init__(self):
        if not self.event_id:
            self.event_id = str(uuid.uuid4())
        if not self.timestamp:
            self.timestamp = datetime.utcnow().isoformat()

    def to_json(self) -> str:
        return json.dumps(asdict(self))


def from_json(raw: str) -> dict:
    return json.loads(raw)
