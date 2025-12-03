import { Component, OnInit, ViewChild, ElementRef, HostListener, ViewChildren, QueryList, OnDestroy, DoCheck, AfterViewInit, ViewEncapsulation } from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { MatIconModule, } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialogModule } from '@angular/material/dialog';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatSortModule } from '@angular/material/sort';
import { MatRadioModule } from '@angular/material/radio';
import { Subscription } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { RouterModule } from '@angular/router';
import { MatFormFieldModule } from '@angular/material/form-field';
//libs
import { IndexedDBService } from '../../services/indexed-db.service';
import { firstValueFrom, Subject } from 'rxjs';
//component
import { InvoiceDetailComponent } from "../../components/invoice-detail/invoice-detail.component";
import { ConfirmPopupComponent } from '../../components/confirm-popup/confirm-popup.component';
import { InvoicesPageComponent } from '../../components/invoices-page/invoices-page.component';
import { OutOfStockDialogComponent } from '../../components/out-of-stock-dialog/out-of-stock-dialog.component';
import { OrderPageComponent } from '../../components/order-page/order-page.component';

//model
import { Product } from '../../models/product.model';
import { CartItem } from '../../models/cart-item.model';
import { InvoiceTab } from '../../models/invoice.model';
import { Customer } from '../../models/customer.model';
//services
import { CustomerService } from '../../services/customer.service';
import { PrintService } from '../../services/print.service';
import { ProductService } from '../../services/product.service';
import { GroupService } from '../../services/group.service';
import { InvoiceService } from '../../services/invoice.service';
import { OrderService } from '../../services/order.service';
import { OrderToInvoiceService } from '../../services/order-to-invoice.service';
import { KiotvietService } from '../../services/kiotviet.service';
import { LocalStorageService } from '../../services/local-storage.service';
import { ReportPageComponent } from '../report-page/report-page.component';
import { AddCustomerComponent } from '../customers-page/add-customer/add-customer.component';
import { CustomersPageComponent } from '../customers-page/customers-page.component';
import { TimeZoneService } from '../../services/time-zone.service';
import { OfflineInvoicesListComponent } from '../offline-invoices-list/offline-invoices-list.component';
import { UtilityService } from '../../services/utility.service';
// Main page services (refactored)
import {
  CartStateService,
  InvoiceStateService,
  ReloadOrchestratorService,
  CheckoutOrchestratorService,
  UiHelperService,
  ProductSearchHandlerService,
  CartOperationsService,
  CustomerHandlerService,
  InvoiceTabHandlerService,
  InitializationOrchestratorService,
  LocalStorageOrchestratorService,
  InvoiceTabOperationsService,
  ProductCacheService,
  CustomerValidationService,
  InvoiceContextService,
  UINotificationService
} from '../../services/main-page';

// Main page functions (pure functions)
import * as Fn from './functions';

import { environment } from '../../../environments/environment';

// Import new child components
import { ProductSearchComponent } from './product-search/product-search.component';
import { InvoiceTabsComponent } from './invoice-tabs/invoice-tabs.component';
import { MenuBarComponent } from './menu-bar/menu-bar.component';
import { CartItemsComponent } from './cart-items/cart-items.component';
import { CustomerSearchComponent } from './customer-search/customer-search.component';

@Component({
  selector: 'main-page',
  standalone: true,
  imports: [CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatIconModule,
    MatTabsModule,
    InvoiceDetailComponent,
    MatTooltipModule,
    RouterModule,
    MatFormFieldModule,
    MatDialogModule,
    MatInputModule,
    MatSelectModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatButtonModule,
    MatSnackBarModule,
    MatTableModule,
    MatPaginatorModule,
    MatSortModule,
    MatRadioModule,
    // New child components
    ProductSearchComponent,
    InvoiceTabsComponent,
    MenuBarComponent,
    CartItemsComponent,
    CustomerSearchComponent
  ],
  templateUrl: './main-page.component.html',
  styleUrls: ['./main-page.component.css'],
  encapsulation: ViewEncapsulation.None,

})
export class MainPageComponent implements OnInit, OnDestroy, DoCheck, AfterViewInit {

  constructor(
    private productService: ProductService,
    private groupService: GroupService,
    private invoiceService: InvoiceService,
    private customerService: CustomerService,
    private printService: PrintService,
    private dialog: MatDialog,
    private router: Router,
    private kiotvietService: KiotvietService,
    private localStorageService: LocalStorageService,
    private timeZoneService: TimeZoneService,
    private utilityService: UtilityService,
    private orderService: OrderService,
    private orderToInvoiceService: OrderToInvoiceService,
    private indexedDBService: IndexedDBService,
    private snackBar: MatSnackBar,
    // Refactored services
    public cartState: CartStateService,
    public invoiceState: InvoiceStateService,
    private reloadOrchestrator: ReloadOrchestratorService,
    private checkoutOrchestrator: CheckoutOrchestratorService,
    public uiHelper: UiHelperService,
    // Handler services
    // private productSearchHandler: ProductSearchHandlerService,
    // private cartOperations: CartOperationsService,
    // private customerHandler: CustomerHandlerService,
    // private invoiceTabHandler: InvoiceTabHandlerService,
    private initializationOrchestrator: InitializationOrchestratorService,
    private localStorageOrchestrator: LocalStorageOrchestratorService,
    private invoiceTabOperations: InvoiceTabOperationsService,
    // New refactored services
    private productCache: ProductCacheService,
    private customerValidation: CustomerValidationService,
    private invoiceContext: InvoiceContextService,
    private uiNotification: UINotificationService
  ) {
    // this.addInvoiceTab();
  }

  searchTerm = '';
  showDropdown = false;
  filteredProducts: Product[] = [];
  showCustomerDropdown = false;
  showNoteInput = false;
  // MIGRATED: selectedItem now managed by CartStateService
  // selectedItem: CartItem | null = null;
  // removed unused variable `swtichedItem`
  discountAmount = 0;
  discountType = 'VND';
  deliveryTime = '';
  groupedProducts: Record<number, any[]> = {}
  allProducts: Product[] = [];
  paymentMode: 'normal' | 'debt' = 'normal';
  // MIGRATED: cartItems now managed by CartStateService
  // cartItems: CartItem[] = [];
  // MIGRATED: invoices/orders now managed by InvoiceStateService
  // invoices: InvoiceTab[] = [];
  // orders: InvoiceTab[] = [];
  activeOrderTabIndex = 0;
  private isCheckoutInProgress = false;
  tabCounter = 1;
  activeIndex = 0;
  // MIGRATED: activeTabIndex now in InvoiceStateService
  // activeTabIndex = 0;
  invoiceTabFontSize = 12;
  showInvoiceTabNumbersOnly = false;
  private readonly defaultInvoiceTabFontSize = 12;
  private readonly minInvoiceTabFontSize = 7;
  private tabDisplayUpdatePending = false;
  private salesDbReady = false;
  private lastSearchInputType: 'typed' | 'paste' | 'programmatic' = 'typed';
  private suppressDropdownUntilInput = false;
  readonly DEFAULT_INVOICE_VAT = 1.08;
  invoiceVatPercent = 8;
  showVatDetails = false;

  @ViewChild(InvoiceDetailComponent, { static: false })
  invoiceDetailComponent!: InvoiceDetailComponent;

  // MIGRATED: Getters/Setters for state from services
  // Note: Using getters/setters as temporary compatibility layer
  // TODO: Gradually migrate direct usage to service methods

  get cartItems(): CartItem[] {
    return this.cartState.getCartItems();
  }

  set cartItems(items: CartItem[]) {
    this.cartState.setCartItems(items);
    this.syncCartToActiveInvoice();
  }

  get selectedItem(): CartItem | null {
    return this.cartState.getSelectedItem();
  }

  set selectedItem(item: CartItem | null) {
    this.cartState.setSelectedItem(item);
  }

  get invoices(): InvoiceTab[] {
    return this.invoiceState.getInvoices();
  }

  set invoices(invoices: InvoiceTab[]) {
    this.invoiceState.setInvoices(invoices);
  }

  get orders(): InvoiceTab[] {
    return this.invoiceState.getOrders();
  }

  set orders(orders: InvoiceTab[]) {
    this.invoiceState.setOrders(orders);
  }

  get selectedInvoice(): InvoiceTab | null {
    return this.invoiceState.getSelectedInvoice();
  }

  get activeTabIndex(): number {
    return this.invoiceState.getActiveTabIndex();
  }

  set activeTabIndex(value: number) {
    this.invoiceState.setActiveTabIndex(value);
  }

  /**
   * Safe getter for currently active order's customerPaid value.
   * Template should call this to avoid optional chaining type errors.
   */
  getActiveOrderCustomerPaid(): number {
    try {
      const list = this.orders;
      const idx = Number(this.activeOrderTabIndex) || 0;
      if (!Array.isArray(list) || idx < 0 || idx >= list.length) return 0;
      const v = (list[idx] as any)?.customerPaid;
      return typeof v === 'number' && !isNaN(v) ? v : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Helper: Sync cart items to active invoice
   */
  private syncCartToActiveInvoice(): void {
    const invoice = this.selectedInvoice;
    if (invoice) {
      this.invoiceState.updateSelectedInvoiceCartItems(this.cartItems);
    }
  }

  searchChanged: Subject<string> = new Subject<string>();

  @ViewChild('printSection', { static: false }) printSection!: ElementRef;
  @ViewChildren('itemRefs') itemRefs!: QueryList<ElementRef>;
  @ViewChild('dropdownContainer') dropdownContainer!: ElementRef;
  @ViewChildren('noteInput') noteInputs!: QueryList<ElementRef>;
  @ViewChild('invoiceTabContainer') invoiceTabContainer!: ElementRef<HTMLElement>;
  @ViewChildren('invoiceTab') invoiceTabElements!: QueryList<ElementRef<HTMLElement>>;

  // Child component references
  @ViewChild('productSearchComponent') productSearchComponent!: ProductSearchComponent;
  @ViewChild('customerSearchComponent') customerSearchComponent!: CustomerSearchComponent;


  validateNumber(event: KeyboardEvent) {
    this.utilityService.validateNumber(event)
  }

  private updateLastSearchInputType(event?: Event): void {
    this.lastSearchInputType = Fn.isPasteEvent(event) ? 'paste' : 'typed';
  }

  private isAutoSelectPreferred(): boolean {
    return this.lastSearchInputType !== 'paste';
  }

  // Load data from localStorage on component initialization
  private loadDataFromLocalStorage(): void {
    const data = this.localStorageOrchestrator.loadAllData({
      defaultVat: this.DEFAULT_INVOICE_VAT,
      normalizeCustomer: (customer) => customer ? this.normalizeCustomer(customer) : null,
      syncInvoiceVatPercent: () => this.syncInvoiceVatPercent(),
      scheduleTabDisplayUpdate: () => this.scheduleTabDisplayUpdate()
    });

    // Apply loaded data to component properties
    this.invoices = data.invoices;
    this.tabCounter = data.tabCounter;
    this.activeTabIndex = data.activeTabIndex;
    this.cartItems = data.cartItems;
    this.discountAmount = data.discountAmount;
    this.selectedCustomer = data.selectedCustomer;
    this.invoiceNote = data.invoiceNote;
    this.customerSearchTerm = data.customerSearchTerm;
  }

  // Save data to localStorage
  private saveDataToLocalStorage(): void {
    this.localStorageOrchestrator.saveAllData({
      cartItems: this.cartItems,
      invoices: this.invoices,
      activeTabIndex: this.activeTabIndex,
      discountAmount: this.discountAmount,
      selectedCustomer: this.selectedCustomer,
      invoiceNote: this.invoiceNote
    });
  }
  private onHandReloadInterval: any = null;
  private subscriptions: Subscription[] = [];
  async ngOnInit() {
    // Load data from localStorage
    this.loadDataFromLocalStorage();

    // Create initial invoice tab if none exists
    if (this.invoices.length === 0) {
      this.addInvoiceTab();
    }

    // Hydrate sales DB data
    await this.hydrateSalesDbData('init');

    // Focus search input after initialization
    setTimeout(() => {
      this.productSearchComponent?.focusSearchInput();
    }, 0);

    // Check for offline invoices
    this.checkOfflineInvoices();

    // Set quick amounts
    this.setquickAmounts();

    // Initialize order tab if in order mode
    if (this.isOrderMode && this.orders.length === 0) {
      this.addOrderTab();
    }

    // Setup all subscriptions and intervals using the orchestrator service
    const { subscriptions, interval } = this.initializationOrchestrator.initializeSubscriptionsAndIntervals({
      searchChanged$: this.searchChanged,
      invoiceCreated$: this.invoiceService.invoiceCreated$,
      orderProcessed$: this.orderToInvoiceService.orderProcessed$,
      productOnHandUpdated$: this.productService.productOnHandUpdated$,
      onSearchCallback: (query) => this.onSearchInputInternal(query, true),
      onInvoiceCreatedCallback: () => {
        // Invoice created callback - can add custom logic here if needed
      },
      onOrderProcessedCallback: (data) => this.handleProcessedOrder(data.order, data.orderId),
      reloadCartItemsOnHand: () => this.reloadCartItemsOnHand(),
      productUpdateContext: {
        cartItems: this.cartItems,
        filteredProducts: this.filteredProducts,
        groupedProducts: this.groupedProducts,
        updateItemTotal: (item) => this.updateItemTotal(item),
        updateInvoiceTotalPrice: () => this.updateInvoiceTotalPrice(),
        groupProduct: () => this.groupProduct()
      }
    });

    // Add all subscriptions to the component's subscription array
    this.subscriptions.push(...subscriptions);

    // Store the interval reference
    this.onHandReloadInterval = interval;
  }

  ngAfterViewInit(): void {
    if (this.invoiceTabElements) {
      const tabChangesSub = this.invoiceTabElements.changes.subscribe(() => this.scheduleTabDisplayUpdate());
      this.subscriptions.push(tabChangesSub);
    }

    this.scheduleTabDisplayUpdate();
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.scheduleTabDisplayUpdate();
  }

  getTabDisplayLabel(tabName: string): string {
    return Fn.getTabDisplayLabel(tabName, this.showInvoiceTabNumbersOnly);
  }

  isTabCompact(tabName: string): boolean {
    const label = this.getTabDisplayLabel(tabName).trim();
    if (!label) {
      return false;
    }

    if (this.showInvoiceTabNumbersOnly) {
      return true;
    }

    const normalized = label.toUpperCase();
    if (/^HĐ\b/.test(normalized)) {
      return true;
    }

    return /^\d+$/.test(normalized);
  }

  shouldShowCloseIcon(index: number, isOrderTab = false): boolean {
    if (!this.showInvoiceTabNumbersOnly) {
      return true;
    }

    const activeIndex = isOrderTab ? this.activeOrderTabIndex : this.activeTabIndex;
    return index === activeIndex;
  }

  getInvoiceTabName(invoice: InvoiceTab | null | undefined, index: number): string {
    return Fn.getInvoiceTabName(invoice, index);
  }

  getOrderTabName(order: InvoiceTab | null | undefined, index: number): string {
    return Fn.getOrderTabName(order, index);
  }

  onTabWheel(event: WheelEvent): void {
    const container = this.invoiceTabContainer?.nativeElement;
    if (!container) {
      return;
    }

    const horizontalDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
      ? event.deltaX
      : event.deltaY;

    if (horizontalDelta === 0) {
      return;
    }

    event.preventDefault();
    container.scrollBy({
      left: horizontalDelta,
      behavior: 'smooth'
    });
  }

  private scheduleTabDisplayUpdate(): void {
    if (this.tabDisplayUpdatePending) {
      return;
    }

    this.tabDisplayUpdatePending = true;
    const refresh = () => {
      this.tabDisplayUpdatePending = false;
      this.updateTabDisplayMode();
    };

    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(refresh);
    } else {
      setTimeout(refresh, 16);
    }
  }

  private updateTabDisplayMode(): void {
    const container = this.invoiceTabContainer?.nativeElement;
    if (!container) {
      return;
    }

    const tabs = this.invoiceTabElements?.toArray() ?? [];
    if (tabs.length === 0) {
      this.invoiceTabFontSize = this.defaultInvoiceTabFontSize;
      this.showInvoiceTabNumbersOnly = false;
      return;
    }

    const containerWidth = container.clientWidth;
    if (containerWidth <= 0) {
      this.invoiceTabFontSize = this.defaultInvoiceTabFontSize;
      this.showInvoiceTabNumbersOnly = false;
      return;
    }

    const totalWidth = tabs.reduce((width, tab) => width + tab.nativeElement.scrollWidth, 0);

    if (totalWidth <= containerWidth) {
      this.invoiceTabFontSize = this.defaultInvoiceTabFontSize;
      this.showInvoiceTabNumbersOnly = false;
      return;
    }

    const scale = containerWidth / totalWidth;
    const scaledSize = Math.max(this.minInvoiceTabFontSize, Math.floor(this.defaultInvoiceTabFontSize * scale));
    const limitedSize = Math.min(this.defaultInvoiceTabFontSize, scaledSize);

    this.invoiceTabFontSize = limitedSize;
    this.showInvoiceTabNumbersOnly = limitedSize <= this.minInvoiceTabFontSize;
    this.scrollActiveTabIntoView();
  }

  private scrollActiveTabIntoView(): void {
    const container = this.invoiceTabContainer?.nativeElement;
    if (!container) {
      return;
    }

    const tabs = this.invoiceTabElements?.toArray() ?? [];
    if (tabs.length === 0) {
      return;
    }

    const activeIndex = this.isOrderMode ? this.activeOrderTabIndex : this.activeTabIndex;
    if (activeIndex < 0 || activeIndex >= tabs.length) {
      return;
    }

    const activeElement = tabs[activeIndex]?.nativeElement;
    if (!activeElement) {
      return;
    }

    const elementLeft = activeElement.offsetLeft;
    const elementRight = elementLeft + activeElement.offsetWidth;
    const visibleLeft = container.scrollLeft;
    const visibleRight = visibleLeft + container.clientWidth;

    if (elementLeft < visibleLeft) {
      container.scrollTo({ left: elementLeft, behavior: 'smooth' });
    } else if (elementRight > visibleRight) {
      container.scrollTo({ left: elementRight - container.clientWidth, behavior: 'smooth' });
    }
  }


  /**
   * REFACTORED: Now uses ReloadOrchestratorService
   * Reduced from ~160 lines to ~15 lines
   */
  async reload() {
    // Show loading indicator
    this.isReloading = true;

    try {
      // Delegate to ReloadOrchestratorService
      const result = await this.reloadOrchestrator.reload();

      // Hydrate UI data after reload
      try {
        await this.hydrateSalesDbData(result.success ? 'reload-final' : 'reload-error');
      } catch (hydrateErr) {
        console.error('❌ Lỗi khi hydrate SalesDB sau reload:', hydrateErr);
      }

      // Log summary
      if (result.success) {
        console.log('✅ Reload hoàn tất thành công!');
        console.log(`📊 Đã xóa ${result.cleanupResult.deletedCount} orphaned products`);
      } else {
        console.warn('⚠️ Reload không hoàn toàn thành công');
      }
    } finally {
      // Hide loading indicator
      this.isReloading = false;
    }
  }


  /**
   * TODO: REFACTOR - Use CheckoutOrchestratorService
   * This method can be simplified by using the orchestrator service.
   * Keeping current implementation for now to avoid breaking changes.
   */
  private generateUUID(): string {
    // simple RFC4122 v4-like generator
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
  async checkout() {

    // =============================
    //  BLOCK 1: EARLY VALIDATION
    // =============================
    if (this.isEditMode) {
      await this.saveEditedOrder();
      return;
    }

    if (this.isCheckoutInProgress) {
      console.warn('Checkout is already in progress, ignoring duplicate action.');
      return;
    }

    this.isCheckoutInProgress = true;

    try {
      let invoiceSentToServer = false;

      // Validate cart not empty
      const cartValidation = this.checkoutOrchestrator.validateCartNotEmpty(this.cartItems);
      if (!cartValidation.valid) {
        alert(cartValidation.message);
        return;
      }

      let currentInvoiceIndex = this.activeTabIndex;
      const initialInvoice = this.invoices[currentInvoiceIndex];

      // Validate invoice has items
      const invoiceValidation = this.checkoutOrchestrator.validateInvoiceHasItems(initialInvoice);
      if (!invoiceValidation.valid) {
        alert(invoiceValidation.message);
        return;
      }

      // Check OnHand from IndexedDB
      const notEnough = await this.checkOnHandFromIndexedDB();
      if (notEnough) {
        this.notifyInsufficientStock();
      }

      // Validate customer for debt
      const customerValidation = this.checkoutOrchestrator.validateCustomerForDebt(
        this.getChangeAmount(),
        this.selectedCustomer
      );
      if (!customerValidation.valid) {
        alert(customerValidation.message);
        return;
      }

      // Re-validate
      currentInvoiceIndex = this.activeTabIndex;
      const currentInvoice = this.invoices[currentInvoiceIndex];

      const reValidation = this.checkoutOrchestrator.validateInvoiceHasItems(currentInvoice);
      const reCartValidation = this.checkoutOrchestrator.validateCartNotEmpty(this.cartItems);
      if (!reValidation.valid || !reCartValidation.valid) {
        alert('Giỏ hàng trống!');
        return;
      }

      // =============================
      //  BLOCK 2: BUILD FINAL INVOICE OBJECT
      // =============================
      const now = new Date();
      const vnNow = this.timeZoneService.formatVietnamISOString(now);
      const changeAmount = this.getChangeAmount();

      currentInvoice.debt = changeAmount;
      currentInvoice.note = this.invoiceNote;
      this.createdDate = vnNow;

      const invoice = this.checkoutOrchestrator.createInvoiceForCheckout({
        currentInvoice: currentInvoice,
        vnNow: vnNow,
        changeAmount: changeAmount
      });

      // Ensure VAT
      invoice.invoiceVAT = this.ensureInvoiceVat(currentInvoice);

      // Ensure invoice.id exists
      if (!invoice.id) {
        invoice.id = this.generateUUID();
        console.warn('Generated missing invoice.id:', invoice.id);
      }

      // =============================
      //  BLOCK 3: UPDATE CUSTOMER DEBT
      // =============================
      if (this.paymentMode === 'debt' && invoice.customer?.Id) {
        try {
          const newDebt = this.checkoutOrchestrator.calculateCustomerDebt({
            customer: invoice.customer,
            changeAmount: changeAmount,
            paymentMode: this.paymentMode
          });

          invoice.customer.Debt = newDebt;

          await this.customerService.updateCustomerDebt(invoice.customer.Id, invoice.customer.Debt);
          const updatedCustomer = await this.customerService.getCustomerByIdFromIndexedDB(invoice.customer.Id);
          console.log('Updated customer debt in indexedDB:', updatedCustomer);

        } catch (err) {
          console.error('❌ Lỗi update customer debt:', err);
        }
      }

      // =============================
      //  BLOCK 4: PRINT BEFORE CLEARING UI
      // =============================
      if (this.isPrintEnabled) {
        if (this.invoiceDetailComponent) {
          this.invoiceDetailComponent.invoice = invoice;
        }
        const html = this.invoiceDetailComponent?.getHtmlContent();
        if (html) this.printService.printHtml(html);
      }

      // =============================
      //  BLOCK 5: CLEAR TAB UI
      // =============================
      this.localStorageService.clearTabData(currentInvoiceIndex);
      this.invoices.splice(currentInvoiceIndex, 1);

      this.createdDate = '';
      if (this.checkoutOrchestrator.shouldCreateNewTab(this.invoices.length)) {
        this.addInvoiceTab();
      } else {
        const newIndex = this.checkoutOrchestrator.getNextTabIndexAfterCheckout({
          currentIndex: currentInvoiceIndex,
          totalInvoices: this.invoices.length
        });
        this.setActiveTab(newIndex);
      }

      // =============================
      //  BLOCK 6: SEND INVOICE (ONLINE OR OFFLINE)
      // =============================

      // ========== OFFLINE PATH ==========
      if (!navigator.onLine) {
        console.warn('📴 Offline — saving invoice to IndexedDB only.');
        try {
          await this.invoiceService.saveInvoiceToOffline(invoice);
          this.hasOfflineInvoices = true;
          console.log('Saved invoice offline:', invoice.id);
        } catch (err) {
          console.error('❌ Failed saving invoice offline:', err);
        }
        invoiceSentToServer = false;
      }

      // ========== ONLINE PATH ==========
      else {
        try {
          await this.invoiceService.notifyInvoiceCreated(invoice);
          invoiceSentToServer = true;
          console.log('Invoice successfully sent to Firebase:', invoice.id);

          // Update order status if needed
          if (invoice.name && invoice.name.includes('từ đơn hàng')) {
            const orderIdMatch = invoice.name.match(/từ đơn hàng (DH\d+)/);
            if (orderIdMatch && orderIdMatch[1]) {
              await this.updateOrderStatusToChecked(orderIdMatch[1]);
            }
          }

          // Update KiotViet (fire and forget)
          this.kiotvietService.updateOnHandFromInvoiceToKiotviet(invoice, this.groupedProducts)
            .catch(err => console.error('KiotViet update error:', err));

        } catch (notifyErr) {
          console.error('❌ notifyInvoiceCreated failed, fallback to offline:', notifyErr);

          try {
            await this.invoiceService.saveInvoiceToOffline(invoice);
            this.hasOfflineInvoices = true;
            console.log('Saved invoice offline after notify failure:', invoice.id);
          } catch (saveErr) {
            console.error('❌ Failed saving offline after notify error:', saveErr);
          }

          invoiceSentToServer = false;
        }
      }

      // =============================
      //  BLOCK 7: LOCAL ONHAND ADJUSTMENT
      // =============================
      const preAdjustmentOnHand = new Map<number, number>();
      let localRealtimeUpdateMap = new Map<number, number>();

      try {
        localRealtimeUpdateMap = await this.applyLocalOnHandAdjustments(this.cartItems, preAdjustmentOnHand);
      } catch (error) {
        console.error('❌ local onHand adjust error:', error);
      }

      if (localRealtimeUpdateMap.size > 0) {
        const payload = Array.from(localRealtimeUpdateMap.entries()).map(([Id, OnHand]) => ({ Id, OnHand }));
        try {
          if (typeof (this.productService as any).updateProductOnHandToFireStore === 'function') {
            await (this.productService as any).updateProductOnHandToFireStore(payload);
          } else if ((this.productService as any).http) {
            const url = environment.domainUrl + '/api/firebase/update/products';
            await firstValueFrom((this.productService as any).http.put(url, payload));
          }
        } catch (notifyErr) {
          console.warn('⚠️ Failed to send immediate OnHand update:', notifyErr);
        }
      }

      // =============================
      //  BLOCK 8: RESET UI
      // =============================
      const resetState = this.checkoutOrchestrator.getResetStateAfterCheckout();
      this.discountAmount = resetState.discountAmount;
      this.change = resetState.change;
      this.formattedCustomerPaid = resetState.formattedCustomerPaid;
      this.invoiceNote = resetState.invoiceNote;
      this.searchTerm = resetState.searchTerm;
      this.filteredProducts = resetState.filteredProducts;
      this.showDropdown = resetState.showDropdown;
      this.activeIndex = resetState.activeIndex;
      this.lastCartItemsLength = resetState.lastCartItemsLength;

      // =============================
      //  BLOCK 9: FINAL SERVER SYNC IF ONLINE
      // =============================
      if (invoiceSentToServer) {
        try {
          const affectedIds = new Set<number>();
          for (const item of invoice.cartItems || []) {
            if (item?.product?.Id != null) {
              affectedIds.add(Number(item.product.Id));
            }
          }
          if (affectedIds.size > 0) {
            await this.productService.fetchProductsByIds(Array.from(affectedIds));
          }
        } catch (err) {
          console.warn('⚠️ Failed to sync products after checkout:', err);
        }
      }

      // =============================
      //  BLOCK 10: OFFLINE fallback update_onhand_batch
      // =============================
      if (!invoiceSentToServer) {
        try {
          const res = await this.productService.updateProductsOnHandFromInvoiceToFireBase(
            invoice,
            this.groupedProducts,
            this.manuallyEditedOnHandProductIds,
            'decrease',
            preAdjustmentOnHand
          );

          invoice.onHandSynced = true;
          await this.invoiceService.markOfflineInvoiceOnHandSynced(invoice.id, true);

          const ids: number[] = (res?.updated_products ?? [])
            .map((p: any) => Number(p.Id))
            .filter((x: number) => Number.isFinite(x));

          this.manuallyEditedOnHandProductIds.clear();
        } catch (err) {
          console.error('❌ Offline fallback update_onhand_batch error:', err);
          invoice.onHandSynced = false;
        }
      }

    } finally {
      this.isCheckoutInProgress = false;
    }
  }

  private notifyInsufficientStock(): void {
    this.uiNotification.notifyInsufficientStock();
  }

  private notifyProductNotFound(query: string): void {
    this.uiNotification.notifyProductNotFound(query);
  }

  private async applyLocalOnHandAdjustments(
    cartItems: CartItem[],
    snapshot?: Map<number, number>
  ): Promise<Map<number, number>> {
    const aggregated: Record<number, number> = {};

    for (const item of cartItems) {
      if (!item?.product || item.product.Id == null) {
        continue;
      }

      const quantity = Number(item.quantity ?? 0);
      if (!Number.isFinite(quantity) || quantity === 0) {
        continue;
      }

      const conversionValue = Number(item.product.ConversionValue) || 1;
      const masterQty = quantity * conversionValue;
      const masterUnitId = item.product.MasterUnitId || item.product.Id;
      const group = this.groupedProducts[masterUnitId] as Product[] | undefined;

      if (!group || group.length === 0) {
        const productId = Number(item.product.Id);
        aggregated[productId] = (aggregated[productId] ?? 0) + quantity;
        continue;
      }

      for (const variant of group) {
        if (!variant || variant.Id == null) {
          continue;
        }
        const variantConversion = Number(variant.ConversionValue) || 1;
        if (!Number.isFinite(variantConversion) || variantConversion === 0) {
          continue;
        }
        const delta = masterQty / variantConversion;
        aggregated[variant.Id] = (aggregated[variant.Id] ?? 0) + delta;
      }
    }

    const result = new Map<number, number>();
    for (const [productIdStr, delta] of Object.entries(aggregated)) {
      const productId = Number(productIdStr);
      if (!Number.isFinite(productId)) {
        continue;
      }
      const numericDelta = Number(delta) || 0;
      if (!Number.isFinite(numericDelta) || numericDelta === 0) {
        continue;
      }

      const latest = await this.productService.getProductByIdFromIndexedDB(productId);
      const currentOnHand = latest ? Number(latest.OnHand ?? 0) : this.getCachedOnHandValue(productId);
      if (snapshot && !snapshot.has(productId)) {
        snapshot.set(productId, currentOnHand);
      }
      const newOnHand = currentOnHand - numericDelta;

      await this.productService.updateProductOnHandLocal(productId, newOnHand);
      this.updateCachedProductOnHand(productId, newOnHand);
      result.set(productId, newOnHand);
    }

    return result;
  }

  private getCachedOnHandValue(productId: number): number {
    return this.productCache.getCachedOnHandValue(productId, this.groupedProducts);
  }

  private updateCachedProductOnHand(productId: number, newOnHand: number): void {
    this.productCache.updateCachedProductOnHand({
      productId,
      newOnHand,
      groupedProducts: this.groupedProducts,
      cartItems: this.cartItems
    });
  }

  // ✅ Thêm hàm kiểm tra OnHand từ IndexedDB
  private async checkOnHandFromIndexedDB(): Promise<boolean> {
    try {
      // Làm mới tồn kho trong giỏ và danh sách sản phẩm để UI luôn phản ánh dữ liệu mới nhất
      await this.reloadCartItemsOnHand();
      await this.groupProduct();

      // Gom các sản phẩm trong cart theo group (masterUnitId)
      const groupMap: Record<number, { totalSell: number; totalOnHand: number }> = {};

      for (const item of this.cartItems) {
        const masterUnitId = item.product.MasterUnitId || item.product.Id;
        const group = this.groupedProducts[masterUnitId];
        if (!group || group.length === 0) {
          // Nếu không tìm thấy group, fallback về dữ liệu hiện tại của item
          const available = Number(item.product?.OnHand ?? 0);
          const required = item.quantity * (item.product?.ConversionValue ?? 1);
          if (required > available) {
            console.log(`❌ Không đủ hàng cho sản phẩm ${item.product?.Id}: cần ${required}, có ${available}`);
            return true;
          }
          continue;
        }

        // Tính tổng số lượng bán quy đổi về master
        const sellQty = item.quantity * (item.product?.ConversionValue ?? 1);

        if (!groupMap[masterUnitId]) {
          // Lấy tổng OnHand thực tế của group (quy đổi về master)
          const totalOnHand = group.reduce((sum, productVariant) => {
            const conversion = productVariant?.ConversionValue ?? 1;
            const onHand = Number(productVariant?.OnHand ?? 0);
            return sum + onHand * conversion;
          }, 0);

          groupMap[masterUnitId] = { totalSell: 0, totalOnHand };
        }

        groupMap[masterUnitId].totalSell += sellQty;
      }

      // Kiểm tra từng group
      for (const masterUnitId in groupMap) {
        if (groupMap[masterUnitId].totalSell > groupMap[masterUnitId].totalOnHand) {
          console.log(`❌ Không đủ hàng cho group ${masterUnitId}: cần ${groupMap[masterUnitId].totalSell}, có ${groupMap[masterUnitId].totalOnHand}`);
          return true; // Không đủ hàng
        }
      }

      return false; // Đủ hàng
    } catch (error) {
      console.error('❌ Lỗi khi kiểm tra OnHand từ IndexedDB:', error);
      return true; // Nếu lỗi, không cho phép bán
    }
  }

  ngDoCheck() {
    this.setquickAmounts();
  }
  async groupProduct() {
    try {
      const products = await this.productService.getAllProductsFromIndexedDB();
      this.allProducts = products;
      this.groupedProducts = await this.groupService.group(products);

      const activeQuery = this.searchTerm.trim();
      if (activeQuery.length > 0) {
        await this.onSearchInputInternal(activeQuery, false);
      }
    } catch (error) {
      console.error('❌ Lỗi khi group sản phẩm từ IndexedDB:', error);
      this.allProducts = [];
      this.groupedProducts = {};
    }
  }

  private async hydrateSalesDbData(trigger: string): Promise<void> {
    try {
      const hasProducts = await this.productService.hasIndexedDbProducts();
      this.salesDbReady = hasProducts;

      if (!hasProducts) {
        console.warn(`ℹ️ [${trigger}] SalesDB chưa có dữ liệu, vui lòng nhấn Reload để tải sản phẩm.`);
        this.allProducts = [];
        this.groupedProducts = {};
        return;
      }

      await this.groupProduct();
      await this.syncCartItemsWithIndexedDB();
    } catch (error) {
      this.salesDbReady = false;
      console.error(`❌ Lỗi khi chuẩn bị dữ liệu SalesDB (${trigger}):`, error);
    }
  }

  scrollToActiveItem() {
    const items = this.itemRefs.toArray();

    if (this.activeIndex >= 0 && this.activeIndex < items.length) {
      const element = items[this.activeIndex].nativeElement;
      const container = this.dropdownContainer?.nativeElement;

      if (element && container) {
        const elementTop = element.offsetTop;
        const elementBottom = elementTop + element.offsetHeight;
        const containerTop = container.scrollTop;
        const containerBottom = containerTop + container.offsetHeight;

        if (elementBottom > containerBottom) {
          container.scrollTop = elementBottom - container.offsetHeight;
        } else if (elementTop < containerTop) {
          container.scrollTop = elementTop;
        }
      }
    }
  }
  private enterPressed = false;
  onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      this.enterPressed = true;
      event.preventDefault();

      // Nếu có sản phẩm, chọn sản phẩm
      if (this.showDropdown && this.filteredProducts.length > 0) {
        if (this.activeIndex >= 0 && this.activeIndex < this.filteredProducts.length) {
          this.selectProduct(this.filteredProducts[this.activeIndex]);
        }
        setTimeout(() => {
          if (this.productSearchComponent?.searchInputElement) {
            this.productSearchComponent.searchInputElement.nativeElement.select();
          }
        }, 0);
        return;
      }

      if (this.suppressDropdownUntilInput) {
        return;
      }

      const query = this.searchTerm.trim();
      if (query.length === 0) {
        this.showDropdown = false;
        return;
      }

      this.searchChanged.next(query);
      return;
    } else if (!this.showDropdown || this.filteredProducts.length === 0) {
      return;
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (this.activeIndex < this.filteredProducts.length - 1) {
        this.activeIndex++;
        setTimeout(() => this.scrollToActiveItem(), 0);
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (this.activeIndex > 0) {
        this.activeIndex--;
        setTimeout(() => this.scrollToActiveItem(), 0);
      }
    }
  }
  onSearchInput(event?: Event) {
    this.suppressDropdownUntilInput = false;
    this.updateLastSearchInputType(event);
    this.searchChanged.next(this.searchTerm.trim());
  }

  async onSearchFieldFocus(): Promise<void> {
    setTimeout(() => {
      if (this.productSearchComponent?.searchInputElement) {
        this.productSearchComponent.searchInputElement.nativeElement.select();
      }
    }, 0);

    const query = this.searchTerm.trim();
    if (query.length === 0) {
      this.showDropdown = false;
      return;
    }

    if (this.filteredProducts.length > 0) {
      this.showDropdown = true;
      return;
    }

    try {
      this.lastSearchInputType = 'programmatic';
      await this.onSearchInputInternal(query, false);
    } catch (error) {
      console.error('Lỗi khi hiển thị dropdown sản phẩm:', error);
    }
  }
  lastCartItemsLength = 0;
  async onSearchInputInternal(query: string, triggeredByUser = false): Promise<void> {
    if (query.length === 0) {
      this.filteredProducts = [];
      this.showDropdown = false;
      this.activeIndex = -1;
      return;
    }

    if (this.suppressDropdownUntilInput && triggeredByUser) {
      this.showDropdown = false;
      return;
    }

    let results = await this.productService.searchProducts(query);
    results = results.filter((p): p is Product => !!p && typeof p === 'object' && 'Name' in p && 'Code' in p && 'Unit' in p);
    if (results.length > 0) {
      const queryLower = query.toLowerCase();

      // ✅ KIỂM TRA TRÙNG KHỚP CHÍNH XÁC MÃ SẢN PHẨM
      const exactCodeMatch = results.find(p => p.Code?.toLowerCase() === queryLower);

      if (triggeredByUser && this.isAutoSelectPreferred() && exactCodeMatch) {
        // Nếu tìm thấy sản phẩm có mã trùng khớp chính xác, chọn ngay lập tức
        this.selectProduct(exactCodeMatch);
        return;
      }

      // Logic cũ để kiểm tra cảnh báo khi chưa chọn sản phẩm
      let isProductCode = false;
      if (queryLower.includes('-')) {
        const baseQuery = queryLower.split('-')[0];
        isProductCode = results.some(p => p.Code?.toLowerCase() === baseQuery);
      } else {
        isProductCode = results.some(p => p.Code?.toLowerCase() === queryLower);
      }

      if (triggeredByUser && this.isAutoSelectPreferred() && isProductCode && this.showDropdown && this.cartItems.length === this.lastCartItemsLength) {
        setTimeout(() => alert(`BẠN CHƯA CHỌN SẢN PHẨM TRƯỚC ĐÓ. 
       HÃY NHẬP LẠI !`), 1000);
      }
      this.showDropdown = true;
      this.lastCartItemsLength = this.cartItems.length;
    } else {
      this.showDropdown = false;

      const fetched = await this.productService.loadProductsIfNotExist(query);
      if (fetched && fetched.length > 0) {
        results = await this.productService.searchProducts(query);
        results = results.filter(p => p && p.Image && (p.Name || p.FullName) && p.Code && p.Unit && p.BasePrice);
      }

      // ✅ KIỂM TRA LẠI SAU KHI FETCH
      const queryLower = query.toLowerCase();
      const exactCodeMatch = results.find(p => p.Code?.toLowerCase() === queryLower);

      if (triggeredByUser && this.isAutoSelectPreferred() && exactCodeMatch) {
        this.selectProduct(exactCodeMatch);
        return;
      }
    }

    const shouldAutoSelectSingleResult = triggeredByUser && this.isAutoSelectPreferred() && results.length === 1;
    if (shouldAutoSelectSingleResult) {
      this.selectProduct(results[0]);
      return;
    }

    if (triggeredByUser && results.length === 0) {
      this.notifyProductNotFound(query);
    }

    this.filteredProducts = results;
    this.showDropdown = results.length > 0;
    this.activeIndex = results.length > 0 ? 0 : -1;
    console.log('Kết quả tìm kiếm cuối cùng:', this.filteredProducts);
    setTimeout(() => this.scrollToActiveItem(), 0);
    this.activeIndex = -1;
  }

  async updateItemUnit(index: number, unit: string) {
    const item = this.cartItems[index];
    const masterId = (item as any).masterId || item.product.MasterUnitId || item.product.Id;
    const group = this.groupedProducts[masterId];

    if (group) {
      // Tìm sản phẩm đúng đơn vị
      const newProduct = group.find(p => p.Unit === unit);
      if (newProduct) {
        // Lấy thông tin mới nhất từ IndexedDB
        const db = await this.indexedDBService.getDB('SalesDB', 1);
        const tx = db.transaction('products', 'readonly');
        const latestProduct = await tx.store.get(newProduct.Id);

        // Nếu lấy được sản phẩm mới nhất, dùng nó, nếu không thì dùng newProduct cũ
        item.product = latestProduct ? { ...latestProduct } : { ...newProduct };
        item.unitPrice = item.product.BasePrice;
        this.updateItemTotal(item);
      }
    }
    item.product.Unit = unit;
    this.cartItems[index].unitPriceSaleOff = 0; // Reset giá sale off khi đổi đơn vị

    // ✅ Cập nhật tổng tiền invoice
    this.updateInvoiceTotalPrice();
  }


  getAvailableUnits(product: Product, cartItem?: any): string[] {
    return Fn.getAvailableUnits(product, cartItem, this.groupedProducts);
  }
  sortCartItemsByQuantity(productCode: string) {
    const idx = this.cartItems.findIndex(item => item.product.Code === productCode);
    if (idx > -1) {
      const [item] = this.cartItems.splice(idx, 1);
      this.cartItems.unshift(item);
    }
  }

  selectProduct(product: Product) {
    // Validate price vs cost
    if (product.BasePrice < product.Cost) {
      alert(`GIÁ BÁN đang thấp hơn GIÁ VỐN, cần kiểm tra lại  Sản phẩm: ${product.Name}`);
      return;
    }

    // Find or create cart item
    const existingItem = this.cartItems.find(item => item.product.Code === product.Code);
    if (existingItem) {
      existingItem.quantity += 1;
      this.updateItemTotal(existingItem);
      this.sortCartItemsByQuantity(product.Code);
    } else {
      this.cartItems.unshift({
        product,
        quantity: 1,
        unitPrice: product.BasePrice,
        totalPrice: product.BasePrice,
        unitPriceSaleOff: 0
      });
    }

    // Sync and reset UI
    this.syncCartWithInvoice();
    this.resetProductSearchUI();
  }

  private resetProductSearchUI() {
    this.showDropdown = false;
    this.filteredProducts = [];
    this.activeIndex = -1;
    this.suppressDropdownUntilInput = true;
    setTimeout(() => {
      this.productSearchComponent?.searchInputElement?.nativeElement.select();
    }, 0);
  }
  // REFACTORED: Delegate to CartStateService
  getTotalQuantity(): number {
    return this.cartState.getTotalQuantity();
  }

  getTotalAmount(): number {
    return this.cartState.getTotalAmount();
  }

  getTotalCost(): number {
    return this.cartState.getTotalCost();
  }
  onDiscountChange() {
    const activeInvoice = this.invoices[this.activeTabIndex];
    if (!activeInvoice) return;

    activeInvoice.discountAmount = this.discountAmount;
    if (!(activeInvoice as any).customerPaidManuallySet) {
      activeInvoice.customerPaid = this.getTotalAmount() - this.discountAmount;
    }
    this.saveDataToLocalStorage();
  }

  updateInvoiceTotalPrice() {
    const activeInvoice = this.invoices[this.activeTabIndex];
    if (!activeInvoice) return;

    activeInvoice.totalPrice = this.getTotalAmount();
    activeInvoice.totalCost = this.getTotalCost();
    activeInvoice.totalQuantity = this.getTotalQuantity();
    activeInvoice.discountAmount = this.discountAmount;

    if (!(activeInvoice as any).customerPaidManuallySet) {
      activeInvoice.customerPaid = this.getTotalAmount() - this.discountAmount;
    }
    this.saveDataToLocalStorage();
  }

  // REFACTORED: Delegate to CartStateService
  updateItemTotal(item: CartItem) {
    this.cartState.updateItemTotal(item);
    // ✅ THÊM DÒNG NÀY - Cập nhật tổng tiền invoice mỗi khi item thay đổi
    this.updateInvoiceTotalPrice();
  }
  onQuantityChange(item: CartItem) {
    this.updateItemTotal(item);
  }

  onUnitPriceChange(item: CartItem) {
    this.updateItemTotal(item);
  }
  removeItem(index: number) {
    this.cartItems.splice(index, 1);
    this.syncCartWithInvoice();
  }

  private syncCartWithInvoice() {
    const activeInvoice = this.invoices[this.activeTabIndex];
    this.invoiceContext.syncCartWithInvoice({
      invoice: activeInvoice,
      cartItems: this.cartItems,
      discountAmount: this.discountAmount,
      selectedCustomer: this.selectedCustomer,
      updateInvoiceTotalPrice: () => this.updateInvoiceTotalPrice()
    });
  }
  // REFACTORED: Delegate to UiHelperService
  getItemStatus(product: Product): string {
    return this.uiHelper.getItemStatusFromAttributes(product);
  }

  showNoteInputIndex: number | null = null;

  showNoteForProduct(index: number) {
    this.showNoteInputIndex = index;
    this.selectedItem = this.cartItems[index];
    this.showNoteInput = true;
    setTimeout(() => {
      const input = this.noteInputs?.toArray()[0]?.nativeElement;
      if (input) {
        input.focus();
        input.select();
      }
    }, 0);
  }

  calculateFinalPrice(): number {
    if (!this.selectedItem) return 0;

    let finalPrice = this.selectedItem.unitPrice;

    if (this.discountType === 'VND') {
      finalPrice -= this.discountAmount;
    } else {
      finalPrice = finalPrice * (1 - this.discountAmount / 100);
    }

    return Math.max(0, finalPrice);
  }


  // REFACTORED: Use getActiveInvoiceContext()
  selectQuickAmount(amount: number) {
    const activeInvoice = this.getActiveInvoiceContext();
    if (activeInvoice) {
      activeInvoice.customerPaid = amount;
      (activeInvoice as any).customerPaidManuallySet = true;
    }
  }

  addNewProduct() {
    console.log('Add new product');
    this.showDropdown = false;
  }



  // REFACTORED: Delegate to UiHelperService
  formatPrice(price: number): string {
    return this.uiHelper.formatPrice(price);
  }

  // REFACTORED: Delegate to UiHelperService
  private coerceToNumber(value: unknown, fallback = 0): number {
    return this.uiHelper.coerceToNumber(value, fallback);
  }

  private normalizeCustomer(customer: Customer): Customer {
    return this.customerValidation.normalizeCustomer(customer, (value, fallback) => this.coerceToNumber(value, fallback));
  }

  get selectedCustomerDebtValue(): number {
    return this.customerValidation.getCustomerDebtValue(
      this.selectedCustomer,
      (value, fallback) => this.coerceToNumber(value, fallback)
    );
  }

  get selectedCustomerTotalPointValue(): number {
    return this.customerValidation.getCustomerTotalPointValue(
      this.selectedCustomer,
      (value, fallback) => this.coerceToNumber(value, fallback)
    );
  }

  customerSuggestions: any[] = [];
  customerSearchTerm = '';
  selectedCustomer: Customer | null = null;

  // REFACTORED: Consolidated duplicate if/else logic
  selectCustomer(customer: Customer) {
    const normalizedCustomer = this.normalizeCustomer(customer);
    this.selectedCustomer = normalizedCustomer;
    this.customerSearchTerm = this.customerValidation.formatCustomerDisplayText(normalizedCustomer);
    this.customerSuggestions = [];

    const activeInvoice = this.getActiveInvoiceContext();
    if (activeInvoice) {
      activeInvoice.customer = { ...normalizedCustomer };
    }
    this.showCustomerDropdown = false;
    this.saveDataToLocalStorage();
  }

  activeCustomerIndex = 0;
  async onCustomerSearchInput(event: any) {
    const rawInput = (event.target?.value ?? '') as string;
    this.customerSearchTerm = rawInput.trim();

    const normalizedQuery = this.normalizeSearchText(this.customerSearchTerm);

    if (!normalizedQuery) {
      this.customerSuggestions = [];
      this.showCustomerDropdown = false;
      return;
    }

    // Lấy dữ liệu từ IndexedDB
    const db = await this.indexedDBService.getDB('Client', 1);
    const tx = db.transaction('customers', 'readonly');
    const store = tx.objectStore('customers');
    const allCustomers = await store.getAll();

    const queryTokens = normalizedQuery.split(' ').filter(Boolean);

    this.customerSuggestions = allCustomers.filter((customer: Customer) =>
      this.matchesCustomerSearch(customer, queryTokens)
    );

    this.activeCustomerIndex = 0;
    this.showCustomerDropdown = this.customerSuggestions.length > 0;
    this.saveDataToLocalStorage();
  }

  // REFACTORED: Consolidated duplicate if/else logic
  onCustomerDelete(event: KeyboardEvent) {
    // Kiểm tra nếu sau khi delete/backspace mà input rỗng
    setTimeout(() => {
      const inputValue = (event.target as HTMLInputElement).value;
      if (!inputValue || inputValue.trim() === '') {
        this.selectedCustomer = null;
        this.showCustomerDropdown = false;
        this.customerSuggestions = [];
        const activeInvoice = this.getActiveInvoiceContext();
        if (activeInvoice) {
          activeInvoice.customer = null;
        }
      }
      this.saveDataToLocalStorage();
    }, 0);
  }
  onCustomerKeyDown(event: KeyboardEvent) {
    if (!this.customerSuggestions || this.customerSuggestions.length === 0) return;

    if (event.key === 'ArrowDown') {
      if (this.activeCustomerIndex < this.customerSuggestions.length - 1) {
        this.activeCustomerIndex++;
        event.preventDefault();
      }
    } else if (event.key === 'ArrowUp') {
      if (this.activeCustomerIndex > 0) {
        this.activeCustomerIndex--;
        event.preventDefault();
      }
    } else if (event.key === 'Enter') {
      if (this.customerSuggestions[this.activeCustomerIndex]) {
        this.selectCustomer(this.customerSuggestions[this.activeCustomerIndex]);
        event.preventDefault();
      }
    }
  }

  private normalizeSearchText(value: string | null | undefined): string {
    return this.customerValidation.normalizeSearchText(value);
  }

  private matchesCustomerSearch(customer: Customer, tokens: string[]): boolean {
    return this.customerValidation.matchesCustomerSearch(customer, tokens);
  }
  @HostListener('window:keydown', ['$event'])
  handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'F3') {
      event.preventDefault(); // Ngăn trình duyệt mở tìm kiếm mặc định
      this.productSearchComponent?.focusSearchInput();
      if (this.productSearchComponent?.searchInputElement) {
        this.productSearchComponent.searchInputElement.nativeElement.select();
      }
    }
    if (event.key === 'Enter') {
      event.preventDefault(); // Ngăn trình duyệt mở tìm kiếm mặc định
      this.productSearchComponent?.focusSearchInput();
      if (this.productSearchComponent?.searchInputElement) {
        this.productSearchComponent.searchInputElement.nativeElement.select();
      }
    }
    if (event.key === 'F4') {
      event.preventDefault(); // Ngăn trình duyệt mở tìm kiếm mặc định
      this.customerSearchComponent?.focusSearchInput();
    }
    if (event.key === 'F1') {
      event.preventDefault();
      setTimeout(() => {
        if (this.productSearchComponent?.searchInputElement) {
          this.productSearchComponent.searchInputElement.nativeElement.select(); // Bôi đen toàn bộ sau mỗi lần input thay đổi
        }
      }, 0);
      // Kiểm tra chế độ hiện tại để tạo đúng loại tab
      if (this.isOrderMode) {
        this.addOrderTab();
      } else {
        this.addInvoiceTab();
      }
    }
    if (event.key === 'F2') {
      event.preventDefault();
      this.togglePrint();
    }
    if (event.key === 'F9') {
      event.preventDefault();
      if (this.isEditMode) {
        if (this.isEditModeInvoice) {
          void this.saveEditedInvoice();
        } else {
          void this.saveEditedOrder();
        }
      } else if (this.isOrderMode) {
        this.order();
      } else {
        this.checkout();
      }
    }
    if (event.altKey && !event.ctrlKey && !event.metaKey) {
      const key = event.key;
      let idx = -1;
      if (key >= '1' && key <= '9') {
        idx = parseInt(key, 10) - 1;
      } else if (key === '0') {
        idx = 9;
      }
      if (idx >= 0 && idx < this.cartItems.length) {
        event.preventDefault();
        this.removeItem(idx);
      }
    }
    // Alt + number sequence: xóa item ở index >= 0 (Alt+2+5 => xóa item 25)
    if (event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
      if (event.key >= '0' && event.key <= '9') {
        this._removeItemKeyBuffer += event.key;
        // Chỉ thực hiện xóa khi buffer có từ 2 số trở lên
        if (this._removeItemKeyBuffer.length >= 2) {
          const idx = parseInt(this._removeItemKeyBuffer, 10);
          if (!isNaN(idx) && idx < this.cartItems.length) {
            event.preventDefault();
            this.removeItem(idx);
          }
          this._removeItemKeyBuffer = '';
        }
      } else {
        // Nếu nhấn phím không phải số, reset buffer
        this._removeItemKeyBuffer = '';
      }
      return;
    }
  }
  private _removeItemKeyBuffer = '';
  handleClick(event: MouseEvent) {
    event.preventDefault(); // Ngăn trình duyệt mở tìm kiếm mặc định
    this.productSearchComponent?.focusSearchInput();
    if (this.productSearchComponent?.searchInputElement) {
      this.productSearchComponent.searchInputElement.nativeElement.select();
    }
  }
  // REFACTORED: Delegate to CartStateService
  getCartTotal(): number {
    return this.cartState.getCartTotal();
  }

  private getActiveInvoiceContext(): InvoiceTab | null {
    return this.invoiceContext.getActiveInvoiceContext({
      isOrderMode: this.isOrderMode,
      orders: this.orders,
      activeOrderTabIndex: this.activeOrderTabIndex,
      invoices: this.invoices,
      activeTabIndex: this.activeTabIndex
    });
  }

  private ensureInvoiceVat(invoice?: InvoiceTab | null): number {
    return this.invoiceContext.ensureInvoiceVat(invoice, this.DEFAULT_INVOICE_VAT);
  }

  private syncInvoiceVatPercent(): void {
    const multiplier = this.ensureInvoiceVat(this.getActiveInvoiceContext());
    this.invoiceVatPercent = this.invoiceContext.calculateVatPercent(multiplier);
  }

  onInvoiceVatPercentChange(value: number | string): void {
    const numeric = typeof value === 'number' ? value : Number(value);
    const safeValue = Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
    this.invoiceVatPercent = safeValue;

    const target = this.getActiveInvoiceContext();
    this.invoiceContext.updateInvoiceVat({
      invoice: target,
      vatPercent: safeValue
    });

    this.saveDataToLocalStorage();
  }

  getTotalAmountWithVAT(): number {
    const total = this.getTotalAmount();
    const discount = this.discountAmount || 0;
    const multiplier = this.ensureInvoiceVat(this.getActiveInvoiceContext());
    const totalWithVAT = Fn.getTotalWithVAT(total, discount, multiplier);
    return this.roundUpToNearestThousand(Math.max(totalWithVAT, 0));
  }
  // REFACTORED: Delegate to UiHelperService
  roundUpToNearestThousand(amount: number): number {
    return this.uiHelper.roundUpToNearestThousand(amount);
  }

  invoiceNote = ''
  createdDate = '';
  async addInvoiceTab() {
    const newTab = this.invoiceTabOperations.createInvoiceTab({
      tabCounter: this.tabCounter,
      invoiceNote: this.invoiceNote,
      defaultVAT: this.DEFAULT_INVOICE_VAT
    });

    this.tabCounter++;
    this.invoices.push(newTab);
    this.setActiveTab(this.invoices.length - 1);

    // Reset UI state after creating new tab
    const resetState = this.invoiceTabOperations.getResetStateAfterNewTab();
    this.change = resetState.change;
    this.discountAmount = resetState.discountAmount;
    this.selectedCustomer = resetState.selectedCustomer;
    this.customerSearchTerm = resetState.customerSearchTerm;
    this.formattedCustomerPaid = resetState.formattedCustomerPaid;
    this.invoiceNote = resetState.invoiceNote;
    this.isOrderMode = resetState.isOrderMode;

    this.saveDataToLocalStorage();
    this.scheduleTabDisplayUpdate();
  }

  removeInvoiceTab(index: number) {
    const tabToRemove = this.invoices[index];

    // If tab has no items, remove directly without confirmation
    if (!this.invoiceTabOperations.hasCartItems(tabToRemove)) {
      this.handleRemoveTab(index);
      return;
    }

    // If tab has items, show confirmation dialog
    const dialogRef = this.dialog.open(ConfirmPopupComponent, {
      width: '300px',
      data: { message: 'Bạn có chắc chắn muốn đóng hóa đơn?' }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result === true) {
        this.handleRemoveTab(index);
      }
    });
  }

  private handleRemoveTab(index: number) {
    // Clear localStorage data for this tab
    this.localStorageService.clearTabData(index);

    const result = this.invoiceTabOperations.handleTabRemoval({
      invoices: this.invoices,
      removedIndex: index,
      currentActiveIndex: this.activeTabIndex
    });

    if (result.shouldReset) {
      // Reset last remaining tab to "Hóa đơn 1"
      const resetTab = this.invoiceTabOperations.resetTab(
        this.invoices[0],
        1
      );
      this.invoices[0] = resetTab;
      this.tabCounter = 2;
      this.setActiveTab(0);
    } else {
      // Remove the tab
      this.invoices.splice(index, 1);

      // Ensure at least one tab exists
      if (this.invoices.length === 0) {
        this.addInvoiceTab();
      } else {
        this.setActiveTab(result.newActiveIndex);
      }

      // Sync discount amount
      this.discountAmount = this.invoices[index]?.discountAmount || this.invoices[0]?.discountAmount || 0;
    }

    if (result.newTabCounter !== undefined) {
      this.tabCounter = result.newTabCounter;
    }

    this.saveDataToLocalStorage();
    this.scheduleTabDisplayUpdate();
  }

  setActiveTab(index: number) {
    const invoice = this.invoices[index];
    if (!invoice) return;

    // Update active index
    this.activeTabIndex = index;

    // Load invoice data
    this.ensureInvoiceVat(invoice);
    this.cartItems = [...invoice.cartItems];
    this.selectedCustomer = invoice.customer;
    this.customerSearchTerm = this.selectedCustomer
      ? `${this.selectedCustomer.Name} - ${this.selectedCustomer.ContactNumber || ''}`
      : '';
    this.invoiceNote = invoice.note || '';
    this.discountAmount = invoice.discountAmount || 0;
    this.isOrderMode = false;

    // Auto-calculate customerPaid if not manually set and not from order
    const isManuallySet = (invoice as any).customerPaidManuallySet;
    const isFromOrder = invoice.name?.includes('Hóa đơn từ đơn hàng');
    if (!isManuallySet && !isFromOrder) {
      invoice.customerPaid = this.getTotalAmount() - this.discountAmount;
    }

    // Update UI
    this.syncInvoiceVatPercent();
    this.scrollActiveTabIntoView();
    setTimeout(() => this.productSearchComponent?.searchInputElement?.nativeElement.select(), 0);
  }

  change = 0
  // REFACTORED: Consolidated duplicate if/else logic
  getChangeAmount(): number {
    if (this.invoices[this.activeTabIndex].cartItems.length === 0) {
      this.change = 0;
      return 0;
    }
    const activeInvoice = this.getActiveInvoiceContext();
    const paid = activeInvoice?.customerPaid ? Number(activeInvoice.customerPaid) : 0;
    const total = this.getTotalAmount();
    const discount = this.discountAmount || 0;
    this.change = Fn.getChangeAmount(total, discount, paid);
    return this.change;
  }
  // REFACTORED: Delegate to UiHelperService
  roundToNearestTenThousand(value: number): number {
    return this.uiHelper.roundToNearestTenThousand(value);
  }
  quickAmounts: number[] = [];
  // REFACTORED: Delegate to UiHelperService
  roundUpToNearestStep(value: number, step: number): number {
    return this.uiHelper.roundUpToNearestStep(value, step);
  }
  setquickAmounts() {
    const total = this.getTotalAmount() - (this.discountAmount || 0);
    let quicks: number[] = [];
    if (total < 10000) {
      quicks = [total, 10000, 20000, 50000, 100000, 200000, 500000];
    } else if (total < 20000) {
      quicks = [total, 20000, 50000, 100000, 200000, 500000];
    } else if (total < 50000) {
      quicks = [total, 50000, 100000, 200000, 500000];
    } else if (total < 100000) {
      quicks = [total, 100000, 200000, 500000];
    } else if (total < 150000) {
      quicks = [total, 150000, 200000, 500000];
    } else if (total < 200000) {
      quicks = [total, 200000, 500000];
    } else if (total < 250000) {
      quicks = [total, 250000, 300000, 400000, 500000];
    } else if (total < 300000) {
      quicks = [total, 300000, 400000, 500000];
    } else if (total < 350000) {
      quicks = [total, 350000, 400000, 500000];
    } else if (total < 400000) {
      quicks = [total, 400000, 450000, 500000];
    } else if (total < 450000) {
      quicks = [total, 450000, 500000];
    } else if (total < 500000) {
      quicks = [total, 500000, 550000, 600000, 700000, 800000, 900000, 1000000];
    } else if (total < 550000) {
      quicks = [total, 550000, 600000, 700000, 800000, 900000, 1000000];
    } else if (total < 600000) {
      quicks = [total, 600000, 700000, 800000, 900000, 1000000];
    } else if (total < 650000) {
      quicks = [total, 650000, 700000, 800000, 900000, 1000000];
    } else if (total < 700000) {
      quicks = [total, 700000, 750000, 800000, 900000, 1000000];
    } else if (total < 750000) {
      quicks = [total, 750000, 800000, 900000, 1000000];
    } else if (total < 800000) {
      quicks = [total, 800000, 900000, 1000000];
    } else if (total < 850000) {
      quicks = [total, 850000, 900000, 1000000];
    } else if (total < 900000) {
      quicks = [total, 900000, 1000000];
    } else if (total < 950000) {
      quicks = [total, 950000];
    } else if (total < 1000000) {
      quicks = [total, 1000000];
    } else if (total < 1100000) {
      quicks = [total, 1100000, 1200000, 1500000];
    } else if (total < 1200000) {
      quicks = [total, 1200000, 1500000];
    } else if (total < 1300000) {
      quicks = [total, 1300000, 1400000, 1500000];
    } else if (total < 1400000) {
      quicks = [total, 1400000, 1500000];
    } else if (total < 1500000) {
      quicks = [total, 1500000];
    } else if (total < 1600000) {
      quicks = [total, 1600000];
    } else if (total < 1700000) {
      quicks = [total, 1700000];
    } else if (total < 1800000) {
      quicks = [total, 1800000];
    } else if (total < 1900000) {
      quicks = [total, 1900000];
    } else if (total < 2000000) {
      quicks = [total, 2000000];
    } else if (total < 2500000) {
      quicks = [total, 2500000, 3000000];
    } else if (total < 3000000) {
      quicks = [total, 3000000];
    } else if (total < 4000000) {
      quicks = [total, 4000000];
    } else if (total < 5000000) {
      quicks = [total, 5000000];
    } else if (total < 10000000) {
      quicks = [total, 10000000];
    } else {
      quicks = [total];
    }
    // Loại bỏ các giá trị trùng lặp và <=0
    this.quickAmounts = quicks
      .filter((v, i, arr) => arr.indexOf(v) === i && v > 0)
      .map(v => this.roundUpToNearestStep(v, 1000));
  }

  onUnitPriceInput(event: any, item: CartItem) {
    const value = Number(event.target.value.replace(/\D/g, ''));
    item.unitPrice = value;
    this.updateItemTotal(item);

    // Tính chênh lệch nếu giá nhập nhỏ hơn giá gốc
    item.unitPriceSaleOff = item.product.BasePrice - value;

  }

  showMenuDropdown = false;

  onMenuClick(type: string) {
    this.showMenuDropdown = false;
    // Xử lý chuyển tab hoặc mở modal tương ứng
    if (type === 'hanghoa') {
      this.saveDataToLocalStorage();
      this.router.navigate(['/edit-product-page']);
    } else if (type === 'hoadon') {
      const dialogRef = this.dialog.open(InvoicesPageComponent, {
        width: '100%',
        height: '100%',
        panelClass: 'slide-in-modal',
        disableClose: false
      });

      dialogRef.afterClosed().subscribe((result: any) => {
        this.processInvoiceEditResult(result);
      });
    } else if (type === 'khachhang') {
      const dialogRef = this.dialog.open(CustomersPageComponent, {
        width: '100%',
        height: '100%',
        maxWidth: '100vw',
        panelClass: 'slide-in-modal',
        disableClose: false
      });

      dialogRef.afterClosed().subscribe((result: any) => {
        this.processInvoiceEditResult(result);
      });
    } else if (type === 'baocao') {
      this.dialog.open(ReportPageComponent, {
        width: '100%',
        height: '100%',
        panelClass: 'slide-in-modal',
        disableClose: false
      });
    } else if (type === 'dathang') {
      this.saveDataToLocalStorage();
      this.dialog.open(OrderPageComponent, {
        width: '100%',
        height: '100%',
        maxWidth: '100vw',
        panelClass: 'slide-in-modal',
        disableClose: false
      });
    } else if (type === 'dangxuat') {
      const confirmed = confirm('Bạn có chắc chắn muốn đăng xuất?');
      if (confirmed) {
        // Xóa thông tin đăng nhập khỏi localStorage
        localStorage.removeItem('kv_access_token');
        localStorage.removeItem('kv_retailer');
        localStorage.removeItem('kv_branch_id');

        // Chuyển hướng về trang login
        this.router.navigate(['/login']);
      }
    }
  }

  private processInvoiceEditResult(result: any): void {
    if (!result?.edit || !result.invoice) {
      return;
    }

    const inv = result.invoice as InvoiceTab;
    const newTab: InvoiceTab = {
      id: inv.id || ('HD' + Date.now().toString()),
      name: inv.name || ('Hóa đơn ' + this.tabCounter),
      cartItems: [...(inv.cartItems || [])],
      createdDate: inv.createdDate || new Date().toISOString(),
      totalPrice: inv.totalPrice || this.getTotalAmount(),
      discountAmount: inv.discountAmount || 0,
      customer: inv.customer ? { ...inv.customer } : null,
      totalQuantity: inv.totalQuantity || 0,
      debt: inv.debt || 0,
      note: inv.note || '',
      customerPaid: inv.customerPaid || 0,
      totalCost: inv.totalCost || 0,
    } as InvoiceTab;

    this.tabCounter++;
    this.invoices.push(newTab);
    this.setActiveTab(this.invoices.length - 1);

    this.cartItems = [...(inv.cartItems || [])];
    this.discountAmount = inv.discountAmount || 0;
    this.selectedCustomer = inv.customer ? { ...inv.customer } : null;
    this.invoiceNote = inv.note || '';

    this.isEditMode = true;
    this.isEditModeInvoice = !!result.isInvoiceEdit;
    if (this.isEditModeInvoice) {
      this.originalInvoiceId = inv.id || null;
      this.originalOrderId = null;
    } else {
      this.originalOrderId = inv.id || null;
      this.originalInvoiceId = null;
    }

    this.saveDataToLocalStorage();
  }

  isReloading = false;
  hasOfflineInvoices = false;

  isPrintEnabled = false;

  togglePrint() {
    this.isPrintEnabled = !this.isPrintEnabled;
  }
  selectIfNotSelected(event: MouseEvent): void {
    const input = event.target as HTMLInputElement;
    // Nếu chưa có phần nào được chọn (hoặc người dùng click sai vị trí)
    if (input.selectionStart !== 0 || input.selectionEnd !== input.value.length) {
      setTimeout(() => input.select(), 0);
    }
  }
  increaseQuantity(item: CartItem): void {
    if (item.quantity < item.product.OnHand) {
      item.quantity += 1;
      this.updateItemTotal(item); // Đã bao gồm updateInvoiceTotalPrice()
    }
  }
  closeInvoice() {
    const dialogRef = this.dialog.open(ConfirmPopupComponent, {
      width: '300px',
      data: { message: 'Bạn có chắc chắn muốn đóng hóa đơn?' }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result === true) {
        // Thực hiện đóng hóa đơn
        console.log('Hóa đơn đã được đóng');
      } else {
        console.log('Hủy thao tác đóng hóa đơn');
      }
    });
  }

  formattedCustomerPaid = '0';

  // REFACTORED: Delegate to UiHelperService
  formatNumberWithCommas(value: number): string {
    return this.uiHelper.formatNumberWithCommas(value);
  }

  // REFACTORED: Consolidated duplicate if/else logic
  onCustomerPaidChange(event: Event): void {
    const input = (event.target as HTMLInputElement).value;
    const raw = parseInt(input.replace(/,/g, ''), 10);
    const paid = isNaN(raw) ? 0 : raw;
    const activeInvoice = this.getActiveInvoiceContext();
    if (activeInvoice) {
      activeInvoice.customerPaid = paid;
      (activeInvoice as any).customerPaidManuallySet = true;
    }
  }

  // REFACTORED: Use getActiveInvoiceContext()
  onNoteChange() {
    const activeInvoice = this.invoices[this.activeTabIndex];
    if (activeInvoice) {
      activeInvoice.note = this.invoiceNote;
      this.saveDataToLocalStorage();
    }
  }

  openAddCustomerDialog() {
    const dialogRef = this.dialog.open(AddCustomerComponent, {
      width: '100%',
      height: '100%',
      disableClose: true,
      data: { customer: null } // Truyền dữ liệu nếu cần
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        // Nếu có kết quả trả về, cập nhật danh sách khách hàng
        this.customerService.loadCustomersFromKiotvietToIndexedDB().then(() => {
          console.log('Tất cả customer đã được tải và lưu vào IndexedDB.');
        }).catch((err) => {
          console.error('Lỗi khi tải tất cả customer:', err);
        });
      }
    });
  }

  async syncCartItemsWithIndexedDB() {
    if (!this.salesDbReady) {
      console.warn('⚠️ SalesDB chưa có dữ liệu, bỏ qua syncCartItemsWithIndexedDB.');
      return;
    }

    try {
      for (const item of this.cartItems) {
        const latestProduct = await this.productService.getProductByIdFromIndexedDB(item.product.Id);
        if (latestProduct) {
          item.product = { ...latestProduct };
          item.unitPrice = latestProduct.BasePrice;
        }
      }
      this.syncCartWithInvoice();
    } catch (error) {
      console.error('❌ Lỗi khi đồng bộ cart với IndexedDB:', error);
    }
  }

  showEditOnHandIndex: number | null = null;
  editOnHandValue = 0;

  openEditOnHandPopup(index: number) {
    this.showEditOnHandIndex = index;
    this.editOnHandValue = this.cartItems[index].product.OnHand;
  }
  closeEditOnHandPopup() {
    this.showEditOnHandIndex = null;
  }
  async confirmEditOnHand(index: number) {
    const item = this.cartItems[index];
    const newOnHand = this.editOnHandValue;
    item.product.OnHand = this.editOnHandValue;

    try {
      const masterUnitId = item.product.MasterUnitId || item.product.Id;
      const group = this.groupedProducts[masterUnitId];
      if (!group || group.length === 0) {
        console.error('Không tìm thấy group cho sản phẩm:', item.product.Id);
        return;
      }

      // Tìm master item (nếu có)
      const masterItem = group.find(p => p.MasterUnitId == null) || group[0];
      const selectedProduct = item.product;
      const masterOnHand = newOnHand * selectedProduct.ConversionValue;

      console.log(`confirmEditOnHand: updating master ${masterItem.Id} OnHand -> ${masterOnHand}`);

      // 1) Cập nhật KiotViet (master item)
      try {
        const formData = await this.kiotvietService.getRequestBody(masterItem.Id);
        formData.Product.OnHand = masterOnHand;
        const kvRes = await this.kiotvietService.updateProductToKiotviet(formData);
        console.log('✅ KiotViet update result:', kvRes);
      } catch (kvErr) {
        console.error('❌ Lỗi khi cập nhật KiotViet:', kvErr);
        // tiếp tục để cập nhật local/remote khác
      }

      // 2) Chuẩn bị danh sách sản phẩm để cập nhật (IndexedDB + Firestore/API)
      const productsToUpdate: Product[] = [];
      for (const p of group) {
        const newProductOnHand = masterOnHand / p.ConversionValue;
        p.OnHand = newProductOnHand;
        productsToUpdate.push({ ...p });
      }

      // 3) Cập nhật IndexedDB cục bộ
      try {
        await this.productService.updateProductsOnHandLocal(productsToUpdate);
        console.log(`✅ Updated ${productsToUpdate.length} product(s) in IndexedDB`);
        // Also emit per-product update and notify server so other clients receive real-time event
        for (const p of productsToUpdate) {
          try {
            await this.productService.updateSingleProductOnHandLocal(p.Id, p.OnHand);
          } catch (e) {
            console.warn('⚠️ updateSingleProductOnHandLocal failed for', p.Id, e);
          }
        }
      } catch (dbErr) {
        console.error('❌ Lỗi khi cập nhật IndexedDB:', dbErr);
      }

      // 4) Gửi lên Firestore / backend API
      let remoteRes: any = null;
      try {
        if (typeof (this.productService as any).updateProductOnHandToFireStore === 'function') {
          remoteRes = await (this.productService as any).updateProductOnHandToFireStore(productsToUpdate);
          console.log('✅ Called productService.updateProductOnHandToFireStore(), result:', remoteRes);
        } else if ((this.productService as any).http && (this.productService as any).firebase?.update_products_api) {
          // fallback nếu service định nghĩa url trong productService.firebase.update_products_api
          const url = environment.domainUrl + (this.productService as any).firebase.update_products_api;
          remoteRes = await firstValueFrom((this.productService as any).http.put(url, productsToUpdate));
          console.log('✅ Fallback HTTP PUT to', url, 'result:', remoteRes);
        } else {
          // Generic fallback to known endpoint
          const url = environment.domainUrl + '/api/firebase/update/products';
          if ((this.productService as any).http) {
            remoteRes = await firstValueFrom((this.productService as any).http.put(url, productsToUpdate));
            console.log('✅ Fallback HTTP PUT to /api/firebase/update/products result:', remoteRes);
          } else {
            console.warn('⚠️ No HTTP client available on productService to call backend update API.');
          }
        }
      } catch (remoteErr) {
        console.error('❌ Lỗi khi gửi cập nhật lên backend/Firestore:', remoteErr);
      }

      // 4b) Previously emitted a batched socket notification here.
      // Backend now processes REST updates and will broadcast to websocket clients itself.
      // Instead, poll the backend for the freshest product docs and persist them locally.
      try {
        const ids = productsToUpdate.map(p => p.Id);
        await this.productService.fetchProductsByIds(ids);
      } catch (fetchErr) {
        console.warn('⚠️ Failed to fetch latest products after update:', fetchErr);
      }

      // 5) Đánh dấu sản phẩm đã chỉnh tay để tránh ghi đè không mong muốn
      productsToUpdate.forEach(p => this.manuallyEditedOnHandProductIds.add(p.Id));

      // 6) Cập nhật UI / localStorage
      this.saveDataToLocalStorage();

      // 7) No websocket listener — backend will broadcast after REST update. Clients use polling/fetch endpoints.

      console.log(`✅ Hoàn thành cập nhật OnHand cho group ${masterUnitId}`);
    } catch (e) {
      console.error('❌ Lỗi cập nhật OnHand:', e);
    }

    this.closeEditOnHandPopup();
  }

  // Kiểm tra có invoice offline không
  async checkOfflineInvoices() {
    try {
      const offlineInvoices = await this.invoiceService.getAllOfflineInvoices();
      this.hasOfflineInvoices = offlineInvoices.length > 0;
    } catch (error) {
      console.error('Lỗi khi kiểm tra offline invoices:', error);
      this.hasOfflineInvoices = false;
    }
  }

  openOfflineInvoicesDialog() {
    const dialogRef = this.dialog.open(OfflineInvoicesListComponent, {
      width: '90%',
      maxWidth: '1000px',
      height: '80%',
      maxHeight: '400px',
      disableClose: false,
      panelClass: 'offline-invoices-dialog'
    });
    // this.productService.syncAllProductsFromIndexedDBToFirebase().then(() => {
    //   console.log('Tất cả sản phẩm đã được tải và lưu lên Firebase.');
    // }).catch((err) => {
    //   console.error('Lỗi khi tải tất cả sản phẩm:', err);
    // }),
    dialogRef.afterClosed().subscribe(() => {
      // Cập nhật trạng thái offline sau khi đóng dialog
      this.checkOfflineInvoices();
    });
  }

  ngOnDestroy() {
    // Socket cleanup no longer required (websockets removed on server)
    if (this.onHandReloadInterval) {
      clearInterval(this.onHandReloadInterval);
      this.onHandReloadInterval = null;
    }

    // Unsubscribe from all subscriptions
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions = [];
  }

  private manuallyEditedOnHandProductIds = new Set<number>();


  openOutOfStockDialog() {
    this.dialog.open(OutOfStockDialogComponent, {
      width: '100%',
      maxWidth: '1000px',
      height: '80%',
      maxHeight: '600px',
      disableClose: false
    });
  }

  isOrderMode = false;

  enableOrderMode() {
    if (!this.isOrderMode) {
      // Chuyển sang Order Mode
      // Convert invoice tab hiện tại thành order tab
      this.isOrderMode = true;

      // Lấy invoice tab hiện tại
      const currentInvoice = this.invoices[this.activeTabIndex];

      // Tạo order tab mới từ invoice tab hiện tại
      const newOrderTab: InvoiceTab = {
        id: 'DH' + Date.now().toString(),
        name: 'Đơn đặt hàng ' + (this.orders.length + 1),
        cartItems: [...currentInvoice.cartItems],
        createdDate: currentInvoice.createdDate,
        totalPrice: currentInvoice.totalPrice,
        discountAmount: currentInvoice.discountAmount,
        customer: currentInvoice.customer ? { ...currentInvoice.customer } : null,
        totalQuantity: currentInvoice.totalQuantity,
        debt: currentInvoice.debt,
        note: currentInvoice.note,
        customerPaid: 0, // Order luôn có customerPaid = 0
        totalCost: currentInvoice.totalCost,
        invoiceVAT: this.ensureInvoiceVat(currentInvoice)
      };
      (newOrderTab as any).customerPaidManuallySet = false;

      // Thêm order tab vào danh sách orders
      this.orders.push(newOrderTab);
      this.activeOrderTabIndex = this.orders.length - 1;

      // Không xóa invoice tab hiện tại, chỉ chuyển sang order mode
      // Giữ nguyên invoice tab để có thể chuyển về sau

      // Đồng bộ cartItems với order tab mới (không gọi setActiveOrderTab vì nó sẽ reset cartItems)
      this.cartItems = [...newOrderTab.cartItems];
      this.discountAmount = newOrderTab.discountAmount;
      this.selectedCustomer = newOrderTab.customer;
      this.invoiceNote = newOrderTab.note || '';

      // Cập nhật order tab với cartItems hiện tại
      this.orders[this.activeOrderTabIndex].cartItems = [...this.cartItems];
      this.orders[this.activeOrderTabIndex].discountAmount = this.discountAmount;
      this.orders[this.activeOrderTabIndex].customer = this.selectedCustomer;
      this.orders[this.activeOrderTabIndex].note = this.invoiceNote;

      console.log('✅ Chuyển sang Order Mode - Convert invoice tab thành order tab');
    } else {
      // Tắt Order Mode, trở về invoice
      this.isOrderMode = false;

      // Đồng bộ dữ liệu từ order tab về invoice tab hiện tại
      if (this.orders[this.activeOrderTabIndex]) {
        const currentOrder = this.orders[this.activeOrderTabIndex];
        this.invoices[this.activeTabIndex].cartItems = [...currentOrder.cartItems];
        this.invoices[this.activeTabIndex].discountAmount = currentOrder.discountAmount;
        this.invoices[this.activeTabIndex].customer = currentOrder.customer;
        this.invoices[this.activeTabIndex].note = currentOrder.note;
        this.invoices[this.activeTabIndex].totalPrice = currentOrder.totalPrice;
        this.invoices[this.activeTabIndex].totalQuantity = currentOrder.totalQuantity;
        this.invoices[this.activeTabIndex].totalCost = currentOrder.totalCost;
        this.invoices[this.activeTabIndex].invoiceVAT = this.ensureInvoiceVat(currentOrder);
      }

      // Đồng bộ lại cartItems, discount, note, customer với invoice tab hiện tại
      this.cartItems = [...this.invoices[this.activeTabIndex].cartItems];
      this.discountAmount = this.invoices[this.activeTabIndex].discountAmount || 0;
      this.selectedCustomer = this.invoices[this.activeTabIndex].customer;
      this.invoiceNote = this.invoices[this.activeTabIndex].note || '';
      this.saveDataToLocalStorage();
    }
    this.syncInvoiceVatPercent();
    this.scheduleTabDisplayUpdate();
  }

  async addOrderTab() {
    const newTab = this.invoiceTabOperations.createOrderTab({
      tabCounter: this.orders.length + 1,
      defaultVAT: this.DEFAULT_INVOICE_VAT
    });

    this.orders.push(newTab);
    this.setActiveOrderTab(this.orders.length - 1);

    // Reset UI state
    this.cartItems = [];
    this.discountAmount = 0;
    this.selectedCustomer = null;
    this.customerSearchTerm = '';

    // Ensure customerPaid is 0
    this.orders[this.activeOrderTabIndex].customerPaid = 0;
    this.saveDataToLocalStorage();
    this.scheduleTabDisplayUpdate();
  }

  setActiveOrderTab(index: number) {
    this.activeOrderTabIndex = index;
    this.ensureInvoiceVat(this.orders[index]);
    this.cartItems = [...this.orders[index].cartItems];
    this.selectedCustomer = this.orders[index].customer;
    if (this.selectedCustomer) {
      this.customerSearchTerm = this.selectedCustomer.Name + ' - ' + (this.selectedCustomer.ContactNumber || '');
    } else {
      this.customerSearchTerm = '';
    }
    this.invoiceNote = this.orders[index].note || '';
    this.discountAmount = this.orders[index].discountAmount || 0;
    // Đảm bảo customerPaid luôn = 0 khi chuyển tab
    this.orders[this.activeOrderTabIndex].customerPaid = 0;
    this.saveDataToLocalStorage();
    this.syncInvoiceVatPercent();
    this.scrollActiveTabIntoView();
  }

  // Khi add item vào order.cartItems, luôn set customerPaid = 0
  // private syncCartWithOrder() {
  //   if (this.isOrderMode) {
  //     if (this.orders[this.activeOrderTabIndex]) {
  //       this.orders[this.activeOrderTabIndex].cartItems = [...this.cartItems];
  //       this.orders[this.activeOrderTabIndex].discountAmount = this.discountAmount;
  //       this.orders[this.activeOrderTabIndex].customer = this.selectedCustomer;
  //       this.orders[this.activeOrderTabIndex].note = this.invoiceNote;
  //       this.orders[this.activeOrderTabIndex].customerPaid = 0;
  //     }
  //   } else {
  //     if (this.invoices[this.activeTabIndex]) {
  //       this.invoices[this.activeTabIndex].cartItems = [...this.cartItems];
  //       this.invoices[this.activeTabIndex].discountAmount = this.discountAmount;
  //       this.invoices[this.activeTabIndex].customer = this.selectedCustomer;
  //       this.invoices[this.activeTabIndex].note = this.invoiceNote;
  //     }
  //   }
  //   this.updateInvoiceTotalPrice();
  //   this.saveDataToLocalStorage();
  // }

  // ===================== UI TAB RENDER =====================
  // (Phần này sẽ sửa ở HTML, nhưng cần thêm các hàm này để gọi từ template)
  getOrderTabs() {
    return this.orders;
  }
  getActiveOrderTabIndex() {
    return this.activeOrderTabIndex;
  }
  setStatus(): string {
    // Khi order được tạo, mặc định là pending
    return 'pending';
  }

  // Method to update order status when checkout is successful
  async updateOrderStatusToChecked(orderId: string): Promise<void> {
    try {
      const updateData = { status: 'checked' };
      await firstValueFrom(this.orderService.updateOrderToFirestore(orderId, updateData));

      // Update in IndexedDB
      const order = await this.orderService.getOrderFromDBById(orderId);
      if (order) {
        order.status = 'checked';
        await this.orderService.updateOrderInDB(order);
      }

      // Notify via WebSocket
      await this.orderService.notifyOrderUpdated({ id: orderId, status: 'checked' });

      console.log(`✅ Order ${orderId} status updated to 'checked'`);
    } catch (error) {
      console.error(`❌ Error updating order status to 'checked':`, error);
    }
  }

  // Checkout order (convert order to invoice)
  async checkoutOrder(orderId: string): Promise<void> {
    try {
      // Get order from IndexedDB
      const order = await this.orderService.getOrderFromDBById(orderId);
      if (!order) {
        console.error(`❌ Order ${orderId} not found`);
        return;
      }

      // Check if order is already checked or canceled
      if (order.status === 'checked' || order.status === 'canceled') {
        console.log(`ℹ️ Order ${orderId} is already ${order.status}`);
        return;
      }

      // Update order status to 'checked'
      await this.updateOrderStatusToChecked(orderId);

      // Create invoice from order
      const now = new Date();
      const vnNow = this.timeZoneService.formatVietnamISOString(now);

      const invoice: InvoiceTab = {
        id: 'HD' + Date.now().toString(),
        name: 'Hóa đơn từ đơn hàng ' + order.id,
        cartItems: order.cartItems,
        createdDate: vnNow,
        totalPrice: order.totalPrice,
        discountAmount: order.discountAmount,
        customer: order.customer,
        totalQuantity: order.totalQuantity,
        debt: 0, // Orders don't have debt
        note: order.note,
        customerPaid: order.totalPrice - order.discountAmount, // Full payment
        totalCost: order.totalCost,
        onHandSynced: false
      };

      // Add invoice to Firestore via service (single unified call)
      try {
        await this.invoiceService.notifyInvoiceCreated(invoice);
        console.info(`✅ Order ${orderId} converted to invoice successfully`);
      } catch (err) {
        console.error(`❌ Error converting order to invoice (notify): ${err}`);
        try {
          await this.invoiceService.saveInvoiceToOffline(invoice);
          console.log('✅ Invoice saved to offline store');
        } catch (offlineError) {
          console.error('❌ Error saving to offline store:', offlineError);
        }
      }

    } catch (error) {
      console.error(`❌ Error during order checkout:`, error);
    }
  }

  // Handle processed order from order page
  private handleProcessedOrder(invoice: InvoiceTab, orderId: string): void {
    try {
      console.log(`🔄 Processing order ${orderId} as invoice ${invoice.id} on main page`);
      console.log(`📊 Invoice data:`, {
        customerPaid: invoice.customerPaid,
        totalPrice: invoice.totalPrice,
        discountAmount: invoice.discountAmount,
        debt: invoice.debt,
        isEditMode: (invoice as any).isEditMode
      });

      // Check if this is edit mode
      const isEditMode = (invoice as any).isEditMode || false;

      if (isEditMode) {
        // Handle edit mode
        this.isEditMode = true;
        this.originalOrderId = (invoice as any).originalOrderId || orderId;
        console.log(`📝 Entering edit mode for order ${this.originalOrderId}`);
      } else {
        // Normal processing mode
        this.isEditMode = false;
        this.originalOrderId = null;
      }

      // Switch to invoice mode if currently in order mode
      if (this.isOrderMode) {
        this.isOrderMode = false;
        // Sync current order data before switching
        if (this.orders[this.activeOrderTabIndex]) {
          this.orders[this.activeOrderTabIndex].cartItems = [...this.cartItems];
          this.orders[this.activeOrderTabIndex].discountAmount = this.discountAmount;
          this.orders[this.activeOrderTabIndex].customer = this.selectedCustomer;
          this.orders[this.activeOrderTabIndex].note = this.invoiceNote;
        }
      }

      // Add the processed order as a new invoice tab
      const newInvoiceTab: InvoiceTab = {
        id: invoice.id,
        name: invoice.name || (isEditMode ? `Chỉnh sửa đơn hàng ${orderId}` : `Hóa đơn từ đơn hàng ${orderId}`),
        cartItems: [...invoice.cartItems],
        createdDate: invoice.createdDate,
        totalPrice: invoice.totalPrice,
        discountAmount: invoice.discountAmount,
        customer: invoice.customer ? { ...invoice.customer } : null,
        totalQuantity: invoice.totalQuantity,
        debt: invoice.debt || 0,
        note: invoice.note,
        customerPaid: invoice.customerPaid || 0,
        totalCost: invoice.totalCost,
        deliveryTime: invoice.deliveryTime,
        onHandSynced: invoice.onHandSynced
      } as any;

      // Mark as manually set to prevent auto-override
      (newInvoiceTab as any).customerPaidManuallySet = true;
      if (isEditMode) {
        (newInvoiceTab as any).isEditMode = true;
        (newInvoiceTab as any).originalOrderId = this.originalOrderId;
      }

      console.log(`📊 New invoice tab data:`, {
        customerPaid: newInvoiceTab.customerPaid,
        totalPrice: newInvoiceTab.totalPrice,
        discountAmount: newInvoiceTab.discountAmount,
        debt: newInvoiceTab.debt,
        isEditMode: (newInvoiceTab as any).isEditMode
      });

      // Add to invoices array
      this.invoices.push(newInvoiceTab);

      // Set as active tab
      this.setActiveTab(this.invoices.length - 1);

      // Force update the invoice data to ensure it's not overridden
      const finalInvoiceIndex = this.invoices.length - 1;
      this.invoices[finalInvoiceIndex].customerPaid = invoice.customerPaid || 0;
      this.invoices[finalInvoiceIndex].debt = invoice.debt || 0;
      (this.invoices[finalInvoiceIndex] as any).customerPaidManuallySet = true;
      if (isEditMode) {
        (this.invoices[finalInvoiceIndex] as any).isEditMode = true;
        (this.invoices[finalInvoiceIndex] as any).originalOrderId = this.originalOrderId;
      }

      console.log(`🔧 Force updated invoice data:`, {
        customerPaid: this.invoices[finalInvoiceIndex].customerPaid,
        debt: this.invoices[finalInvoiceIndex].debt,
        customerPaidManuallySet: (this.invoices[finalInvoiceIndex] as any).customerPaidManuallySet,
        isEditMode: (this.invoices[finalInvoiceIndex] as any).isEditMode
      });

      // Update cart items, customer, and other data
      this.cartItems = [...invoice.cartItems];
      this.selectedCustomer = invoice.customer;
      this.discountAmount = invoice.discountAmount;
      this.invoiceNote = invoice.note || '';

      // Update customer search term
      if (this.selectedCustomer) {
        this.customerSearchTerm = this.selectedCustomer.Name + ' - ' + (this.selectedCustomer.ContactNumber || '');
      } else {
        this.customerSearchTerm = '';
      }

      // Keep the original customerPaid from the invoice (which was set from order)
      this.formattedCustomerPaid = (invoice.customerPaid || 0).toString();

      // Save to localStorage
      this.saveDataToLocalStorage();

      // Force UI update
      this.updateInvoiceTotalPrice();

      console.log(`✅ Đã xử lý đơn hàng ${orderId} thành công! Dữ liệu đã được thêm vào tab hóa đơn.`);
      console.log(`📊 Final invoice tab data:`, {
        customerPaid: this.invoices[this.activeTabIndex].customerPaid,
        totalPrice: this.invoices[this.activeTabIndex].totalPrice,
        discountAmount: this.invoices[this.activeTabIndex].discountAmount,
        debt: this.invoices[this.activeTabIndex].debt,
        isEditMode: (this.invoices[this.activeTabIndex] as any).isEditMode
      });

    } catch (error) {
      console.error(`❌ Error handling processed order:`, error);
    }
  }
  async order() {
    if (!this.selectedCustomer) {
      alert('Bạn phải select customer cho order!');
      return;
    }
    const notEnough = await this.checkOnHandFromIndexedDB();
    if (notEnough) {
      this.notifyInsufficientStock();
    }
    if (this.cartItems.length === 0) {
      alert('Giỏ hàng trống!');
      return;
    }
    // Lấy index order hiện tại
    const currentOrderIndex = this.activeOrderTabIndex;
    // Gán các giá trị vào order tab trước khi tạo order object
    const now = new Date();
    const vnNow = this.timeZoneService.formatVietnamISOString(now);
    this.orders[currentOrderIndex].debt = this.getChangeAmount();
    this.orders[currentOrderIndex].note = this.invoiceNote;
    this.orders[currentOrderIndex].createdDate = vnNow;
    this.orders[currentOrderIndex].totalPrice = this.getTotalAmount() - this.discountAmount;
    this.orders[currentOrderIndex].customer = this.selectedCustomer ? { ...this.selectedCustomer } : null;
    this.orders[currentOrderIndex].discountAmount = this.discountAmount;
    this.orders[currentOrderIndex].customerPaid = this.orders[currentOrderIndex].customerPaid || 0;
    this.orders[currentOrderIndex].totalCost = this.getTotalCost();
    this.orders[currentOrderIndex].totalQuantity = this.getTotalQuantity();
    this.orders[currentOrderIndex].deliveryTime = this.deliveryTime;
    // Tạo order object từ tab hiện tại
    const order = {
      ...this.orders[currentOrderIndex],
      cartItems: [...this.cartItems],
      status: this.setStatus(),
      customerPaidManuallySet: false
    };
    // Gửi lên Firestore
    try {
      await firstValueFrom(this.orderService.addOrderToFirestore(order));
      // Phát WebSocket real-time (nếu muốn)
      await this.orderService.notifyOrderCreated(order);
      // Lưu vào IndexedDB (để đồng bộ offline)
      await this.orderService.addOrderToDB(order);
      alert('Đã lưu đơn đặt hàng!');
    } catch (err) {
      // Nếu lỗi, chỉ lưu local
      await this.orderService.addOrderToDB(order);
      alert('Đã lưu đơn đặt hàng (offline)!');
    }
    // Reset giỏ hàng và trạng thái
    this.cartItems = [];
    this.discountAmount = 0;
    this.invoiceNote = '';
    this.selectedCustomer = null;
    this.customerSearchTerm = '';
    this.saveDataToLocalStorage();
  }

  private async reloadCartItemsOnHand() {
    for (const item of this.cartItems) {
      if (item.product && item.product.Id) {
        const latest = await this.productService.getProductByIdFromIndexedDB(item.product.Id);
        if (latest) {
          item.product.OnHand = latest.OnHand;
        }
      }
    }
  }

  removeOrderTab(index: number) {
    // Nếu tab không có item, xóa trực tiếp không cần dialog
    if (!this.orders[index].cartItems || this.orders[index].cartItems.length === 0) {
      this.handleRemoveOrderTab(index);
      return;
    }
    // Nếu tab có item, hiển thị dialog xác nhận
    const dialogRef = this.dialog.open(ConfirmPopupComponent, {
      width: '300px',
      data: { message: 'Bạn có chắc chắn muốn đóng đơn đặt hàng?' }
    });
    dialogRef.afterClosed().subscribe(result => {
      if (result === true) {
        this.handleRemoveOrderTab(index);
      }
    });
  }

  private handleRemoveOrderTab(index: number) {
    // Nếu chỉ còn 1 tab cuối cùng, reset về "Đơn đặt hàng 1"
    if (this.orders.length === 1) {
      const lastTab = this.orders[0];
      lastTab.name = 'Đơn đặt hàng 1';
      lastTab.id = 'DH' + Date.now().toString();
      lastTab.cartItems = [];
      lastTab.customerPaid = 0;
      this.setActiveOrderTab(0);
      this.scheduleTabDisplayUpdate();
      return;
    }
    // Xóa tab
    this.orders.splice(index, 1);
    // Đảm bảo luôn có ít nhất 1 tab
    if (this.orders.length === 0) {
      this.addOrderTab();
    } else {
      // Set active tab mới
      const newIndex = Math.max(index - 1, 0);
      this.setActiveOrderTab(newIndex);
    }
    this.scheduleTabDisplayUpdate();
  }

  async saveEditedOrder() {
    if (!this.originalOrderId) {
      console.error('❌ No original order ID found');
      return;
    }

    const notEnough = await this.checkOnHandFromIndexedDB();
    if (notEnough) {
      this.notifyInsufficientStock();
    }

    if (this.cartItems.length === 0) {
      alert('Giỏ hàng trống!');
      return;
    }

    // Get current invoice tab (which is the edited order)
    const currentInvoiceIndex = this.activeTabIndex;
    // removed unused timestamp variables (vnNow)

    // Update order with edited data
    const updatedOrder = {
      id: this.originalOrderId,
      name: 'Đơn đặt hàng ' + this.originalOrderId,
      cartItems: [...this.cartItems],
      createdDate: this.invoices[currentInvoiceIndex].createdDate, // Keep original creation date
      totalPrice: this.getTotalAmount() - this.discountAmount,
      discountAmount: this.discountAmount,
      customer: this.selectedCustomer ? { ...this.selectedCustomer } : null,
      totalQuantity: this.getTotalQuantity(),
      debt: this.getChangeAmount(),
      note: this.invoiceNote,
      customerPaid: this.invoices[currentInvoiceIndex].customerPaid || 0,
      totalCost: this.getTotalCost(),
      status: 'edited', // Set status to 'edited'
      deliveryTime: this.invoices[currentInvoiceIndex].deliveryTime
    };

    try {
      // Update in Firestore
      await firstValueFrom(this.orderService.updateOrderToFirestore(this.originalOrderId, updatedOrder));
      console.log(`✅ Order ${this.originalOrderId} updated in Firestore`);

      // Update in IndexedDB
      await this.orderService.updateOrderInDB(updatedOrder);
      console.log(`✅ Order ${this.originalOrderId} updated in IndexedDB`);

      // Notify via WebSocket
      await this.orderService.notifyOrderUpdated(updatedOrder);
      console.log(`✅ Order ${this.originalOrderId} update notified via WebSocket`);

      alert(`Đã lưu chỉnh sửa đơn hàng ${this.originalOrderId}!`);

      // Clear local storage data for this tab and remove edit tab
      this.localStorageService.clearTabData(currentInvoiceIndex);
      this.invoices.splice(currentInvoiceIndex, 1);

      // Reset edit flags
      this.isEditMode = false;
      this.originalOrderId = null;

      // Restore tabs UI
      if (this.invoices.length === 0) {
        this.addInvoiceTab();
      } else {
        const newIndex = Math.min(currentInvoiceIndex, this.invoices.length - 1);
        this.setActiveTab(newIndex);
      }

      // Reset UI values
      this.discountAmount = 0;
      this.change = 0;
      this.formattedCustomerPaid = '0';
      this.invoiceNote = '';

      // Optionally notify realtime
      if (typeof (this.invoiceService as any).notifyInvoiceUpdated === 'function') {
        try {
          await (this.invoiceService as any).notifyInvoiceUpdated(updatedOrder);
        } catch (e) { /* ignore */ }
      }
    } catch (error) {
      console.error('❌ Error saving edited order:', error);
      alert('Lỗi khi lưu chỉnh sửa đơn hàng!');
    }
  }

  // Edit mode tracking
  isEditMode = false;
  originalOrderId: string | null = null;
  isEditModeInvoice = false;
  originalInvoiceId: string | null = null;

  // Add saveEditedInvoice implementation (place inside the MainPageComponent class)
  async saveEditedInvoice() {
    if (!this.originalInvoiceId) {
      console.error('❌ No original invoice ID found');
      return;
    }

    const notEnough = await this.checkOnHandFromIndexedDB();
    if (notEnough) {
      this.notifyInsufficientStock();
    }

    if (this.cartItems.length === 0) {
      alert('Giỏ hàng trống!');
      return;
    }

    const currentInvoiceIndex = this.activeTabIndex;
    const updatedInvoice: InvoiceTab = {
      id: this.originalInvoiceId,
      name: this.invoices[currentInvoiceIndex]?.name || ('Hóa đơn ' + this.originalInvoiceId),
      cartItems: [...this.cartItems],
      createdDate: this.invoices[currentInvoiceIndex]?.createdDate || new Date().toISOString(),
      totalPrice: this.getTotalAmount() - (this.discountAmount || 0),
      discountAmount: this.discountAmount || 0,
      customer: this.selectedCustomer ? { ...this.selectedCustomer } : null,
      totalQuantity: this.getTotalQuantity(),
      debt: this.getChangeAmount(),
      note: this.invoiceNote || '',
      customerPaid: this.invoices[currentInvoiceIndex]?.customerPaid || 0,
      totalCost: this.getTotalCost(),
      deliveryTime: this.invoices[currentInvoiceIndex]?.deliveryTime || ''
    };

    try {
      // Update remote (Firestore / API)
      if (typeof (this.invoiceService as any).updateInvoiceToFirestore === 'function') {
        await firstValueFrom((this.invoiceService as any).updateInvoiceToFirestore(updatedInvoice.id, updatedInvoice));
      } else if ((this.invoiceService as any).http && (this.invoiceService as any).firebase?.put_update_invoice) {
        const url = (this.invoiceService as any).firebase.put_update_invoice;
        await firstValueFrom((this.invoiceService as any).http.put(url + updatedInvoice.id, updatedInvoice));
      }

      // Update local IndexedDB
      if (typeof (this.invoiceService as any).updateInvoiceInDB === 'function') {
        await (this.invoiceService as any).updateInvoiceInDB(updatedInvoice);
      } else if (typeof (this.invoiceService as any).addInvoiceToDB === 'function') {
        await (this.invoiceService as any).addInvoiceToDB(updatedInvoice);
      }

      // Print the edited invoice if quick print toggle is enabled
      if (this.isPrintEnabled && this.invoiceDetailComponent) {
        this.invoiceDetailComponent.invoice = updatedInvoice;
        const html = this.invoiceDetailComponent.getHtmlContent?.();
        if (html) {
          this.printService.printHtml(html);
        }
      }

      this.snackBar.open(`Đã lưu chỉnh sửa hóa đơn ${updatedInvoice.id}!`, 'Đóng', {
        duration: 3000
      });

      // Clear local storage data for this tab and remove edit tab
      this.localStorageService.clearTabData(currentInvoiceIndex);
      this.invoices.splice(currentInvoiceIndex, 1);

      // Reset edit flags
      this.isEditMode = false;
      this.isEditModeInvoice = false;
      this.originalInvoiceId = null;

      // Restore tabs UI
      if (this.invoices.length === 0) {
        this.addInvoiceTab();
      } else {
        const newIndex = Math.min(currentInvoiceIndex, this.invoices.length - 1);
        this.setActiveTab(newIndex);
      }

      // Reset UI values
      this.discountAmount = 0;
      this.change = 0;
      this.formattedCustomerPaid = '0';
      this.invoiceNote = '';

      // Optionally notify realtime
      if (typeof (this.invoiceService as any).notifyInvoiceUpdated === 'function') {
        try {
          await (this.invoiceService as any).notifyInvoiceUpdated(updatedInvoice);
        } catch (e) { /* ignore */ }
      }
    } catch (error) {
      console.error('❌ Error saving edited invoice:', error);
      this.snackBar.open('Lỗi khi lưu chỉnh sửa hóa đơn!', 'Đóng', {
        duration: 4000
      });
    }
  }
}