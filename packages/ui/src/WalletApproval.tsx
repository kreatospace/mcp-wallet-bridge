import { useState, useEffect, useCallback } from "react";

// ─── Types (inlined to keep the UI package self-contained) ────────────────────

type PendingStatus =
  | "pending" | "approved" | "signed" | "broadcast"
  | "confirmed" | "rejected" | "expired" | "failed";

interface Transaction {
  type: string;
  chain: string;
  to?: string;
  value?: string;
  amount?: string;
  message?: string;
  functionName?: string;
  tokenAddress?: string;
  metadata?: Record<string, unknown>;
}

interface PendingRequest {
  id: string;
  sessionId: string;
  transaction: Transaction;
  status: PendingStatus;
  approvalUrl: string;
  createdAt: string;
  expiresAt: string;
  result?: { txHash?: string; signature?: string; signerAddress: string };
  error?: string;
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface WalletApprovalProps {
  /** The pending request ID from the bridge */
  requestId: string;

  /**
   * Async function that should:
   * 1. Connect the user's wallet
   * 2. Sign / send the transaction
   * 3. Call your backend to bridge.resolve() with the result
   * 4. Return the result
   */
  onApprove: (request: PendingRequest) => Promise<{
    txHash?: string;
    signature?: string;
    signerAddress: string;
  }>;

  /**
   * Async function that should call your backend bridge.reject()
   */
  onReject: (request: PendingRequest) => Promise<void>;

  /**
   * Function to fetch the pending request from your backend.
   * Receives the requestId, should return the PendingRequest or null.
   */
  fetchRequest: (requestId: string) => Promise<PendingRequest | null>;

  /** Optional: poll interval in ms for refreshing status (default 3000) */
  pollInterval?: number;

  /** Optional: custom class name for the root element */
  className?: string;

  /** Optional: app name shown in the UI */
  appName?: string;

  /** Optional: app logo URL */
  appLogo?: string;
}

// ─── Chain display helpers ────────────────────────────────────────────────────

const CHAIN_META: Record<string, { name: string; color: string; symbol: string }> = {
  ethereum: { name: "Ethereum", color: "#627EEA", symbol: "ETH" },
  base: { name: "Base", color: "#0052FF", symbol: "ETH" },
  "base-sepolia": { name: "Base Sepolia", color: "#0052FF", symbol: "ETH" },
  polygon: { name: "Polygon", color: "#8247E5", symbol: "POL" },
  arbitrum: { name: "Arbitrum", color: "#28A0F0", symbol: "ETH" },
  optimism: { name: "Optimism", color: "#FF0420", symbol: "ETH" },
  solana: { name: "Solana", color: "#9945FF", symbol: "SOL" },
  "solana-devnet": { name: "Solana Devnet", color: "#9945FF", symbol: "SOL" },
};

function getChainMeta(chain: string) {
  return CHAIN_META[chain] ?? { name: chain, color: "#6B7280", symbol: "???" };
}

function formatAddress(addr: string): string {
  if (!addr) return "";
  if (addr.length <= 13) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function getTxLabel(tx: Transaction): string {
  switch (tx.type) {
    case "transfer": return "Send";
    case "token_transfer": return "Token Transfer";
    case "contract_call": return `Call: ${tx.functionName ?? "contract"}`;
    case "sign_message": return "Sign Message";
    case "sign_typed": return "Sign Data";
    case "custom": return "Custom Transaction";
    default: return "Transaction";
  }
}

// ─── Countdown hook ───────────────────────────────────────────────────────────

function useCountdown(expiresAt: string): { minutes: number; seconds: number; expired: boolean } {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    const update = () => {
      const diff = new Date(expiresAt).getTime() - Date.now();
      setRemaining(Math.max(0, diff));
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  const totalSecs = Math.floor(remaining / 1000);
  return {
    minutes: Math.floor(totalSecs / 60),
    seconds: totalSecs % 60,
    expired: remaining === 0,
  };
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function WalletApproval({
  requestId,
  onApprove,
  onReject,
  fetchRequest,
  pollInterval = 3000,
  className = "",
  appName,
  appLogo,
}: WalletApprovalProps) {
  const [request, setRequest] = useState<PendingRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "approving" | "done">("idle");

  // ── Fetch the request ──────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const req = await fetchRequest(requestId);
        if (!cancelled) {
          setRequest(req);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load request");
          setLoading(false);
        }
      }
    }

    load();

    // Poll while status is pending
    const interval = setInterval(async () => {
      if (request?.status !== "pending") return;
      const req = await fetchRequest(requestId).catch(() => null);
      if (!cancelled && req) setRequest(req);
    }, pollInterval);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [requestId, fetchRequest, pollInterval]);

  const { minutes, seconds, expired } = useCountdown(request?.expiresAt ?? new Date(Date.now() + 600_000).toISOString());

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleApprove = useCallback(async () => {
    if (!request) return;
    setActionLoading(true);
    setPhase("approving");
    setError(null);
    try {
      const result = await onApprove(request);
      setRequest((prev) => prev
        ? { ...prev, status: "broadcast", result }
        : prev
      );
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transaction failed");
      setPhase("idle");
    } finally {
      setActionLoading(false);
    }
  }, [request, onApprove]);

  const handleReject = useCallback(async () => {
    if (!request) return;
    setActionLoading(true);
    setError(null);
    try {
      await onReject(request);
      setRequest((prev) => prev ? { ...prev, status: "rejected" } : prev);
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reject");
    } finally {
      setActionLoading(false);
    }
  }, [request, onReject]);

  // ── Render states ──────────────────────────────────────────────────────────

  if (loading) return <LoadingState />;
  if (!request) return <NotFoundState />;

  const chainMeta = getChainMeta(request.transaction.chain);
  const isTerminal = ["approved", "signed", "broadcast", "confirmed", "rejected", "expired", "failed"].includes(request.status);
  const isSuccess = ["approved", "signed", "broadcast", "confirmed"].includes(request.status);
  const isRejected = request.status === "rejected";
  const isExpired = request.status === "expired" || expired;

  if (isTerminal || phase === "done") {
    return (
      <TerminalState
        success={isSuccess}
        rejected={isRejected}
        expired={isExpired}
        request={request}
        chainMeta={chainMeta}
        appName={appName}
        className={className}
      />
    );
  }

  return (
    <div className={`wallet-approval-root ${className}`} style={styles.root}>
      <div style={styles.card}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.headerTop}>
            {appLogo && <img src={appLogo} alt={appName} style={styles.appLogo} />}
            <div>
              <div style={styles.appLabel}>{appName ?? "App"} is requesting</div>
              <div style={styles.txLabel}>{getTxLabel(request.transaction)}</div>
            </div>
            <div style={{ ...styles.chainBadge, background: chainMeta.color }}>
              {chainMeta.name}
            </div>
          </div>
        </div>

        {/* Transaction Details */}
        <div style={styles.details}>
          <TxDetails tx={request.transaction} chainMeta={chainMeta} />
        </div>

        {/* Metadata / context from MCP tool */}
        {request.transaction.metadata && Object.keys(request.transaction.metadata).length > 0 && (
          <div style={styles.metadataSection}>
            <div style={styles.sectionLabel}>Context</div>
            {Object.entries(request.transaction.metadata).map(([k, v]) => (
              <div key={k} style={styles.metaRow}>
                <span style={styles.metaKey}>{k}</span>
                <span style={styles.metaVal}>{String(v)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Timer */}
        <div style={styles.timer}>
          <div style={{ ...styles.timerBar, width: `${(minutes * 60 + seconds) / 600 * 100}%` }} />
          <span style={styles.timerText}>
            Expires in {minutes}:{String(seconds).padStart(2, "0")}
          </span>
        </div>

        {/* Error */}
        {error && <div style={styles.errorBox}>{error}</div>}

        {/* Actions */}
        <div style={styles.actions}>
          <button
            style={{ ...styles.btn, ...styles.rejectBtn }}
            onClick={handleReject}
            disabled={actionLoading}
          >
            Reject
          </button>
          <button
            style={{ ...styles.btn, ...styles.approveBtn }}
            onClick={handleApprove}
            disabled={actionLoading}
          >
            {phase === "approving" ? (
              <span style={styles.spinner}>⟳ Approving…</span>
            ) : (
              "Approve"
            )}
          </button>
        </div>

        <div style={styles.footerNote}>
          Your wallet will prompt you to confirm this action.
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TxDetails({ tx, chainMeta }: { tx: Transaction; chainMeta: ReturnType<typeof getChainMeta> }) {
  const rows: { label: string; value: string }[] = [];
  const currency = tx.metadata?.currency as string | undefined;
  const originalPrice = tx.metadata?.originalPrice as string | undefined;

  if (tx.to) rows.push({ label: "To", value: formatAddress(tx.to) });
  if (tx.value) rows.push({
    label: "Amount",
    value: `${tx.value} ${currency ?? chainMeta.symbol}${originalPrice ? ` (${originalPrice})` : ""}`,
  });
  else if (tx.amount) rows.push({ label: "Amount", value: tx.amount });
  if (tx.tokenAddress) rows.push({ label: "Token", value: formatAddress(tx.tokenAddress) });
  if (tx.message) rows.push({ label: "Message", value: tx.message.slice(0, 120) });
  if (tx.functionName) rows.push({ label: "Function", value: tx.functionName });

  return (
    <div>
      {rows.map((row) => (
        <div key={row.label} style={styles.detailRow}>
          <span style={styles.detailLabel}>{row.label}</span>
          <span style={styles.detailValue}>{row.value}</span>
        </div>
      ))}
    </div>
  );
}

function TerminalState({ success, rejected, expired, request, chainMeta, appName, className }: {
  success: boolean; rejected: boolean; expired: boolean;
  request: PendingRequest; chainMeta: ReturnType<typeof getChainMeta>;
  appName?: string; className?: string;
}) {
  const icon = success ? "✓" : rejected ? "✕" : "⌛";
  const title = success
    ? request.transaction.type === "sign_message" || request.transaction.type === "sign_typed"
      ? "Signed"
      : "Transaction Submitted"
    : rejected ? "Rejected" : "Expired";

  return (
    <div className={className} style={styles.root}>
      <div style={styles.card}>
        <div style={{ textAlign: "center", padding: "2rem 0" }}>
          <div style={{
            ...styles.terminalIcon,
            background: success ? "#10B981" : rejected ? "#EF4444" : "#6B7280",
          }}>{icon}</div>
          <div style={styles.terminalTitle}>{title}</div>
          {request.result?.txHash && (
            <div style={styles.terminalSub}>
              Tx: {formatAddress(request.result.txHash)}
            </div>
          )}
          {request.result?.signature && (
            <div style={styles.terminalSub}>
              Sig: {formatAddress(request.result.signature)}
            </div>
          )}
          {request.result?.signerAddress && (
            <div style={styles.terminalSub}>
              Signed by: {formatAddress(request.result.signerAddress)}
            </div>
          )}
          <div style={styles.terminalFooter}>You can close this window.</div>
        </div>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div style={styles.root}>
      <div style={styles.card}>
        <div style={{ textAlign: "center", padding: "3rem", color: "#9CA3AF" }}>
          Loading request…
        </div>
      </div>
    </div>
  );
}

function NotFoundState() {
  return (
    <div style={styles.root}>
      <div style={styles.card}>
        <div style={{ textAlign: "center", padding: "3rem" }}>
          <div style={{ color: "#EF4444", fontWeight: 600 }}>Request not found</div>
          <div style={{ color: "#9CA3AF", fontSize: "0.875rem", marginTop: "0.5rem" }}>
            This approval link may be invalid or already expired.
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "100vh",
    background: "#0A0A0F",
    fontFamily: "'DM Sans', 'Inter', system-ui, sans-serif",
    padding: "1rem",
  },
  card: {
    background: "#111118",
    border: "1px solid #1E1E2E",
    borderRadius: "1.25rem",
    maxWidth: "440px",
    width: "100%",
    overflow: "hidden",
    boxShadow: "0 25px 50px rgba(0,0,0,0.5)",
  },
  header: {
    padding: "1.5rem",
    borderBottom: "1px solid #1E1E2E",
    background: "linear-gradient(135deg, #111118 0%, #151520 100%)",
  },
  headerTop: {
    display: "flex",
    alignItems: "center",
    gap: "0.875rem",
  },
  appLogo: {
    width: "40px",
    height: "40px",
    borderRadius: "10px",
    objectFit: "cover",
  },
  appLabel: {
    color: "#6B7280",
    fontSize: "0.75rem",
    fontWeight: 500,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    marginBottom: "2px",
  },
  txLabel: {
    color: "#F3F4F6",
    fontSize: "1.1rem",
    fontWeight: 700,
    letterSpacing: "-0.01em",
  },
  chainBadge: {
    marginLeft: "auto",
    padding: "4px 10px",
    borderRadius: "100px",
    fontSize: "0.72rem",
    fontWeight: 700,
    color: "#fff",
    whiteSpace: "nowrap" as const,
    letterSpacing: "0.02em",
  },
  details: {
    padding: "1.25rem 1.5rem",
    borderBottom: "1px solid #1E1E2E",
  },
  detailRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "0.5rem 0",
    borderBottom: "1px solid #1A1A28",
  },
  detailLabel: {
    color: "#6B7280",
    fontSize: "0.8rem",
    fontWeight: 500,
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
  },
  detailValue: {
    color: "#E5E7EB",
    fontSize: "0.9rem",
    fontWeight: 600,
    fontFamily: "monospace",
    wordBreak: "break-all" as const,
    maxWidth: "60%",
    textAlign: "right" as const,
  },
  metadataSection: {
    padding: "1rem 1.5rem",
    borderBottom: "1px solid #1E1E2E",
    background: "#0D0D14",
  },
  sectionLabel: {
    color: "#6B7280",
    fontSize: "0.7rem",
    fontWeight: 700,
    textTransform: "uppercase" as const,
    letterSpacing: "0.1em",
    marginBottom: "0.5rem",
  },
  metaRow: {
    display: "flex",
    justifyContent: "space-between",
    padding: "0.25rem 0",
    fontSize: "0.8rem",
  },
  metaKey: { color: "#6B7280" },
  metaVal: { color: "#D1D5DB", fontFamily: "monospace" },
  timer: {
    position: "relative" as const,
    padding: "0.75rem 1.5rem",
    background: "#0D0D14",
    borderBottom: "1px solid #1E1E2E",
  },
  timerBar: {
    position: "absolute" as const,
    left: 0,
    top: 0,
    height: "2px",
    background: "linear-gradient(90deg, #6366F1, #8B5CF6)",
    transition: "width 1s linear",
  },
  timerText: {
    color: "#6B7280",
    fontSize: "0.75rem",
    fontWeight: 500,
  },
  errorBox: {
    margin: "1rem 1.5rem 0",
    padding: "0.75rem 1rem",
    background: "rgba(239,68,68,0.1)",
    border: "1px solid rgba(239,68,68,0.3)",
    borderRadius: "0.5rem",
    color: "#FCA5A5",
    fontSize: "0.85rem",
  },
  actions: {
    display: "flex",
    gap: "0.75rem",
    padding: "1.25rem 1.5rem",
  },
  btn: {
    flex: 1,
    padding: "0.875rem",
    borderRadius: "0.75rem",
    fontWeight: 700,
    fontSize: "0.95rem",
    cursor: "pointer",
    border: "none",
    transition: "opacity 0.15s, transform 0.1s",
    letterSpacing: "-0.01em",
  },
  rejectBtn: {
    background: "#1A1A28",
    color: "#9CA3AF",
    border: "1px solid #2A2A3E",
  },
  approveBtn: {
    background: "linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)",
    color: "#fff",
    boxShadow: "0 4px 20px rgba(99,102,241,0.4)",
  },
  spinner: {
    display: "inline-block",
    animation: "spin 1s linear infinite",
  },
  footerNote: {
    textAlign: "center" as const,
    color: "#4B5563",
    fontSize: "0.75rem",
    paddingBottom: "1.25rem",
  },
  terminalIcon: {
    width: "56px",
    height: "56px",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "1.5rem",
    color: "#fff",
    margin: "0 auto 1rem",
    fontWeight: 700,
  },
  terminalTitle: {
    color: "#F3F4F6",
    fontSize: "1.25rem",
    fontWeight: 700,
    marginBottom: "0.5rem",
  },
  terminalSub: {
    color: "#6B7280",
    fontFamily: "monospace",
    fontSize: "0.8rem",
    marginTop: "0.25rem",
  },
  terminalFooter: {
    color: "#4B5563",
    fontSize: "0.8rem",
    marginTop: "1.5rem",
  },
};

export default WalletApproval;
