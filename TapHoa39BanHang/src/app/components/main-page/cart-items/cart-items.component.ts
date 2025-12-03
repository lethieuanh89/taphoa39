import { Component, Input, Output, EventEmitter, ViewChildren, QueryList, ElementRef, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CartItem } from '../../../models/cart-item.model';
import { Product } from '../../../models/product.model';

@Component({
  selector: 'app-cart-items',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './cart-items.component.html',
  styleUrls: ['./cart-items.component.css'],
  encapsulation: ViewEncapsulation.None
})
export class CartItemsComponent {
  @Input() cartItems: CartItem[] = [];
  @Input() showNoteInputIndex: number | null = null;
  @Input() groupedProducts: { [key: string]: Product[] } = {};

  @Output() itemRemove = new EventEmitter<number>();
  @Output() unitChange = new EventEmitter<{ index: number; unit: string }>();
  @Output() quantityChange = new EventEmitter<CartItem>();
  @Output() quantityIncrease = new EventEmitter<CartItem>();
  @Output() unitPriceInput = new EventEmitter<{ event: Event; item: CartItem }>();
  @Output() showNoteClick = new EventEmitter<number>();
  @Output() showNoteInputIndexChange = new EventEmitter<number | null>();
  @Output() keyDown = new EventEmitter<KeyboardEvent>();

  @ViewChildren('noteInput') noteInputs!: QueryList<ElementRef>;

  removeItem(index: number) {
    this.itemRemove.emit(index);
  }

  updateItemUnit(index: number, unit: string) {
    this.unitChange.emit({ index, unit });
  }

  onQuantityChange(item: CartItem) {
    this.quantityChange.emit(item);
  }

  increaseQuantity(item: CartItem) {
    this.quantityIncrease.emit(item);
  }

  onUnitPriceInput(event: Event, item: CartItem) {
    this.unitPriceInput.emit({ event, item });
  }

  showNoteForProduct(index: number) {
    this.showNoteClick.emit(index);
  }

  updateShowNoteInputIndex(value: number | null) {
    this.showNoteInputIndexChange.emit(value);
  }

  validateNumber(event: KeyboardEvent) {
    this.keyDown.emit(event);
  }

  getAvailableUnits(product: Product, cartItem?: any): string[] {
    // Ưu tiên lấy masterId từ cartItem nếu có
    const masterId = cartItem?.MasterUnitId || product.MasterUnitId || product.Id;
    const masterProducts = this.groupedProducts[masterId];
    if (masterProducts && masterProducts.length > 0) {
      const units = new Set<string>();

      masterProducts.forEach(p => {
        if (p.Unit) {
          units.add(p.Unit);
        }
      });
      return Array.from(units);
    }
    if (product.Unit) {
      return [product.Unit];
    }

    return [];
  }
  /**
   * Get item status từ ProductAttributes
   */
  getItemStatus(product: Product): string {
    if (!product) return '';
    if (product.ProductAttributes?.[0]?.Value === undefined ||
        product.ProductAttributes?.[0]?.Value === null) return '';

    return product.ProductAttributes[0]?.Value || '';
  }
  formatPrice(price: number): string {
    return Math.abs(price).toLocaleString('vi-VN');
  }

}
