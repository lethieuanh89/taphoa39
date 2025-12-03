import { Component, ElementRef, Inject, Input, ViewChild, OnInit, Optional } from '@angular/core';
import { InvoiceTab } from '../../models/invoice.model';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TimeZoneService } from '../../services/time-zone.service';

@Component({
  selector: 'app-invoice-detail',
  templateUrl: './invoice-detail.component.html',
  styleUrls: ['./invoice-detail.component.css'],
  imports: [CommonModule]
})
export class InvoiceDetailComponent implements OnInit {
  @Input() invoice!: InvoiceTab;
  constructor(
    @Optional() @Inject(MAT_DIALOG_DATA) public data: { invoice: InvoiceTab } | null = null,
    @Optional() public dialogRef: MatDialogRef<InvoiceDetailComponent> | null = null,
    private timeZoneService: TimeZoneService,
  ) { }

  ngOnInit() {
    // Nếu được mở như dialog, sử dụng data từ dialog
    if (this.data && this.data.invoice) {
      this.invoice = this.data.invoice;
    }
  }
  @ViewChild('printSection', { static: false }) printSection!: ElementRef;
  getHtmlContent(): string {
    return this.printSection?.nativeElement?.innerHTML || '';
  }

  formatVietnameseDate(): string {
    const now = new Date();
    const vnNow = this.timeZoneService.formatVietnamISOString(now);
    const d = new Date(vnNow);
    const day = d.getDate().toString().padStart(2, '0');
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    const year = d.getFullYear();

    return `Ngày ${day} tháng ${month} năm ${year}`;
  }
  getTotalDiscount(): number {
    if (!this.invoice || !this.invoice.cartItems) return 0;
    return this.invoice.cartItems
      .filter(item => item.unitPriceSaleOff > 0)
      .reduce((sum, item) => sum + item.unitPriceSaleOff * item.quantity, 0);
  }
}
