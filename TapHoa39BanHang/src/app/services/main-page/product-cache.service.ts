import { Injectable } from '@angular/core';
import { Product } from '../../models/product.model';
import { CartItem } from '../../models/cart-item.model';

/**
 * ProductCacheService
 * Manages product cache operations for quick access to product data
 */
@Injectable({
  providedIn: 'root'
})
export class ProductCacheService {

  /**
   * Find cached product by ID from grouped products
   */
  findCachedProduct(productId: number, groupedProducts: { [key: number]: Product[] }): Product | null {
    const groups = Object.values(groupedProducts);

    for (const group of groups) {
      if (!Array.isArray(group)) {
        continue;
      }

      const match = (group as Product[]).find(p => p?.Id === productId);
      if (match) {
        return match;
      }
    }

    return null;
  }

  /**
   * Get cached OnHand value for a product
   */
  getCachedOnHandValue(productId: number, groupedProducts: { [key: number]: Product[] }): number {
    const product = this.findCachedProduct(productId, groupedProducts);
    return product ? Number(product.OnHand ?? 0) : 0;
  }

  /**
   * Update cached product OnHand value in both grouped products and cart items
   */
  updateCachedProductOnHand(config: {
    productId: number;
    newOnHand: number;
    groupedProducts: { [key: number]: Product[] };
    cartItems: CartItem[];
  }): void {
    const { productId, newOnHand, groupedProducts, cartItems } = config;

    // Update in grouped products
    const product = this.findCachedProduct(productId, groupedProducts);
    if (product) {
      product.OnHand = newOnHand;
    }

    // Update in cart items
    for (const item of cartItems) {
      if (item?.product?.Id === productId) {
        item.product.OnHand = newOnHand;
      }
    }
  }

  /**
   * Find product in cart items by product ID
   */
  findProductInCart(productId: number, cartItems: CartItem[]): CartItem | null {
    return cartItems.find(item => item?.product?.Id === productId) || null;
  }

  /**
   * Get total quantity of a product in cart
   */
  getProductQuantityInCart(productId: number, cartItems: CartItem[]): number {
    const item = this.findProductInCart(productId, cartItems);
    return item ? item.quantity : 0;
  }
}
