import { Component, OnInit, ViewChild, AfterViewInit, Optional, OnDestroy } from '@angular/core';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { SelectionModel } from '@angular/cdk/collections';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { Customer } from '../../models/customer.model';
import { CustomerService } from '../../services/customer.service';
import { AddCustomerComponent } from './add-customer/add-customer.component';
import { CustomerInvoiceHistoryDialogComponent } from './customer-invoice-history-dialog.component';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-customers-page',
  imports: [
    CommonModule,
    FormsModule,
    MatTableModule,
    MatPaginatorModule,
    MatSortModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatButtonModule,
    MatCheckboxModule,
    MatProgressSpinnerModule
  ],
  templateUrl: './customers-page.component.html',
  styleUrl: './customers-page.component.css'
})
export class CustomersPageComponent implements OnInit, AfterViewInit, OnDestroy {
  displayedColumns: string[] = ['select', 'code', 'name', 'totalSpend', 'debt', 'purchaseRate', 'gift'];
  dataSource: MatTableDataSource<Customer> = new MatTableDataSource<Customer>();
  selection = new SelectionModel<Customer>(true, []);
  isLoading = true;
  isSyncing = false;
  totalDebt = 0;
  totalSpend = 0;
  websocketConnected = false;
  private subscriptions = new Subscription();

  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  constructor(
    private customerService: CustomerService,
    private dialog: MatDialog,
    @Optional() private dialogRef?: MatDialogRef<CustomersPageComponent>
  ) { }

  ngOnInit(): void {
    void this.loadCustomers();
    this.initializeRealtimeSubscriptions();
  }

  ngAfterViewInit(): void {
    this.dataSource.paginator = this.paginator;
    this.dataSource.sort = this.sort;
    this.dataSource.sortingDataAccessor = (item: Customer, property: string): string | number => {
      switch (property) {
        case 'purchaseRate':
          return item.TotalPoint ?? 0;
        case 'gift':
          return this.calculateGiftValue(item);
        case 'debt':
          return item.Debt ?? 0;
        case 'totalSpend':
          return item.TotalRevenue ?? 0;
        case 'code':
          return item.Code || '';
        case 'name':
          return item.Name || '';
        case 'phone':
          return item.ContactNumber || '';
        default:
          return (item as any)[property] ?? '';
      }
    };
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  async loadCustomers(forceRefresh = false): Promise<void> {
    this.isLoading = true;
    try {
      await this.customerService.ensureCustomersSeededFromFirebase(forceRefresh);
      const customers = await this.customerService.getAllCustomersFromIndexedDB();
      this.applyCustomersToTable(customers);
    } catch (error) {
      console.error('Error loading customers:', error);
    } finally {
      this.isLoading = false;
    }
  }

  private initializeRealtimeSubscriptions(): void {
    // WebSocket initialization removed; rely on REST/polling and service connection observable

    const connectionSub = this.customerService.customerConnection$.subscribe((isConnected) => {
      this.websocketConnected = isConnected;
    });
    this.subscriptions.add(connectionSub);

    const updatesSub = this.customerService.customersUpdated$.subscribe(() => {
      void this.refreshCustomersFromCache().catch((error) => {
        console.error('Lỗi khi làm mới dữ liệu khách hàng từ cache:', error);
      });
    });
    this.subscriptions.add(updatesSub);
  }

  private async refreshCustomersFromCache(): Promise<void> {
    const customers = await this.customerService.getAllCustomersFromIndexedDB();
    this.applyCustomersToTable(customers);
  }

  private applyCustomersToTable(customers: Customer[]): void {
    const sorted = [...customers].sort((a, b) => (b.Id ?? 0) - (a.Id ?? 0));
    this.dataSource.data = sorted;
    this.calculateTotals(sorted);
  }

  calculateGiftValue(customer: Customer | null | undefined): number {
    if (!customer) {
      return 0;
    }

    const totalPoint = customer.TotalPoint ?? 0;
    const rawGift = totalPoint * 0.05;
    const rounded = Math.round(rawGift / 1000) * 1000;
    return Number.isFinite(rounded) ? rounded : 0;
  }

  async syncCustomers(): Promise<void> {
    if (this.isSyncing) {
      return;
    }

    this.isSyncing = true;
    try {
      await this.loadCustomers(true);
    } finally {
      this.isSyncing = false;
    }
  }

  calculateTotals(customers: Customer[]): void {
    this.totalDebt = customers.reduce((sum, customer) => sum + (customer.Debt ?? 0), 0);
    this.totalSpend = customers.reduce((sum, customer) => sum + (customer.TotalRevenue ?? 0), 0);
  }

  applyFilter(event: Event): void {
    const filterValue = (event.target as HTMLInputElement).value;
    this.dataSource.filter = filterValue.trim().toLowerCase();

    if (this.dataSource.paginator) {
      this.dataSource.paginator.firstPage();
    }
    this.calculateTotals(this.dataSource.filteredData);
  }

  isAllSelected(): boolean {
    const numSelected = this.selection.selected.length;
    const numRows = this.dataSource.data.length;
    return numSelected === numRows;
  }

  masterToggle(): void {
    this.isAllSelected() ?
      this.selection.clear() :
      this.dataSource.data.forEach(row => this.selection.select(row));
  }

  checkboxLabel(row?: Customer): string {
    if (!row) {
      return `${this.isAllSelected() ? 'select' : 'deselect'} all`;
    }
    return `${this.selection.isSelected(row) ? 'deselect' : 'select'} row ${row.Id}`;
  }

  openAddCustomerDialog(): void {
    const dialogRef = this.dialog.open(AddCustomerComponent, {
      width: '900px',
      maxHeight: '95vh',
      disableClose: true,
    });

    dialogRef.afterClosed().subscribe(result => {
      if (!result) {
        return;
      }

      if (result?.Id) {
        void this.refreshCustomersFromCache();

        if (!this.websocketConnected) {
          void this.loadCustomers(true);
        }

        return;
      }

      void this.loadCustomers();
    });
  }

  getSelectedCount(): number {
    return this.selection.selected.length;
  }

  async deleteSelectedCustomers(): Promise<void> {
    const selectedCustomers = this.selection.selected;
    console.log('Selected customers for deletion:', selectedCustomers);
    if (selectedCustomers.length === 0) {
      alert('Vui lòng chọn khách hàng cần xóa');
      return;
    }

    const confirmed = confirm(`Bạn có chắc chắn muốn xóa ${selectedCustomers.length} khách hàng đã chọn?`);
    if (!confirmed) {
      return;
    }

    this.isLoading = true;
    try {
      const ids = selectedCustomers
        .map((customer) => customer.Id)
        .filter((id): id is number => typeof id === 'number');

      if (ids.length === 0) {
        alert('Không xác định được mã khách hàng hợp lệ để xóa.');
        return;
      }

      const backendDeleted = await this.customerService.deleteCustomersBatch(ids);
      if (!backendDeleted) {
        alert('Có lỗi xảy ra khi xóa khách hàng trên máy chủ. Vui lòng thử lại.');
        return;
      }

      await Promise.all(ids.map((id) => this.customerService.deleteCustomerFromIndexedDB(id)));

      // Reload data sau khi xóa
      await this.loadCustomers();
      this.selection.clear();

      alert(`Đã xóa thành công ${selectedCustomers.length} khách hàng`);
    } catch (error) {
      console.error('Lỗi khi xóa khách hàng:', error);
      alert('Có lỗi xảy ra khi xóa khách hàng');
    } finally {
      this.isLoading = false;
    }
  }

  openCustomerInvoices(customer: Customer): void {
    if (!customer) {
      return;
    }

    const dialogRef = this.dialog.open(CustomerInvoiceHistoryDialogComponent, {
      width: '1024px',
      maxWidth: '95vw',
      maxHeight: '95vh',
      data: { customer }
    });

    const componentInstance = dialogRef.componentInstance;
    let summarySubscription: Subscription | undefined;

    if (componentInstance && typeof customer.Id === 'number') {
      summarySubscription = componentInstance.summaryChange.subscribe((summary) => {
        this.updateCustomerSummary(customer.Id, summary);
      });
    }

    dialogRef.afterClosed().subscribe(async (result: any) => {
      summarySubscription?.unsubscribe();
      if (!result) {
        return;
      }

      if (result.summary && typeof customer.Id === 'number') {
        this.updateCustomerSummary(customer.Id, result.summary);
      }

      if (result?.edit) {
        this.dialogRef?.close(result);
        return;
      }

      if (result === true || result?.deleted) {
        await this.loadCustomers();
      }
    });
  }

  private updateCustomerSummary(customerId: number, summary: { totalAmount: number; totalDebt: number; invoiceCount: number }): void {
    let hasChanges = false;
    const updatedData = this.dataSource.data.map((item) => {
      if (item.Id === customerId) {
        hasChanges = true;
        item.TotalRevenue = summary.totalAmount;
        item.Debt = summary.totalDebt;
        item.InvoiceCount = summary.invoiceCount;
      }
      return item;
    });

    if (hasChanges) {
      this.dataSource.data = [...updatedData];
      this.calculateTotals(updatedData);
    }
  }


}
