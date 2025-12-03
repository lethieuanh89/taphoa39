import { Injectable } from '@angular/core';
import { InvoiceTab } from '../../models/invoice.model';

/**
 * InvoiceTabOperationsService
 * Handles invoice tab creation, removal, and management operations
 */
@Injectable({
  providedIn: 'root'
})
export class InvoiceTabOperationsService {

  /**
   * Create a new invoice tab with default values
   */
  createInvoiceTab(config: {
    tabCounter: number;
    defaultVAT: number;
    invoiceNote?: string;
  }): InvoiceTab {
    const newId = Date.now().toString();
    const newTab: InvoiceTab = {
      id: 'HD' + newId,
      name: 'Hóa đơn ' + config.tabCounter,
      cartItems: [],
      createdDate: '',
      totalPrice: 0,
      discountAmount: 0,
      customer: null,
      totalQuantity: 0,
      debt: 0,
      note: config.invoiceNote || '',
      customerPaid: 0,
      totalCost: 0,
      invoiceVAT: config.defaultVAT
    };

    // Set custom property
    (newTab as any).customerPaidManuallySet = false;

    return newTab;
  }

  /**
   * Create a new order tab with default values
   */
  createOrderTab(config: {
    tabCounter: number;
    defaultVAT: number;
    invoiceNote?: string;
  }): InvoiceTab {
    const newId = Date.now().toString();
    const newTab: InvoiceTab = {
      id: 'DH' + newId,
      name: 'Đơn hàng ' + config.tabCounter,
      cartItems: [],
      createdDate: '',
      totalPrice: 0,
      discountAmount: 0,
      customer: null,
      totalQuantity: 0,
      debt: 0,
      note: config.invoiceNote || '',
      customerPaid: 0,
      totalCost: 0,
      invoiceVAT: config.defaultVAT
    };

    (newTab as any).customerPaidManuallySet = false;

    return newTab;
  }

  /**
   * Check if tab has cart items
   */
  hasCartItems(tab: InvoiceTab | null | undefined): boolean {
    return !!tab && Array.isArray(tab.cartItems) && tab.cartItems.length > 0;
  }

  /**
   * Reset a tab to default state
   */
  resetTab(tab: InvoiceTab, tabNumber: number): InvoiceTab {
    tab.name = 'Hóa đơn ' + tabNumber;
    tab.id = 'HD' + Date.now().toString();
    tab.cartItems = [];
    tab.customerPaid = 0;
    tab.totalPrice = 0;
    tab.totalQuantity = 0;
    tab.totalCost = 0;
    tab.discountAmount = 0;
    tab.customer = null;
    tab.note = '';
    tab.debt = 0;
    (tab as any).customerPaidManuallySet = false;
    return tab;
  }

  /**
   * Calculate next active tab index after removing a tab
   */
  getNextActiveTabIndex(config: {
    currentIndex: number;
    removedIndex: number;
    totalTabs: number;
  }): number {
    const { currentIndex, removedIndex, totalTabs } = config;

    // If removing the current tab
    if (currentIndex === removedIndex) {
      // If it's the last tab, go to previous
      if (currentIndex >= totalTabs - 1) {
        return Math.max(0, totalTabs - 2);
      }
      // Otherwise keep the same index (which will now point to next tab)
      return currentIndex;
    }

    // If removing a tab before current, shift index back
    if (removedIndex < currentIndex) {
      return currentIndex - 1;
    }

    // If removing a tab after current, index stays the same
    return currentIndex;
  }

  /**
   * Get reset state for component after adding new tab
   */
  getResetStateAfterNewTab(): {
    change: number;
    discountAmount: number;
    selectedCustomer: null;
    customerSearchTerm: string;
    formattedCustomerPaid: string;
    invoiceNote: string;
    isOrderMode: boolean;
  } {
    return {
      change: 0,
      discountAmount: 0,
      selectedCustomer: null,
      customerSearchTerm: '',
      formattedCustomerPaid: '0',
      invoiceNote: '',
      isOrderMode: false
    };
  }

  /**
   * Handle tab removal logic
   * Returns updated state
   */
  handleTabRemoval(config: {
    invoices: InvoiceTab[];
    removedIndex: number;
    currentActiveIndex: number;
  }): {
    shouldReset: boolean;
    newActiveIndex: number;
    newTabCounter?: number;
  } {
    const { invoices, removedIndex } = config;

    // If only one tab remains, reset it
    if (invoices.length === 1) {
      return {
        shouldReset: true,
        newActiveIndex: 0,
        newTabCounter: 2
      };
    }

    // Calculate new active index
    const newActiveIndex = this.getNextActiveTabIndex({
      currentIndex: config.currentActiveIndex,
      removedIndex: removedIndex,
      totalTabs: invoices.length
    });

    return {
      shouldReset: false,
      newActiveIndex
    };
  }
}
