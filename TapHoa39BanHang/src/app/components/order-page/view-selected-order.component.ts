import { Component, Inject, Input, OnInit, OnDestroy } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialog, MatDialogModule } from '@angular/material/dialog';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { OrderService } from '../../services/order.service';
import { InvoiceService } from '../../services/invoice.service';
import { TimeZoneService } from '../../services/time-zone.service';
import { OrderToInvoiceService } from '../../services/order-to-invoice.service';
import { ConfirmPopupComponent } from '../confirm-popup/confirm-popup.component';
import { Subscription, firstValueFrom } from 'rxjs';
import { InvoiceTab } from '../../models/invoice.model';

@Component({
  selector: 'app-order-detail',
  templateUrl: './view-selected-order.component.html',
  styleUrls: ['./view-selected-order.component.css'],
  imports: [CommonModule, MatIconModule, MatButtonModule, MatDialogModule]
})
export class ViewSwlectedOrderDialogComponent implements OnInit, OnDestroy {
  isDeleting = false;
  lastUpdateTime: Date | null = null;
  private subscriptions: Subscription[] = [];

  constructor(
    public dialogRef: MatDialogRef<ViewSwlectedOrderDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { order: InvoiceTab },
    private orderService: OrderService,
    private invoiceService: InvoiceService,
    private timeZoneService: TimeZoneService,
    private orderToInvoiceService: OrderToInvoiceService,
    private dialog: MatDialog,
  ) { }

  ngOnInit() {
    this.setupRealTimeSubscriptions();
    this.lastUpdateTime = new Date();
  }

  ngOnDestroy() {
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions = [];
  }

  // WebSocket initialization removed; server no longer supports websockets.

  private setupRealTimeSubscriptions(): void {
    const updatedSub = this.orderService.orderUpdated$.subscribe(order => {
      if (order.id === this.data.order.id) {
        this.handleOrderUpdate(order);
      }
    });
    const deletedSub = this.orderService.orderDeleted$.subscribe(orderId => {
      if (orderId === this.data.order.id) {
        this.handleOrderDeleted(orderId);
      }
    });
    this.subscriptions.push(updatedSub, deletedSub);
  }

  close() {
    this.dialogRef.close();
  }

  getTotalPrice(): number {
    return this.data.order.totalPrice;
  }

  getTotalQuantity(): number {
    return this.data.order.totalQuantity;
  }

  formatVnd(amount: number): string {
    return amount ? amount.toLocaleString('vi-VN') + ' ₫' : '';
  }

  async refreshOrderData(): Promise<void> {
    try {
      const updatedOrder = await this.orderService.getOrderFromDBById(this.data.order.id);
      if (updatedOrder) {
        this.data.order = updatedOrder;
        this.lastUpdateTime = new Date();
      }
    } catch (error) {
      // handle error
    }
  }

  getConnectionStatus(): string {
    return 'Polling / Manual sync';
  }

  getLastUpdateTime(): string {
    if (this.lastUpdateTime) {
      return this.lastUpdateTime.toLocaleTimeString('vi-VN');
    }
    return 'Never';
  }

  handleOrderUpdate(updatedOrder: any): void {
    this.data.order = updatedOrder;
    this.lastUpdateTime = new Date();
  }

  handleOrderDeleted(orderId: string): void {
    this.dialogRef.close(true); // true indicates deletion
  }

  // Delete order method
  async deleteOrder() {
    const dialogRef = this.dialog.open(ConfirmPopupComponent, {
      width: '300px',
      data: { message: `Bạn có chắc chắn muốn xóa đơn hàng ${this.data.order.id}?` }
    });

    dialogRef.afterClosed().subscribe(async (result) => {
      if (result === true) {
        try {
          // Delete from IndexedDB
          await this.orderService.deleteOrderFromDB(this.data.order.id);
          
          // Delete from Firestore
          await firstValueFrom(this.orderService.deleteOrderToFirestore(this.data.order.id));
          
          // Notify via WebSocket
          await this.orderService.notifyOrderDeleted(this.data.order.id);
          
          // Close dialog with deletion result
          this.dialogRef.close(true);
          console.log(`✅ Order ${this.data.order.id} has been deleted`);
        } catch (error) {
          console.error('❌ Error deleting order:', error);
        }
      }
    });
  }

  getHtmlContent(): string | null {
    // Try to get the HTML content for printing
    const el = document.querySelector('mat-dialog-content');
    return el ? el.innerHTML : null;
  }

  getStatusText(status: string | undefined): string {
    switch (status) {
      case 'pending':
        return 'Chờ xử lý';
      case 'checked':
        return 'Đã xử lý';
      case 'canceled':
        return 'Đã hủy';
      default:
        return 'Chờ xử lý';
    }
  }
  async handleOrder() {
    if (this.data.order.status === 'checked' || this.data.order.status === 'canceled') {
      console.log(`ℹ️ Order ${this.data.order.id} is already ${this.data.order.status}`);
      return;
    }

        try {
          // Create invoice from order (without changing order status yet)
          const now = new Date();
          const vnNow = this.timeZoneService.formatVietnamISOString(now);
          
          // Calculate the amount due after discount
          const amountDue = this.data.order.totalPrice - this.data.order.discountAmount;
          
          // Keep the original customerPaid from order (what customer has already paid)
          const customerPaid = this.data.order.customerPaid || 0;
          
          // Calculate debt (change amount) - negative means customer owes money, positive means we owe customer
          const debt = customerPaid - amountDue;
          
          console.log(`📊 Order to Invoice conversion:`, {
            orderId: this.data.order.id,
            orderTotalPrice: this.data.order.totalPrice,
            orderDiscountAmount: this.data.order.discountAmount,
            orderCustomerPaid: this.data.order.customerPaid,
            calculatedAmountDue: amountDue,
            calculatedCustomerPaid: customerPaid,
            calculatedDebt: debt
          });
          
          const invoice: InvoiceTab = {
            id: 'HD' + Date.now().toString(),
            name: 'Hóa đơn từ đơn hàng ' + this.data.order.id,
            cartItems: [...this.data.order.cartItems],
            createdDate: vnNow,
            totalPrice: this.data.order.totalPrice,
            discountAmount: this.data.order.discountAmount,
            customer: this.data.order.customer ? { ...this.data.order.customer } : null,
            totalQuantity: this.data.order.totalQuantity,
            debt: debt, // Calculate debt based on what customer has paid vs amount due
            note: this.data.order.note,
            customerPaid: customerPaid, // Keep original customerPaid from order
            totalCost: this.data.order.totalCost
          } as any;
          
          // Mark as manually set to prevent auto-override
          (invoice as any).customerPaidManuallySet = true;
          
          console.log(`📊 Created invoice:`, {
            invoiceId: invoice.id,
            invoiceCustomerPaid: invoice.customerPaid,
            invoiceDebt: invoice.debt,
            invoiceTotalPrice: invoice.totalPrice,
            invoiceDiscountAmount: invoice.discountAmount
          });

          // Emit event to main page to add invoice
          this.orderToInvoiceService.processOrder(invoice, this.data.order.id);

          // Close dialog
          this.dialogRef.close({ 
            success: true, 
            invoice: invoice,
            orderId: this.data.order.id
          });
          console.log(`✅ Order ${this.data.order.id} has been processed and sent to main page`);

        } catch (error) {
          console.error('❌ Error processing order:', error);
        }
  }

  editOrder() {
    try {
      // Create a copy of the order for editing
      const now = new Date();
      const vnNow = this.timeZoneService.formatVietnamISOString(now);

      // Calculate the amount due after discount
      const amountDue = this.data.order.totalPrice - this.data.order.discountAmount;

      // Keep the original customerPaid from order
      const customerPaid = this.data.order.customerPaid || 0;

      // Calculate debt
      const debt = customerPaid - amountDue;

      console.log(`📝 Editing order ${this.data.order.id}`, {
        orderId: this.data.order.id,
        orderTotalPrice: this.data.order.totalPrice,
        orderDiscountAmount: this.data.order.discountAmount,
        orderCustomerPaid: this.data.order.customerPaid,
        calculatedAmountDue: amountDue,
        calculatedCustomerPaid: customerPaid,
        calculatedDebt: debt
      });

      const editedOrder: InvoiceTab = {
        id: this.data.order.id, // Keep the original order ID
        name: 'Chỉnh sửa đơn hàng ' + this.data.order.id,
        cartItems: [...this.data.order.cartItems],
        createdDate: this.data.order.createdDate, // Keep original creation date
        totalPrice: this.data.order.totalPrice,
        discountAmount: this.data.order.discountAmount,
        customer: this.data.order.customer ? { ...this.data.order.customer } : null,
        totalQuantity: this.data.order.totalQuantity,
        debt: debt,
        note: this.data.order.note,
        customerPaid: customerPaid,
        totalCost: this.data.order.totalCost,
        status: this.data.order.status, // Keep original status
        deliveryTime: this.data.order.deliveryTime
      } as any;

      // Mark as manually set to prevent auto-override
      (editedOrder as any).customerPaidManuallySet = true;
      (editedOrder as any).isEditMode = true; // Mark as edit mode
      (editedOrder as any).originalOrderId = this.data.order.id; // Store original order ID

      console.log(`📝 Created edited order:`, {
        orderId: editedOrder.id,
        isEditMode: (editedOrder as any).isEditMode,
        originalOrderId: (editedOrder as any).originalOrderId
      });

      // Emit event to main page to add order for editing
      this.orderToInvoiceService.processOrder(editedOrder, this.data.order.id);

      // Close dialog
      this.dialogRef.close({
        edit: true,
        order: editedOrder,
        orderId: this.data.order.id
      });

      console.log(`✅ Order ${this.data.order.id} has been sent to main page for editing`);

    } catch (error) {
      console.error('❌ Error editing order:', error);
    }
  }
}
