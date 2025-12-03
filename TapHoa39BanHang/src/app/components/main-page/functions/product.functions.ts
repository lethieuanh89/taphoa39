import { Product } from '../../../models/product.model';
import { CartItem } from '../../../models/cart-item.model';

/**
 * Normalize Vietnamese text for search
 */
export function normalizeVietnamese(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

/**
 * Get available units for a product from grouped products
 */
export function getAvailableUnits(
  product: Product,
  cartItem: CartItem | undefined,
  groupedProducts: Record<number, Product[]>
): string[] {
  const masterId = cartItem?.product?.MasterUnitId || product.MasterUnitId || product.Id;
  const masterProducts = groupedProducts[masterId];

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
 * Get item status label based on stock
 */
export function getItemStatus(product: Product): string {
  if (product.OnHand <= 0) {
    return 'Hết hàng';
  } else if (product.OnHand < 10) {
    return 'Sắp hết';
  }
  return '';
}

/**
 * Check if product has enough stock
 */
export function hasEnoughStock(product: Product, quantity: number): boolean {
  return product.OnHand >= quantity;
}

/**
 * Find product by code
 */
export function findProductByCode(products: Product[], code: string): Product | undefined {
  const normalizedCode = code.toLowerCase().trim();
  return products.find(p =>
    p.Code &&
    p.Code.toLowerCase() === normalizedCode &&
    p.isActive &&
    !p.isDeleted
  );
}

/**
 * Filter products by search term
 */
export function filterProducts(
  products: Product[],
  searchTerm: string,
  maxResults: number = 10
): Product[] {
  if (!searchTerm || searchTerm.trim().length === 0) {
    return [];
  }

  const normalizedSearch = normalizeVietnamese(searchTerm.toLowerCase().trim());
  const searchWords = normalizedSearch.split(/\s+/);

  return products
    .filter(product => {
      if (!product.isActive || product.isDeleted) {
        return false;
      }

      const normalizedName = (product.NormalizedName || '').toLowerCase();
      const normalizedCode = (product.NormalizedCode || product.Code || '').toLowerCase();
      const normalizedFullName = product.FullName ? normalizeVietnamese(product.FullName.toLowerCase()) : '';

      return searchWords.every(word =>
        normalizedName.includes(word) ||
        normalizedCode.includes(word) ||
        normalizedFullName.includes(word)
      );
    })
    .slice(0, maxResults);
}

/**
 * Check if product is barcode format
 */
export function isBarcode(input: string): boolean {
  // Check if input is all digits or follows barcode pattern
  return /^\d+$/.test(input) && input.length >= 8;
}

/**
 * Get product display name
 */
export function getProductDisplayName(product: Product): string {
  return product.FullName || product.Name || '';
}

/**
 * Calculate product final price with conversion
 */
export function calculateProductPrice(
  product: Product,
  conversionValue: number = 1
): number {
  return (product.BasePrice || 0) * conversionValue;
}
