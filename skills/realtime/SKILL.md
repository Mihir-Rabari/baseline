---
name: realtime
description: Redis Pub/Sub messaging and realtime notification events.
---

# Realtime Events Skill

## 1. When to Use
Use this skill when publishing or subscribing to realtime notification events across microservices, background jobs, or user channels.

## 2. Architecture
- Built on `RedisService` from `@packages/shared` utilizing `ioredis`.
- Decouples message emission from consumer clients.
- Channel naming convention: `<namespace>:<entityId>:<event>` (e.g. `notifications:user_123:new_message`).

## 3. Invariants
- Keep payload messages small and JSON-serializable.
- Handle connection reconnections automatically through the shared Redis client wrapper.
- Do not store long-term persistent state inside ephemeral pub/sub channels.

## 4. Mandatory Testing Expectations
- Test message serialization and deserialization error handling.
- Verify safe disconnection behavior when the Redis instance closes.
- Ensure pub/sub channel names follow the structured taxonomy.
