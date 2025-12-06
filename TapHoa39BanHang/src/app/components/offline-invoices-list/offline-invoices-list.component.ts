import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { InvoiceTab } from '../../models/invoice.model';
import { InvoiceService } from '../../services/invoice.service';
import { TimeZoneService } from '../../services/time-zone.service';
import { KiotvietService } from '../../services/kiotviet.service';
import { GroupService } from '../../services/group.service';
import { IndexedDBService } from '../../services/indexed-db.service';
import { ProductService } from '../../services/product.service';
import { Product } from '../../models/product.model';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-offline-invoices-list',
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatTableModule,
    MatProgressSpinnerModule
  ],
  templateUrl: './offline-invoices-list.component.html',
  styleUrl: './offline-invoices-list.component.css'
})
export class OfflineInvoicesListComponent implements OnInit {
  offlineInvoices: InvoiceTab[] = [];
  displayedColumns: string[] = ['id', 'customer', 'totalPrice', 'createdDate', 'actions'];
  isLoading = false;

  constructor(
    private dialogRef: MatDialogRef<OfflineInvoicesListComponent>,
    private invoiceService: InvoiceService,
    private timeZoneService: TimeZoneService,
    private kiotvietService: KiotvietService,
    private groupService: GroupService,
    private indexedDBService: IndexedDBService,
    private productService: ProductService,
  ) { }

  groupedProducts: Record<number, any[]> = {}

  ngOnInit() {
    this.loadOfflineInvoices();
    this.groupDB();
  }

  private async groupDB() {
    const db = await this.indexedDBService.getDB('SalesDB', 1);
    const tx = db.transaction('products', 'readonly');
    const filteredProducts = await tx.store.getAll();
    this.groupedProducts = await this.groupService.group(filteredProducts);
  }

  async loadOfflineInvoices() {
    this.isLoading = true;
    try {
      this.offlineInvoices = await this.invoiceService.getAllOfflineInvoices();
    } catch (error) {
      console.error('Lỗi khi tải danh sách offline invoices:', error);
    } finally {
      this.isLoading = false;
    }
  }

  formatPrice(price: number): string {
    return price.toLocaleString('en-US');
  }

  formatDate(dateString: string): string {
    try {
      const date = this.timeZoneService.parseApiDate(dateString);
      return this.timeZoneService.formatVietnamISOString(date);
    } catch (error) {
      return dateString;
    }
  }

  getCustomerName(invoice: InvoiceTab): string {
    return invoice.customer?.Name || 'Khách lẻ';
  }

  /**
   * Helper: Lấy danh sách product IDs bị ảnh hưởng từ invoice
   */
  private extractAffectedProductIds(invoice: InvoiceTab): number[] {
    const affectedIds = new Set<number>();

    for (const item of invoice.cartItems || []) {
      if (item?.product?.Id != null) {
        affectedIds.add(Number(item.product.Id));
      }

      const masterUnitId = item?.product?.MasterUnitId || item?.product?.Id;
      if (masterUnitId != null) {
        const group = this.groupedProducts[masterUnitId] as Product[] | undefined;
        if (group && group.length > 0) {
          for (const variant of group) {
            if (variant?.Id != null) {
              affectedIds.add(Number(variant.Id));
            }
          }
        }
      }
    }

    return Array.from(affectedIds).filter(id => Number.isFinite(id));
  }

  /**
   * ✅ SỬA: Sync một invoice - THÊM fetchProductsByIds để cập nhật IndexedDB
   */
  async syncInvoice(invoice: InvoiceTab) {
    try {
      console.log(`🔄 [SYNC] Bắt đầu sync invoice ${invoice.id}...`);

      // =============================
      // BƯỚC 1: Lấy danh sách product IDs bị ảnh hưởng
      // =============================
      const affectedIds = this.extractAffectedProductIds(invoice);
      console.log(`  📊 Có ${affectedIds.length} products bị ảnh hưởng`);

      // =============================
      // BƯỚC 2: Lấy OnHand hiện tại từ IndexedDB
      // =============================
      const preAdjustmentOnHand = new Map<number, number>();
      for (const productId of affectedIds) {
        const product = await this.productService.getProductByIdFromIndexedDB(productId);
        if (product) {
          preAdjustmentOnHand.set(productId, Number(product.OnHand ?? 0));
        }
      }
      console.log(`  📊 Đã lấy OnHand hiện tại của ${preAdjustmentOnHand.size} products`);

      // =============================
      // BƯỚC 3: Gửi invoice lên Firestore
      // =============================
      console.log(`  📤 Gửi invoice lên Firestore... `);
      await firstValueFrom(this.invoiceService.addInvoiceToFirestore(invoice));
      console.log(`  ✅ Invoice đã được gửi lên Firestore`);

      // =============================
      // BƯỚC 4: Gọi API update_onhand_batch để tính toán và cập nhật OnHand
      // =============================
      console.log(`  🔄 Gọi API update_onhand_batch... `);
      const response = await this.productService.updateProductsOnHandFromInvoiceToFireBase(
        invoice,
        this.groupedProducts,
        new Set<number>(),
        'decrease',
        preAdjustmentOnHand
      );
      console.log(`  📦 API update_onhand_batch Response:`, response);

      // =============================
      // BƯỚC 5: ✅ GỌI fetchProductsByIds ĐỂ CẬP NHẬT IndexedDB
      // =============================
      if (affectedIds.length > 0) {
        console.log(`  🔄 Gọi API /products/fetch để cập nhật IndexedDB...`);

        try {
          const fetchedProducts = await this.productService.fetchProductsByIds(affectedIds);
          console.log(`  ✅ Đã fetch ${fetchedProducts.length} products từ Firestore`);

          // Verify IndexedDB đã được cập nhật
          console.log(`  🔍 Verify IndexedDB sau khi fetch:`);
          for (const product of fetchedProducts.slice(0, 3)) {
            const dbProduct = await this.productService.getProductByIdFromIndexedDB(product.Id);
            const oldOnHand = preAdjustmentOnHand.get(product.Id) ?? 'N/A';
            console.log(`    Product ${product.Id}: Old=${oldOnHand}, Firestore=${product.OnHand}, IndexedDB=${dbProduct?.OnHand}`);
          }
        } catch (fetchErr) {
          console.error(`  ❌ Lỗi khi fetch products:`, fetchErr);
        }
      }

      // Đánh dấu invoice đã sync OnHand
      invoice.onHandSynced = true;

      // =============================
      // BƯỚC 6: Xóa invoice khỏi offline store
      // =============================
      await this.invoiceService.deleteOfflineInvoice(invoice.id);
      console.log(`  🗑️ Đã xóa invoice khỏi offline store`);

      // =============================
      // BƯỚC 7: Cập nhật KiotViet (fire and forget)
      // =============================
      console.log(`  📤 Cập nhật KiotViet... `);
      try {
        await this.kiotvietService.updateOnHandFromInvoiceToKiotviet(invoice, this.groupedProducts);
        console.log(`  ✅ Đã cập nhật KiotViet`);
      } catch (kvErr) {
        console.warn(`  ⚠️ Lỗi cập nhật KiotViet (không ảnh hưởng sync):`, kvErr);
      }

      // =============================
      // BƯỚC 8: Reload danh sách và groupedProducts
      // =============================
      await this.loadOfflineInvoices();
      await this.groupDB();

      console.log(`✅ [SYNC] Đã sync thành công invoice ${invoice.id}`);

    } catch (error) {
      console.error(`❌ [SYNC] Lỗi khi sync invoice ${invoice.id}:`, error);
      alert('Không thể sync invoice này. Vui lòng thử lại sau.');
    }
  }

  /**
   * ✅ SỬA: Sync tất cả invoices - THÊM fetchProductsByIds để cập nhật IndexedDB
   */
  async syncAllInvoices() {
    if (this.offlineInvoices.length === 0) {
      alert('Không có invoice nào để sync');
      return;
    }

    const confirmed = confirm(`Bạn có chắc chắn muốn sync tất cả ${this.offlineInvoices.length} invoice? `);
    if (!confirmed) return;

    this.isLoading = true;
    let successCount = 0;
    let failedCount = 0;
    const allAffectedProductIds = new Set<number>();

    console.log(`🔄 [SYNC ALL] Bắt đầu sync ${this.offlineInvoices.length} invoices...`);

    for (const invoice of this.offlineInvoices) {
      try {
        console.log(`\n📋 [${successCount + failedCount + 1}/${this.offlineInvoices.length}] Sync invoice ${invoice.id}... `);

        // =============================
        // BƯỚC 1: Lấy danh sách product IDs bị ảnh hưởng
        // =============================
        const affectedIds = this.extractAffectedProductIds(invoice);
        affectedIds.forEach(id => allAffectedProductIds.add(id));

        // =============================
        // BƯỚC 2: Lấy OnHand hiện tại từ IndexedDB
        // =============================
        const preAdjustmentOnHand = new Map<number, number>();
        for (const productId of affectedIds) {
          const product = await this.productService.getProductByIdFromIndexedDB(productId);
          if (product) {
            preAdjustmentOnHand.set(productId, Number(product.OnHand ?? 0));
          }
        }

        // =============================
        // BƯỚC 3: Gửi invoice lên Firestore
        // =============================
        await firstValueFrom(this.invoiceService.addInvoiceToFirestore(invoice));

        // =============================
        // BƯỚC 4: Gọi API update_onhand_batch
        // =============================
        await this.productService.updateProductsOnHandFromInvoiceToFireBase(
          invoice,
          this.groupedProducts,
          new Set<number>(),
          'decrease',
          preAdjustmentOnHand
        );

        // Đánh dấu đã sync
        invoice.onHandSynced = true;

        // =============================
        // BƯỚC 5: Xóa invoice khỏi offline store
        // =============================
        await this.invoiceService.deleteOfflineInvoice(invoice.id);

        // =============================
        // BƯỚC 6: Cập nhật KiotViet (fire and forget)
        // =============================
        try {
          await this.kiotvietService.updateOnHandFromInvoiceToKiotviet(invoice, this.groupedProducts);
        } catch (kvErr) {
          console.warn(`  ⚠️ Lỗi KiotViet (không ảnh hưởng sync):`, kvErr);
        }

        successCount++;
        console.log(`  ✅ Invoice ${invoice.id} sync thành công`);

      } catch (error) {
        console.error(`  ❌ Lỗi khi sync invoice ${invoice.id}:`, error);
        failedCount++;
      }
    }

    // =============================
    // BƯỚC 7: ✅ GỌI fetchProductsByIds CHO TẤT CẢ PRODUCTS BỊ ẢNH HƯỞNG
    // =============================
    if (allAffectedProductIds.size > 0) {
      console.log(`\n🔄 [SYNC ALL] Gọi API /products/fetch cho ${allAffectedProductIds.size} products...`);

      try {
        const idsArray = Array.from(allAffectedProductIds);
        const fetchedProducts = await this.productService.fetchProductsByIds(idsArray);
        console.log(`✅ [SYNC ALL] Đã fetch và cập nhật ${fetchedProducts.length} products vào IndexedDB`);

        // Verify một số sản phẩm
        console.log(`🔍 [SYNC ALL] Verify IndexedDB:`);
        for (const product of fetchedProducts.slice(0, 5)) {
          const dbProduct = await this.productService.getProductByIdFromIndexedDB(product.Id);
          console.log(`  Product ${product.Id} (${product.Code}): Firestore=${product.OnHand}, IndexedDB=${dbProduct?.OnHand}`);
        }
      } catch (fetchErr) {
        console.error(`❌ [SYNC ALL] Lỗi khi fetch products:`, fetchErr);
      }
    }

    // =============================
    // BƯỚC 8: Reload dữ liệu
    // =============================
    console.log(`\n🔄 [SYNC ALL] Reload dữ liệu...`);
    await this.loadOfflineInvoices();
    await this.groupDB();

    // =============================
    // BƯỚC 9: Hiển thị kết quả
    // =============================
    console.log(`\n✅ [SYNC ALL] Hoàn tất: ${successCount} thành công, ${failedCount} thất bại`);

    if (successCount > 0) {
      alert(`Đã sync thành công ${successCount} invoice${successCount > 1 ? 's' : ''}`);
    }
    if (failedCount > 0) {
      alert(`Không thể sync ${failedCount} invoice${failedCount > 1 ? 's' : ''}`);
    }

    this.isLoading = false;
  }

  async deleteOfflineInvoice(invoice: InvoiceTab) {
    if (!confirm(`Bạn có chắc chắn muốn xóa hóa đơn offline mã ${invoice.id}?`)) return;
    try {
      await this.invoiceService.deleteOfflineInvoice(invoice.id);
      await this.loadOfflineInvoices();
      console.log(`Đã xóa hóa đơn offline ${invoice.id}`);
    } catch (error) {
      console.error(`Lỗi khi xóa hóa đơn offline ${invoice.id}:`, error);
      alert('Không thể xóa hóa đơn này.  Vui lòng thử lại sau.');
    }
  }

  closeDialog() {
    this.dialogRef.close();
  }
}