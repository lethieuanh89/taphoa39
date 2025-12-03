import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { InvoiceTab } from '../../models/invoice.model';
import { CartItem } from '../../models/cart-item.model';

/**
 * Service quản lý state của invoices và orders
 * Tách logic quản lý tabs ra khỏi component
 */
@Injectable({
  providedIn: 'root'
})
export class InvoiceStateService {
  private invoicesSubject = new BehaviorSubject<InvoiceTab[]>([]);
  public invoices$ = this.invoicesSubject.asObservable();

  private ordersSubject = new BehaviorSubject<InvoiceTab[]>([]);
  public orders$ = this.ordersSubject.asObservable();

  private activeTabIndexSubject = new BehaviorSubject<number>(0);
  public activeTabIndex$ = this.activeTabIndexSubject.asObservable();

  private activeOrderTabIndexSubject = new BehaviorSubject<number>(0);
  public activeOrderTabIndex$ = this.activeOrderTabIndexSubject.asObservable();

  private tabCounterSubject = new BehaviorSubject<number>(1);

  constructor() {
    // Khởi tạo invoice tab đầu tiên
    this.addInvoiceTab();
  }

  /**
   * Lấy danh sách invoices
   */
  getInvoices(): InvoiceTab[] {
    return this.invoicesSubject.value;
  }

  /**
   * Set danh sách invoices
   */
  setInvoices(invoices: InvoiceTab[]): void {
    this.invoicesSubject.next(invoices);
  }

  /**
   * Lấy danh sách orders
   */
  getOrders(): InvoiceTab[] {
    return this.ordersSubject.value;
  }

  /**
   * Set danh sách orders
   */
  setOrders(orders: InvoiceTab[]): void {
    this.ordersSubject.next(orders);
  }

  /**
   * Lấy active tab index
   */
  getActiveTabIndex(): number {
    return this.activeTabIndexSubject.value;
  }

  /**
   * Set active tab index
   */
  setActiveTabIndex(index: number): void {
    this.activeTabIndexSubject.next(index);
  }

  /**
   * Lấy active order tab index
   */
  getActiveOrderTabIndex(): number {
    return this.activeOrderTabIndexSubject.value;
  }

  /**
   * Set active order tab index
   */
  setActiveOrderTabIndex(index: number): void {
    this.activeOrderTabIndexSubject.next(index);
  }

  /**
   * Lấy invoice đang active
   */
  getSelectedInvoice(): InvoiceTab | null {
    const invoices = this.getInvoices();
    const index = this.getActiveTabIndex();
    return invoices[index] || null;
  }

  /**
   * Lấy order đang active
   */
  getSelectedOrder(): InvoiceTab | null {
    const orders = this.getOrders();
    const index = this.getActiveOrderTabIndex();
    return orders[index] || null;
  }

  /**
   * Thêm invoice tab mới
   */
  addInvoiceTab(): void {
    const currentInvoices = this.getInvoices();
    const counter = this.tabCounterSubject.value;

    const newInvoice: InvoiceTab = {
      id: `invoice-${Date.now()}`,
      name: `HD ${counter}`,
      cartItems: [],
      customer: null,
      note: '',
      discountAmount: 0,
      deliveryTime: '',
      customerPaid: 0,
      totalPrice: 0,
      totalQuantity: 0,
      debt: 0,
      totalCost: 0
    };

    currentInvoices.push(newInvoice);
    this.setInvoices([...currentInvoices]);
    this.setActiveTabIndex(currentInvoices.length - 1);
    this.tabCounterSubject.next(counter + 1);
  }

  /**
   * Thêm order tab mới
   */
  addOrderTab(): void {
    const currentOrders = this.getOrders();
    const counter = this.tabCounterSubject.value;

    const newOrder: InvoiceTab = {
      id: `order-${Date.now()}`,
      name: `ĐH ${counter}`,
      cartItems: [],
      customer: null,
      note: '',
      discountAmount: 0,
      deliveryTime: '',
      customerPaid: 0,
      totalPrice: 0,
      totalQuantity: 0,
      debt: 0,
      totalCost: 0
    };

    currentOrders.push(newOrder);
    this.setOrders([...currentOrders]);
    this.setActiveOrderTabIndex(currentOrders.length - 1);
    this.tabCounterSubject.next(counter + 1);
  }

  /**
   * Xóa invoice tab
   */
  removeInvoiceTab(index: number): void {
    const currentInvoices = this.getInvoices();
    if (currentInvoices.length <= 1) {
      console.warn('Không thể xóa tab cuối cùng');
      return;
    }

    currentInvoices.splice(index, 1);
    this.setInvoices([...currentInvoices]);

    const currentActiveIndex = this.getActiveTabIndex();
    if (index <= currentActiveIndex && currentActiveIndex > 0) {
      this.setActiveTabIndex(currentActiveIndex - 1);
    } else if (currentActiveIndex >= currentInvoices.length) {
      this.setActiveTabIndex(currentInvoices.length - 1);
    }
  }

  /**
   * Xóa order tab
   */
  removeOrderTab(index: number): void {
    const currentOrders = this.getOrders();
    if (currentOrders.length <= 1) {
      console.warn('Không thể xóa tab cuối cùng');
      return;
    }

    currentOrders.splice(index, 1);
    this.setOrders([...currentOrders]);

    const currentActiveIndex = this.getActiveOrderTabIndex();
    if (index <= currentActiveIndex && currentActiveIndex > 0) {
      this.setActiveOrderTabIndex(currentActiveIndex - 1);
    } else if (currentActiveIndex >= currentOrders.length) {
      this.setActiveOrderTabIndex(currentOrders.length - 1);
    }
  }

  /**
   * Cập nhật cart items cho invoice đang active
   */
  updateSelectedInvoiceCartItems(items: CartItem[]): void {
    const invoices = this.getInvoices();
    const index = this.getActiveTabIndex();

    if (invoices[index]) {
      invoices[index].cartItems = items;
      this.setInvoices([...invoices]);
    }
  }

  /**
   * Cập nhật cart items cho order đang active
   */
  updateSelectedOrderCartItems(items: CartItem[]): void {
    const orders = this.getOrders();
    const index = this.getActiveOrderTabIndex();

    if (orders[index]) {
      orders[index].cartItems = items;
      this.setOrders([...orders]);
    }
  }

  /**
   * Kiểm tra xem invoice có cart items không
   */
  invoiceHasCartItems(invoice: InvoiceTab | null | undefined): boolean {
    return !!invoice && Array.isArray(invoice.cartItems) && invoice.cartItems.length > 0;
  }

  /**
   * Clear tất cả tabs
   */
  clearAllTabs(): void {
    this.setInvoices([]);
    this.setOrders([]);
    this.setActiveTabIndex(0);
    this.setActiveOrderTabIndex(0);
    this.tabCounterSubject.next(1);
    // Tạo lại invoice tab đầu tiên
    this.addInvoiceTab();
  }
}
