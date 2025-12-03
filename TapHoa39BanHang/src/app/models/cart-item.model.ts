import { Product } from "./product.model";

export interface CartItem {
  product: Product;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  unitPriceSaleOff: number; // Thêm dòng này
}