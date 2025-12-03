import { Component, Input, Output, EventEmitter, ViewChild, ElementRef, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Customer } from '../../../models/customer.model';

@Component({
  selector: 'app-customer-search',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule],
  templateUrl: './customer-search.component.html',
  styleUrls: ['./customer-search.component.css'],
  encapsulation: ViewEncapsulation.None
})
export class CustomerSearchComponent {
  @Input() customerSearchTerm: string = '';
  @Input() showCustomerDropdown: boolean = false;
  @Input() customerSuggestions: Customer[] = [];
  @Input() activeCustomerIndex: number = 0;
  @Input() selectedCustomer: Customer | null = null;
  @Input() selectedCustomerDebtValue: number = 0;
  @Input() selectedCustomerTotalPointValue: number = 0;

  @Output() customerSearchTermChange = new EventEmitter<string>();
  @Output() customerSearchInput = new EventEmitter<Event>();
  @Output() customerKeyDown = new EventEmitter<KeyboardEvent>();
  @Output() customerDelete = new EventEmitter<KeyboardEvent>();
  @Output() customerSelect = new EventEmitter<Customer>();
  @Output() addCustomerClick = new EventEmitter<void>();
  @Output() dropdownStateChange = new EventEmitter<boolean>();

  @ViewChild('searchCustomer') searchCustomer!: ElementRef;

  onCustomerSearchTermChange(value: string) {
    this.customerSearchTerm = value;
    this.customerSearchTermChange.emit(value);
  }

  onCustomerSearchInput(event: Event) {
    this.customerSearchInput.emit(event);
  }

  onCustomerKeyDown(event: KeyboardEvent) {
    this.customerKeyDown.emit(event);
  }

  onCustomerDelete(event: KeyboardEvent) {
    this.customerDelete.emit(event);
  }

  selectCustomer(customer: Customer, event: MouseEvent) {
    event.preventDefault();
    this.customerSelect.emit(customer);
  }

  openAddCustomerDialog() {
    this.addCustomerClick.emit();
  }

  closeDropdown() {
    this.showCustomerDropdown = false;
    this.dropdownStateChange.emit(false);
  }

  focusSearchInput() {
    if (this.searchCustomer) {
      this.searchCustomer.nativeElement.focus();
    }
  }
}
