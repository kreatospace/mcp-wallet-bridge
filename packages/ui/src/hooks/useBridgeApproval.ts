import { useState, useCallback } from "react";

interface BridgeApprovalResult {
  txHash?: string;
  signature?: string;
  signerAddress: string;
}

interface UseBridgeApprovalOptions {
  /** Endpoint to POST the resolution to */
  resolveEndpoint: string;
  /** Endpoint to POST the rejection to */
  rejectEndpoint: string;
  /** Auth token */
  authToken?: string;
  onSuccess?: (result: BridgeApprovalResult) => void;
  onError?: (error: Error) => void;
}

interface UseBridgeApprovalResult {
  approve: (requestId: string, result: BridgeApprovalResult) => Promise<void>;
  reject: (requestId: string, reason?: string) => Promise<void>;
  approving: boolean;
  rejecting: boolean;
  error: string | null;
  phase: "idle" | "approving" | "rejecting" | "done";
}

/**
 * useBridgeApproval
 *
 * Handles calling your backend to resolve or reject a pending bridge request.
 * Use this when you want to manage the wallet signing yourself and just need
 * the approval flow wired up.
 *
 * @example
 * ```tsx
 * const { approve, reject, approving, phase } = useBridgeApproval({
 *   resolveEndpoint: "/api/wallet-bridge/resolve",
 *   rejectEndpoint: "/api/wallet-bridge/reject",
 * });
 *
 * // After you've signed with wagmi / @solana/web3.js:
 * await approve(requestId, { txHash, signerAddress });
 * ```
 */
export function useBridgeApproval({
  resolveEndpoint,
  rejectEndpoint,
  authToken,
  onSuccess,
  onError,
}: UseBridgeApprovalOptions): UseBridgeApprovalResult {
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "approving" | "rejecting" | "done">("idle");

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

  const approve = useCallback(
    async (requestId: string, result: BridgeApprovalResult) => {
      setApproving(true);
      setPhase("approving");
      setError(null);
      try {
        const res = await fetch(`${resolveEndpoint}/${requestId}`, {
          method: "POST",
          headers,
          body: JSON.stringify(result),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        setPhase("done");
        onSuccess?.(result);
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e.message);
        setPhase("idle");
        onError?.(e);
      } finally {
        setApproving(false);
      }
    },
    [resolveEndpoint, authToken, onSuccess, onError]
  );

  const reject = useCallback(
    async (requestId: string, reason?: string) => {
      setRejecting(true);
      setPhase("rejecting");
      setError(null);
      try {
        const res = await fetch(`${rejectEndpoint}/${requestId}`, {
          method: "POST",
          headers,
          body: JSON.stringify({ reason }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        setPhase("done");
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e.message);
        setPhase("idle");
        onError?.(e);
      } finally {
        setRejecting(false);
      }
    },
    [rejectEndpoint, authToken, onError]
  );

  return { approve, reject, approving, rejecting, error, phase };
}
