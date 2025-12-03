import { Component, OnInit } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
// import { ProductService } from './services/product.service';
// import { CustomerService } from './services/customer.service';
// import { InvoiceService } from './services/invoice.service';
// import { KiotvietService } from './services/kiotviet.service';
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterModule,
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],

})
export class AppComponent implements OnInit {

  constructor(
    private router: Router,
    // private productService: ProductService,
    // private customerService: CustomerService,
    // private invoiceService: InvoiceService,
    // private kiotvietService: KiotvietService,
  ) {
  }

  ngOnInit(): void {
    // Kiểm tra đăng nhập KiotViet
    const token = localStorage.getItem('kv_access_token');
    const retailer = localStorage.getItem('kv_retailer');
    const branchId = localStorage.getItem('kv_branch_id');
    
    if (!token || !retailer || !branchId) {
      if (this.router.url !== '/login') {
        this.router.navigate(['/login']);
      }
      return;
    }

    // Kiểm tra token có expired không
    if (this.isTokenExpired(token)) {
      console.log('Token đã hết hạn, chuyển hướng về trang đăng nhập');
      this.clearStoredCredentials();
      if (this.router.url !== '/login') {
        this.router.navigate(['/login']);
      }
      return;
    }
  }

  private isTokenExpired(token: string): boolean {
    try {
      // JWT token có 3 phần, phần thứ 2 là payload
      const payload = token.split('.')[1];
      const decodedPayload = JSON.parse(atob(payload));
      
      // Kiểm tra thời gian hết hạn (exp)
      if (decodedPayload.exp) {
        const currentTime = Math.floor(Date.now() / 1000);
        return currentTime >= decodedPayload.exp;
      }
      
      // Nếu không có exp, kiểm tra thời gian tạo token (iat) + thời gian sống ước tính
      if (decodedPayload.iat) {
        const currentTime = Math.floor(Date.now() / 1000);
        const estimatedExpiry = decodedPayload.iat + (24 * 60 * 60); // Ước tính 24 giờ
        return currentTime >= estimatedExpiry;
      }
      
      // Nếu không có thông tin thời gian, coi như không expired
      return false;
    } catch (error) {
      console.error('Lỗi khi kiểm tra token expired:', error);
      // Nếu không parse được token, coi như expired để đảm bảo an toàn
      return true;
    }
  }

  private clearStoredCredentials(): void {
    localStorage.removeItem('kv_access_token');
    localStorage.removeItem('kv_retailer');
    localStorage.removeItem('kv_branch_id');
  }
  // async fromKiotViet() {
  //   console.log('Starting sync from KiotViet to IndexedDB...');
  //   await this.productService.loadItemsFromKiotVietToIndexedDB();
  //   await this.customerService.loadCustomersFromKiotvietToIndexedDB();
  //   await this.kiotvietService.syncProductFromKiotvietToFirebase('');
  //   await this.kiotvietService.syncCustomerFromKiotvietToFirebase('');
  //   console.log('Sync from KiotViet to IndexedDB finished.');
  // }
  // async fromIndexedDB() {
  //   console.log('Starting sync from IndexedDB to Firebase...');
  //   await this.invoiceService.syncAllInvoicesFromIndexedDBToFirebase();
  //   await this.productService.syncAllProductsFromIndexedDBToFirebase();
  //   await this.customerService.syncAllCustomersFromIndexedDBToFirebase();
  //   console.log('Sync from IndexedDB to Firebase finished.');
  // }
  // async fromFirebase() {
  //   console.log('Starting sync from Firebase to IndexedDB...');
  //   await this.productService.syncProductsFromFirebaseToIndexedDB();
  //   await this.customerService.syncCustomersFromFirebaseToIndexedDB();
  //   await this.invoiceService.syncInvoicesFromFirestoreToIndexedDB();
  //   console.log('Sync from Firebase to IndexedDB finished.');
  // }
}