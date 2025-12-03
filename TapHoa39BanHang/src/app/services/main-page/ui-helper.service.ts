import { Injectable } from '@angular/core';
import { Product } from '../../models/product.model';
import { InvoiceTab } from '../../models/invoice.model';

/**
 * Service chứa các helper methods cho UI
 * Tách các pure functions ra khỏi component
 */
@Injectable({
  providedIn: 'root'
})
export class UiHelperService {
  readonly DEFAULT_INVOICE_VAT = 1.08;
  private readonly defaultInvoiceTabFontSize = 12;
  private readonly minInvoiceTabFontSize = 7;

  constructor() {}

  /**
   * Format số với dấu phẩy
   */
  formatNumberWithCommas(value: number): string {
    if (value === null || value === undefined || isNaN(value)) {
      return '0';
    }
    return Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /**
   * Format giá tiền
   */
  formatPrice(price: number): string {
    if (!price || isNaN(price)) {
      return '0';
    }
    return this.formatNumberWithCommas(Math.round(price));
  }

  /**
   * Làm tròn lên đến nghìn gần nhất
   */
  roundUpToNearestThousand(amount: number): number {
    if (amount <= 0) return 0;
    return Math.ceil(amount / 1000) * 1000;
  }

  /**
   * Làm tròn đến chục nghìn gần nhất
   */
  roundToNearestTenThousand(value: number): number {
    if (value <= 0) return 0;
    return Math.round(value / 10000) * 10000;
  }

  /**
   * Làm tròn lên theo bước
   */
  roundUpToNearestStep(value: number, step: number): number {
    if (value <= 0 || step <= 0) return 0;
    return Math.ceil(value / step) * step;
  }

  /**
   * Lấy tab display label
   */
  getTabDisplayLabel(tabName: string): string {
    if (!tabName) return '';

    // Extract number from tab name (e.g., "HD 123" -> "123", "ĐH 456" -> "456")
    const match = tabName.match(/(\d+)/);
    if (match && match[1]) {
      return match[1];
    }

    return tabName;
  }

  /**
   * Kiểm tra xem tab có compact không
   */
  isTabCompact(tabName: string): boolean {
    if (!tabName) return false;
    return tabName.length > 6; // Compact nếu tên dài hơn 6 ký tự
  }

  /**
   * Lấy tên tab cho invoice
   */
  getInvoiceTabName(invoice: InvoiceTab | null | undefined, index: number): string {
    return invoice?.name || `HD ${index + 1}`;
  }

  /**
   * Lấy tên tab cho order
   */
  getOrderTabName(order: InvoiceTab | null | undefined, index: number): string {
    return order?.name || `ĐH ${index + 1}`;
  }

  /**
   * Kiểm tra xem có nên hiển thị close icon không
   */
  shouldShowCloseIcon(index: number, totalTabs: number, isOrderTab = false): boolean {
    // Luôn hiển thị close icon cho order tabs
    if (isOrderTab) return true;

    // Chỉ hiển thị nếu có nhiều hơn 1 tab
    return totalTabs > 1;
  }

  /**
   * Lấy trạng thái item (còn hàng, sắp hết, hết hàng)
   */
  getItemStatus(product: Product): string {
    const onHand = product.OnHand || 0;

    if (onHand === 0) {
      return 'out-of-stock';
    } else if (onHand < 10) {
      return 'low-stock';
    } else {
      return 'in-stock';
    }
  }

  /**
   * Lấy màu sắc cho status
   */
  getStatusColor(status: string): string {
    switch (status) {
      case 'out-of-stock':
        return '#f44336'; // Red
      case 'low-stock':
        return '#ff9800'; // Orange
      case 'in-stock':
        return '#4caf50'; // Green
      default:
        return '#757575'; // Grey
    }
  }

  /**
   * Lấy danh sách units available cho product
   */
  getAvailableUnits(product: Product): string[] {
    const units: string[] = [];

    // Add Unit if available
    if (product.Unit) {
      units.push(product.Unit);
    }

    return units;
  }

  /**
   * Tính font size cho invoice tabs dựa trên số lượng tabs
   */
  calculateInvoiceTabFontSize(tabCount: number): number {
    if (tabCount <= 5) {
      return this.defaultInvoiceTabFontSize;
    } else if (tabCount <= 10) {
      return 10;
    } else if (tabCount <= 15) {
      return 9;
    } else if (tabCount <= 20) {
      return 8;
    } else {
      return this.minInvoiceTabFontSize;
    }
  }

  /**
   * Kiểm tra xem có nên hiển thị invoice tab numbers only
   */
  shouldShowInvoiceTabNumbersOnly(tabCount: number): boolean {
    return tabCount > 15;
  }

  /**
   * Tính tổng tiền với VAT
   */
  calculateTotalWithVAT(subtotal: number, vatPercent: number): number {
    const vatAmount = (subtotal * vatPercent) / 100;
    return subtotal + vatAmount;
  }

  /**
   * Tính discount amount
   */
  calculateDiscountAmount(
    subtotal: number,
    discountValue: number,
    discountType: 'VND' | '%'
  ): number {
    if (discountType === 'VND') {
      return Math.min(discountValue, subtotal);
    } else {
      return (subtotal * discountValue) / 100;
    }
  }

  /**
   * Validate customer paid amount
   */
  validateCustomerPaid(
    paid: number,
    totalAmount: number
  ): { valid: boolean; message?: string } {
    if (paid < 0) {
      return { valid: false, message: 'Số tiền không hợp lệ' };
    }

    if (paid < totalAmount) {
      return { valid: false, message: 'Số tiền chưa đủ' };
    }

    return { valid: true };
  }

  /**
   * Parse finite number
   */
  parseFiniteNumber(value: any): number | null {
    const parsed = parseFloat(value);
    if (isNaN(parsed) || !isFinite(parsed)) {
      return null;
    }
    return parsed;
  }

  /**
   * Truncate text
   */
  truncateText(text: string, maxLength: number): string {
    if (!text || text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength) + '...';
  }

  /**
   * Get display name for product
   */
  getProductDisplayName(product: Product, maxLength = 50): string {
    const name = product.Name || 'Sản phẩm';
    return this.truncateText(name, maxLength);
  }

  /**
   * Coerce value to number with fallback
   */
  coerceToNumber(value: unknown, fallback = 0): number {
    if (value === null || value === undefined) {
      return fallback;
    }

    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : fallback;
    }

    if (typeof value === 'string') {
      const normalized = value.replace(/[^0-9.-]/g, '');
      if (normalized.length === 0) {
        return fallback;
      }

      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : fallback;
    }

    if (typeof value === 'boolean') {
      return value ? 1 : 0;
    }

    return fallback;
  }

  /**
   * Get item status từ ProductAttributes
   */
  getItemStatusFromAttributes(product: Product): string {
    if (!product) return '';
    if (product.ProductAttributes?.[0]?.Value === undefined ||
        product.ProductAttributes?.[0]?.Value === null) return '';

    return product.ProductAttributes[0]?.Value || '';
  }
}
