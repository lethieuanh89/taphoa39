import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { Product } from '../../models/product.model';
import { CartItem } from '../../models/cart-item.model';

@Injectable({
  providedIn: 'root'
})
export class ProductSearchHandlerService {
  private allProducts: Product[] = [];
  private groupedProducts: Record<number, any[]> = {};

  setProducts(products: Product[]) {
    this.allProducts = products;
  }

  setGroupedProducts(grouped: Record<number, any[]>) {
    this.groupedProducts = grouped;
  }

  /**
   * Filter products based on search term
   */
  filterProducts(searchTerm: string, maxResults: number = 10): Product[] {
    if (!searchTerm || searchTerm.trim().length === 0) {
      return [];
    }

    const normalizedSearch = this.normalizeVietnamese(searchTerm.toLowerCase().trim());
    const searchWords = normalizedSearch.split(/\s+/);

    return this.allProducts
      .filter(product => {
        if (!product.isActive || product.isDeleted) {
          return false;
        }

        const normalizedName = (product.NormalizedName || '').toLowerCase();
        const normalizedCode = (product.NormalizedCode || product.Code || '').toLowerCase();
        const normalizedFullName = product.FullName ? this.normalizeVietnamese(product.FullName.toLowerCase()) : '';

        // Check if all search words match
        return searchWords.every(word =>
          normalizedName.includes(word) ||
          normalizedCode.includes(word) ||
          normalizedFullName.includes(word)
        );
      })
      .slice(0, maxResults);
  }

  /**
   * Get available units for a product
   */
  getAvailableUnits(product: Product, masterId?: number): string[] {
    const id = masterId || product.MasterUnitId || product.Id;
    const masterProducts = this.groupedProducts[id];

    if (masterProducts && masterProducts.length > 0) {
      const units = new Set<string>();
      masterProducts.forEach(p => {
        if (p.Unit) {
          units.add(p.Unit);
        }
      });
      return Array.from(units);
    }

    return [product.Unit || 'Cái'];
  }

  /**
   * Find product by code
   */
  findProductByCode(code: string): Product | undefined {
    const normalizedCode = code.toLowerCase().trim();
    return this.allProducts.find(p =>
      p.Code && p.Code.toLowerCase() === normalizedCode &&
      p.isActive &&
      !p.isDeleted
    );
  }

  /**
   * Prepare cart item from product
   */
  prepareCartItem(product: Product, quantity: number = 1): CartItem {
    const unitPrice = product.BasePrice || 0;
    const totalPrice = unitPrice * quantity;

    return {
      product: { ...product },
      quantity,
      unitPrice,
      totalPrice,
      unitPriceSaleOff: 0
    };
  }

  /**
   * Normalize Vietnamese text for search
   */
  private normalizeVietnamese(str: string): string {
    return str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D');
  }

  /**
   * Check if product has enough stock
   */
  hasEnoughStock(product: Product, quantity: number): boolean {
    return product.OnHand >= quantity;
  }

  /**
   * Get product status label
   */
  getProductStatus(product: Product): string {
    if (product.OnHand <= 0) {
      return 'Hết hàng';
    } else if (product.OnHand < 10) {
      return 'Sắp hết';
    }
    return '';
  }
}
