import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-invoice-payment',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './invoice-payment.component.html',
  styleUrls: ['./invoice-payment.component.css']
})
export class InvoicePaymentComponent {
  @Input() totalQuantity: number = 0;
  @Input() totalAmount: number = 0;
  @Input() discountAmount: number = 0;
  @Input() customerPaid: number = 0;
  @Input() changeAmount: number = 0;
  @Input() paymentMode: 'normal' | 'debt' = 'normal';
  @Input() showVatDetails: boolean = false;
  @Input() invoiceVatPercent: number = 8;
  @Input() totalAmountWithVAT: number = 0;
  @Input() quickAmounts: number[] = [];
  @Input() isOrderMode: boolean = false;
  @Input() isEditMode: boolean = false;
  @Input() isEditModeInvoice: boolean = false;
  @Input() invoiceNote: string = '';

  @Output() discountAmountChange = new EventEmitter<number>();
  @Output() customerPaidChange = new EventEmitter<string>();
  @Output() paymentModeChange = new EventEmitter<'normal' | 'debt'>();
  @Output() showVatDetailsChange = new EventEmitter<boolean>();
  @Output() invoiceVatPercentChange = new EventEmitter<number>();
  @Output() quickAmountSelect = new EventEmitter<number>();
  @Output() checkoutClick = new EventEmitter<void>();
  @Output() orderClick = new EventEmitter<void>();
  @Output() saveEditedInvoiceClick = new EventEmitter<void>();
  @Output() invoiceNoteChange = new EventEmitter<string>();
  @Output() keyDown = new EventEmitter<KeyboardEvent>();

  onDiscountChange() {
    this.discountAmountChange.emit(this.discountAmount);
  }

  onCustomerPaidChange(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.customerPaidChange.emit(value);
  }

  selectIfNotSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.selectionStart === input.selectionEnd) {
      input.select();
    }
  }

  validateNumber(event: KeyboardEvent) {
    this.keyDown.emit(event);
  }

  onPaymentModeChange() {
    this.paymentModeChange.emit(this.paymentMode);
  }

  onShowVatDetailsChange() {
    this.showVatDetailsChange.emit(this.showVatDetails);
  }

  onInvoiceVatPercentChange(value: number) {
    this.invoiceVatPercentChange.emit(value);
  }

  selectQuickAmount(amount: number) {
    this.quickAmountSelect.emit(amount);
  }

  checkout() {
    this.checkoutClick.emit();
  }

  order() {
    this.orderClick.emit();
  }

  saveEditedInvoice() {
    this.saveEditedInvoiceClick.emit();
  }

  onInvoiceNoteChange(value: string) {
    this.invoiceNote = value;
    this.invoiceNoteChange.emit(value);
  }

  formatPrice(price: number): string {
    return price.toLocaleString('vi-VN');
  }
}
