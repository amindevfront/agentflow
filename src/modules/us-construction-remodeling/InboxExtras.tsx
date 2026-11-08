"use client";

// UI injetada na Neural Inbox pela gaveta US Construction & Remodeling.

import type { InboxModuleContext } from "../types";
import { RemodelingEstimatePanel } from "@/components/niche/RemodelingEstimatePanel";

export function UsConstructionRemodelingInboxExtras(context: InboxModuleContext) {
  return <RemodelingEstimatePanel {...context} />;
}
