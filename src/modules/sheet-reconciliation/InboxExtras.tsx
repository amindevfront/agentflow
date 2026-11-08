"use client";

// UI injetada na Neural Inbox pela gaveta Sheet Reconciliation.

import type { InboxModuleContext } from "../types";
import { SheetReconciliationPanel } from "@/components/niche/SheetReconciliationPanel";

export function SheetReconciliationInboxExtras(context: InboxModuleContext) {
  return <SheetReconciliationPanel {...context} />;
}
