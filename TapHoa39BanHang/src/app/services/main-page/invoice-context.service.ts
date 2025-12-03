import { Injectable } from '@angular/core';
import { InvoiceTab } from '../../models/invoice.model';
import { CartItem } from '../../models/cart-item.model';
import { Customer } from '../../models/customer.model';

/**
 * InvoiceContextService
 * Manages invoice context operations including VAT, syncing, and state management
 */
@Injectable({
  providedIn: 'root'
})
export class InvoiceContextService {

  /**
   * Get active invoice context based on mode
   */
  getActiveInvoiceContext(config: {
    isOrderMode: boolean;
    orders: InvoiceTab[];
    activeOrderTabIndex: number;
    invoices: InvoiceTab[];
    activeTabIndex: number;
  }): InvoiceTab | null {
    if (config.isOrderMode) {
      return config.orders[config.activeOrderTabIndex] || null;
    }
    return config.invoices[config.activeTabIndex] || null;
  }

  /**
   * Ensure invoice has valid VAT value
   */
  ensureInvoiceVat(invoice: InvoiceTab | null | undefined, defaultVat: number): number {
    if (!invoice) {
      return defaultVat;
    }
    if (!invoice.invoiceVAT || invoice.invoiceVAT <= 0) {
      invoice.invoiceVAT = defaultVat;
    }
    return invoice.invoiceVAT;
  }

  /**
   * Calculate VAT percent from multiplier
   */
  calculateVatPercent(vatMultiplier: number): number {
    return Number(((vatMultiplier - 1) * 100).toFixed(2));
  }

  /**
   * Calculate VAT multiplier from percent
   */
  calculateVatMultiplier(vatPercent: number): number {
    return 1 + vatPercent / 100;
  }

  /**
   * Sync cart with active invoice
   */
  syncCartWithInvoice(config: {
    invoice: InvoiceTab | null;
    cartItems: CartItem[];
    discountAmount: number;
    selectedCustomer: Customer | null;
    updateInvoiceTotalPrice: () => void;
  }): void {
    const { invoice, cartItems, discountAmount, selectedCustomer, updateInvoiceTotalPrice } = config;

    if (!invoice) return;

    invoice.cartItems = [...cartItems];
    invoice.discountAmount = discountAmount;
    invoice.customer = selectedCustomer;
    updateInvoiceTotalPrice();
  }

  /**
   * Update invoice VAT and sync percent
   */
  updateInvoiceVat(config: {
    invoice: InvoiceTab | null;
    vatPercent: number;
  }): { success: boolean; newMultiplier?: number } {
    const { invoice, vatPercent } = config;

    if (!invoice) {
      return { success: false };
    }

    const safeValue = Number.isFinite(vatPercent) && vatPercent >= 0 ? vatPercent : 0;
    const multiplier = this.calculateVatMultiplier(safeValue);

    invoice.invoiceVAT = multiplier;

    return {
      success: true,
      newMultiplier: multiplier
    };
  }

  /**
   * Set customer paid amount for invoice
   */
  setCustomerPaidAmount(config: {
    invoice: InvoiceTab | null;
    amount: number;
    markAsManuallySet?: boolean;
  }): boolean {
    const { invoice, amount, markAsManuallySet = true } = config;

    if (!invoice) {
      return false;
    }

    invoice.customerPaid = amount;
    if (markAsManuallySet) {
      (invoice as any).customerPaidManuallySet = true;
    }

    return true;
  }

  /**
   * Check if invoice customer paid was manually set
   */
  isCustomerPaidManuallySet(invoice: InvoiceTab | null): boolean {
    if (!invoice) return false;
    return (invoice as any).customerPaidManuallySet === true;
  }

  /**
   * Calculate total price with discount
   */
  calculateTotalPriceWithDiscount(invoice: InvoiceTab): number {
    return invoice.totalPrice - (invoice.discountAmount || 0);
  }

  /**
   * Update invoice with customer
   */
  updateInvoiceCustomer(invoice: InvoiceTab | null, customer: Customer | null): boolean {
    if (!invoice) return false;

    invoice.customer = customer ? { ...customer } : null;
    return true;
  }
}
