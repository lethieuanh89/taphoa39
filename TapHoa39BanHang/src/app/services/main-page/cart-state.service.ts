import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { CartItem } from '../../models/cart-item.model';
import { Product } from '../../models/product.model';

/**
 * Service quản lý state của giỏ hàng
 * Tách logic quản lý cart items ra khỏi component
 */
@Injectable({
  providedIn: 'root'
})
export class CartStateService {
  private cartItemsSubject = new BehaviorSubject<CartItem[]>([]);
  public cartItems$ = this.cartItemsSubject.asObservable();

  private selectedItemSubject = new BehaviorSubject<CartItem | null>(null);
  public selectedItem$ = this.selectedItemSubject.asObservable();

  constructor() {}

  /**
   * Lấy danh sách cart items hiện tại
   */
  getCartItems(): CartItem[] {
    return this.cartItemsSubject.value;
  }

  /**
   * Set danh sách cart items
   */
  setCartItems(items: CartItem[]): void {
    this.cartItemsSubject.next(items);
  }

  /**
   * Thêm product vào giỏ hàng
   */
  addToCart(product: Product, quantity: number = 1): void {
    const currentItems = this.getCartItems();
    const existingItemIndex = currentItems.findIndex(
      item => item.product.Id === product.Id
    );

    if (existingItemIndex !== -1) {
      // Tăng số lượng nếu sản phẩm đã có trong giỏ
      currentItems[existingItemIndex].quantity += quantity;
      currentItems[existingItemIndex].totalPrice = currentItems[existingItemIndex].unitPrice * currentItems[existingItemIndex].quantity;
    } else {
      // Thêm sản phẩm mới
      const unitPrice = product.BasePrice || 0;
      const newItem: CartItem = {
        product,
        quantity,
        unitPrice: unitPrice,
        totalPrice: unitPrice * quantity,
        unitPriceSaleOff: unitPrice
      };
      currentItems.push(newItem);
    }

    this.setCartItems([...currentItems]);
  }

  /**
   * Xóa item khỏi giỏ hàng
   */
  removeFromCart(index: number): void {
    const currentItems = this.getCartItems();
    currentItems.splice(index, 1);
    this.setCartItems([...currentItems]);
  }

  /**
   * Cập nhật số lượng của item
   */
  updateQuantity(index: number, quantity: number): void {
    const currentItems = this.getCartItems();
    if (currentItems[index]) {
      currentItems[index].quantity = quantity;
      this.setCartItems([...currentItems]);
    }
  }

  /**
   * Cập nhật tổng tiền của item
   */
  updateItemTotal(item: CartItem): void {
    item.totalPrice = item.quantity * item.unitPrice;
  }

  /**
   * Tăng số lượng
   */
  increaseQuantity(item: CartItem): void {
    const currentItems = this.getCartItems();
    const index = currentItems.findIndex(i => i === item);
    if (index !== -1) {
      currentItems[index].quantity++;
      this.setCartItems([...currentItems]);
    }
  }

  /**
   * Giảm số lượng
   */
  decreaseQuantity(item: CartItem): void {
    const currentItems = this.getCartItems();
    const index = currentItems.findIndex(i => i === item);
    if (index !== -1 && currentItems[index].quantity > 1) {
      currentItems[index].quantity--;
      this.setCartItems([...currentItems]);
    }
  }

  /**
   * Xóa toàn bộ giỏ hàng
   */
  clearCart(): void {
    this.setCartItems([]);
    this.setSelectedItem(null);
  }

  /**
   * Tính tổng số lượng
   */
  getTotalQuantity(): number {
    return this.getCartItems().reduce((total, item) => total + item.quantity, 0);
  }

  /**
   * Tính tổng tiền
   */
  getTotalAmount(): number {
    return this.getCartItems().reduce((total, item) => {
      return total + (item.unitPrice * item.quantity);
    }, 0);
  }

  /**
   * Tính tổng cost (giá vốn)
   */
  getTotalCost(): number {
    return this.getCartItems().reduce((total, item) => {
      const cost = item.product.Cost || 0;
      return total + (cost * item.quantity);
    }, 0);
  }

  /**
   * Tính tổng giá trị giỏ hàng (từ totalPrice của mỗi item)
   */
  getCartTotal(): number {
    return this.getCartItems().reduce((sum, item) => sum + (item.totalPrice || 0), 0);
  }

  /**
   * Set selected item
   */
  setSelectedItem(item: CartItem | null): void {
    this.selectedItemSubject.next(item);
  }

  /**
   * Get selected item
   */
  getSelectedItem(): CartItem | null {
    return this.selectedItemSubject.value;
  }
}
