import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../contract";
import { DEFAULT_REVIEW_INSTRUCTIONS } from "../core/review-prompt";

/** The saved review instructions, null while loading. A failed read gives the defaults. */
export function useReviewInstructions(): string | null {
  const rpc = useRpc<typeof rpcContract>();
  const [instructions, setInstructions] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    rpc.call("getReviewInstructions", {}).then(
      (saved) => current && setInstructions(saved.instructions),
      () => current && setInstructions(DEFAULT_REVIEW_INSTRUCTIONS),
    );
    return () => {
      current = false;
    };
  }, [rpc]);
  return instructions;
}
