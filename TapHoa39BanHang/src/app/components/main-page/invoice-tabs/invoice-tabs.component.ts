import { Component, Input, Output, EventEmitter, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { InvoiceTab } from '../../../models/invoice.model';

@Component({
  selector: 'app-invoice-tabs',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './invoice-tabs.component.html',
  styleUrls: ['./invoice-tabs.component.css'],
  encapsulation: ViewEncapsulation.None
})
export class InvoiceTabsComponent {
  @Input() invoices: InvoiceTab[] = [];
  @Input() orders: InvoiceTab[] = [];
  @Input() activeTabIndex: number = 0;
  @Input() activeOrderTabIndex: number = 0;
  @Input() isOrderMode: boolean = false;
  @Input() invoiceTabFontSize: number = 12;
  @Input() showInvoiceTabNumbersOnly: boolean = false;

  @Output() tabSelect = new EventEmitter<number>();
  @Output() orderTabSelect = new EventEmitter<number>();
  @Output() tabRemove = new EventEmitter<number>();
  @Output() orderTabRemove = new EventEmitter<number>();
  @Output() addInvoiceTabClick = new EventEmitter<void>();
  @Output() addOrderTabClick = new EventEmitter<void>();
  @Output() tabWheel = new EventEmitter<WheelEvent>();

  setActiveTab(index: number) {
    this.tabSelect.emit(index);
  }

  setActiveOrderTab(index: number) {
    this.orderTabSelect.emit(index);
  }

  removeInvoiceTab(index: number, event: Event) {
    event.stopPropagation();
    this.tabRemove.emit(index);
  }

  removeOrderTab(index: number, event: Event) {
    event.stopPropagation();
    this.orderTabRemove.emit(index);
  }

  addInvoiceTab() {
    this.addInvoiceTabClick.emit();
  }

  addOrderTab() {
    this.addOrderTabClick.emit();
  }

  onTabWheel(event: WheelEvent) {
    this.tabWheel.emit(event);
  }

  getInvoiceTabName(invoice: InvoiceTab, idx: number): string {
    return invoice.name || `Hóa đơn ${idx + 1}`;
  }

  getOrderTabName(order: InvoiceTab, idx: number): string {
    return order.name || `Đơn hàng ${idx + 1}`;
  }

  getTabDisplayLabel(fullName: string): string {
    if (this.showInvoiceTabNumbersOnly) {
      const match = fullName.match(/\d+/);
      return match ? match[0] : fullName;
    }
    return fullName;
  }

  isTabCompact(tabName: string): boolean {
    return tabName.length > 15;
  }

  shouldShowCloseIcon(idx: number, isOrder: boolean = false): boolean {
    // Luôn hiển thị nút X để có thể reset tên tab về mặc định
    // Khi chỉ có 1 tab: nút X sẽ reset tên (ví dụ "Hóa đơn 35" -> "Hóa đơn 1")
    // Khi có nhiều tab: nút X sẽ xóa tab đó
    return true;
  }
}
