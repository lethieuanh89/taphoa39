import { Injectable } from '@angular/core';
import { InvoiceTab } from '../../models/invoice.model';
import { CartItem } from '../../models/cart-item.model';
import { Customer } from '../../models/customer.model';
import { LocalStorageService } from '../local-storage.service';

/**
 * LocalStorageOrchestratorService
 * Handles complex localStorage operations for main-page component
 */
@Injectable({
  providedIn: 'root'
})
export class LocalStorageOrchestratorService {

  constructor(private localStorageService: LocalStorageService) {}

  /**
   * Normalize invoice with default VAT value
   */
  private normalizeInvoiceWithVat(
    invoice: InvoiceTab | null | undefined,
    defaultVat: number
  ): InvoiceTab | null | undefined {
    if (!invoice) {
      return invoice;
    }

    const invoiceWithVat: InvoiceTab = {
      ...invoice,
      invoiceVAT: invoice.invoiceVAT && invoice.invoiceVAT > 0 ? invoice.invoiceVAT : defaultVat
    };

    const hasItems = Array.isArray(invoice.cartItems) && invoice.cartItems.length > 0;
    if (hasItems) {
      return invoiceWithVat;
    }

    return {
      ...invoiceWithVat,
      cartItems: [],
      createdDate: ''
    } as InvoiceTab;
  }

  /**
   * Calculate highest invoice number from invoice names
   */
  private calculateHighestInvoiceNumber(invoices: InvoiceTab[]): number {
    return invoices.reduce((max, inv, idx) => {
      if (!inv || typeof inv.name !== 'string') {
        return Math.max(max, idx + 1);
      }

      const match = inv.name.match(/Hóa\s*đơn\s*(\d+)/i);
      if (match) {
        const parsed = Number(match[1]);
        if (!Number.isNaN(parsed)) {
          return Math.max(max, parsed);
        }
      }

      return Math.max(max, idx + 1);
    }, 0);
  }

  /**
   * Load and normalize invoices from localStorage
   */
  loadInvoices(defaultVat: number): {
    invoices: InvoiceTab[];
    tabCounter: number;
  } {
    const savedInvoices = this.localStorageService.getInvoiceTabs();

    if (savedInvoices.length === 0) {
      return {
        invoices: [],
        tabCounter: 1
      };
    }

    const normalizedInvoices = savedInvoices
      .map(inv => this.normalizeInvoiceWithVat(inv, defaultVat))
      .filter((inv): inv is InvoiceTab => inv !== null && inv !== undefined);

    const highestInvoiceNumber = this.calculateHighestInvoiceNumber(normalizedInvoices);
    const tabCounter = Math.max(highestInvoiceNumber + 1, normalizedInvoices.length + 1);

    return {
      invoices: normalizedInvoices,
      tabCounter
    };
  }

  /**
   * Load active tab index and ensure it's within bounds
   */
  loadActiveTabIndex(invoicesLength: number): number {
    const activeTabIndex = this.localStorageService.getActiveTabIndex();
    return activeTabIndex >= invoicesLength ? 0 : activeTabIndex;
  }

  /**
   * Load tab-specific data for the active tab
   */
  loadTabSpecificData(activeTabIndex: number): {
    cartItems: CartItem[];
    discountAmount: number;
    selectedCustomer: Customer | null;
    invoiceNote: string;
    customerSearchTerm: string;
  } {
    const cartItems = this.localStorageService.getCartItems(activeTabIndex);
    const discountAmount = this.localStorageService.getDiscountAmount(activeTabIndex);
    const selectedCustomer = this.localStorageService.getSelectedCustomer(activeTabIndex);
    const invoiceNote = this.localStorageService.getInvoiceNote(activeTabIndex);

    // Generate customer search term if customer exists
    let customerSearchTerm = '';
    if (selectedCustomer) {
      customerSearchTerm = selectedCustomer.Name + ' - ' + (selectedCustomer.ContactNumber || '');
    }

    return {
      cartItems,
      discountAmount,
      selectedCustomer,
      invoiceNote,
      customerSearchTerm
    };
  }

  /**
   * Complete load operation - loads all data from localStorage
   */
  loadAllData(config: {
    defaultVat: number;
    normalizeCustomer: (customer: Customer | null) => Customer | null;
    syncInvoiceVatPercent: () => void;
    scheduleTabDisplayUpdate: () => void;
  }): {
    invoices: InvoiceTab[];
    tabCounter: number;
    activeTabIndex: number;
    cartItems: CartItem[];
    discountAmount: number;
    selectedCustomer: Customer | null;
    invoiceNote: string;
    customerSearchTerm: string;
  } {
    // Check if localStorage is available
    if (!this.localStorageService.isStorageAvailable()) {
      console.warn('localStorage is not available');
      return {
        invoices: [],
        tabCounter: 1,
        activeTabIndex: 0,
        cartItems: [],
        discountAmount: 0,
        selectedCustomer: null,
        invoiceNote: '',
        customerSearchTerm: ''
      };
    }

    // Load invoices
    const { invoices, tabCounter } = this.loadInvoices(config.defaultVat);

    // Load active tab index
    const activeTabIndex = this.loadActiveTabIndex(invoices.length);

    // Load tab-specific data
    let tabData = {
      cartItems: [] as CartItem[],
      discountAmount: 0,
      selectedCustomer: null as Customer | null,
      invoiceNote: '',
      customerSearchTerm: ''
    };

    if (invoices.length > 0) {
      tabData = this.loadTabSpecificData(activeTabIndex);

      // Sync cart items with the active invoice
      if (invoices[activeTabIndex]) {
        invoices[activeTabIndex].cartItems = [...tabData.cartItems];
      }

      // Normalize customer
      if (tabData.selectedCustomer) {
        tabData.selectedCustomer = config.normalizeCustomer(tabData.selectedCustomer);
        if (tabData.selectedCustomer) {
          tabData.customerSearchTerm = tabData.selectedCustomer.Name + ' - ' + (tabData.selectedCustomer.ContactNumber || '');
        }
      }
    }

    // Sync invoice VAT and update tab display
    config.syncInvoiceVatPercent();
    config.scheduleTabDisplayUpdate();

    return {
      invoices,
      tabCounter,
      activeTabIndex,
      ...tabData
    };
  }

  /**
   * Save all data to localStorage
   */
  saveAllData(data: {
    cartItems: CartItem[];
    invoices: InvoiceTab[];
    activeTabIndex: number;
    discountAmount: number;
    selectedCustomer: Customer | null;
    invoiceNote: string;
  }): void {
    if (!this.localStorageService.isStorageAvailable()) {
      return;
    }

    // Save cart items for current tab
    this.localStorageService.saveCartItems(data.cartItems, data.activeTabIndex);

    // Save invoice tabs
    this.localStorageService.saveInvoiceTabs(data.invoices);

    // Save active tab index
    this.localStorageService.saveActiveTabIndex(data.activeTabIndex);

    // Save other tab-specific data
    this.localStorageService.saveDiscountAmount(data.discountAmount, data.activeTabIndex);
    this.localStorageService.saveSelectedCustomer(data.selectedCustomer, data.activeTabIndex);
    this.localStorageService.saveInvoiceNote(data.invoiceNote, data.activeTabIndex);
  }
}
