import { Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { InvoiceTab } from '../../models/invoice.model';
import { CartItem } from '../../models/cart-item.model';
import { Customer } from '../../models/customer.model';

/**
 * Service orchestrator for checkout operations
 * Handles the complex checkout flow including validation, invoice creation,
 * customer debt updates, printing, and inventory management
 */
@Injectable({
  providedIn: 'root'
})
export class CheckoutOrchestratorService {

  constructor(
    private dialog: MatDialog,
    private snackBar: MatSnackBar
  ) {}

  /**
   * Validate cart is not empty
   */
  validateCartNotEmpty(cartItems: CartItem[]): { valid: boolean; message?: string } {
    if (cartItems.length === 0) {
      return { valid: false, message: 'Giỏ hàng trống!' };
    }
    return { valid: true };
  }

  /**
   * Validate invoice has cart items
   */
  validateInvoiceHasItems(invoice: InvoiceTab | null | undefined): { valid: boolean; message?: string } {
    if (!invoice || !invoice.cartItems || invoice.cartItems.length === 0) {
      return { valid: false, message: 'Giỏ hàng trống!' };
    }
    return { valid: true };
  }

  /**
   * Validate customer is provided when there's debt
   */
  validateCustomerForDebt(changeAmount: number, selectedCustomer: Customer | null): { valid: boolean; message?: string } {
    if (changeAmount < 0 && !selectedCustomer) {
      return { valid: false, message: 'CẦN NHẬP KHÁCH HÀNG ĐỂ QUẢN LÝ CÔNG NỢ' };
    }
    return { valid: true };
  }

  /**
   * Create invoice from current invoice data
   */
  createInvoiceForCheckout(config: {
    currentInvoice: InvoiceTab;
    vnNow: string;
    changeAmount: number;
  }): InvoiceTab {
    const { currentInvoice, vnNow, changeAmount } = config;

    return {
      ...currentInvoice,
      createdDate: vnNow,
      totalPrice: currentInvoice.totalPrice - currentInvoice.discountAmount,
      customer: currentInvoice.customer ? { ...currentInvoice.customer } : null,
      debt: changeAmount >= 0 ? 0 : changeAmount,
      discountAmount: currentInvoice.discountAmount,
      note: currentInvoice.note,
      onHandSynced: false,
      invoiceVAT: currentInvoice.invoiceVAT
    };
  }

  /**
   * Calculate updated customer debt
   */
  calculateCustomerDebt(config: {
    customer: Customer;
    changeAmount: number;
    paymentMode: 'cash' | 'debt';
  }): number {
    const { customer, changeAmount, paymentMode } = config;

    if (paymentMode !== 'debt' || !customer.Id) {
      return customer.Debt;
    }

    let newDebt = customer.Debt;

    if (changeAmount < 0) {
      // Increase debt
      newDebt += Math.abs(changeAmount);
    } else {
      // Decrease debt
      newDebt -= changeAmount;
      if (newDebt < 0) newDebt = 0;
    }

    return newDebt;
  }

  /**
   * Get reset state for UI after checkout
   */
  getResetStateAfterCheckout(): {
    discountAmount: number;
    change: number;
    formattedCustomerPaid: string;
    invoiceNote: string;
    searchTerm: string;
    filteredProducts: any[];
    showDropdown: boolean;
    activeIndex: number;
    lastCartItemsLength: number;
  } {
    return {
      discountAmount: 0,
      change: 0,
      formattedCustomerPaid: '0',
      invoiceNote: '',
      searchTerm: '',
      filteredProducts: [],
      showDropdown: false,
      activeIndex: -1,
      lastCartItemsLength: 0
    };
  }

  /**
   * Determine next active tab index after removing current tab
   */
  getNextTabIndexAfterCheckout(config: {
    currentIndex: number;
    totalInvoices: number;
  }): number {
    const { currentIndex, totalInvoices } = config;
    return Math.min(currentIndex, totalInvoices - 1);
  }

  /**
   * Check if should create new tab after checkout
   */
  shouldCreateNewTab(invoicesLength: number): boolean {
    return invoicesLength === 0;
  }
}
