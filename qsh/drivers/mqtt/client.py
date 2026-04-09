"""Thin wrapper over paho-mqtt for QSH broker connectivity.

Thread model: paho loop_start() runs its own network thread.
The on_message callback writes to a thread-safe cache dict.
The pipeline thread reads from the cache via lock in read_inputs().
"""

from __future__ import annotations

import json
import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

import paho.mqtt.client as paho

logger = logging.getLogger(__name__)

# Reconnect backoff schedule (seconds)
_RECONNECT_DELAYS = [5, 10, 30, 60]


@dataclass
class MQTTClientConfig:
    """Connection parameters for the MQTT broker."""

    broker: str = "localhost"
    port: int = 1883
    username: str = ""
    password: str = ""
    tls: bool = False
    client_id: str = "qsh"
    keepalive: int = 60
    topic_prefix: str = ""


class MQTTClient:
    """Thread-safe MQTT client with automatic reconnect and topic cache."""

    def __init__(self, config: MQTTClientConfig):
        self._config = config
        self._lock = threading.Lock()
        self._cache: Dict[str, Tuple[str, float]] = {}  # {topic: (payload_str, timestamp)}
        self._subscriptions: List[str] = []
        self._connected = threading.Event()
        self._client: Optional[paho.Client] = None

    # ── Public API ──────────────────────────────────────────────────────

    def connect(self, timeout: float = 10.0, retries: int = 3) -> None:
        """Connect to broker with retry and backoff."""
        cfg = self._config
        self._client = paho.Client(
            paho.CallbackAPIVersion.VERSION2,
            client_id=cfg.client_id,
        )

        if cfg.username:
            self._client.username_pw_set(cfg.username, cfg.password)
        if cfg.tls:
            self._client.tls_set()

        # LWT: {prefix}/status = "offline", retained
        status_topic = f"{cfg.topic_prefix}/status" if cfg.topic_prefix else "qsh/status"
        self._client.will_set(status_topic, payload="offline", qos=1, retain=True)

        # Wire callbacks
        self._client.on_connect = self._on_connect
        self._client.on_disconnect = self._on_disconnect
        self._client.on_message = self._on_message

        last_err = None
        for attempt in range(retries):
            try:
                self._client.connect(cfg.broker, cfg.port, keepalive=cfg.keepalive)
                self._client.loop_start()
                if self._connected.wait(timeout=timeout):
                    # Publish online status
                    self._client.publish(status_topic, payload="online", qos=1, retain=True)
                    logger.info("MQTT connected to %s:%d", cfg.broker, cfg.port)
                    return
                else:
                    raise TimeoutError("Connect timed out")
            except Exception as exc:
                last_err = exc
                delay = _RECONNECT_DELAYS[min(attempt, len(_RECONNECT_DELAYS) - 1)]
                logger.warning(
                    "MQTT connect attempt %d/%d failed: %s — retrying in %ds",
                    attempt + 1, retries, exc, delay,
                )
                try:
                    self._client.loop_stop()
                except Exception:
                    pass
                time.sleep(delay)

        raise ConnectionError(f"MQTT connect failed after {retries} attempts: {last_err}")

    def subscribe(self, topics: List[str]) -> None:
        """Subscribe to topic list at QoS 0 (sensor reads tolerate occasional loss)."""
        self._subscriptions = list(topics)
        if self._client and self._connected.is_set():
            for topic in topics:
                self._client.subscribe(topic, qos=0)
            logger.info("MQTT subscribed to %d topics", len(topics))

    def publish(self, topic: str, payload: str, qos: int = 1, retain: bool = True) -> None:
        """Publish with QoS 1, retained by default (control outputs must be reliable)."""
        if self._client:
            self._client.publish(topic, payload=payload, qos=qos, retain=retain)

    def get_cache_snapshot(self) -> Dict[str, Tuple[str, float]]:
        """Thread-safe snapshot of the topic cache."""
        with self._lock:
            return dict(self._cache)

    def get_cached(self, topic: str) -> Optional[str]:
        """Thread-safe lookup of cached payload for a single topic.

        Returns the payload string if a message has been received for this
        topic, or None if the topic has never been seen.  Used by
        _resolve_mqtt_control() for per-key cache queries.
        """
        with self._lock:
            entry = self._cache.get(topic)
        return entry[0] if entry is not None else None

    def disconnect(self) -> None:
        """Clean disconnect — publish offline status, stop loop."""
        if self._client:
            cfg = self._config
            status_topic = f"{cfg.topic_prefix}/status" if cfg.topic_prefix else "qsh/status"
            try:
                self._client.publish(status_topic, payload="offline", qos=1, retain=True)
                self._client.disconnect()
                self._client.loop_stop()
            except Exception as exc:
                logger.warning("MQTT disconnect error: %s", exc)
            self._connected.clear()

    # ── Paho callbacks ──────────────────────────────────────────────────

    def _on_connect(self, client: Any, userdata: Any, flags: Any, reason_code: Any, properties: Any = None) -> None:
        """Called on successful connect — resubscribe to all topics."""
        self._connected.set()
        # Resubscribe on reconnect (paho clears subscriptions on reconnect)
        for topic in self._subscriptions:
            client.subscribe(topic, qos=0)
        if self._subscriptions:
            logger.info("MQTT (re)subscribed to %d topics on connect", len(self._subscriptions))

    def _on_disconnect(self, client: Any, userdata: Any, flags: Any, reason_code: Any, properties: Any = None) -> None:
        """Called on disconnect — paho handles reconnect via loop_start()."""
        self._connected.clear()
        logger.warning("MQTT disconnected (rc=%s) — paho will auto-reconnect", reason_code)

    def _on_message(self, client: Any, userdata: Any, msg: Any) -> None:
        """Message callback — thread-safe write to cache."""
        try:
            payload_str = msg.payload.decode("utf-8", errors="replace")
            with self._lock:
                self._cache[msg.topic] = (payload_str, time.time())
        except Exception as exc:
            logger.debug("MQTT message decode error on %s: %s", msg.topic, exc)
