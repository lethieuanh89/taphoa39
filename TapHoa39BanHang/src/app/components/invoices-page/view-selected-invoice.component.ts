import { Component, Inject, OnInit, OnDestroy } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule, MatDialog } from '@angular/material/dialog';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { CartItem } from '../../models/cart-item.model';
import { InvoiceTab } from '../../models/invoice.model';
import { InvoiceService } from '../../services/invoice.service';
import { ConfirmPopupComponent } from '../confirm-popup/confirm-popup.component';
import { firstValueFrom, Subscription } from 'rxjs';

@Component({
  selector: 'app-invoice-detail-dialog',
  templateUrl: './view-selected-invoice.component.html',
  styleUrls: ['./view-selected-invoice.component.css'],
  imports: [
    CommonModule,
    MatDialogModule,
    MatIconModule,
    MatButtonModule
  ]
})
export class ViewSwlectedInvoiceDialogComponent implements OnInit, OnDestroy {
  isDeleting = false;
  lastUpdateTime: Date | null = null;

  // Real-time subscriptions
  private subscriptions: Subscription[] = [];

  constructor(
    public dialogRef: MatDialogRef<ViewSwlectedInvoiceDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { invoices: InvoiceTab, cartItems: CartItem[] },
    private invoiceService: InvoiceService,
    private dialog: MatDialog,
  ) { }

  ngOnInit() {
    this.setupRealTimeSubscriptions();
    this.lastUpdateTime = new Date();
  }

  ngOnDestroy() {
    // Unsubscribe from all real-time events
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions = [];
    console.log('🔌 View invoice dialog destroyed');
  }

  private async initializeWebSocket(): Promise<void> {
    // WebSocket initialization removed; server no longer supports websockets.
  }

  private setupRealTimeSubscriptions(): void {
    // Subscribe to invoice updated events for this specific invoice
    const updatedSub = this.invoiceService.invoiceUpdated$.subscribe(invoice => {
      if (invoice.id === this.data.invoices.id) {
        console.log(`🔄 Real-time: Invoice ${invoice.id} updated in detail view`);
        this.handleInvoiceUpdate(invoice);
      }
    });

    // Subscribe to invoice deleted events for this specific invoice
    const deletedSub = this.invoiceService.invoiceDeleted$.subscribe(invoiceId => {
      if (invoiceId === this.data.invoices.id) {
        console.log(`🗑️ Real-time: Invoice ${invoiceId} deleted in detail view`);
        this.handleInvoiceDeleted(invoiceId);
      }
    });

    // Add subscriptions to the array for cleanup
    this.subscriptions.push(updatedSub, deletedSub);
  }

  close() {
    this.dialogRef.close();
  }

  getTotalPrice(): number {
    return this.data.invoices.totalPrice
  }

  getTotalQuantity(): number {
    return this.data.invoices.totalQuantity
  }

  formatVnd(amount: number): string {
    return amount.toLocaleString('vi-VN') + ' ₫';
  }

  // Enhanced delete method with WebSocket notification
  async deleteInvoice() {
    // Hiển thị popup xác nhận trước khi xóa
    const confirmData = {
      message: 'Bạn có chắc chắn muốn xóa hóa đơn này? Hành động này không thể hoàn tác.'
    };
    
    const dialogRef = this.dialog.open(ConfirmPopupComponent, {
      width: '400px',
      data: confirmData
    });
    
    dialogRef.afterClosed().subscribe(async (confirmed: boolean) => {
      if (confirmed) {
        this.isDeleting = true;
        
        try {
          // Xóa từ Firestore trước
          await firstValueFrom(this.invoiceService.deleteInvoiceToFirestore(this.data.invoices.id));
          console.log('✅ Hóa đơn đã được xóa thành công từ Firestore');
          
          // Xóa từ IndexedDB
          await this.invoiceService.deleteInvoiceFromDB(this.data.invoices.id);
          console.log('✅ Hóa đơn đã được xóa thành công từ IndexedDB');
          
          // Notify other clients via service notify (REST or no-op)
          if (this.invoiceService.notifyInvoiceDeleted) {
            await this.invoiceService.notifyInvoiceDeleted(this.data.invoices.id);
          }

          try {
            await this.invoiceService.restoreInventoryAfterInvoiceDeletion(this.data.invoices);
            console.log('✅ Đã hoàn tồn kho sau khi xóa hóa đơn');
          } catch (restoreErr) {
            console.error('❌ Lỗi khi hoàn tồn kho sau khi xóa hóa đơn:', restoreErr);
          }
          
          this.dialogRef.close(true); // Trả về true để thông báo đã xóa thành công
          
        } catch (error: any) {
          console.error('❌ Lỗi khi xóa hóa đơn:', error);
          
          // Show more detailed error message
          let errorMessage = 'Lỗi khi xóa hóa đơn. Vui lòng thử lại sau.';
          
          if (error.status === 404) {
            errorMessage = 'Hóa đơn không tồn tại hoặc đã bị xóa.';
          } else if (error.status === 403) {
            errorMessage = 'Bạn không có quyền xóa hóa đơn này.';
          } else if (error.status === 0) {
            errorMessage = 'Không thể kết nối đến máy chủ. Vui lòng kiểm tra kết nối mạng.';
          } else if (error.message) {
            errorMessage += ` Chi tiết: ${error.message}`;
          }
          
          alert(errorMessage);
        } finally {
          this.isDeleting = false;
        }
      }
    });
  }

  // Method to refresh invoice data
  async refreshInvoiceData(): Promise<void> {
    try {
      console.log('🔄 Refreshing invoice data...');
      
      // Get latest data from IndexedDB
      const updatedInvoice = await this.invoiceService.getInvoiceFromDBById(this.data.invoices.id);
      
      if (updatedInvoice) {
        this.data.invoices = updatedInvoice;
        this.lastUpdateTime = new Date();
        console.log('✅ Invoice data refreshed successfully');
      } else {
        console.warn('⚠️ Invoice not found in local database');
      }
    } catch (error) {
      console.error('❌ Error refreshing invoice data:', error);
    }
  }

  // Get connection status with more detailed information
  getConnectionStatus(): string {
    return 'Polling / Manual sync';
  }

  // Public method to check WebSocket status for template
  isWebSocketReady(): boolean {
    return false;
  }

  // Get last update time
  getLastUpdateTime(): string {
    if (this.lastUpdateTime) {
      return this.lastUpdateTime.toLocaleTimeString('vi-VN');
    }
    return 'Never';
  }

  // Check if invoice is recent (within last 5 minutes)
  isRecentInvoice(): boolean {
    if (!this.data.invoices.createdDate) return false;
    
    const createdTime = new Date(this.data.invoices.createdDate).getTime();
    const currentTime = new Date().getTime();
    const fiveMinutes = 5 * 60 * 1000; // 5 minutes in milliseconds
    
    return (currentTime - createdTime) < fiveMinutes;
  }

  // Get invoice age in human readable format
  getInvoiceAge(): string {
    if (!this.data.invoices.createdDate) return 'Unknown';
    
    const createdTime = new Date(this.data.invoices.createdDate).getTime();
    const currentTime = new Date().getTime();
    const diffInMinutes = Math.floor((currentTime - createdTime) / (1000 * 60));
    
    if (diffInMinutes < 1) {
      return 'Just now';
    } else if (diffInMinutes < 60) {
      return `${diffInMinutes} minutes ago`;
    } else if (diffInMinutes < 1440) { // Less than 24 hours
      const hours = Math.floor(diffInMinutes / 60);
      return `${hours} hours ago`;
    } else {
      const days = Math.floor(diffInMinutes / 1440);
      return `${days} days ago`;
    }
  }

  // Check if invoice can be edited (recent invoices only)
  canEditInvoice(): boolean {
    return this.isRecentInvoice();
  }

  /**
   * Request to edit this invoice: close dialog and return payload to caller.
   * Caller (InvoicesPageComponent) will handle bubbling this up to MainPage.
   */
  editInvoice() {
    try {
      const payload = {
        edit: true,
        invoice: this.data.invoices,
        cartItems: this.data.cartItems || [],
        isInvoiceEdit: true // <-- mark this as invoice edit
      };
      this.dialogRef.close(payload);
    } catch (err) {
      console.error('❌ Error while requesting invoice edit:', err);
      this.dialogRef.close();
    }
  }

  // Method to handle invoice updates from WebSocket
  handleInvoiceUpdate(updatedInvoice: InvoiceTab): void {
    this.data.invoices = updatedInvoice;
    this.lastUpdateTime = new Date();
    console.log('🔄 Invoice updated via WebSocket');
  }

  // Method to handle invoice deletion from WebSocket
  handleInvoiceDeleted(invoiceId: string): void {
    console.log(`🗑️ Invoice ${invoiceId} was deleted by another user`);
    // Close the dialog since the invoice no longer exists
    this.dialogRef.close();
  }
}
