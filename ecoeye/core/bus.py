"""
EcoEye Asynchronous In-Memory EventBus.
Enables non-blocking, decoupled communication between sensory producers (CSI, BLE, Vision)
and downstream handlers (Storage, WebSocket Gateway, Sync Worker, Audio Feedback).
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Awaitable, Callable, Dict, List, Set

logger = logging.getLogger("ecoeye.bus")

EventHandler = Callable[[Any], Awaitable[None]]


class EventBus:
    """
    Publish/Subscribe event dispatcher supporting asynchronous event distribution.
    Features robust error isolation so failing subscribers do not disrupt pipeline flow.
    """

    def __init__(self):
        self._subscribers: Dict[str, List[EventHandler]] = {}
        self._lock = asyncio.Lock()

    def subscribe(self, topic: str, handler: EventHandler) -> None:
        """Register an async callback for a specific topic."""
        if topic not in self._subscribers:
            self._subscribers[topic] = []
        if handler not in self._subscribers[topic]:
            self._subscribers[topic].append(handler)
            logger.debug(f"Subscribed handler '{handler.__name__}' to topic '{topic}'")

    def unsubscribe(self, topic: str, handler: EventHandler) -> None:
        """Remove an async callback from a topic."""
        if topic in self._subscribers and handler in self._subscribers[topic]:
            self._subscribers[topic].remove(handler)
            logger.debug(f"Unsubscribed handler '{handler.__name__}' from topic '{topic}'")

    async def publish(self, topic: str, event_data: Any) -> None:
        """
        Broadcast event data to all registered topic subscribers concurrently.
        Catches and logs subscriber exceptions to preserve system resilience.
        """
        handlers = list(self._subscribers.get(topic, []))
        # Support wildcard matching for topic.*
        if "all" in self._subscribers:
            handlers.extend(self._subscribers["all"])

        if not handlers:
            logger.debug(f"No subscribers registered for topic '{topic}'")
            return

        tasks = []
        for handler in handlers:
            tasks.append(self._invoke_handler(handler, topic, event_data))

        await asyncio.gather(*tasks, return_exceptions=True)

    async def _invoke_handler(self, handler: EventHandler, topic: str, event_data: Any) -> None:
        try:
            await handler(event_data)
        except Exception as ex:
            logger.error(
                f"Error in EventBus subscriber '{handler.__name__}' on topic '{topic}': {ex}",
                exc_info=True
            )


# Global singleton instance
event_bus = EventBus()
