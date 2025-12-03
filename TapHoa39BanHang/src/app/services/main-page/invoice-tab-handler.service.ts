import { Injectable } from '@angular/core';
import { InvoiceTab } from '../../models/invoice.model';
import { CartItem } from '../../models/cart-item.model';
import { Customer } from '../../models/customer.model';

@Injectable({
  providedIn: 'root'
})
export class InvoiceTabHandlerService {
  private readonly DEFAULT_INVOICE_VAT = 1.08;

  /**
   * Create a new invoice tab
   */
  createNewInvoiceTab(tabNumber: number, name?: string): InvoiceTab {
    return {
      name: name || `Hóa đơn ${tabNumber}`,
      cartItems: [],
      customer: null,
      customerPaid: 0,
      invoiceVAT: this.DEFAULT_INVOICE_VAT,
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
   * Create a new order tab
   */
  createNewOrderTab(tabNumber: number, name?: string): InvoiceTab {
    return {
   name: name || `Hóa đơn ${tabNumber}`,
      cartItems: [],
      customer: null,
      customerPaid: 0,
      invoiceVAT: this.DEFAULT_INVOICE_VAT,
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
   * Get tab display name
   */
  getTabDisplayName(invoice: InvoiceTab, index: number, prefix: string = 'Hóa đơn'): string {
    return invoice.name || `${prefix} ${index + 1}`;
  }

  /**
   * Check if tab name should be compacted
   */
  isTabCompact(tabName: string): boolean {
    return tabName.length > 15;
  }

  /**
   * Get display label for tab (show only numbers if compact mode)
   */
  getTabDisplayLabel(fullName: string, showNumbersOnly: boolean): string {
    if (showNumbersOnly) {
      const match = fullName.match(/\d+/);
      return match ? match[0] : fullName;
    }
    return fullName;
  }

  /**
   * Calculate tab font size based on number of tabs
   */
  calculateTabFontSize(tabCount: number, defaultSize: number = 12, minSize: number = 7): number {
    if (tabCount <= 5) return defaultSize;
    if (tabCount <= 10) return defaultSize - 1;
    if (tabCount <= 15) return defaultSize - 2;
    return Math.max(minSize, defaultSize - 3);
  }

  /**
   * Determine if numbers-only mode should be enabled
   */
  shouldShowNumbersOnly(tabCount: number): boolean {
    return tabCount > 20;
  }

  /**
   * Sync cart items to invoice tab
   */
  syncCartToInvoice(invoice: InvoiceTab, cartItems: CartItem[]): InvoiceTab {
    return {
      ...invoice,
      cartItems: [...cartItems]
    };
  }

  /**
   * Update invoice customer
   */
  updateInvoiceCustomer(invoice: InvoiceTab, customer: Customer | null): InvoiceTab {
    return {
      ...invoice,
      customer: customer ? { ...customer } : null
    };
  }

  /**
   * Update invoice payment amount
   */
  updateInvoicePayment(invoice: InvoiceTab, amount: number): InvoiceTab {
    return {
      ...invoice,
      customerPaid: amount
    };
  }

  /**
   * Update invoice VAT
   */
  updateInvoiceVAT(invoice: InvoiceTab, vatPercent: number): InvoiceTab {
    return {
      ...invoice,
      invoiceVAT: 1 + (vatPercent / 100)
    };
  }

  /**
   * Update invoice discount
   */
  updateInvoiceDiscount(invoice: InvoiceTab, discount: number): InvoiceTab {
    return {
      ...invoice,
      discountAmount: discount
    };
  }

  /**
   * Check if invoice can be closed
   */
  canCloseTab(invoices: InvoiceTab[], tabIndex: number): boolean {
    // Can't close if it's the only tab
    if (invoices.length <= 1) {
      return false;
    }

    // Can close if there are no items in the cart
    const invoice = invoices[tabIndex];
    return !invoice || invoice.cartItems.length === 0;
  }

  /**
   * Get next active tab index after closing a tab
   */
  getNextActiveTabIndex(currentIndex: number, totalTabs: number): number {
    if (currentIndex >= totalTabs - 1) {
      return totalTabs - 2; // Move to previous tab if closing last tab
    }
    return currentIndex; // Stay at same index (which will now show next tab)
  }
}
