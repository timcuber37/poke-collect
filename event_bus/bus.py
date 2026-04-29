from kafka import KafkaProducer, KafkaConsumer
from kafka.errors import NoBrokersAvailable
import config
import json
import logging

logger = logging.getLogger(__name__)

_producer = None


def get_producer() -> KafkaProducer:
    global _producer
    if _producer is None:
        try:
            _producer = KafkaProducer(
                bootstrap_servers=config.KAFKA_BOOTSTRAP_SERVERS,
                value_serializer=lambda v: v.encode("utf-8") if isinstance(v, str) else v,
            )
        except NoBrokersAvailable:
            logger.error("Kafka broker not available — events will not be published")
            return None
    return _producer


def publish(event_json: str) -> None:
    producer = get_producer()
    if producer:
        producer.send(config.KAFKA_TOPIC, value=event_json)
        producer.flush()
        logger.info("Published event: %s", event_json[:80])


def make_consumer(group_id: str) -> KafkaConsumer:
    return KafkaConsumer(
        config.KAFKA_TOPIC,
        bootstrap_servers=config.KAFKA_BOOTSTRAP_SERVERS,
        group_id=group_id,
        auto_offset_reset="earliest",
        value_deserializer=lambda m: json.loads(m.decode("utf-8")),
    )
