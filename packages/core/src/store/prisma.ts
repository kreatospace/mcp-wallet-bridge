import type { PendingRequest, PendingResult, PendingStatus, StorageAdapter } from "../types/index.js";

/**
 * PrismaAdapter
 *
 * Persistent storage using Prisma ORM. Suitable for production deployments
 * where multiple processes or servers share the same database.
 *
 * Required Prisma schema — add to your schema.prisma:
 *
 * ```prisma
 * model McpWalletRequest {
 *   id          String   @id @default(cuid())
 *   sessionId   String
 *   transaction Json
 *   status      String   @default("pending")
 *   approvalUrl String
 *   createdAt   DateTime @default(now())
 *   expiresAt   DateTime
 *   resolvedAt  DateTime?
 *   result      Json?
 *   error       String?
 *
 *   @@index([sessionId])
 *   @@index([status, expiresAt])
 * }
 * ```
 *
 * Then run: `npx prisma migrate dev --name mcp_wallet_requests`
 */
export class PrismaAdapter implements StorageAdapter {
  // Using `any` here intentionally — allows consumers to pass their own
  // PrismaClient instance without a hard peer dependency on @prisma/client.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private readonly prisma: any) {}

  async create(request: Omit<PendingRequest, "id">): Promise<PendingRequest> {
    const row = await this.prisma.mcpWalletRequest.create({
      data: {
        sessionId: request.sessionId,
        transaction: request.transaction as object,
        status: request.status,
        approvalUrl: request.approvalUrl,
        createdAt: request.createdAt,
        expiresAt: request.expiresAt,
        resolvedAt: request.resolvedAt ?? null,
        result: (request.result as object) ?? null,
        error: request.error ?? null,
      },
    });
    return this.deserialize(row);
  }

  async findById(id: string): Promise<PendingRequest | null> {
    const row = await this.prisma.mcpWalletRequest.findUnique({ where: { id } });
    return row ? this.deserialize(row) : null;
  }

  async findBySession(sessionId: string): Promise<PendingRequest[]> {
    const rows = await this.prisma.mcpWalletRequest.findMany({
      where: { sessionId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(this.deserialize);
  }

  async update(id: string, patch: Partial<PendingRequest>): Promise<PendingRequest> {
    const row = await this.prisma.mcpWalletRequest.update({
      where: { id },
      data: {
        ...(patch.status !== undefined && { status: patch.status }),
        ...(patch.resolvedAt !== undefined && { resolvedAt: patch.resolvedAt }),
        ...(patch.result !== undefined && { result: patch.result as object }),
        ...(patch.error !== undefined && { error: patch.error }),
      },
    });
    return this.deserialize(row);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.mcpWalletRequest.delete({ where: { id } });
  }

  async cleanup(olderThan?: Date): Promise<number> {
    const threshold = olderThan ?? new Date();
    const result = await this.prisma.mcpWalletRequest.updateMany({
      where: { status: "pending", expiresAt: { lte: threshold } },
      data: { status: "expired" },
    });
    return result.count;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private deserialize(row: any): PendingRequest {
    return {
      id: row.id,
      sessionId: row.sessionId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transaction: row.transaction as any,
      status: row.status as PendingStatus,
      approvalUrl: row.approvalUrl,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      resolvedAt: row.resolvedAt ?? undefined,
      result: row.result as PendingResult | undefined,
      error: row.error ?? undefined,
    };
  }
}
