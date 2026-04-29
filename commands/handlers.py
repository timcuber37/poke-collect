import uuid
import logging
from commands.mysql_writer import (
    insert_collection,
    delete_collection,
    insert_trade_listing,
    insert_trade,
    get_card_by_id,
    get_collection_entry,
    find_or_create_card_by_pokewallet_id,
)
from events.definitions import (
    CardAddedToCollection,
    CardRemovedFromCollection,
    CardListedForTrade,
    TradeCompleted,
)
from event_bus.bus import publish
from api.pokewallet import get_live_price

logger = logging.getLogger(__name__)


def handle_add_card(user_id: str, card_id: str, condition: str) -> dict:
    collection_id = str(uuid.uuid4())
    card = get_card_by_id(card_id)

    # Fetch live market price from PokéWallet — enriches the event so the
    # read models capture the price at the exact moment of the command.
    market_price = get_live_price(card["name"])
    if market_price is None:
        logger.warning("Could not fetch live price for '%s' — storing without price", card["name"])

    insert_collection(collection_id, user_id, card_id, condition)

    event = CardAddedToCollection(
        user_id=user_id,
        card_id=card_id,
        card_name=card["name"],
        set_name=card["set_name"],
        rarity=card["rarity"],
        condition=condition,
        collection_id=collection_id,
        market_price_usd=market_price,
    )
    publish(event.to_json())
    return {"collection_id": collection_id}


def handle_add_from_search(
    user_id: str,
    pokewallet_id: str,
    card_name: str,
    set_name: str,
    rarity: str,
    card_type: str,
    condition: str,
    market_price_usd: float | None = None,
) -> dict:
    """
    Add a card to the user's collection using data from a search result.
    Lazily creates the card in the MySQL master catalog if it doesn't exist yet.
    """
    card_id = find_or_create_card_by_pokewallet_id(
        pokewallet_id, card_name, set_name, rarity, card_type
    )
    collection_id = str(uuid.uuid4())
    insert_collection(collection_id, user_id, card_id, condition)

    event = CardAddedToCollection(
        user_id=user_id,
        card_id=card_id,
        card_name=card_name,
        set_name=set_name,
        rarity=rarity,
        condition=condition,
        collection_id=collection_id,
        market_price_usd=market_price_usd,
    )
    publish(event.to_json())
    return {"collection_id": collection_id}


def handle_remove_card(user_id: str, collection_id: str) -> None:
    entry = get_collection_entry(collection_id)

    delete_collection(collection_id)

    event = CardRemovedFromCollection(
        user_id=user_id,
        card_id=entry["card_id"],
        card_name=entry["name"],
        collection_id=collection_id,
    )
    publish(event.to_json())


def handle_list_for_trade(user_id: str, collection_id: str) -> dict:
    listing_id = str(uuid.uuid4())
    entry = get_collection_entry(collection_id)

    insert_trade_listing(listing_id, user_id, collection_id)

    event = CardListedForTrade(
        user_id=user_id,
        card_id=entry["card_id"],
        card_name=entry["name"],
        collection_id=collection_id,
        listing_id=listing_id,
    )
    publish(event.to_json())
    return {"listing_id": listing_id}


def handle_complete_trade(initiator_id: str, receiver_id: str,
                          initiator_listing: str, receiver_listing: str) -> dict:
    trade_id = str(uuid.uuid4())

    insert_trade(trade_id, initiator_id, receiver_id, initiator_listing, receiver_listing)

    event = TradeCompleted(
        trade_id=trade_id,
        initiator_id=initiator_id,
        receiver_id=receiver_id,
        initiator_card=initiator_listing,
        receiver_card=receiver_listing,
    )
    publish(event.to_json())
    return {"trade_id": trade_id}
