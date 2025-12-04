import { Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';
import { ProductService } from '../product.service';
import { Product } from '../../models/product.model';

/**
 * Service orchestrator cho reload và sync operations
 * Tách toàn bộ logic reload phức tạp ra khỏi component
 * 
 * THỨ TỰ API CALLS:
 * 1. /api/kiotviet/items/all - Lấy data từ KiotViet
 * 2. /api/firebase/get/products - Lấy data từ Firebase  
 * 3. /api/sync/kiotviet/firebase/products - Sync KiotViet → Firebase
 * 4.  Cập nhật IndexedDB với data đã sync
 */
@Injectable({
  providedIn: 'root'
})
export class ReloadOrchestratorService {
  private isReloading = false;

  constructor(
    private productService: ProductService,
    private snackBar: MatSnackBar
  ) {}

  /**
   * Kiểm tra xem đang reload hay không
   */
  isCurrentlyReloading(): boolean {
    return this.isReloading;
  }

  /**
   * Main reload method - orchestrates toàn bộ reload process
   * 
   * THỨ TỰ ĐÚNG:
   * 1. Fetch từ KiotViet (/api/kiotviet/items/all)
   * 2. Fetch từ Firebase (/api/firebase/get/products)
   * 3. Sync KiotViet → Firebase (/api/sync/kiotviet/firebase/products)
   * 4. Cập nhật IndexedDB
   */
  async reload(): Promise<{
    success: boolean;
    seededIndexedDB: boolean;
    cleanupResult: { deletedCount: number; totalChecked: number };
  }> {
    if (this.isReloading) {
      console.log('ℹ️ Reload đang chạy, bỏ qua yêu cầu mới.');
      return {
        success: false,
        seededIndexedDB: false,
        cleanupResult: { deletedCount: 0, totalChecked: 0 }
      };
    }

    this.isReloading = true;
    let cleanupResult = { deletedCount: 0, totalChecked: 0 };
    let seededIndexedDB = false;
    let reloadSucceeded = false;

    try {
      console.log('🔄 Bắt đầu reload dữ liệu.. .');
      console.log('📋 Thứ tự API calls: KiotViet → Firebase → Sync → IndexedDB');

      // Force clear cache để đảm bảo lấy dữ liệu mới nhất
      this.productService.forceClearCache();

      // =============================
      // BƯỚC 1: Fetch từ KiotViet (/api/kiotviet/items/all)
      // =============================
      console.log('📥 BƯỚC 1: Lấy dữ liệu từ KiotViet...');
      const kiotvietProducts = await this.fetchProductsFromKiotViet();
      
      if (! kiotvietProducts || kiotvietProducts.length === 0) {
        this.showError('Không tải được danh sách sản phẩm từ KiotViet, thử lại sau.');
        return { success: false, seededIndexedDB: false, cleanupResult };
      }
      console.log(`✅ BƯỚC 1 hoàn tất: Nhận được ${kiotvietProducts.length} sản phẩm từ KiotViet`);

      // =============================
      // BƯỚC 2: Fetch từ Firebase (/api/firebase/get/products)
      // =============================
      console. log('📥 BƯỚC 2: Lấy dữ liệu từ Firebase.. .');
      const firebaseProducts = await this.fetchProductsFromFirebase();
      console.log(`✅ BƯỚC 2 hoàn tất: Nhận được ${firebaseProducts.length} sản phẩm từ Firebase`);

      // =============================
      // BƯỚC 3: Sync KiotViet → Firebase (/api/sync/kiotviet/firebase/products)
      // =============================
      console.log('☁️ BƯỚC 3: Đồng bộ KiotViet → Firebase...');
      const syncResult = await this.syncKiotVietToFirebase();
      
      if (!syncResult.success) {
        console.error('❌ BƯỚC 3 thất bại: Sync không thành công');
        return { success: false, seededIndexedDB, cleanupResult };
      }
      console.log('✅ BƯỚC 3 hoàn tất: Sync thành công');

      // Lấy products đã sync (ưu tiên từ sync result, fallback về firebase)
      const syncedProducts = syncResult.products && syncResult.products. length > 0
        ? syncResult. products
        : firebaseProducts;

      // =============================
      // BƯỚC 4: Cleanup orphaned products
      // =============================
      console.log('🧹 BƯỚC 4: Cleanup orphaned products...');
      cleanupResult = await this.cleanupOrphanedProducts(kiotvietProducts, firebaseProducts);
      console.log(`✅ BƯỚC 4 hoàn tất: Đã xóa ${cleanupResult.deletedCount} orphaned products`);

      // =============================
      // BƯỚC 5: Cập nhật IndexedDB với data đã sync
      // =============================
      console.log('💾 BƯỚC 5: Cập nhật IndexedDB...');
      
      // Merge products: ưu tiên KiotViet, bổ sung từ Firebase
      const mergedProducts = this.mergeProducts(kiotvietProducts, syncedProducts);
      
      // Seed hoặc reseed IndexedDB
      const currentCount = await this.productService.countProductsInIndexedDb();
      
      if (currentCount === 0) {
        // IndexedDB trống, seed mới
        seededIndexedDB = await this.productService.ensureIndexedDbSeeded(mergedProducts);
        console.log('🆕 IndexedDB trống, đã seed dữ liệu mới');
      } else {
        // IndexedDB có data, reseed để đảm bảo đồng bộ
        await this.productService.reseedIndexedDbWithApiProducts(mergedProducts);
        console.log('🔄 IndexedDB đã được reseed với data mới');
      }

      // =============================
      // BƯỚC 6: Verify số lượng
      // =============================
      console.log('🔍 BƯỚC 6: Verify dữ liệu...');
      await this.verifyAndLogResults(mergedProducts. length);

      reloadSucceeded = true;
      console.log('✅ Tất cả dữ liệu đã được reload thành công! ');
      console.log(`📊 Tóm tắt: KiotViet(${kiotvietProducts.length}) + Firebase(${firebaseProducts.length}) → IndexedDB(${mergedProducts.length})`);

    } catch (err) {
      console.error('❌ Lỗi khi reload dữ liệu:', err);
      reloadSucceeded = false;
    } finally {
      this.isReloading = false;
    }

    return { success: reloadSucceeded, seededIndexedDB, cleanupResult };
  }

  /**
   * BƯỚC 1: Fetch products từ KiotViet
   * API: /api/kiotviet/items/all
   */
  private async fetchProductsFromKiotViet(): Promise<Product[]> {
    try {
      console.log('  → Gọi API: /api/kiotviet/items/all');
      const products = await this.productService.fetchAllProductsFromBackend();
      
      if (!products || products.length === 0) {
        console.warn('⚠️ Không nhận được danh sách sản phẩm từ KiotViet.');
        return [];
      }
      
      console.log(`  ← Nhận được ${products.length} sản phẩm từ KiotViet`);
      return products;
    } catch (err) {
      console.error('❌ Lỗi khi fetch products từ KiotViet:', err);
      return [];
    }
  }

  /**
   * BƯỚC 2: Fetch products từ Firebase
   * API: /api/firebase/get/products
   */
  private async fetchProductsFromFirebase(): Promise<Product[]> {
    try {
      console.log('  → Gọi API: /api/firebase/get/products');
      
      // Clear cache trước khi fetch
      this.productService.forceClearCache();
      
      const products = await firstValueFrom(
        this.productService. getAllProductsFromFirebase()
      ). catch(err => {
        console.warn('⚠️ Lỗi khi lấy products từ Firebase:', err);
        return [] as Product[];
      });
      
      console.log(`  ← Nhận được ${products?. length || 0} sản phẩm từ Firebase`);
      return products || [];
    } catch (err) {
      console.error('❌ Lỗi khi fetch products từ Firebase:', err);
      return [];
    }
  }

  /**
   * BƯỚC 3: Sync KiotViet → Firebase
   * API: /api/sync/kiotviet/firebase/products
   */
  private async syncKiotVietToFirebase(): Promise<{
    success: boolean;
    products?: Product[];
    stats?: any;
  }> {
    try {
      console.log('  → Gọi API: /api/sync/kiotviet/firebase/products');
      
      const syncResult = await this.productService.syncKiotVietToFirebase();

      if (!syncResult.success) {
        const errorMsg = syncResult.error || 'Đồng bộ thất bại';
        console.error('  ← Sync failed:', errorMsg);
        
        this.snackBar.open(`❌ Lỗi đồng bộ: ${errorMsg}`, 'Đóng', {
          duration: 6000,
          panelClass: ['error-snackbar'],
          horizontalPosition: 'center',
          verticalPosition: 'top'
        });
        
        return { success: false };
      }

      const stats = syncResult.stats;
      const timeSpent = stats?.total_time_seconds || 0;
      
      console.log(`  ← Sync thành công: ${stats?.updated_or_created || 0} cập nhật, ${stats?.unchanged || 0} không đổi (${timeSpent}s)`);

      // Show success message
      this.snackBar.open(
        `✅ Đồng bộ thành công!  ${stats?.updated_or_created || 0} cập nhật, ${stats?.unchanged || 0} không đổi (${timeSpent}s)`,
        'Đóng',
        {
          duration: 5000,
          panelClass: ['success-snackbar'],
          horizontalPosition: 'center',
          verticalPosition: 'bottom'
        }
      );

      return {
        success: true,
        products: syncResult.products,
        stats: syncResult.stats
      };

    } catch (err: any) {
      console.error('❌ Lỗi khi syncKiotVietToFirebase:', err);
      
      this.snackBar.open(`❌ Lỗi: ${err?. message || 'Không xác định'}`, 'Đóng', {
        duration: 6000,
        panelClass: ['error-snackbar'],
        horizontalPosition: 'center',
        verticalPosition: 'top'
      });
      
      return { success: false };
    }
  }

  /**
   * BƯỚC 4: Cleanup orphaned products
   * Xóa products trong IndexedDB không còn tồn tại trong KiotViet hoặc Firebase
   */
  private async cleanupOrphanedProducts(
    kiotvietProducts: Product[],
    firebaseProducts: Product[]
  ): Promise<{
    deletedCount: number;
    totalChecked: number;
  }> {
    try {
      // Merge products từ cả 2 nguồn
      const mergedProducts = this.mergeProducts(kiotvietProducts, firebaseProducts);
      
      console.log(`  → Cleanup với ${mergedProducts. length} products hợp lệ`);
      
      const result = await this.productService.cleanupOrphanedProductsFromAPI(mergedProducts);
      
      console.log(`  ← Đã xóa ${result.deletedCount}/${result.totalChecked} orphaned products`);
      return result;

    } catch (err) {
      console.error('❌ Lỗi khi cleanup orphaned products:', err);
      return { deletedCount: 0, totalChecked: 0 };
    }
  }

  /**
   * Merge products từ KiotViet và Firebase
   * Ưu tiên data từ KiotViet (source of truth)
   */
  private mergeProducts(kiotvietProducts: Product[], firebaseProducts: Product[]): Product[] {
    const mergedMap = new Map<number, Product>();
    
    // Thêm products từ KiotViet trước (source of truth)
    for (const p of kiotvietProducts || []) {
      if (p && p.Id) {
        mergedMap.set(p.Id, p);
      }
    }
    
    // Thêm products từ Firebase nếu chưa có trong KiotViet
    // (có thể là products inactive hoặc chỉ tồn tại trong Firebase)
    for (const p of firebaseProducts || []) {
      if (p && p.Id && !mergedMap.has(p. Id)) {
        mergedMap.set(p.Id, p);
      }
    }
    
    return Array.from(mergedMap.values());
  }

  /**
   * BƯỚC 6: Verify và log kết quả
   */
  private async verifyAndLogResults(expectedCount: number): Promise<void> {
    const indexedDbCount = await this.productService. countProductsInIndexedDb();
    
    if (indexedDbCount === expectedCount) {
      console.log(`  ✅ Verify thành công: IndexedDB có ${indexedDbCount} sản phẩm (khớp với expected ${expectedCount})`);
    } else {
      console.warn(`  ⚠️ Verify: IndexedDB có ${indexedDbCount} sản phẩm (expected ${expectedCount})`);
    }
  }

  /**
   * Show error message
   */
  private showError(message: string): void {
    this.snackBar. open(message, 'Đóng', {
      duration: 4000,
      panelClass: ['error-snackbar']
    });
  }
}