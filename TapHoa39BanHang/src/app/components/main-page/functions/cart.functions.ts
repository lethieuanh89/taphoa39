import { CartItem } from '../../../models/cart-item.model';
import { Product } from '../../../models/product.model';

/**
 * Format price to Vietnamese currency format
 */
export function formatPrice(price: number): string {
  if (isNaN(price) || price === null || price === undefined) {
    return '0';
  }
  return Math.round(price).toLocaleString('vi-VN');
}

/**
 * Parse price from formatted string
 */
export function parsePrice(priceStr: string): number {
  if (!priceStr) return 0;
  const cleaned = priceStr.replace(/[.,\s]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/**
 * Calculate total quantity in cart
 */
export function getTotalQuantity(cartItems: CartItem[]): number {
  return cartItems.reduce((sum, item) => sum + item.quantity, 0);
}

/**
 * Calculate total amount in cart
 */
export function getTotalAmount(cartItems: CartItem[]): number {
  return cartItems.reduce((sum, item) => sum + item.totalPrice, 0);
}

/**
 * Calculate total with discount
 */
export function getTotalWithDiscount(
  totalAmount: number,
  discountAmount: number
): number {
  return totalAmount - (discountAmount || 0);
}

/**
 * Calculate total with VAT
 */
export function getTotalWithVAT(
  totalAmount: number,
  discountAmount: number,
  vatMultiplier: number
): number {
  const afterDiscount = getTotalWithDiscount(totalAmount, discountAmount);
  return afterDiscount * vatMultiplier;
}

/**
 * Calculate change amount
 */
export function getChangeAmount(
  totalAmount: number,
  discountAmount: number,
  customerPaid: number
): number {
  const total = getTotalWithDiscount(totalAmount, discountAmount);
  return customerPaid - total;
}

/**
 * Create cart item from product
 */
export function createCartItem(
  product: Product,
  quantity: number = 1
): CartItem {
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
 * Update cart item quantity
 */
export function updateCartItemQuantity(
  item: CartItem,
  quantity: number
): CartItem {
  return {
    ...item,
    quantity,
    totalPrice: item.unitPrice * quantity
  };
}

/**
 * Update cart item unit price
 */
export function updateCartItemUnitPrice(
  item: CartItem,
  unitPrice: number
): CartItem {
  const priceDiff = unitPrice - item.product.BasePrice;
  return {
    ...item,
    unitPrice,
    unitPriceSaleOff: priceDiff,
    totalPrice: unitPrice * item.quantity
  };
}

/**
 * Find cart item by product ID and unit
 */
export function findCartItem(
  cartItems: CartItem[],
  productId: number,
  unit: string
): CartItem | undefined {
  return cartItems.find(
    item => item.product.Id === productId && item.product.Unit === unit
  );
}

/**
 * Check if cart has items
 */
export function hasCartItems(cartItems: CartItem[]): boolean {
  return cartItems.length > 0;
}

/**
 * Validate cart items for checkout
 */
export function validateCartForCheckout(cartItems: CartItem[]): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!hasCartItems(cartItems)) {
    errors.push('Giỏ hàng trống');
    return { valid: false, errors };
  }

  cartItems.forEach((item, index) => {
    if (item.quantity <= 0) {
      errors.push(`Sản phẩm ${index + 1}: Số lượng không hợp lệ`);
    }

    if (item.quantity > item.product.OnHand) {
      errors.push(
        `${item.product.Name}: Không đủ hàng (cần ${item.quantity}, còn ${item.product.OnHand})`
      );
    }

    if (item.unitPrice < 0) {
      errors.push(`Sản phẩm ${index + 1}: Giá không hợp lệ`);
    }
  });

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Calculate quick payment amounts based on total
 */
export function calculateQuickAmounts(total: number): number[] {
  if (total <= 0) return [];

  const roundedTotal = Math.ceil(total / 1000) * 1000;
  const amounts: number[] = [];

  // Add rounded total
  amounts.push(roundedTotal);

  // Add increments
  const increments = [10000, 20000, 50000, 100000, 200000, 500000];
  increments.forEach(increment => {
    const amount = roundedTotal + increment;
    if (amount > total) {
      amounts.push(amount);
    }
  });

  return amounts.slice(0, 6); // Limit to 6 quick amounts
}

/**
 * Clone cart items (deep copy)
 */
export function cloneCartItems(cartItems: CartItem[]): CartItem[] {
  return cartItems.map(item => ({
    ...item,
    product: { ...item.product }
  }));
}
