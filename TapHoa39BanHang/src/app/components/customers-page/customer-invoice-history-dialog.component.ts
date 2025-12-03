import { AfterViewInit, Component, EventEmitter, Inject, OnInit, Output, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA, MatDialog } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';

import { Customer } from '../../models/customer.model';
import { InvoiceTab } from '../../models/invoice.model';
import { CartItem } from '../../models/cart-item.model';
import { CustomerService } from '../../services/customer.service';
import { ViewSwlectedInvoiceDialogComponent } from '../invoices-page/view-selected-invoice.component';

interface CustomerInvoiceHistoryDialogData {
  customer: Customer;
}

interface CustomerInvoiceSummary {
  totalAmount: number;
  totalDebt: number;
  totalQuantity: number;
  invoiceCount: number;
}

interface CustomerInvoiceDialogResult {
  summary: CustomerInvoiceSummary;
  edit?: boolean;
  invoice?: InvoiceTab;
  cartItems?: CartItem[];
  isInvoiceEdit?: boolean;
  deleted?: boolean;
}

type InvoiceRow = InvoiceTab & { parsedCreatedDate: Date | null };

@Component({
  selector: 'app-customer-invoice-history-dialog',
  standalone: true,
  templateUrl: './customer-invoice-history-dialog.component.html',
  styleUrls: ['./customer-invoice-history-dialog.component.css'],
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatTableModule,
    MatPaginatorModule,
    MatSortModule,
    MatFormFieldModule,
    MatInputModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatProgressSpinnerModule,
    MatTooltipModule
  ]
})
export class CustomerInvoiceHistoryDialogComponent implements OnInit, AfterViewInit {
  private paginatorInstance: MatPaginator | null = null;
  private sortInstance: MatSort | null = null;

  @ViewChild(MatPaginator)
  set paginator(value: MatPaginator | undefined) {
    if (value) {
      this.paginatorInstance = value;
      this.dataSource.paginator = value;
    }
  }

  get paginator(): MatPaginator | null {
    return this.paginatorInstance;
  }

  @ViewChild(MatSort)
  set sort(value: MatSort | undefined) {
    if (value) {
      this.sortInstance = value;
      this.dataSource.sort = value;
    }
  }

  get sort(): MatSort | null {
    return this.sortInstance;
  }

  displayedColumns: string[] = ['id', 'createdDate', 'totalQuantity', 'totalPrice', 'debt', 'actions'];
  dataSource = new MatTableDataSource<InvoiceRow>([]);

  productSearchTerm = '';
  startDate: Date | null = null;
  endDate: Date | null = null;
  totalAmount: number | null = null;

  isLoading = false;
  error: string | null = null;
  totalInvoiceAmount = 0;
  totalInvoiceDebt = 0;
  lastLoadedAt: Date | null = null;

  private invoices: InvoiceRow[] = [];
  private summary: CustomerInvoiceSummary = this.createEmptySummary();

  @Output() summaryChange = new EventEmitter<CustomerInvoiceSummary>();

  constructor(
    private customerService: CustomerService,
    private dialogRef: MatDialogRef<CustomerInvoiceHistoryDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: CustomerInvoiceHistoryDialogData,
    private dialog: MatDialog
  ) {
    this.dataSource.sortingDataAccessor = (item: InvoiceRow, property: string): number | string => {
      switch (property) {
        case 'createdDate':
          return item.parsedCreatedDate ? item.parsedCreatedDate.getTime() : 0;
        case 'totalPrice':
          return this.toNumber(item.totalPrice, this.calculateTotalPrice(item.cartItems || []));
        case 'totalQuantity':
          return this.toNumber(item.totalQuantity, this.calculateTotalQuantity(item.cartItems || []));
        case 'debt':
          return this.toNumber(item.debt, this.calculateInvoiceDebt(item));
        default:
          return (item as any)[property] || '';
      }
    };
  }

  get customer(): Customer {
    return this.data.customer;
  }

  ngOnInit(): void {
    void this.loadInvoices(true);
  }

  ngAfterViewInit(): void {
    const paginator = this.paginator;
    if (paginator) {
      this.dataSource.paginator = paginator;
    }
    const sort = this.sort;
    if (sort) {
      this.dataSource.sort = sort;
    }
  }

  async loadInvoices(forceRefresh = false): Promise<void> {
    if (!this.customer) {
      this.error = 'Không tìm thấy thông tin khách hàng.';
      return;
    }

    const customerId = this.getCustomerId();
    if (!customerId) {
      this.error = 'Khách hàng không có mã định danh hợp lệ.';
      return;
    }

    this.isLoading = true;
    this.error = null;

    try {
      if (forceRefresh) {
        this.customerService.clearCustomerInvoicesCache(customerId);
      }
      const invoices = await this.customerService.getCustomerInvoicesFromFirebase(customerId, forceRefresh);
      this.invoices = invoices.map((invoice) => this.normalizeInvoice(invoice));
      this.updateSummary();
      this.lastLoadedAt = new Date();
      this.applyFilters();
    } catch (err) {
      console.error('❌ Lỗi khi tải danh sách hóa đơn của khách hàng:', err);
      this.error = 'Không thể tải danh sách hóa đơn. Vui lòng thử lại sau.';
    } finally {
      this.isLoading = false;
    }
  }

  applyFilters(): void {
    let filtered = [...this.invoices];

    const productTerm = this.productSearchTerm.trim().toLowerCase();
    if (productTerm) {
      filtered = filtered.filter((invoice) =>
        invoice.cartItems?.some(item =>
          item?.product?.FullName?.toLowerCase().includes(productTerm) ||
          item?.product?.Code?.toLowerCase().includes(productTerm)
        )
      );
    }

    if (this.startDate) {
      const start = this.toStartOfDay(this.startDate).getTime();
      filtered = filtered.filter((invoice) =>
        !invoice.parsedCreatedDate || invoice.parsedCreatedDate.getTime() >= start
      );
    }

    if (this.endDate) {
      const end = this.toEndOfDay(this.endDate).getTime();
      filtered = filtered.filter((invoice) =>
        !invoice.parsedCreatedDate || invoice.parsedCreatedDate.getTime() <= end
      );
    }

    if (this.totalAmount !== null && !Number.isNaN(Number(this.totalAmount))) {
      const minimum = Number(this.totalAmount);
      filtered = filtered.filter((invoice) =>
        this.toNumber(invoice.totalPrice, this.calculateTotalPrice(invoice.cartItems || [])) >= minimum
      );
    }

    this.dataSource.data = filtered;
    const paginator = this.paginator;
    if (paginator) {
      paginator.firstPage();
    }

    this.totalInvoiceAmount = this.summary.totalAmount;
    this.totalInvoiceDebt = this.summary.totalDebt;
  }

  clearFilters(): void {
    this.productSearchTerm = '';
    this.startDate = null;
    this.endDate = null;
    this.totalAmount = null;
    this.applyFilters();
  }
  formatCurrency(amount: number | null | undefined): string {
    const numeric = typeof amount === 'number' ? amount : Number(amount ?? 0);
    return numeric.toLocaleString('vi-VN') + ' ₫';
  }

  formatDate(date: Date | null): string {
    if (!date) {
      return 'Chưa xác định';
    }
    return date.toLocaleString('vi-VN');
  }

  openInvoiceDetail(invoice: InvoiceRow): void {
    const dialogRef = this.dialog.open(ViewSwlectedInvoiceDialogComponent, {
      width: '720px',
      maxWidth: '95vw',
      maxHeight: '95vh',
      data: {
        invoices: invoice,
        cartItems: invoice.cartItems || []
      }
    });

    dialogRef.afterClosed().subscribe(async (result: any) => {
      if (result === true || result?.deleted) {
        this.invoices = this.invoices.filter((item) => item.id !== invoice.id);
        this.updateSummary();
        this.applyFilters();
        this.invalidateCustomerInvoiceCache();
        return;
      }

      if (result?.edit) {
        const invoiceForEdit = {
          ...result.invoice,
          customer: result.invoice?.customer ?? this.customer,
          cartItems: result.invoice?.cartItems ?? result.cartItems ?? []
        };
        const cartItems: CartItem[] = Array.isArray(result.cartItems)
          ? result.cartItems
          : (invoiceForEdit.cartItems || []);

        const normalized = this.normalizeInvoice({ ...invoiceForEdit, cartItems });
        const idx = this.invoices.findIndex((item) => item.id === normalized.id);
        if (idx >= 0) {
          this.invoices[idx] = normalized;
        } else {
          this.invoices.push(normalized);
        }
        this.updateSummary();
        this.applyFilters();

        this.invalidateCustomerInvoiceCache();

        this.closeWithResult({
          edit: true,
          invoice: normalized,
          cartItems: normalized.cartItems || [],
          isInvoiceEdit: !!result.isInvoiceEdit
        });
        return;
      }

      if (result?.refresh) {
        await this.loadInvoices(true);
      }
    });
  }

  close(): void {
    this.closeWithResult();
  }

  trackByInvoiceId(_index: number, invoice: InvoiceRow): string {
    return invoice.id;
  }

  private toStartOfDay(date: Date): Date {
    const normalized = new Date(date);
    normalized.setHours(0, 0, 0, 0);
    return normalized;
  }

  private toEndOfDay(date: Date): Date {
    const normalized = new Date(date);
    normalized.setHours(23, 59, 59, 999);
    return normalized;
  }

  getConnectionStatus(): string {
    return navigator.onLine ? 'Connected' : 'Offline';
  }

  getConnectionIcon(): string {
    return navigator.onLine ? 'wifi' : 'wifi_off';
  }

  getLastLoadedLabel(): string {
    if (!this.lastLoadedAt) {
      return 'Chưa tải';
    }
    return this.lastLoadedAt.toLocaleTimeString('vi-VN');
  }

  get isOnline(): boolean {
    return navigator.onLine;
  }

  private getCustomerId(): number | string | null {
    const directId = (this.customer?.Id ?? (this.customer as any)?.id);
    return directId !== undefined && directId !== null ? directId : null;
  }

  private normalizeInvoice(invoice: InvoiceTab): InvoiceRow {
    const cartItems: CartItem[] = Array.isArray(invoice.cartItems) ? invoice.cartItems : [];
    const totalQuantity = this.toNumber(invoice.totalQuantity, this.calculateTotalQuantity(cartItems));
    const totalPrice = this.toNumber(invoice.totalPrice, this.calculateTotalPrice(cartItems));
    const customerPaid = this.toNumber(invoice.customerPaid, totalPrice);
    const debt = this.toNumber(invoice.debt, Math.max(totalPrice - customerPaid, 0));

    return {
      ...invoice,
      cartItems,
      customer: invoice.customer ? { ...invoice.customer } : { ...this.customer },
      totalQuantity,
      totalPrice,
      customerPaid,
      debt,
      parsedCreatedDate: invoice.createdDate ? new Date(invoice.createdDate) : null
    };
  }

  private calculateTotalQuantity(items: CartItem[]): number {
    return items.reduce((sum, item) => sum + this.toNumber(item?.quantity, 0), 0);
  }

  private calculateTotalPrice(items: CartItem[]): number {
    return items.reduce((sum, item) => {
      const totalPrice = typeof item?.totalPrice === 'number'
        ? item.totalPrice
        : this.toNumber(item?.quantity, 0) * this.toNumber(item?.unitPrice, 0);
      return sum + totalPrice;
    }, 0);
  }

  private calculateInvoiceDebt(invoice: InvoiceRow): number {
    const totalPrice = typeof invoice.totalPrice === 'number'
      ? invoice.totalPrice
      : this.calculateTotalPrice(invoice.cartItems || []);
    const customerPaid = this.toNumber(invoice.customerPaid, 0);
    return this.toNumber(invoice.debt, Math.max(totalPrice - customerPaid, 0));
  }

  private toNumber(value: unknown, fallback = 0): number {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : fallback;
    }

    if (typeof value === 'string') {
      const cleaned = value.replace(/[^0-9-]/g, '');
      if (cleaned.length > 0) {
        const parsed = Number(cleaned);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }

    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  private createEmptySummary(): CustomerInvoiceSummary {
    return {
      totalAmount: 0,
      totalDebt: 0,
      totalQuantity: 0,
      invoiceCount: 0
    };
  }

  private updateSummary(): void {
    const totalAmount = this.invoices.reduce((sum, invoice) =>
      sum + (typeof invoice.totalPrice === 'number' ? invoice.totalPrice : this.calculateTotalPrice(invoice.cartItems || [])), 0);
    const totalDebt = this.invoices.reduce((sum, invoice) => sum + this.calculateInvoiceDebt(invoice), 0);
    const totalQuantity = this.invoices.reduce((sum, invoice) => sum + (invoice.totalQuantity ?? this.calculateTotalQuantity(invoice.cartItems || [])), 0);

    this.summary = {
      totalAmount,
      totalDebt,
      totalQuantity,
      invoiceCount: this.invoices.length
    };

    this.totalInvoiceAmount = totalAmount;
    this.totalInvoiceDebt = totalDebt;
    this.summaryChange.emit({ ...this.summary });
  }

  private buildResultPayload(extra: Partial<CustomerInvoiceDialogResult> = {}): CustomerInvoiceDialogResult {
    this.updateSummary();
    return {
      summary: { ...this.summary },
      ...extra
    };
  }

  private closeWithResult(extra: Partial<CustomerInvoiceDialogResult> = {}): void {
    if (extra.edit || extra.deleted) {
      this.invalidateCustomerInvoiceCache();
    }
    this.dialogRef.close(this.buildResultPayload(extra));
  }

  private invalidateCustomerInvoiceCache(): void {
    const customerId = this.getCustomerId();
    this.customerService.clearCustomerInvoicesCache(customerId);
  }
}
