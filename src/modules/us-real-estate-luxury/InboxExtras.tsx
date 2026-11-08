"use client";

// UI injetada na Neural Inbox pela gaveta US Luxury Real Estate.

import type { InboxModuleContext } from "../types";
import { BuyerQualificationPanel } from "@/components/niche/BuyerQualificationPanel";

export function UsRealEstateLuxuryInboxExtras(context: InboxModuleContext) {
  return <BuyerQualificationPanel {...context} />;
}
