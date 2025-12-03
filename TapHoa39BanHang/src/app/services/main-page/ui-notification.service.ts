import { Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';

/**
 * UINotificationService
 * Handles UI notifications with throttling and consistent messaging
 */
@Injectable({
  providedIn: 'root'
})
export class UINotificationService {
  private lastProductNotFoundQuery = '';
  private lastProductNotFoundAt = 0;
  private readonly PRODUCT_NOT_FOUND_THROTTLE_MS = 2000;

  constructor(private snackBar: MatSnackBar) {}

  /**
   * Show insufficient stock warning
   */
  notifyInsufficientStock(): void {
    this.snackBar.open(
      'Cảnh báo: tồn kho không đủ, hệ thống sẽ ghi nhận số lượng âm cho sản phẩm.',
      'Đóng',
      { duration: 4000 }
    );
  }

  /**
   * Show product not found alert with throttling
   */
  notifyProductNotFound(query: string): void {
    const normalized = query.trim();
    if (!normalized) {
      return;
    }

    const now = Date.now();
    if (
      normalized === this.lastProductNotFoundQuery &&
      now - this.lastProductNotFoundAt < this.PRODUCT_NOT_FOUND_THROTTLE_MS
    ) {
      return;
    }

    this.lastProductNotFoundQuery = normalized;
    this.lastProductNotFoundAt = now;
    alert(`Không tìm thấy sản phẩm phù hợp với "${normalized}"`);
  }

  /**
   * Show success message
   */
  showSuccess(message: string, duration: number = 3000): void {
    this.snackBar.open(message, 'Đóng', { duration });
  }

  /**
   * Show error message
   */
  showError(message: string, duration: number = 4000): void {
    this.snackBar.open(message, 'Đóng', {
      duration,
      panelClass: ['error-snackbar']
    });
  }

  /**
   * Show warning message
   */
  showWarning(message: string, duration: number = 3500): void {
    this.snackBar.open(message, 'Đóng', {
      duration,
      panelClass: ['warning-snackbar']
    });
  }

  /**
   * Show info message
   */
  showInfo(message: string, duration: number = 2500): void {
    this.snackBar.open(message, 'Đóng', { duration });
  }
}
