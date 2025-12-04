import { Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';
import { ProductService } from '../product.service';
import { Product } from '../../models/product.model';

/**
 * Service orchestrator cho reload và sync operations
 * Tách toàn bộ logic reload phức tạp ra khỏi component
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

    // Force clear cache để đảm bảo lấy dữ liệu mới nhất
    this. productService.forceClearCache();

    // Bước 1: Fetch products từ backend (KiotViet)
    const apiProducts = await this. fetchProductsFromBackend();
    if (!apiProducts || apiProducts.length === 0) {
      this.showError('Không tải được danh sách sản phẩm từ KiotViet, thử lại sau.');
      return { success: false, seededIndexedDB: false, cleanupResult };
    }

    let apiProductCount = apiProducts.length;

    // Bước 2: Seed IndexedDB nếu cần
    seededIndexedDB = await this.productService.ensureIndexedDbSeeded(apiProducts);

    if (seededIndexedDB) {
      console.log('🆕 IndexedDB trống nên đã seed dữ liệu sản phẩm trong quá trình reload.');
    }

    // Bước 3: Sync KiotViet -> Firebase
    const syncResult = await this.syncKiotVietToFirebase();
    if (!syncResult.success) {
      return { success: false, seededIndexedDB, cleanupResult };
    }

    // Cập nhật apiProducts từ sync result nếu có
    if (syncResult.products && syncResult.products. length > 0) {
      console.log(`✅ Đã lấy ${syncResult.products. length} products từ Firebase`);
      apiProductCount = syncResult.products.length;
    }

    // Bước 4: Cleanup orphaned products và lấy firebaseProducts
    const cleanupData = await this.cleanupOrphanedProducts(apiProducts);
    cleanupResult = cleanupData.result;
    const firebaseProducts = cleanupData.firebaseProducts;

    // Bước 5: LUÔN sync từ Firebase về IndexedDB (không phụ thuộc vào seededIndexedDB)
    // Đây là thay đổi quan trọng - đảm bảo products được cập nhật từ Firebase
    // Sử dụng firebaseProducts đã fetch ở bước 4 để tránh gọi API lần nữa
    // Không cần clear cache vì chúng ta đang sử dụng products đã fetch sẵn
    console.log('🔄 Sync products từ Firebase về IndexedDB...');
    await this.syncFromFirebaseToIndexedDB(firebaseProducts);

    // Bước 6: Verify và reseed nếu cần
    await this.verifyAndReseedIfNeeded(apiProducts, apiProductCount);

    reloadSucceeded = true;
    console.log('✅ Tất cả dữ liệu đã được reload thành công! ');
    console.log(`📊 Tóm tắt: Đã xóa ${cleanupResult.deletedCount} orphaned products và đồng bộ sản phẩm với Firebase. `);

  } catch (err) {
    console.error('❌ Lỗi khi reload dữ liệu:', err);
    reloadSucceeded = false;
  } finally {
    this.isReloading = false;
  }

  return { success: reloadSucceeded, seededIndexedDB, cleanupResult };
}

  /**
   * Fetch products từ backend
   */
  private async fetchProductsFromBackend(): Promise<Product[]> {
    try {
      const products = await this.productService.fetchAllProductsFromBackend();
      if (!products || products.length === 0) {
        console.warn('⚠️ Không nhận được danh sách sản phẩm từ backend.');
        return [];
      }
      return products;
    } catch (err) {
      console.error('❌ Lỗi khi fetch products từ backend:', err);
      return [];
    }
  }

  /**
   * Sync KiotViet -> Firebase
   */
  private async syncKiotVietToFirebase(): Promise<{
    success: boolean;
    products?: Product[];
    stats?: any;
  }> {
    console.log('☁️ Đồng bộ KiotViet -> Firebase (optimized)...');
    try {
      const syncResult = await this.productService.syncKiotVietToFirebase();

      if (!syncResult.success) {
        const errorMsg = syncResult.error || 'Đồng bộ thất bại';
        console.error('❌ Sync failed:', errorMsg);
        this.snackBar.open(`❌ Lỗi đồng bộ: ${errorMsg}`, 'Đóng', {
          duration: 6000,
          panelClass: ['error-snackbar'],
          horizontalPosition: 'center',
          verticalPosition: 'top'
        });
        return { success: false };
      }

      console.log('✅ Sync succeeded:', syncResult.stats);
      const stats = syncResult.stats;
      const timeSpent = stats?.total_time_seconds || 0;

      // Show success message
      this.snackBar.open(
        `✅ Đồng bộ thành công! ${stats?.updated_or_created || 0} cập nhật, ${stats?.unchanged || 0} không đổi (${timeSpent}s)`,
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
      console.error('⚠️ Lỗi khi syncKiotVietToFirebase():', err);
      this.snackBar.open(`❌ Lỗi: ${err?.message || 'Không xác định'}`, 'Đóng', {
        duration: 6000,
        panelClass: ['error-snackbar'],
        horizontalPosition: 'center',
        verticalPosition: 'top'
      });
      return { success: false };
    }
  }

  /**
   * Cleanup orphaned products
   * Returns both cleanup result and firebaseProducts to avoid duplicate API calls
   */
  private async cleanupOrphanedProducts(apiProducts: Product[]): Promise<{
    result: {
      deletedCount: number;
      totalChecked: number;
    };
    firebaseProducts: Product[];
  }> {
    console.log('🧹 Bước: Cleanup orphaned products (preserve inactive from Firebase)...');
    try {
      // Lấy products từ Firebase
      const firebaseProducts = await firstValueFrom(
        this.productService.getAllProductsFromFirebase()
      ).catch(err => {
        console.warn('⚠️ Không lấy được products từ Firebase, tiếp tục với API only', err);
        return [] as Product[];
      }) || [];

      // Merge products từ API và Firebase
      const mergedProductsMap = new Map<number, Product>();
      for (const p of apiProducts || []) {
        if (p && p.Id) mergedProductsMap.set(p.Id, p);
      }
      for (const p of firebaseProducts || []) {
        if (p && p.Id && !mergedProductsMap.has(p.Id)) mergedProductsMap.set(p.Id, p);
      }

      const combinedProducts = Array.from(mergedProductsMap.values());

      // Cleanup
      const result = await this.productService.cleanupOrphanedProductsFromAPI(combinedProducts);
      console.log(`✅ Cleanup hoàn thành: đã xóa ${result.deletedCount}/${result.totalChecked} orphaned products`);
      return {
        result,
        firebaseProducts
      };

    } catch (err) {
      console.error('❌ Lỗi khi cleanup orphaned products:', err);
      return {
        result: { deletedCount: 0, totalChecked: 0 },
        firebaseProducts: []
      };
    }
  }

  /**
   * Sync từ Firebase về IndexedDB
   * @param firebaseProducts Optional products already fetched from Firebase to avoid duplicate API calls
   */
  private async syncFromFirebaseToIndexedDB(firebaseProducts?: Product[]): Promise<void> {
    console.log('ℹ️ Sync products từ Firebase về IndexedDB...');
    try {
      if (firebaseProducts && firebaseProducts.length > 0) {
        console.log(`📦 Sử dụng ${firebaseProducts.length} products đã fetch từ Firebase (tránh gọi API trùng)`);
        await this.productService.syncProductsFromFirebaseToIndexedDB(firebaseProducts);
      } else {
        console.log('🔄 Fetch products mới từ Firebase...');
        await this.productService.syncProductsFromFirebaseToIndexedDB();
      }
      console.log('✅ Đã sync products từ Firebase về IndexedDB.');
    } catch (err) {
      console.warn('⚠️ Lỗi khi sync từ Firebase về IndexedDB:', err);
    }
  }

  /**
   * Verify và reseed nếu cần
   */
  private async verifyAndReseedIfNeeded(
    apiProducts: Product[],
    apiProductCount: number
  ): Promise<void> {
    let indexedDbCount = await this.productService.countProductsInIndexedDb();

    if (indexedDbCount !== apiProductCount) {
      console.warn(
        `⚠️ IndexedDB hiện có ${indexedDbCount} sản phẩm trong khi API trả về ${apiProductCount}. Thực hiện reseed để đồng bộ.`
      );

      await this.productService.reseedIndexedDbWithApiProducts(apiProducts);
      indexedDbCount = await this.productService.countProductsInIndexedDb();

      if (indexedDbCount === apiProductCount) {
        console.log('✅ IndexedDB đã được reseed và khớp số lượng với API.');
      } else {
        console.error(`❌ Sau khi reseed, IndexedDB vẫn có ${indexedDbCount}/${apiProductCount} sản phẩm.`);
      }
    }
  }

  /**
   * Show error message
   */
  private showError(message: string): void {
    this.snackBar.open(message, 'Đóng', {
      duration: 4000,
      panelClass: ['error-snackbar']
    });
  }
}
