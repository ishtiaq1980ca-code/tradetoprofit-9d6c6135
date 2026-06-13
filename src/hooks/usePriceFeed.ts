import { useEffect, useState } from "react";
import { priceFeed, type FeedState } from "@/lib/priceFeed";
import { useAccount } from "@/lib/paperTrading";

export function usePriceFeed(): FeedState {
  const [state, setState] = useState<FeedState>(priceFeed.state);
  useEffect(() => {
    priceFeed.start();
    return priceFeed.subscribe(setState);
  }, []);
  return state;
}

/** Mount once near the root to bridge live ticks into the paper account. */
export function MarketEngine() {
  const tickAll = useAccount((s) => s.tickAll);
  useEffect(() => {
    priceFeed.start();
    const unsub = priceFeed.subscribe((s) => tickAll(s.prices));
    return unsub;
  }, [tickAll]);
  return null;
}
