/**
 * examples/nextjs-api-routes.ts
 *
 * Next.js App Router API routes for the wallet bridge backend.
 * Drop these into your app/api/wallet-bridge/ directory.
 *
 * File structure:
 *   app/api/wallet-bridge/requests/[id]/route.ts  ← GET request
 *   app/api/wallet-bridge/resolve/[id]/route.ts   ← POST resolve
 *   app/api/wallet-bridge/reject/[id]/route.ts    ← POST reject
 */

// ── app/api/wallet-bridge/requests/[id]/route.ts ──────────────────────────────

import { NextRequest, NextResponse } from "next/server";
// import { bridge } from "@/lib/wallet-bridge";  // your bridge singleton

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  // import { bridge } from "@/lib/wallet-bridge";
  const request = await bridge.getRequest(params.id);

  if (!request) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(request);
}

// ── app/api/wallet-bridge/resolve/[id]/route.ts ───────────────────────────────

export async function POST_resolve(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await req.json();
  const { txHash, signature, signerAddress } = body;

  if (!signerAddress) {
    return NextResponse.json({ error: "signerAddress is required" }, { status: 400 });
  }

  try {
    const resolved = await bridge.resolve(params.id, {
      txHash,
      signature,
      signerAddress,
    });
    return NextResponse.json(resolved);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 400 }
    );
  }
}

// ── app/api/wallet-bridge/reject/[id]/route.ts ────────────────────────────────

export async function POST_reject(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await req.json().catch(() => ({}));
  const reason = body.reason ?? "User rejected";

  try {
    const rejected = await bridge.reject(params.id, reason);
    return NextResponse.json(rejected);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 400 }
    );
  }
}

// ── app/wallet/approve/[id]/page.tsx ──────────────────────────────────────────
//
// The approval UI page. This is where the user lands when they click
// the approvalUrl from the MCP tool response.

/*
"use client";

import { WalletApproval } from "@mcp-web3/wallet-bridge-ui";
import { useAccount, useWriteContract, useSendTransaction, useSignMessage } from "wagmi";

export default function ApprovePage({ params }: { params: { id: string } }) {
  const { address } = useAccount();

  return (
    <WalletApproval
      requestId={params.id}
      appName="Your App"

      fetchRequest={async (id) => {
        const res = await fetch(`/api/wallet-bridge/requests/${id}`);
        return res.json();
      }}

      onApprove={async (request) => {
        // Wire this up with wagmi, viem, or @solana/web3.js
        // depending on the request.transaction.chain

        if (request.transaction.type === "transfer") {
          const { sendTransactionAsync } = useSendTransaction();
          const hash = await sendTransactionAsync({
            to: request.transaction.to as `0x${string}`,
            value: BigInt(parseFloat(request.transaction.value!) * 1e18),
          });
          // Tell the bridge the tx was submitted
          await fetch(`/api/wallet-bridge/resolve/${request.id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ txHash: hash, signerAddress: address }),
          });
          return { txHash: hash, signerAddress: address! };
        }

        if (request.transaction.type === "sign_message") {
          const { signMessageAsync } = useSignMessage();
          const sig = await signMessageAsync({ message: request.transaction.message! });
          await fetch(`/api/wallet-bridge/resolve/${request.id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ signature: sig, signerAddress: address }),
          });
          return { signature: sig, signerAddress: address! };
        }

        throw new Error("Unsupported transaction type");
      }}

      onReject={async (request) => {
        await fetch(`/api/wallet-bridge/reject/${request.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "User rejected" }),
        });
      }}
    />
  );
}
*/
