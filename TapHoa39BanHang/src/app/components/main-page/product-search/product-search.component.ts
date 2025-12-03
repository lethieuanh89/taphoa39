import { Component, Input, Output, EventEmitter, ViewChild, ElementRef, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Product } from '../../../models/product.model';

@Component({
  selector: 'app-product-search',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './product-search.component.html',
  styleUrls: ['./product-search.component.css'],
  encapsulation: ViewEncapsulation.None
})
export class ProductSearchComponent {
  @Input() searchTerm: string = '';
  @Input() showDropdown: boolean = false;
  @Input() filteredProducts: Product[] = [];
  @Input() activeIndex: number = 0;

  @Output() searchTermChange = new EventEmitter<string>();
  @Output() searchInput = new EventEmitter<Event>();
  @Output() searchFieldFocus = new EventEmitter<void>();
  @Output() keyDown = new EventEmitter<KeyboardEvent>();
  @Output() productSelect = new EventEmitter<Product>();
  @Output() addNewProductClick = new EventEmitter<void>();
  @Output() dropdownStateChange = new EventEmitter<boolean>();

  @ViewChild('searchInput') searchInputElement!: ElementRef;

  onSearchTermChange(value: string) {
    this.searchTerm = value;
    this.searchTermChange.emit(value);
  }

  onSearchInput(event: Event) {
    this.searchInput.emit(event);
  }

  onSearchFieldFocus() {
    this.searchFieldFocus.emit();
  }

  onKeyDown(event: KeyboardEvent) {
    this.keyDown.emit(event);
  }

  selectProduct(product: Product) {
    this.productSelect.emit(product);
  }

  addNewProduct() {
    this.addNewProductClick.emit();
  }

  formatPrice(price: number): string {
    return price.toLocaleString('vi-VN');
  }

  closeDropdown() {
    this.showDropdown = false;
    this.dropdownStateChange.emit(false);
  }

  focusSearchInput() {
    if (this.searchInputElement) {
      this.searchInputElement.nativeElement.focus();
    }
  }
}
