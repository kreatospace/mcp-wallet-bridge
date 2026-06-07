import { useState, useEffect, useCallback } from "react";

interface PendingRequest {
  id: string;
  sessionId: string;
  transaction: Record<string, unknown>;
  status: string;
  approvalUrl: string;
  createdAt: string;
  expiresAt: string;
  result?: { txHash?: string; signature?: string; signerAddress: string };
  error?: string;
}

interface UseWalletBridgeRequestOptions {
  /** Your backend endpoint that returns the PendingRequest by ID */
  endpoint: string;
  requestId: string;
  /** Poll interval in ms while status is pending (default 3000) */
  pollInterval?: number;
  /** Auth token to include in the Authorization header */
  authToken?: string;
}

interface UseWalletBridgeRequestResult {
  request: PendingRequest | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * useWalletBridgeRequest
 *
 * Fetches and polls a pending wallet bridge request.
 * Stops polling when the request reaches a terminal status.
 *
 * @example
 * ```tsx
 * const { request, loading, error } = useWalletBridgeRequest({
 *   endpoint: "/api/wallet-bridge/requests",
 *   requestId: params.id,
 * });
 * ```
 */
export function useWalletBridgeRequest({
  endpoint,
  requestId,
  pollInterval = 3000,
  authToken,
}: UseWalletBridgeRequestOptions): UseWalletBridgeRequestResult {
  const [request, setRequest] = useState<PendingRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

    async function load() {
      try {
        const res = await fetch(`${endpoint}/${requestId}`, { headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setRequest(data);
          setError(null);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to fetch request");
          setLoading(false);
        }
      }
    }

    load();

    return () => { cancelled = true; };
  }, [endpoint, requestId, authToken, tick]);

  // Poll while pending
  useEffect(() => {
    const TERMINAL = ["approved", "signed", "broadcast", "confirmed", "rejected", "expired", "failed"];
    if (!request || TERMINAL.includes(request.status)) return;

    const interval = setInterval(refetch, pollInterval);
    return () => clearInterval(interval);
  }, [request, pollInterval, refetch]);

  return { request, loading, error, refetch };
}
