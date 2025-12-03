import { Injectable } from '@angular/core';
import { CartItem } from '../../models/cart-item.model';
import { Product } from '../../models/product.model';

@Injectable({
  providedIn: 'root'
})
export class CartOperationsService {
  /**
   * Add item to cart or update quantity if exists
   */
  addOrUpdateItem(cartItems: CartItem[], newItem: CartItem): CartItem[] {
    const existingIndex = cartItems.findIndex(item =>
      item.product.Id === newItem.product.Id &&
      item.product.Unit === newItem.product.Unit
    );

    if (existingIndex !== -1) {
      // Update existing item
      const updated = [...cartItems];
      updated[existingIndex] = {
        ...updated[existingIndex],
        quantity: updated[existingIndex].quantity + newItem.quantity,
        totalPrice: this.calculateItemTotal(
          updated[existingIndex].quantity + newItem.quantity,
          updated[existingIndex].unitPrice
        )
      };
      return updated;
    } else {
      // Add new item
      return [...cartItems, newItem];
    }
  }

  /**
   * Remove item from cart
   */
  removeItem(cartItems: CartItem[], index: number): CartItem[] {
    return cartItems.filter((_, i) => i !== index);
  }

  /**
   * Update item quantity
   */
  updateItemQuantity(cartItems: CartItem[], index: number, quantity: number): CartItem[] {
    if (quantity <= 0) {
      return this.removeItem(cartItems, index);
    }

    const updated = [...cartItems];
    updated[index] = {
      ...updated[index],
      quantity,
      totalPrice: this.calculateItemTotal(quantity, updated[index].unitPrice)
    };
    return updated;
  }

  /**
   * Update item unit price
   */
  updateItemUnitPrice(cartItems: CartItem[], index: number, unitPrice: number): CartItem[] {
    const updated = [...cartItems];
    const item = updated[index];

    const priceDiff = unitPrice - item.product.BasePrice;

    updated[index] = {
      ...item,
      unitPrice,
      unitPriceSaleOff: priceDiff,
      totalPrice: this.calculateItemTotal(item.quantity, unitPrice)
    };
    return updated;
  }

  /**
   * Update item unit
   */
  updateItemUnit(
    cartItems: CartItem[],
    index: number,
    newUnit: string,
    groupedProducts: Record<number, any[]>
  ): CartItem[] {
    const item = cartItems[index];
    const masterId = item.product.MasterUnitId || item.product.Id;
    const masterProducts = groupedProducts[masterId];

    if (!masterProducts || masterProducts.length === 0) {
      return cartItems;
    }

    // Find product with the new unit
    const newProduct = masterProducts.find(p => p.Unit === newUnit);
    if (!newProduct) {
      return cartItems;
    }

    const updated = [...cartItems];
    updated[index] = {
      ...item,
      product: { ...newProduct },
      unitPrice: newProduct.BasePrice,
      totalPrice: this.calculateItemTotal(item.quantity, newProduct.BasePrice),
      unitPriceSaleOff: 0
    };

    return updated;
  }

  /**
   * Calculate total for an item
   */
  calculateItemTotal(quantity: number, unitPrice: number): number {
    return quantity * unitPrice;
  }

  /**
   * Calculate cart total amount
   */
  calculateCartTotal(cartItems: CartItem[]): number {
    return cartItems.reduce((sum, item) => sum + item.totalPrice, 0);
  }

  /**
   * Calculate total quantity
   */
  calculateTotalQuantity(cartItems: CartItem[]): number {
    return cartItems.reduce((sum, item) => sum + item.quantity, 0);
  }

  /**
   * Calculate total with discount
   */
  calculateTotalWithDiscount(cartTotal: number, discount: number): number {
    return cartTotal - discount;
  }

  /**
   * Calculate total with VAT
   */
  calculateTotalWithVAT(cartTotal: number, discount: number, vatMultiplier: number): number {
    const afterDiscount = this.calculateTotalWithDiscount(cartTotal, discount);
    return afterDiscount * vatMultiplier;
  }

  /**
   * Calculate change amount
   */
  calculateChangeAmount(total: number, paid: number): number {
    return paid - total;
  }

  /**
   * Clear all items from cart
   */
  clearCart(): CartItem[] {
    return [];
  }

  /**
   * Check if cart is empty
   */
  isCartEmpty(cartItems: CartItem[]): boolean {
    return cartItems.length === 0;
  }

  /**
   * Get item at index
   */
  getItem(cartItems: CartItem[], index: number): CartItem | undefined {
    return cartItems[index];
  }

  /**
   * Find item by product ID and unit
   */
  findItem(cartItems: CartItem[], productId: number, unit: string): CartItem | undefined {
    return cartItems.find(item =>
      item.product.Id === productId && item.product.Unit === unit
    );
  }

  /**
   * Validate cart items (check stock, prices, etc.)
   */
  validateCartItems(cartItems: CartItem[]): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    cartItems.forEach((item, index) => {
      if (item.quantity <= 0) {
        errors.push(`Item ${index + 1}: Invalid quantity`);
      }

      if (item.quantity > item.product.OnHand) {
        errors.push(`Item ${index + 1}: Not enough stock (${item.product.Name})`);
      }

      if (item.unitPrice < 0) {
        errors.push(`Item ${index + 1}: Invalid price`);
      }
    });

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Clone cart items (deep copy)
   */
  cloneCartItems(cartItems: CartItem[]): CartItem[] {
    return cartItems.map(item => ({
      ...item,
      product: { ...item.product }
    }));
  }
}
