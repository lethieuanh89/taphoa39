import { Injectable } from '@angular/core';
import { CartItem } from '../models/cart-item.model';
import { InvoiceTab } from '../models/invoice.model';
@Injectable({
  providedIn: 'root'
})
export class LocalStorageService {

  constructor() { }
   public setItem<T>(key: string, value: T): void {
    try {
      const serializedValue = JSON.stringify(value);
      localStorage.setItem(key, serializedValue);
    } catch (error) {
      console.error(`Error saving to localStorage with key "${key}":`, error);
    }
  }

  public getItem<T>(key: string): T | null {
    try {
      const item = localStorage.getItem(key);
      if (item === null) {
        return null;
      }
      return JSON.parse(item) as T;
    } catch (error) {
      console.error(`Error getting from localStorage with key "${key}":`, error);
      return null;
    }
  }

  private removeItem(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.error(`Error removing from localStorage with key "${key}":`, error);
    }
  }

  private hasItem(key: string): boolean {
    return localStorage.getItem(key) !== null;
  }

  // CartItems specific methods
  saveCartItems(cartItems: CartItem[], activeTabIndex = 0): void {
    const key = `cartItems_tab_${activeTabIndex}`;
    this.setItem(key, cartItems);
  }

  getCartItems(activeTabIndex = 0): CartItem[] {
    const key = `cartItems_tab_${activeTabIndex}`;
    const cartItems = this.getItem<CartItem[]>(key);
    return cartItems || [];
  }

  clearCartItems(activeTabIndex = 0): void {
    const key = `cartItems_tab_${activeTabIndex}`;
    this.removeItem(key);
  }

  hasCartItems(activeTabIndex = 0): boolean {
    const key = `cartItems_tab_${activeTabIndex}`;
    return this.hasItem(key);
  }

  // Invoice tabs specific methods
  saveInvoiceTabs(invoices: InvoiceTab[]): void {
    this.setItem('invoice_tabs', invoices);
  }

  getInvoiceTabs(): InvoiceTab[] {
    const invoices = this.getItem<InvoiceTab[]>('invoice_tabs');
    return invoices || [];
  }

  clearInvoiceTabs(): void {
    this.removeItem('invoice_tabs');
  }

  // Active tab index
  saveActiveTabIndex(index: number): void {
    this.setItem('active_tab_index', index);
  }

  getActiveTabIndex(): number {
    const index = this.getItem<number>('active_tab_index');
    return index !== null ? index : 0;
  }

  clearActiveTabIndex(): void {
    this.removeItem('active_tab_index');
  }

  // Discount amount
  saveDiscountAmount(discountAmount: number, activeTabIndex = 0): void {
    const key = `discount_amount_tab_${activeTabIndex}`;
    this.setItem(key, discountAmount);
  }

  getDiscountAmount(activeTabIndex = 0): number {
    const key = `discount_amount_tab_${activeTabIndex}`;
    const discount = this.getItem<number>(key);
    return discount !== null ? discount : 0;
  }

  clearDiscountAmount(activeTabIndex = 0): void {
    const key = `discount_amount_tab_${activeTabIndex}`;
    this.removeItem(key);
  }

  // Selected customer
  saveSelectedCustomer(customer: any, activeTabIndex = 0): void {
    const key = `selected_customer_tab_${activeTabIndex}`;
    this.setItem(key, customer);
  }

  getSelectedCustomer(activeTabIndex = 0): any {
    const key = `selected_customer_tab_${activeTabIndex}`;
    return this.getItem(key);
  }

  clearSelectedCustomer(activeTabIndex = 0): void {
    const key = `selected_customer_tab_${activeTabIndex}`;
    this.removeItem(key);
  }

  // Invoice note
  saveInvoiceNote(note: string, activeTabIndex = 0): void {
    const key = `invoice_note_tab_${activeTabIndex}`;
    this.setItem(key, note);
  }

  getInvoiceNote(activeTabIndex = 0): string {
    const key = `invoice_note_tab_${activeTabIndex}`;
    const note = this.getItem<string>(key);
    return note || '';
  }

  clearInvoiceNote(activeTabIndex = 0): void {
    const key = `invoice_note_tab_${activeTabIndex}`;
    this.removeItem(key);
  }

  // Clear all data for a specific tab
  clearTabData(activeTabIndex: number): void {
    this.clearCartItems(activeTabIndex);
    this.clearDiscountAmount(activeTabIndex);
    this.clearSelectedCustomer(activeTabIndex);
    this.clearInvoiceNote(activeTabIndex);
    this.clearInvoiceTabs()
  }

  // Clear all localStorage data
  // clearAllData(): void {
  //   try {
  //     // Get all keys that start with our prefixes
  //     const keysToRemove: string[] = [];
  //     for (let i = 0; i < localStorage.length; i++) {
  //       const key = localStorage.key(i);
  //       if (key && (
  //         key.startsWith('cartItems_tab_') ||
  //         key.startsWith('discount_amount_tab_') ||
  //         key.startsWith('selected_customer_tab_') ||
  //         key.startsWith('invoice_note_tab_') ||
  //          key.startsWith('grouped_') ||
  //           key.startsWith('search_') ||
  //            key.startsWith('edited_products_') ||
  //         key === 'invoice_tabs' ||
  //         key === 'active_tab_index'
  //       )) {
  //         keysToRemove.push(key);
  //       }
  //     }
      
  //     // Remove all identified keys
  //     keysToRemove.forEach(key => localStorage.removeItem(key));
  //   } catch (error) {
  //     console.error('Error clearing all localStorage data:', error);
  //   }
  // }

  // Utility method to get localStorage size (for debugging)
  getStorageSize(): string {
    let total = 0;
    for (const key in localStorage) {
      if (localStorage.hasOwnProperty(key)) {
        total += localStorage[key].length + key.length;
      }
    }
    return (total / 1024).toFixed(2) + ' KB';
  }

  // Method to check if localStorage is available
  isStorageAvailable(): boolean {
    try {
      const test = '__localStorage_test__';
      localStorage.setItem(test, test);
      localStorage.removeItem(test);
      return true;
    } catch (error) {
      return false;
    }
  }
}
