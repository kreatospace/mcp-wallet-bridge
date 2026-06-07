import { randomUUID } from "crypto";
import type { PendingRequest, StorageAdapter } from "../types/index.js";

/**
 * MemoryAdapter
 *
 * Default storage adapter. Zero dependencies, works out of the box.
 * Use for development, testing, or single-process deployments.
 * For multi-process / multi-server, use the Prisma or Redis adapter instead.
 */
export class MemoryAdapter implements StorageAdapter {
  private store = new Map<string, PendingRequest>();

  async create(request: Omit<PendingRequest, "id">): Promise<PendingRequest> {
    const record: PendingRequest = { ...request, id: randomUUID() };
    this.store.set(record.id, record);
    return structuredClone(record);
  }

  async findById(id: string): Promise<PendingRequest | null> {
    const record = this.store.get(id);
    return record ? structuredClone(record) : null;
  }

  async findBySession(sessionId: string): Promise<PendingRequest[]> {
    return [...this.store.values()]
      .filter((r) => r.sessionId === sessionId)
      .map((r) => structuredClone(r));
  }

  async update(
    id: string,
    patch: Partial<PendingRequest>
  ): Promise<PendingRequest> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`PendingRequest ${id} not found`);
    const updated = { ...existing, ...patch };
    this.store.set(id, updated);
    return structuredClone(updated);
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  async cleanup(olderThan?: Date): Promise<number> {
    const threshold = olderThan ?? new Date();
    let count = 0;
    for (const [id, record] of this.store.entries()) {
      if (record.expiresAt <= threshold && record.status === "pending") {
        this.store.set(id, { ...record, status: "expired" });
        count++;
      }
    }
    return count;
  }

  /** Utility: get raw store size (useful for tests) */
  size(): number {
    return this.store.size;
  }
}
