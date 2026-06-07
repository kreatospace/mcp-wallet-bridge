/**
 * RedisAdapter
 *
 * Persistent storage using Redis (via ioredis).
 * Best choice for multi-process / multi-server deployments where you need
 * fast expiry and don't want to run cleanup jobs manually.
 *
 * Peer dependency: ioredis ^5.0.0
 *
 * @example
 * ```ts
 * import Redis from "ioredis";
 * import { createWalletBridge } from "@mcp-web3/wallet-bridge";
 * import { RedisAdapter } from "@mcp-web3/wallet-bridge/adapters/redis";
 *
 * const redis = new Redis(process.env.REDIS_URL);
 *
 * const bridge = createWalletBridge({
 *   approvalBaseUrl: "https://yourapp.xyz/wallet/approve",
 *   storage: new RedisAdapter(redis),
 * });
 * ```
 */

import type {
  PendingRequest,
  PendingResult,
  PendingStatus,
  StorageAdapter,
} from "@mcp-web3/wallet-bridge/types";

const KEY_PREFIX = "mcp:wallet:request:";
const SESSION_INDEX_PREFIX = "mcp:wallet:session:";

export class RedisAdapter implements StorageAdapter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private readonly redis: any) {}

  async create(request: Omit<PendingRequest, "id">): Promise<PendingRequest> {
    const { randomUUID } = await import("crypto");
    const id = randomUUID();
    const record: PendingRequest = { ...request, id };

    const ttlSeconds = Math.max(
      1,
      Math.ceil((record.expiresAt.getTime() - Date.now()) / 1000)
    );

    const pipe = this.redis.pipeline();

    // Store the record as JSON with TTL matching expiresAt
    pipe.set(KEY_PREFIX + id, JSON.stringify(this.serialize(record)), "EX", ttlSeconds);

    // Add to session index (sorted set scored by expiresAt timestamp)
    pipe.zadd(
      SESSION_INDEX_PREFIX + request.sessionId,
      record.expiresAt.getTime(),
      id
    );
    // Expire the session index slightly after the longest possible TTL
    pipe.expire(SESSION_INDEX_PREFIX + request.sessionId, ttlSeconds + 60);

    await pipe.exec();
    return record;
  }

  async findById(id: string): Promise<PendingRequest | null> {
    const raw = await this.redis.get(KEY_PREFIX + id);
    if (!raw) return null;
    return this.deserialize(JSON.parse(raw));
  }

  async findBySession(sessionId: string): Promise<PendingRequest[]> {
    // Get all request IDs for this session
    const ids: string[] = await this.redis.zrange(
      SESSION_INDEX_PREFIX + sessionId,
      0,
      -1
    );
    if (!ids.length) return [];

    const pipe = this.redis.pipeline();
    for (const id of ids) pipe.get(KEY_PREFIX + id);
    const results = await pipe.exec();

    return (results as [Error | null, string | null][])
      .map(([, raw]) => (raw ? this.deserialize(JSON.parse(raw)) : null))
      .filter((r): r is PendingRequest => r !== null);
  }

  async update(id: string, patch: Partial<PendingRequest>): Promise<PendingRequest> {
    const existing = await this.findById(id);
    if (!existing) throw new Error(`PendingRequest ${id} not found`);

    const updated: PendingRequest = { ...existing, ...patch };

    // Recalculate remaining TTL
    const ttlSeconds = Math.max(
      1,
      Math.ceil((updated.expiresAt.getTime() - Date.now()) / 1000)
    );

    await this.redis.set(
      KEY_PREFIX + id,
      JSON.stringify(this.serialize(updated)),
      "EX",
      ttlSeconds
    );

    return updated;
  }

  async delete(id: string): Promise<void> {
    const existing = await this.findById(id);
    if (!existing) return;

    const pipe = this.redis.pipeline();
    pipe.del(KEY_PREFIX + id);
    pipe.zrem(SESSION_INDEX_PREFIX + existing.sessionId, id);
    await pipe.exec();
  }

  async cleanup(olderThan?: Date): Promise<number> {
    // Redis handles expiry automatically via TTL.
    // This method marks logically-expired pending records as "expired"
    // for any that haven't been cleaned up by Redis yet (edge case).
    const threshold = (olderThan ?? new Date()).getTime();

    // Find all session indexes
    const sessionKeys: string[] = await this.redis.keys(SESSION_INDEX_PREFIX + "*");
    let count = 0;

    for (const sessionKey of sessionKeys) {
      // Get IDs with score (expiresAt) <= threshold
      const expiredIds: string[] = await this.redis.zrangebyscore(
        sessionKey,
        "-inf",
        threshold
      );

      for (const id of expiredIds) {
        const record = await this.findById(id);
        if (record && record.status === "pending") {
          await this.update(id, { status: "expired" });
          count++;
        }
      }
    }

    return count;
  }

  // ── Serialization ────────────────────────────────────────────────────────────

  private serialize(record: PendingRequest): object {
    return {
      ...record,
      createdAt: record.createdAt.toISOString(),
      expiresAt: record.expiresAt.toISOString(),
      resolvedAt: record.resolvedAt?.toISOString() ?? null,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private deserialize(raw: any): PendingRequest {
    return {
      id: raw.id,
      sessionId: raw.sessionId,
      transaction: raw.transaction,
      status: raw.status as PendingStatus,
      approvalUrl: raw.approvalUrl,
      createdAt: new Date(raw.createdAt),
      expiresAt: new Date(raw.expiresAt),
      resolvedAt: raw.resolvedAt ? new Date(raw.resolvedAt) : undefined,
      result: raw.result as PendingResult | undefined,
      error: raw.error ?? undefined,
    };
  }
}
