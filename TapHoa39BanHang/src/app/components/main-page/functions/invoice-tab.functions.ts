import { InvoiceTab } from '../../../models/invoice.model';

/**
 * Get invoice tab display name
 * Also normalizes the tab name (trims and sets fallback if needed)
 */
export function getInvoiceTabName(
  invoice: InvoiceTab | null | undefined,
  index: number
): string {
  return normalizeTabName(invoice, index, false);
}

/**
 * Get order tab display name
 * Also normalizes the tab name (trims and sets fallback if needed)
 */
export function getOrderTabName(
  order: InvoiceTab | null | undefined,
  index: number
): string {
  return normalizeTabName(order, index, true);
}

/**
 * Normalize tab name - trims whitespace and sets fallback if empty
 */
function normalizeTabName(
  tab: InvoiceTab | null | undefined,
  index: number,
  isOrder: boolean
): string {
  if (!tab) {
    return `${isOrder ? 'Đơn đặt hàng' : 'Hóa đơn'} ${index + 1}`;
  }

  const rawName = typeof tab.name === 'string' ? tab.name.trim() : '';
  if (rawName.length > 0) {
    if (tab.name !== rawName) {
      tab.name = rawName;
    }
    return rawName;
  }

  const fallback = `${isOrder ? 'Đơn đặt hàng' : 'Hóa đơn'} ${index + 1}`;
  tab.name = fallback;
  return fallback;
}

/**
 * Get tab display label (short or full)
 * If showNumbersOnly is true, extracts the trailing number from tab name
 */
export function getTabDisplayLabel(
  tabName: string,
  showNumbersOnly: boolean
): string {
  if (!tabName) {
    return '';
  }

  if (!showNumbersOnly) {
    return getShortTabTitle(tabName);
  }

  // Extract trailing number from tab name
  const trailingNumberMatch = tabName.match(/(\d+)(?!.*\d)/);
  if (trailingNumberMatch) {
    return trailingNumberMatch[1];
  }

  return getShortTabTitle(tabName);
}

/**
 * Get short tab title
 * Shortens "Hóa đơn" to "HĐ" and "Đơn đặt hàng"/"Đơn hàng" to "ĐĐH"/"ĐH" when there are many tabs
 */
export function getShortTabTitle(tabName: string, invoiceCount: number = 0): string {
  const trimmedName = tabName.trim();
  if (!trimmedName) {
    return tabName;
  }

  const hoaDonPattern = /^Hóa\s*đơn/i;
  if (hoaDonPattern.test(trimmedName)) {
    if (invoiceCount > 5) {
      return trimmedName.replace(hoaDonPattern, 'HĐ').replace(/\s{2,}/g, ' ').trim();
    }
    return trimmedName;
  }

  const replacementRules: Array<{ pattern: RegExp; replacement: string }> = [
    { pattern: /^Đơn\s*đặt\s*hàng/i, replacement: 'ĐĐH' },
    { pattern: /^Đơn\s*hàng/i, replacement: 'ĐH' }
  ];

  for (const rule of replacementRules) {
    if (rule.pattern.test(trimmedName)) {
      return trimmedName.replace(rule.pattern, rule.replacement).replace(/\s{2,}/g, ' ').trim();
    }
  }

  return trimmedName;
}

/**
 * Check if tab name is compact
 */
export function isTabCompact(tabName: string): boolean {
  return tabName.length > 15;
}

/**
 * Calculate tab font size based on tab count
 */
export function calculateTabFontSize(
  tabCount: number,
  defaultSize: number = 12,
  minSize: number = 7
): number {
  if (tabCount <= 5) return defaultSize;
  if (tabCount <= 10) return defaultSize - 1;
  if (tabCount <= 15) return defaultSize - 2;
  if (tabCount <= 20) return defaultSize - 3;
  return Math.max(minSize, defaultSize - 4);
}

/**
 * Determine if should show numbers only mode
 */
export function shouldShowInvoiceTabNumbersOnly(tabCount: number): boolean {
  return tabCount > 20;
}

/**
 * Check if should show close icon for tab
 */
export function shouldShowCloseIcon(
  invoices: InvoiceTab[],
  index: number
): boolean {
  return invoices.length > 1;
}

/**
 * Check if invoice has cart items
 */
export function invoiceHasCartItems(
  invoice: InvoiceTab | null | undefined
): boolean {
  return !!invoice && Array.isArray(invoice.cartItems) && invoice.cartItems.length > 0;
}

/**
 * Get next active tab index after closing a tab
 */
export function getNextActiveTabIndex(
  currentActiveIndex: number,
  removedIndex: number,
  totalTabs: number
): number {
  if (totalTabs <= 1) return 0;

  // If removing a tab before the active tab
  if (removedIndex < currentActiveIndex) {
    return currentActiveIndex - 1;
  }

  // If removing the active tab
  if (removedIndex === currentActiveIndex) {
    // If it's the last tab, move to previous
    if (currentActiveIndex >= totalTabs - 1) {
      return totalTabs - 2;
    }
    // Otherwise stay at same index
    return currentActiveIndex;
  }

  // If removing a tab after the active tab
  return currentActiveIndex;
}

/**
 * Sync invoice VAT percent to multiplier
 */
export function invoiceVatPercentToMultiplier(percent: number): number {
  return 1 + (percent / 100);
}

/**
 * Sync invoice VAT multiplier to percent
 */
export function invoiceVatMultiplierToPercent(multiplier: number): number {
  return (multiplier - 1) * 100;
}

/**
 * Create empty invoice tab
 */
export function createEmptyInvoiceTab(
  tabNumber: number,
  defaultVAT: number = 1.08
): Partial<InvoiceTab> {
  return {
    name: `Hóa đơn ${tabNumber}`,
    cartItems: [],
    customer: null,
    customerPaid: 0,
    invoiceVAT: defaultVAT,
    createdDate: new Date().toISOString(),
    discountAmount: 0,
    id: '',
    totalPrice: 0,
    totalQuantity: 0,
    debt: 0,
    note: '',
    totalCost: 0
  };
}

/**
 * Create empty order tab
 */
export function createEmptyOrderTab(
  tabNumber: number,
  defaultVAT: number = 1.08
): Partial<InvoiceTab> {
  return {
    name: `Đơn hàng ${tabNumber}`,
    cartItems: [],
    customer: null,
    customerPaid: 0,
    invoiceVAT: defaultVAT,
    createdDate: new Date().toISOString(),
    discountAmount: 0,
    id: '',
    totalPrice: 0,
    totalQuantity: 0,
    debt: 0,
    note: '',
    totalCost: 0
  };
}
