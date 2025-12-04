import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { InvoiceTab } from '../../models/invoice.model';
import { InvoiceService } from '../../services/invoice.service';
import { TimeZoneService } from '../../services/time-zone.service';
import { KiotvietService } from '../../services/kiotviet.service';
import { GroupService } from '../../services/group.service';
import { IndexedDBService } from '../../services/indexed-db.service';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-offline-invoices-list',
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatTableModule,
    MatProgressSpinnerModule
  ],
  templateUrl: './offline-invoices-list.component.html',
  styleUrl: './offline-invoices-list.component.css'
})
export class OfflineInvoicesListComponent implements OnInit {
  offlineInvoices: InvoiceTab[] = [];
  displayedColumns: string[] = ['id', 'customer', 'totalPrice', 'createdDate', 'actions'];
  isLoading = false;

  constructor(
    private dialogRef: MatDialogRef<OfflineInvoicesListComponent>,
    private invoiceService: InvoiceService,
    private timeZoneService: TimeZoneService,
    private kiotvietService: KiotvietService,
    private groupService: GroupService,
    private indexedDBService: IndexedDBService,
  ) { }
  groupedProducts: Record<number, any[]> = {}

  ngOnInit() {
    this.loadOfflineInvoices();
    this.groupDB();
  }
  private async groupDB() {
    const db = await this.indexedDBService.getDB('SalesDB', 1);
    const tx = db.transaction('products', 'readonly');
    const filteredProducts = await tx.store.getAll();
    this.groupedProducts = await this.groupService.group(filteredProducts)

  }
  async loadOfflineInvoices() {
    this.isLoading = true;
    try {
      this.offlineInvoices = await this.invoiceService.getAllOfflineInvoices();
    } catch (error) {
      console.error('Lỗi khi tải danh sách offline invoices:', error);
    } finally {
      this.isLoading = false;
    }
  }

  formatPrice(price: number): string {
    return price.toLocaleString('en-US');
  }

  formatDate(dateString: string): string {
    try {
      const date = this.timeZoneService.parseApiDate(dateString);
      return this.timeZoneService.formatVietnamISOString(date);
    } catch (error) {
      return dateString;
    }
  }

  getCustomerName(invoice: InvoiceTab): string {
    return invoice.customer?.Name || 'Khách lẻ';
  }

  async syncInvoice(invoice: InvoiceTab) {

    try {
      await firstValueFrom(this.invoiceService.addInvoiceToFirestore(invoice));
      await this.invoiceService.ensureInvoiceOnHandSynced(invoice, this.groupedProducts);
      await this.invoiceService.deleteOfflineInvoice(invoice.id);
      await this.loadOfflineInvoices(); // Reload list
      await this.kiotvietService.updateOnHandFromInvoiceToKiotviet(invoice, this.groupedProducts);
      console.log(`Đã sync thành công invoice ${invoice.id}`);
    } catch (error) {
      console.error(`Lỗi khi sync invoice ${invoice.id}:`, error);
      alert('Không thể sync invoice này. Vui lòng thử lại sau.');
    }
  }

  async syncAllInvoices() {
    if (this.offlineInvoices.length === 0) {
      alert('Không có invoice nào để sync');
      return;
    }

    const confirmed = confirm(`Bạn có chắc chắn muốn sync tất cả ${this.offlineInvoices.length} invoice?`);
    if (!confirmed) return;

    this.isLoading = true;
    let successCount = 0;
    let failedCount = 0;

    for (const invoice of this.offlineInvoices) {
      try {
        await firstValueFrom(this.invoiceService.addInvoiceToFirestore(invoice));
        await this.invoiceService.ensureInvoiceOnHandSynced(invoice, this.groupedProducts);
        await this.invoiceService.deleteOfflineInvoice(invoice.id);
        await this.kiotvietService.updateOnHandFromInvoiceToKiotviet(invoice, this.groupedProducts);
        successCount++;
      } catch (error) {
        console.error(`Lỗi khi sync invoice ${invoice.id}:`, error);
        failedCount++;
      }
    }

    await this.loadOfflineInvoices(); // Reload list

    if (successCount > 0) {
      alert(`Đã sync thành công ${successCount} invoice${successCount > 1 ? 's' : ''}`);
    }
    if (failedCount > 0) {
      alert(`Không thể sync ${failedCount} invoice${failedCount > 1 ? 's' : ''}`);
    }

    this.isLoading = false;
  }

  async deleteOfflineInvoice(invoice: InvoiceTab) {
    if (!confirm(`Bạn có chắc chắn muốn xóa hóa đơn offline mã ${invoice.id}?`)) return;
    try {
      await this.invoiceService.deleteOfflineInvoice(invoice.id);
      await this.loadOfflineInvoices();
      console.log(`Đã xóa hóa đơn offline ${invoice.id}`);
    } catch (error) {
      console.error(`Lỗi khi xóa hóa đơn offline ${invoice.id}:`, error);
      alert('Không thể xóa hóa đơn này. Vui lòng thử lại sau.');
    }
  }

  closeDialog() {
    this.dialogRef.close();
  }
}
