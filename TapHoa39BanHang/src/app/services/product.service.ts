import { Injectable } from '@angular/core';
import { Product } from '../models/product.model';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, map } from 'rxjs';
import { environment } from '../../environments/environment';
import { catchError, of } from 'rxjs';
import { VietnameseService } from '../services/vietnamese.service';
import { KiotvietService } from '../services/kiotviet.service';
import { FirebaseService } from '../services/firebase.service';
import { IndexedDBService } from './indexed-db.service';
import { Observable } from 'rxjs';
import { InvoiceTab } from '../models/invoice.model';
import { Subject } from 'rxjs';

type ProductRealtimeUpdate = {
  productId: number;
  onHand?: number;
  basePrice?: number;
  cost?: number;
  code?: string;
  name?: string;
  fullName?: string;
};

@Injectable({
  providedIn: 'root'
})
export class ProductService {
  private dbName = 'SalesDB';
  private dbVersion = 3; // Synchronized with CategoryService version
  private storeName = 'products';
  private readonly outOfStockStoreName = 'outofstock';
  private readonly OUT_OF_STOCK_THRESHOLD = 0;

  // Cache mechanism để tránh gọi API trùng lặp
  private firebaseProductsCache: Product[] | null = null;
  private cacheTimestamp = 0;
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 phút

  // Debounce mechanism để tránh gọi saveAllProductsToFirebase trùng lặp
  private saveToFirebaseTimeout: any = null;
  private pendingProductsToSave: Product[] = [];
  private isSavingToFirebase = false;

  // Counter để theo dõi số lần gọi API
  private apiCallCount = 0;
  private cacheHitCount = 0;

  // Shared Promise để tránh gọi API đồng thời
  private currentFirebaseRequest: Promise<Product[]> | null = null;

  // Guard to prevent duplicate sync calls
  private isSyncing = false;
  private syncPromise: Promise<any> | null = null;

  // WebSocket removed: keep pending queues and retry helpers for HTTP-only fallback
  // Queue for pending notifications when socket/http unavailable
  private pendingOnHandNotifications: { productId: number; onHand?: number; basePrice?: number; timestamp: number }[] = [];
  // Queue for pending local IndexedDB applies when product record isn't present yet (e.g., race with initial sync)
  private pendingOnHandLocalApplies: Map<number, {
    onHand?: number;
    basePrice?: number;
    cost?: number;
    code?: string;
    name?: string;
    fullName?: string;
    attempts: number;
  }> = new Map();

  // Real-time event subject (used to broadcast updates to UI)
  private productOnHandUpdatedSubject = new Subject<ProductRealtimeUpdate>();
  public productOnHandUpdated$ = this.productOnHandUpdatedSubject.asObservable();

  // IndexedDB search cache to keep search responsive
  private indexedDbProductsCache: Product[] | null = null;
  private indexedDbCacheTimestamp = 0;
  private readonly INDEXED_DB_CACHE_DURATION = 5000;
  private readonly SEARCH_RESULT_LIMIT = 80;
  private readonly DEFAULT_UNIT_LABEL = '---';
  private productSearchIndex = new Map<number, { normalizedName: string; rawLowerName: string; codeLower: string }>();

  private normalizeUnitValue(unit?: string | null): string {
    if (typeof unit === 'string') {
      const trimmed = unit.trim();
      if (trimmed.length > 0 && trimmed.toLowerCase() !== 'null') {
        return trimmed;
      }
    }
    return this.DEFAULT_UNIT_LABEL;
  }

  private sanitizeProductForStorage(product: Product): Product {
    if (!product) {
      return product;
    }
    const sanitizedUnit = this.normalizeUnitValue(product.Unit);
    if (product.Unit === sanitizedUnit) {
      return product;
    }
    return { ...product, Unit: sanitizedUnit };
  }

  private ensureUnitOnProduct(product: Product | undefined | null): Product | undefined | null {
    if (!product) {
      return product;
    }
    const normalizedUnit = this.normalizeUnitValue(product.Unit);
    if (product.Unit !== normalizedUnit) {
      product.Unit = normalizedUnit;
    }
    return product;
  }

  private async syncOutOfStockEntry(product: Product | null | undefined): Promise<void> {
    if (!product || typeof product.Id !== 'number') {
      return;
    }

    const onHandValue = Number(product.OnHand);
    if (!Number.isFinite(onHandValue)) {
      return;
    }

    try {
      if (onHandValue <= this.OUT_OF_STOCK_THRESHOLD) {
        const entry = { ...product, OnHand: onHandValue } as Product;
        await this.indexedDBService.put<Product>(
          this.dbName,
          this.dbVersion,
          this.outOfStockStoreName,
          entry
        );
      } else {
        await this.indexedDBService.delete(
          this.dbName,
          this.dbVersion,
          this.outOfStockStoreName,
          product.Id
        );
      }
    } catch (error) {
      console.warn(`⚠️ syncOutOfStockEntry failed for product ${product.Id}:`, error);
    }
  }

  private parseFiniteNumber(value: unknown): number | null {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        return null;
      }
      value = trimmed;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  // Resolve backend base URL with optional runtime override via localStorage ('backendBaseUrl')
  private getBackendBaseUrl(): string {
    let base = environment.domainUrl;
    try {
      const override = localStorage.getItem('backendBaseUrl');
      if (override && typeof override === 'string' && override.trim().length > 0) {
        base = override.trim();
      }
    } catch (_) { /* ignore */ }

    // Helpful diagnostics for multi-machine setups
    try {
      const isLocalEnv = /(^|\/)localhost(?=[:/]|$)|(^|\/)127\.0\.0\.1(?=[:/]|$)/i.test(environment.domainUrl);
      const host = (window && window.location && window.location.hostname) ? window.location.hostname : '';
      const isLocalHost = host === 'localhost' || host === '127.0.0.1';
      if (isLocalEnv && !isLocalHost) {
        console.warn('⚠️ environment.domainUrl is localhost but app is accessed from a non-local host. Consider setting localStorage.backendBaseUrl to your backend IP/host. Using base =', base);
      }
    } catch (_) { /* ignore */ }

    return base;
  }

  constructor(
    private http: HttpClient,
    private vi: VietnameseService,
    private indexedDBService: IndexedDBService,
    private kiotvietService: KiotvietService,
    private firebaseService: FirebaseService
  ) {
    // No websocket initialization — backend no longer accepts incoming websocket updates.
  }

  async initDB(): Promise<void> {
    try {
      console.log('🔄 Khởi tạo ProductService IndexedDB...');

      // Prepare upgrade function so we can reuse it if we need to bump version to create missing stores
      const upgradeFn = (db: any) => {
        console.log(`📦 Đang tạo object store '${this.storeName}' cho database '${this.dbName}' v${this.dbVersion}`);

        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'Id' });
          store.createIndex('Name', 'Name', { unique: false });
          store.createIndex('MasterProductId', 'MasterProductId', { unique: false });
          store.createIndex('Code', 'Code', { unique: false });
        } else {
          console.log(`ℹ️ Object store '${this.storeName}' đã tồn tại`);
        }

        if (!db.objectStoreNames.contains('outofstock')) {
          const outofstore = db.createObjectStore('outofstock', { keyPath: 'Id' });
          outofstore.createIndex('Code', 'Code', { unique: false });
          outofstore.createIndex('FullName', 'FullName', { unique: false });
          console.log(`✅ Đã tạo object store 'outofstock' thành công`);
        }

        if (!db.objectStoreNames.contains('order')) {
          const outofstore = db.createObjectStore('order', { keyPath: 'id' });
          outofstore.createIndex('name', 'name', { unique: false });
          outofstore.createIndex('TotalPrice', 'totalPrice', { unique: false });
          console.log(`✅ Đã tạo object store 'order' thành công`);
        }
      };

      // Try opening with the configured version first
      await this.indexedDBService.getDB(this.dbName, this.dbVersion, upgradeFn);

      // Double-check object stores exist; if not, attempt an upgrade by bumping version by 1
      const stores = await this.indexedDBService.getObjectStoreNames(this.dbName, this.dbVersion);
      const missingStores = [this.storeName, 'outofstock', 'order'].filter(s => !stores.includes(s));
      if (missingStores.length > 0) {
        console.warn(`⚠️ Phát hiện missing stores (${missingStores.join(',')}) in ${this.dbName} v${this.dbVersion}, attempting upgrade to create them`);
        // Close current connection and open with higher version to trigger upgrade callback
        await this.indexedDBService.closeDB(this.dbName);
        await this.indexedDBService.getDB(this.dbName, this.dbVersion + 1, upgradeFn);
      }

      console.log('✅ ProductService IndexedDB đã sẵn sàng');
    } catch (error) {
      console.error('❌ Lỗi khi khởi tạo ProductService IndexedDB:', error);
      throw error;
    }
  }

  // Method để kiểm tra và đảm bảo IndexedDB đã được khởi tạo
  private async ensureDBInitialized(): Promise<void> {
    try {
      await this.ensureConnectionOpen();

      // Kiểm tra xem object store có tồn tại không
      const storeExists = await this.indexedDBService.checkObjectStoreExists(this.dbName, this.dbVersion, this.storeName);
      if (!storeExists) {
        console.warn(`⚠️ Object store '${this.storeName}' không tồn tại, đang khởi tạo lại...`);
        await this.initDB();
      }
    } catch (error) {
      console.error('❌ Lỗi khi đảm bảo IndexedDB được khởi tạo:', error);
      // Thử khởi tạo lại
      await this.initDB();
    }
  }

  private async ensureConnectionOpen(): Promise<void> {
    if (this.indexedDBService.isConnectionOpen(this.dbName)) {
      return;
    }

    console.warn('⚠️ Kết nối IndexedDB đã đóng, đang mở lại trước khi thao tác...');
    await this.indexedDBService.closeDB(this.dbName).catch(() => {/* ignore */ });
    await this.initDB();
  }

  public async fetchAllProductsFromBackend(): Promise<Product[]> {
    try {
      await this.ensureConnectionOpen();
      const payload = await firstValueFrom(
        this.http.get<unknown>(`${environment.domainUrl}${this.kiotvietService.kiotviet_items_api}`).pipe(
          catchError((err) => {
            console.error('❌ Lỗi khi gọi API products:', err);
            return of([]);
          })
        )
      ) ?? [];

      const products = this.normalizeProductApiPayload(payload);
      if (products.length === 0) {
        console.warn('⚠️ API products payload hợp lệ nhưng không có sản phẩm.');
      } else {
        console.log(`📦 API products payload sau normalize: ${products.length} sản phẩm.`);
      }
      return products;
    } catch (error) {
      console.error('❌ Lỗi khi lấy danh sách sản phẩm từ backend:', error);
      return [];
    }
  }

  // Refactored: Accept apiProducts as optional parameter
  async loadItemsFromKiotVietToIndexedDB(apiProducts?: Product[] | Record<string, unknown> | null): Promise<void> {
    // Đảm bảo IndexedDB đã được khởi tạo
    await this.ensureDBInitialized();

    let rawPayload: unknown = apiProducts;
    if (!rawPayload) {
      // Gọi API lấy toàn bộ sản phẩm từ KiotViet
      rawPayload = await firstValueFrom(
        this.http.get<unknown>(`${environment.domainUrl}${this.kiotvietService.kiotviet_items_api}`).pipe(
          catchError((err) => {
            console.error('❌ Lỗi khi tải tất cả sản phẩm từ KiotViet:', err);
            return of([]);
          })
        )
      ) ?? [];
    }

    const allProducts = this.normalizeProductApiPayload(rawPayload);

    if (allProducts.length === 0) {
      console.log('ℹ️ Không có sản phẩm nào từ KiotViet');
      return;
    }

    console.log(`📦 Nhận được ${allProducts.length} sản phẩm từ KiotViet`);

    // Lọc và validate products
    const validProducts = allProducts.filter((product: Product) => {
      if (!product || !product.Id) {
        console.warn('⚠️ Product không hợp lệ:', product);
        return false;
      }
      return true;
    });

    if (validProducts.length === 0) {
      console.warn('⚠️ Không có products hợp lệ nào từ KiotViet');
      return;
    }

    console.log(`✅ Có ${validProducts.length} products hợp lệ từ KiotViet`);

    // Lấy toàn bộ sản phẩm đang có trong IndexedDB
    const existingProducts: Product[] = await this.indexedDBService.getAll<Product>(
      this.dbName,
      this.dbVersion,
      this.storeName
    );

    console.log(`📋 Có ${existingProducts.length} products trong IndexedDB`);

    // ✅ Thực hiện cleanup: xóa products trong IndexedDB mà không có trong API
    await this.cleanupOrphanedProducts(existingProducts, validProducts);

    const existingMap = new Map(existingProducts.map(p => [p.Id, p]));

    // Chuẩn bị danh sách sản phẩm cần cập nhật
    const productsToUpdate: Product[] = [];

    for (const product of validProducts) {
      const existing = existingMap.get(product.Id);

      // Tạo bản sao của product để không ảnh hưởng đến dữ liệu gốc
      const productToUpdate = this.sanitizeProductForStorage(product);

      if (existing) {
        // Kiểm tra xem có thay đổi gì không (trừ OnHand)
        const hasChanges = this.hasProductChanges(existing, product);
        if (hasChanges) {
          console.log(`🔄 Phát hiện thay đổi cho product ${product.Id} (${product.Name})`);
          this.logProductChanges(existing, product);
          productsToUpdate.push(productToUpdate);
        } else {
          console.log(`ℹ️ Product ${product.Id} (${product.Name}) không có thay đổi`);
        }
      } else {
        // Product mới, thêm vào danh sách cập nhật
        console.log(`🆕 Thêm product mới: ${product.Id} (${product.Name})`);
        productsToUpdate.push(productToUpdate);
      }
    }

    // Cập nhật nhiều sản phẩm cùng lúc nếu có thay đổi
    if (productsToUpdate.length > 0) {
      console.log(`🔄 Cập nhật ${productsToUpdate.length} sản phẩm vào IndexedDB...`);

      await this.indexedDBService.putMany(
        this.dbName,
        this.dbVersion,
        this.storeName,
        productsToUpdate
      );

      console.log(`✅ Đã cập nhật ${productsToUpdate.length} sản phẩm từ KiotViet vào IndexedDB`);

      this.invalidateIndexedDbCache();

      // Đồng bộ lên Firestore (không thay đổi OnHand)
      console.log('🔄 Đồng bộ sản phẩm lên Firestore...');
      await this.syncProductsToFirestoreWithoutOnHand(productsToUpdate);

      // Đợi một chút để Firestore được cập nhật
      console.log('⏳ Đợi Firestore cập nhật...');
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Sync từ Firestore về IndexedDB để đảm bảo dữ liệu đồng bộ
      // Chỉ sync nếu cache quá cũ hoặc không có cache
      if (this.shouldClearCache()) {
        console.log('🔄 Cache quá cũ, sync từ Firestore về IndexedDB...');
        await this.syncProductsFromFirebaseToIndexedDB();
      } else {
        console.log('ℹ️ Cache còn mới, bỏ qua sync từ Firestore về IndexedDB');
      }

    } else {
      console.log('ℹ️ Tất cả sản phẩm đã được đồng bộ, không cần cập nhật');
    }
  }

  public async ensureIndexedDbSeeded(apiProducts?: Product[] | Record<string, unknown> | null): Promise<boolean> {
    try {
      await this.ensureDBInitialized();

      const storeExists = await this.indexedDBService.checkObjectStoreExists(
        this.dbName,
        this.dbVersion,
        this.storeName
      );

      if (!storeExists) {
        console.warn(`⚠️ Object store '${this.storeName}' chưa tồn tại, đang khởi tạo lại...`);
        await this.initDB();
      }

      const productCount = await this.indexedDBService
        .count(this.dbName, this.dbVersion, this.storeName)
        .catch(err => {
          console.error('❌ Lỗi khi đếm products trong IndexedDB:', err);
          return 0;
        });

      if (productCount > 0) {
        console.log('ℹ️ IndexedDB đã có dữ liệu sản phẩm, bỏ qua bước seed.');
        return false;
      }

      console.log('📥 IndexedDB trống hoặc chưa có sản phẩm, đang seed dữ liệu từ KiotViet...');
      await this.loadItemsFromKiotVietToIndexedDB(apiProducts);
      return true;
    } catch (error) {
      console.error('❌ Lỗi khi đảm bảo IndexedDB có dữ liệu sản phẩm:', error);
      return false;
    }
  }

  public async countProductsInIndexedDb(): Promise<number> {
    try {
      await this.ensureDBInitialized();
      const total = await this.indexedDBService
        .count(this.dbName, this.dbVersion, this.storeName)
        .catch(err => {
          console.error('❌ Lỗi khi đếm sản phẩm trong IndexedDB:', err);
          return 0;
        });
      return total ?? 0;
    } catch (error) {
      console.error('❌ Lỗi khi lấy số lượng sản phẩm trong IndexedDB:', error);
      return 0;
    }
  }

  public async reseedIndexedDbWithApiProducts(products: Product[] | null | undefined): Promise<number> {
    if (!products || products.length === 0) {
      console.warn('⚠️ Không có dữ liệu sản phẩm để reseed IndexedDB.');
      return 0;
    }

    await this.ensureDBInitialized();

    const validProducts = products.filter((product): product is Product => !!product && !!product.Id);
    if (validProducts.length === 0) {
      console.warn('⚠️ Không có sản phẩm hợp lệ để reseed IndexedDB.');
      return 0;
    }

    // Preserve OnHand từ dữ liệu hiện tại nếu có
    const existingProducts: Product[] = await this.indexedDBService.getAll<Product>(
      this.dbName,
      this.dbVersion,
      this.storeName
    ).catch(() => []);

    const onHandMap = new Map<number, number>();
    for (const existing of existingProducts) {
      if (!existing || !existing.Id) {
        continue;
      }
      const parsedOnHand = this.parseFiniteNumber(existing.OnHand);
      if (parsedOnHand !== null) {
        onHandMap.set(existing.Id, parsedOnHand);
      }
    }

    const sanitizedProducts = validProducts.map((product) => {
      const sanitized = this.sanitizeProductForStorage({ ...product });
      const preservedOnHand = onHandMap.get(product.Id!);
      if (preservedOnHand !== undefined) {
        sanitized.OnHand = preservedOnHand;
      }
      return sanitized;
    });

    await this.indexedDBService.clear(this.dbName, this.dbVersion, this.storeName);
    await this.indexedDBService.putMany(this.dbName, this.dbVersion, this.storeName, sanitizedProducts);
    this.invalidateIndexedDbCache();
    console.log(`✅ Đã reseed IndexedDB với ${sanitizedProducts.length} sản phẩm (giữ lại OnHand khi có sẵn).`);
    return sanitizedProducts.length;
  }

  public async hasIndexedDbProducts(): Promise<boolean> {
    try {
      await this.ensureDBInitialized();
      const count = await this.indexedDBService
        .count(this.dbName, this.dbVersion, this.storeName)
        .catch((err) => {
          console.warn('⚠️ Không thể đếm số sản phẩm trong IndexedDB:', err);
          return 0;
        });
      return (count ?? 0) > 0;
    } catch (error) {
      console.error('❌ Lỗi khi kiểm tra trạng thái IndexedDB sản phẩm:', error);
      return false;
    }
  }

  // ✅ Method mới để cleanup products trong IndexedDB mà không có trong API
  private async cleanupOrphanedProducts(existingProducts: Product[], apiProducts: Product[]): Promise<void> {
    try {
      console.log('🧹 Bắt đầu cleanup orphaned products...');

      // Tạo Set các product IDs từ API để tìm kiếm nhanh
      const apiProductIds = new Set(apiProducts.map(p => p.Id));

      // Tìm products trong IndexedDB mà không có trong API
      const orphanedProducts = existingProducts.filter(existingProduct =>
        !apiProductIds.has(existingProduct.Id)
      );

      if (orphanedProducts.length === 0) {
        console.log('✅ Không có orphaned products cần xóa');
        return;
      }

      console.log(`🗑️ Tìm thấy ${orphanedProducts.length} orphaned products cần xóa:`);
      orphanedProducts.forEach(product => {
        console.log(`   - ${product.Id}: ${product.Name} (${product.Code})`);
      });

      // Xóa từng orphaned product khỏi IndexedDB
      const deletedIds: number[] = [];
      for (const orphanedProduct of orphanedProducts) {
        try {
          await this.indexedDBService.delete(
            this.dbName,
            this.dbVersion,
            this.storeName,
            orphanedProduct.Id
          );
          deletedIds.push(orphanedProduct.Id);
          console.log(`✅ Đã xóa orphaned product: ${orphanedProduct.Id} - ${orphanedProduct.Name}`);
        } catch (error) {
          console.error(`❌ Lỗi khi xóa orphaned product ${orphanedProduct.Id}:`, error);
        }
      }

      console.log(`✅ Cleanup hoàn thành: đã xóa ${deletedIds.length}/${orphanedProducts.length} orphaned products`);

      if (deletedIds.length > 0) {
        this.invalidateIndexedDbCache();
      }

      // // ✅ Đồng bộ việc xóa lên Firestore
      // if (deletedIds.length > 0) {
      //   console.log('🔄 Đồng bộ việc xóa orphaned products lên Firestore...');
      //   await this.syncDeletedProductsToFirestore(deletedIds);
      // }

    } catch (error) {
      console.error('❌ Lỗi khi cleanup orphaned products:', error);
      throw error;
    }
  }

  private normalizeProductApiPayload(payload: unknown): Product[] {
    const extracted = this.extractProductsFromPayload(payload);
    if (!Array.isArray(payload) && extracted.length === 0 && payload !== undefined && payload !== null) {
      console.warn('⚠️ API payload không chứa danh sách sản phẩm hợp lệ, trả về []');
    }
    return extracted;
  }

  private extractProductsFromPayload(payload: unknown, depth = 0, visited = new WeakSet<object>()): Product[] {
    if (!payload) {
      return [];
    }

    if (Array.isArray(payload)) {
      return payload as Product[];
    }

    if (typeof payload !== 'object' || depth > 5) {
      return [];
    }

    const objectPayload = payload as Record<string, unknown>;
    if (visited.has(objectPayload)) {
      return [];
    }
    visited.add(objectPayload);

    const candidateKeys = ['items', 'data', 'products', 'result', 'results', 'records', 'list', 'value'];
    for (const key of candidateKeys) {
      if (key in objectPayload) {
        const nested = this.extractProductsFromPayload(objectPayload[key], depth + 1, visited);
        if (nested.length > 0) {
          return nested;
        }
      }
    }

    for (const value of Object.values(objectPayload)) {
      if (typeof value === 'object' && value !== null) {
        const nested = this.extractProductsFromPayload(value, depth + 1, visited);
        if (nested.length > 0) {
          return nested;
        }
      }
    }

    return [];
  }

  // ✅ Method để đồng bộ việc xóa products lên Firestore
  // private async syncDeletedProductsToFirestore(deletedProductIds: number[]): Promise<void> {
  //   try {
  //     console.log(`🔄 Đồng bộ việc xóa ${deletedProductIds.length} products lên Firestore...`);

  //     // Gọi API để xóa products khỏi Firestore
  //     const response = await firstValueFrom(
  //       this.http.post(`${environment.domainUrl}${this.firebaseService.delete_products_batch_from_firebase}`, {
  //         productIds: deletedProductIds
  //       })
  //     );

  //     console.log(`✅ Đã đồng bộ việc xóa ${deletedProductIds.length} products lên Firestore:`, response);

  //   } catch (error) {
  //     console.error('❌ Lỗi khi đồng bộ việc xóa products lên Firestore:', error);
  //     // Không throw error để không ảnh hưởng đến quá trình chính
  //   }
  // }

  // Refactored: Accept apiProducts as optional parameter
  public async cleanupOrphanedProductsFromAPI(apiProducts?: Product[] | Record<string, unknown> | null): Promise<{ deletedCount: number; totalChecked: number }> {
    try {
      await this.ensureDBInitialized();

      let rawPayload: unknown = apiProducts;
      if (!rawPayload) {
        // Lấy products từ API nếu chưa truyền vào
        await this.ensureConnectionOpen();
        rawPayload = await firstValueFrom(
          this.http.get<unknown>(`${environment.domainUrl}${this.kiotvietService.kiotviet_items_api}`).pipe(
            catchError((err) => {
              console.error('❌ Lỗi khi tải products từ API:', err);
              return of([]);
            })
          )
        ) ?? [];
      }

      const productsFromAPI = this.normalizeProductApiPayload(rawPayload);

      if (productsFromAPI.length === 0) {
        console.log('ℹ️ Không có products nào từ API');
        return { deletedCount: 0, totalChecked: 0 };
      }

      // Lọc valid products
      const validApiProducts = productsFromAPI.filter((product: Product) => product && product.Id);
      console.log(`📦 Nhận được ${validApiProducts.length} valid products từ API`);

      // Lấy products từ IndexedDB
      const existingProducts = await this.getAllProductsFromIndexedDB();
      console.log(`📋 Có ${existingProducts.length} products trong IndexedDB`);

      // Thực hiện cleanup
      await this.cleanupOrphanedProducts(existingProducts, validApiProducts);

      // Đếm số lượng đã xóa
      const apiProductIds = new Set(validApiProducts.map((p: Product) => p.Id));
      const orphanedProducts = existingProducts.filter(existingProduct =>
        !apiProductIds.has(existingProduct.Id)
      );

      return {
        deletedCount: orphanedProducts.length,
        totalChecked: existingProducts.length
      };

    } catch (error) {
      console.error('❌ Lỗi khi cleanup orphaned products từ API:', error);
      throw error;
    }
  }

  // ✅ Method để kiểm tra orphaned products mà không xóa
  public async checkOrphanedProducts(): Promise<{ orphanedCount: number; totalInIndexedDB: number; totalInAPI: number; orphanedProducts: Product[] }> {
    try {
      await this.ensureDBInitialized();

      console.log('🔍 Kiểm tra orphaned products...');

      // Lấy products từ API
      await this.ensureConnectionOpen();
      const apiPayload = await firstValueFrom(
        this.http.get<unknown>(`${environment.domainUrl}${this.kiotvietService.kiotviet_items_api}`).pipe(
          catchError((err) => {
            console.error('❌ Lỗi khi tải products từ API:', err);
            return of([]);
          })
        )
      ) ?? [];

      const apiProducts = this.normalizeProductApiPayload(apiPayload);

      // Lọc valid products
      const validApiProducts = apiProducts.filter((product: Product) => product && product.Id);
      console.log(`📦 Nhận được ${validApiProducts.length} valid products từ API`);

      // Lấy products từ IndexedDB
      const existingProducts = await this.getAllProductsFromIndexedDB();
      console.log(`📋 Có ${existingProducts.length} products trong IndexedDB`);

      // Tìm orphaned products
      const apiProductIds = new Set(validApiProducts.map((p: Product) => p.Id));
      const orphanedProducts = existingProducts.filter(existingProduct =>
        !apiProductIds.has(existingProduct.Id)
      );

      console.log(`🔍 Tìm thấy ${orphanedProducts.length} orphaned products`);

      return {
        orphanedCount: orphanedProducts.length,
        totalInIndexedDB: existingProducts.length,
        totalInAPI: validApiProducts.length,
        orphanedProducts: orphanedProducts
      };

    } catch (error) {
      console.error('❌ Lỗi khi kiểm tra orphaned products:', error);
      throw error;
    }
  }

  // Method mới để đồng bộ sản phẩm lên Firestore mà không thay đổi OnHand
  private async syncProductsToFirestoreWithoutOnHand(products: Product[]): Promise<void> {
    try {
      console.log(`🔄 Chuẩn bị đồng bộ ${products.length} sản phẩm lên Firestore...`);

      // Lấy OnHand hiện tại từ Firestore cho các sản phẩm cần cập nhật
      const firebaseProducts = await this.getProductsFromFirebaseWithCache();
      const firebaseMap = new Map(firebaseProducts.map(p => [p.Id, p]));

      // Chuẩn bị danh sách sản phẩm để gửi lên Firestore
      const productsForFirestore: Product[] = [];

      for (const product of products) {
        const firebaseProduct = firebaseMap.get(product.Id);

        // Tạo bản sao của product
        const productForFirestore = { ...product };

        if (firebaseProduct) {
          productForFirestore.OnHand = firebaseProduct.OnHand;
        }

        productsForFirestore.push(productForFirestore);
      }

      // Sử dụng debounce mechanism thay vì gọi trực tiếp
      await this.debouncedSaveToFirebase(productsForFirestore);

      console.log(`✅ Đã chuẩn bị đồng bộ ${productsForFirestore.length} sản phẩm lên Firestore (sẽ được gửi sau 1 giây)`);

    } catch (error) {
      console.error('❌ Lỗi khi chuẩn bị đồng bộ sản phẩm lên Firestore:', error);
      throw error;
    }
  }

  async syncProductsFromFirebaseToIndexedDB(firebaseProducts?: Product[]): Promise<void> {
    try {
      // Đảm bảo IndexedDB đã được khởi tạo
      await this.ensureDBInitialized();

      console.log('🔄 Bắt đầu đồng bộ products từ Firebase về IndexedDB...');

      // Lấy tất cả products từ Firebase (sử dụng cache nếu có, hoặc sử dụng products đã truyền vào)
      const allProducts = firebaseProducts && firebaseProducts.length > 0
        ? firebaseProducts
        : await this.getProductsFromFirebaseWithCache();
      console.log('🔎 [DEBUG] syncProductsFromFirebaseToIndexedDB: nhận được', (allProducts && allProducts.length) || 0, 'products từ Firebase');

      if (!allProducts || allProducts.length === 0) {
        console.log('ℹ️ Không có products nào từ Firebase');
        return;
      }

      console.log(`📦 Nhận được ${allProducts.length} products từ Firebase`);

      // Lọc và validate products
      const validProducts = allProducts.filter(product => {
        if (!product || !product.Id) {
          console.warn('⚠️ Product không hợp lệ:', product);
          return false;
        }
        return true;
      });

      if (validProducts.length === 0) {
        console.warn('⚠️ Không có products hợp lệ nào từ Firebase');
        return;
      }

      console.log(`✅ Có ${validProducts.length} products hợp lệ`);

      // Lấy products hiện tại từ IndexedDB
      const existingProducts: Product[] = await this.indexedDBService.getAll<Product>(
        this.dbName,
        this.dbVersion,
        this.storeName
      );

      console.log(`📋 Có ${existingProducts.length} products trong IndexedDB`);

      // Tạo map để so sánh nhanh
      const existingMap = new Map(existingProducts.map(p => [p.Id, p]));
      const productsToUpdate: Product[] = [];

      // So sánh và tìm products cần cập nhật
      for (const product of validProducts) {
        const existing = existingMap.get(product.Id);

        if (existing) {
          // Tạo bản sao của product từ Firestore
          const productToUpdate = { ...product };

          // Kiểm tra xem có thay đổi gì không (trừ OnHand)
          const hasChanges = this.hasProductChanges(existing, product);
          if (hasChanges) {
            console.log(`🔄 Phát hiện thay đổi từ Firestore cho product ${product.Id} (${product.Name})`);
            this.logProductChanges(existing, product);
            this.logOnHandComparison(product.Id, existing.OnHand, productToUpdate.OnHand, 'Firestore->IndexedDB');
            productsToUpdate.push(productToUpdate);
          } else {
            console.log(`ℹ️ Product ${product.Id} (${product.Name}) không có thay đổi từ Firestore`);
            this.logOnHandComparison(product.Id, existing.OnHand, productToUpdate.OnHand, 'Firestore->IndexedDB (no changes)');
          }
        } else {
          // Product mới từ Firestore
          productsToUpdate.push(product);
        }
      }

      if (productsToUpdate.length > 0) {
        console.log(`🔄 Cập nhật ${productsToUpdate.length} products vào IndexedDB...`);

        // Cập nhật nhiều products cùng lúc
        await this.indexedDBService.putMany(
          this.dbName,
          this.dbVersion,
          this.storeName,
          productsToUpdate
        );

        console.log(`✅ Đã cập nhật thành công ${productsToUpdate.length} products từ Firebase vào IndexedDB`);
        this.invalidateIndexedDbCache();
      } else {
        console.log('ℹ️ Tất cả products đã được đồng bộ, không cần cập nhật');
      }

    } catch (error) {
      console.error('❌ Lỗi khi đồng bộ products từ Firebase:', error);
      throw error; // Re-throw để component có thể xử lý
    }
  }

  async syncAllProductsFromIndexedDBToFirebase(): Promise<void> {
    try {
      const allProducts = await this.getAllProductsFromIndexedDB();
      if (allProducts.length > 0) {
        console.log(`🔄 Chuẩn bị đồng bộ ${allProducts.length} sản phẩm từ IndexedDB lên Firebase...`);

        // Sử dụng debounce mechanism thay vì gọi trực tiếp
        await this.debouncedSaveToFirebase(allProducts);

        console.log(`✅ Đã chuẩn bị đồng bộ ${allProducts.length} sản phẩm từ IndexedDB lên Firebase (sẽ được gửi sau 1 giây)`);
      } else {
        console.log('Không có sản phẩm nào trong IndexedDB để đồng bộ.');
      }
    } catch (error) {
      console.error('❌ Lỗi khi chuẩn bị đồng bộ sản phẩm từ IndexedDB lên Firebase:', error);
    }
  }

  saveAllProductsToFirebase(products: Product[]): Observable<any> {
    return this.http.post(`${environment.domainUrl}${this.firebaseService.post_all_products_indexedDB_firebase}`, products);
  }

  /**
   * Call backend POST /api/sync/kiotviet/firebase/products which triggers sync and
   * optionally returns products. Now optimized to skip product data for faster response.
   *
   * @param includeProducts - If true, fetches products after sync. Default: false for speed.
   * @returns Object with sync result and products (if requested)
   */
  public async fetchAndSaveMergedProductsFromBackend(includeProducts = false): Promise<{
    success: boolean;
    products: Product[];
    stats?: any;
    error?: string;
  }> {
    // Prevent duplicate sync calls
    if (this.isSyncing && this.syncPromise) {
      console.log('⚠️ Sync đang chạy, chờ sync hiện tại hoàn thành...');
      return await this.syncPromise;
    }

    this.isSyncing = true;
    const timestamp = new Date().toISOString();
    console.log(`🔄 [${timestamp}] Bắt đầu sync (guard enabled)`);

    // Create sync promise
    this.syncPromise = (async () => {
      try {
        await this.ensureDBInitialized();
        const url = `${environment.domainUrl}${this.firebaseService.post_all_products_indexedDB_firebase}`;
        console.log(`🔄 [${timestamp}] Gọi POST sync endpoint (optimized):`, url);
        console.trace('Stack trace for sync API call');

        const res = await firstValueFrom(
          this.http.post<any>(url, { skip_products: !includeProducts }).pipe(
            catchError(err => {
              console.error('❌ Lỗi khi gọi POST sync endpoint:', err);
              const errorMessage = err?.error?.error || err?.message || 'Lỗi kết nối đến server';
              throw new Error(errorMessage);
            })
          )
        );

        console.log('📦 Backend response:', res);

        // Check if sync succeeded
        // Support both old and new response formats
        const syncResult = res?.sync || res || {};
        console.log('📊 Sync result:', syncResult);
        console.log('🏷️ Backend version:', syncResult.version || 'unknown (old code)');

        // Check for success (new format: success field, old format: check message)
        const isSuccess = syncResult.success === true ||
          (syncResult.message && syncResult.message.includes('đồng bộ') && !syncResult.error);

        if (!isSuccess) {
          const errorMsg = syncResult.error || syncResult.message || 'Đồng bộ thất bại';
          console.error('❌ Sync failed:', errorMsg);
          throw new Error(errorMsg);
        }

        console.log('✅ Sync succeeded:', syncResult.stats || 'No stats available (old format)');

        // If products were not included in response, fetch them separately
        let products: Product[] = [];
        if (includeProducts) {
          products = this.normalizeProductApiPayload(res);

          if (products && products.length > 0) {
            console.log(`📦 Lưu ${products.length} products vào IndexedDB...`);

            try {
              await this.indexedDBService.clear(this.dbName, this.dbVersion, this.storeName);
            } catch (clearErr) {
              console.warn('⚠️ Không thể clear store:', clearErr);
            }

            const sanitized = products.map(p => this.sanitizeProductForStorage({ ...p }));
            await this.indexedDBService.putMany(this.dbName, this.dbVersion, this.storeName, sanitized);
            this.invalidateIndexedDbCache();
          }
        } else {
          console.log('ℹ️ Products not included in sync response (skip_products=true). Fetch separately if needed.');
        }

        return {
          success: true,
          products,
          stats: syncResult.stats
        };

      } catch (err: any) {
        console.error('❌ Lỗi trong fetchAndSaveMergedProductsFromBackend:', err);
        return {
          success: false,
          products: [],
          error: err?.message || 'Lỗi không xác định'
        };
      } finally {
        this.isSyncing = false;
        this.syncPromise = null;
      }
    })();

    return await this.syncPromise;
  }

  getAllProductsFromFirebase(): Observable<Product[]> {
    // Sử dụng cache nếu có và còn hợp lệ
    const now = Date.now();
    if (this.firebaseProductsCache && (now - this.cacheTimestamp) < this.CACHE_DURATION) {
      console.log('📦 Sử dụng cache cho getAllProductsFromFirebase');
      this.cacheHitCount++;
      this.logCacheUsage('getAllProductsFromFirebase', true, this.firebaseProductsCache.length);
      return of(this.firebaseProductsCache);
    }

    // Cache hết hạn hoặc chưa có, gọi API mới
    console.log('🔄 Gọi API Firebase để lấy products mới (getAllProductsFromFirebase)');
    this.apiCallCount++;
    return this.getAllProductsFromFirebaseAPI().pipe(
      map(products => {
        this.firebaseProductsCache = products || [];
        this.cacheTimestamp = now;
        console.log(`📦 Đã cache ${this.firebaseProductsCache.length} products từ Firebase (getAllProductsFromFirebase)`);
        this.logCacheUsage('getAllProductsFromFirebase', false, this.firebaseProductsCache.length);
        return this.firebaseProductsCache;
      }),
      catchError((error) => {
        console.error('❌ Lỗi khi lấy products từ Firebase (getAllProductsFromFirebase):', error);
        // Trả về cache cũ nếu có, hoặc array rỗng
        const fallbackProducts = this.firebaseProductsCache || [];
        this.logCacheUsage('getAllProductsFromFirebase_fallback', true, fallbackProducts.length);
        return of(fallbackProducts);
      })
    );
  }

  // Method private để gọi API thực tế
  private getAllProductsFromFirebaseAPI(): Observable<Product[]> {
    return this.http.get<Product[]>(`${environment.domainUrl}${this.firebaseService.get_all_products_from_firebase}`).pipe(
      catchError((err) => {
        console.error('❌ Lỗi khi tải tất cả sản phẩm từ Firebase API:', err);
        return of([]);
      })
    );
  }

  private invalidateIndexedDbCache(): void {
    this.indexedDbProductsCache = null;
    this.indexedDbCacheTimestamp = 0;
    this.productSearchIndex.clear();
  }

  private rebuildProductSearchIndex(products: Product[]): void {
    this.productSearchIndex.clear();
    for (const product of products) {
      this.ensureUnitOnProduct(product);
      const id = product?.Id;
      if (typeof id !== 'number') {
        continue;
      }
      this.productSearchIndex.set(id, this.buildSearchIndexEntry(product));
    }
  }

  private buildSearchIndexEntry(product: Product): { normalizedName: string; rawLowerName: string; codeLower: string } {
    this.ensureUnitOnProduct(product);
    const rawName = (product?.Name || '').trim();
    const normalizedFromData = (product as any)?.NormalizedName;
    const normalizedName = typeof normalizedFromData === 'string' && normalizedFromData.length > 0
      ? normalizedFromData.toLowerCase()
      : this.vi.normalizeAndTokenize(rawName).join(' ').toLowerCase();

    const normalizedCodeFromData = (product as any)?.NormalizedCode;
    const codeSource = typeof normalizedCodeFromData === 'string' && normalizedCodeFromData.length > 0
      ? normalizedCodeFromData
      : product?.Code || '';

    return {
      normalizedName: normalizedName.trim(),
      rawLowerName: rawName.toLowerCase(),
      codeLower: codeSource.toLowerCase().trim()
    };
  }

  private getOrCreateSearchIndexEntry(product: Product): { normalizedName: string; rawLowerName: string; codeLower: string } {
    const id = product?.Id;
    if (typeof id !== 'number') {
      return this.buildSearchIndexEntry(product);
    }

    let entry = this.productSearchIndex.get(id);
    if (!entry) {
      entry = this.buildSearchIndexEntry(product);
      this.productSearchIndex.set(id, entry);
    }
    return entry;
  }

  private async getIndexedDbProductsWithCache(): Promise<Product[]> {
    await this.ensureDBInitialized();

    const now = Date.now();
    if (this.indexedDbProductsCache && (now - this.indexedDbCacheTimestamp) < this.INDEXED_DB_CACHE_DURATION) {
      return this.indexedDbProductsCache;
    }

    const products = await this.indexedDBService.getAll<Product>(
      this.dbName,
      this.dbVersion,
      this.storeName
    );

    for (const product of products) {
      this.ensureUnitOnProduct(product);
    }

    this.indexedDbProductsCache = products;
    this.indexedDbCacheTimestamp = now;
    this.rebuildProductSearchIndex(products);

    return products;
  }

  async loadProductsIfNotExist(searchTerm: string): Promise<Product[] | null> {
    const existingProducts = await this.getIndexedDbProductsWithCache();

    const existing = existingProducts.find(
      p => p.Code?.trim().toLowerCase() === searchTerm.toLowerCase() ||
        p.Name?.trim().toLowerCase() === searchTerm.toLowerCase()
    );

    // Nếu đã tồn tại thì return null
    if (existing) {
      return null;
    }

    // Logic để load từ API nếu cần (có thể bổ sung thêm)
    // Hiện tại chỉ return null nếu không tìm thấy
    return null;
  }

  async searchProducts(query: string): Promise<Product[]> {
    const trimmedQuery = (query || '').trim();
    if (!trimmedQuery) {
      return [];
    }

    const allProducts = await this.getIndexedDbProductsWithCache();
    if (!allProducts || allProducts.length === 0) {
      return [];
    }

    if (this.productSearchIndex.size === 0) {
      this.rebuildProductSearchIndex(allProducts);
    }

    const queryTokens = this.vi.normalizeAndTokenize(trimmedQuery);
    const normalizedQuery = queryTokens.join(' ').toLowerCase();
    const rawQuery = trimmedQuery.toLowerCase();
    const baseCodeQuery = rawQuery.includes('-') ? rawQuery.split('-')[0] : rawQuery;

    const exactCodeMatches: Product[] = [];
    const startsWithMatches: Product[] = [];
    const containsNameMatches: Product[] = [];
    const codeMatches: Product[] = [];

    for (const product of allProducts) {
      if (!product || typeof product.Id !== 'number') {
        continue;
      }

      const entry = this.getOrCreateSearchIndexEntry(product);
      const normalizedName = entry.normalizedName;
      const rawLowerName = entry.rawLowerName;
      const codeLower = entry.codeLower;

      const isExactCodeMatch = codeLower === rawQuery || (rawQuery.includes('-') && codeLower === baseCodeQuery);
      if (isExactCodeMatch) {
        exactCodeMatches.push(product);
        continue;
      }

      const startsWith = (normalizedQuery && normalizedName.startsWith(normalizedQuery)) || rawLowerName.startsWith(rawQuery);
      if (startsWith) {
        startsWithMatches.push(product);
        continue;
      }

      const nameContains = (normalizedQuery && normalizedName.includes(normalizedQuery)) || rawLowerName.includes(rawQuery);
      if (nameContains) {
        containsNameMatches.push(product);
        continue;
      }

      if (!rawQuery) {
        continue;
      }

      if (rawQuery.includes('-')) {
        if (codeLower === baseCodeQuery) {
          codeMatches.push(product);
        }
        continue;
      }

      if (codeLower.includes(rawQuery)) {
        codeMatches.push(product);
      }
    }

    const seen = new Set<number>();
    const results: Product[] = [];
    const pushList = (list: Product[]) => {
      for (const product of list) {
        if (!product || typeof product.Id !== 'number') {
          continue;
        }
        if (!product.Code || !product.Name) {
          continue;
        }
        this.ensureUnitOnProduct(product);
        if (seen.has(product.Id)) {
          continue;
        }
        seen.add(product.Id);
        results.push(product);
        if (results.length >= this.SEARCH_RESULT_LIMIT) {
          return;
        }
      }
    };

    pushList(exactCodeMatches);
    if (results.length < this.SEARCH_RESULT_LIMIT) {
      pushList(startsWithMatches);
    }
    if (results.length < this.SEARCH_RESULT_LIMIT) {
      pushList(containsNameMatches);
    }
    if (results.length < this.SEARCH_RESULT_LIMIT) {
      pushList(codeMatches);
    }

    return results;
  }
  updateProductsOnHandFromInvoice(invoice: InvoiceTab): Observable<any> {
    return this.http.put(`${environment.domainUrl}/api/firebase/products/update_onhand_from_invoice`, invoice);
  }
  // Thêm các method tiện ích khác
  async getProductByIdFromIndexedDB(id: number): Promise<Product | undefined> {
    await this.ensureDBInitialized();
    return await this.indexedDBService.getByKey<Product>(
      this.dbName,
      this.dbVersion,
      this.storeName,
      id
    );
  }

  async addProductFromIndexedDB(product: Product): Promise<void> {
    await this.ensureDBInitialized();
    const sanitizedProduct = this.sanitizeProductForStorage(product);
    await this.indexedDBService.put<Product>(
      this.dbName,
      this.dbVersion,
      this.storeName,
      sanitizedProduct
    );
    this.invalidateIndexedDbCache();
  }

  async updateProductFromIndexedDB(product: Product): Promise<void> {
    await this.ensureDBInitialized();
    const sanitizedProduct = this.sanitizeProductForStorage(product);
    await this.indexedDBService.put<Product>(
      this.dbName,
      this.dbVersion,
      this.storeName,
      sanitizedProduct
    );
    this.invalidateIndexedDbCache();
  }

  async deleteProductFromIndexedDB(id: number): Promise<void> {
    await this.ensureDBInitialized();
    await this.indexedDBService.delete(
      this.dbName,
      this.dbVersion,
      this.storeName,
      id
    );
    this.invalidateIndexedDbCache();
  }

  async deleteOutOfStockEntry(productId: number): Promise<void> {
    await this.ensureDBInitialized();
    try {
      await this.indexedDBService.delete(
        this.dbName,
        this.dbVersion,
        'outofstock',
        productId
      );
    } catch (error) {
      console.warn('⚠️ Không thể xóa sản phẩm khỏi SalesDB/outofstock:', error);
    }
  }

  async clearAllProductsFromIndexedDB(): Promise<void> {
    await this.ensureDBInitialized();
    await this.indexedDBService.clear(
      this.dbName,
      this.dbVersion,
      this.storeName
    );
    this.invalidateIndexedDbCache();
  }

  async getAllProductsFromIndexedDB(): Promise<Product[]> {
    await this.ensureDBInitialized();
    return await this.indexedDBService.getAll<Product>(
      this.dbName,
      this.dbVersion,
      this.storeName
    );
  }

  async updateProductsOnHandFromInvoiceToFireBase(
    invoice: InvoiceTab,
    groupedProducts: { [x: string]: unknown;[x: number]: unknown[]; },
    _manuallyEditedIds: Set<number>,
    operation: 'decrease' | 'increase' = 'decrease',
    currentOnHandOverride?: Map<number, number>
  ): Promise<any> {
    // ✅ Lấy OnHand hiện tại từ IndexedDB để đảm bảo đồng bộ với confirmEditOnHand

    const currentOnHandMap: Record<number, number> = {};

    if (currentOnHandOverride && currentOnHandOverride.size > 0) {
      for (const [key, value] of currentOnHandOverride.entries()) {
        const numericId = Number(key);
        if (!Number.isFinite(numericId)) {
          continue;
        }
        currentOnHandMap[numericId] = Number(value ?? 0);
      }
    }

    // Lấy tất cả product IDs cần cập nhật
    const productIds = new Set<number>();
    for (const cartItem of invoice.cartItems) {
      const masterUnitId = cartItem.product.MasterUnitId || cartItem.product.Id;
      const group = groupedProducts[masterUnitId] as unknown as Product[];
      if (group) {
        group.forEach(product => productIds.add(product.Id));
      }
    }

    // Lấy OnHand hiện tại từ IndexedDB
    for (const productId of productIds) {
      if (currentOnHandMap[productId] !== undefined) {
        continue;
      }

      const product = await this.getProductByIdFromIndexedDB(productId);
      if (product) {
        currentOnHandMap[productId] = Number(product.OnHand ?? 0);
      }
    }

    // Tạo map để gom các cập nhật onHand cho từng productId
    const updates: Record<number, number> = {};

    for (const cartItem of invoice.cartItems) {
      const masterUnitId = cartItem.product.MasterUnitId || cartItem.product.Id;
      const group = groupedProducts[masterUnitId] as unknown as Product[];
      if (!group) continue;

      // Số lượng quy đổi về đơn vị nhỏ nhất (master)
      const masterQty = Number(cartItem.quantity ?? 0) * (Number(cartItem.product?.ConversionValue) || 1);

      for (const product of group) {
        const conversion = Number((product as any)?.ConversionValue) || 1;
        const adjustment = conversion === 0 ? 0 : masterQty / conversion;
        const delta = operation === 'decrease' ? -adjustment : adjustment;
        updates[product.Id] = (updates[product.Id] || 0) + delta;
      }
    }

    // ✅ Chuẩn bị payload với OnHand hiện tại và số lượng trừ
    const updatePayload = Object.entries(updates).map(([productId, delta]) => {
      const numericId = Number(productId);
      const current = Number(currentOnHandMap[numericId] ?? 0);
      const numericDelta = Number(delta) || 0;
      const newOnHand = current + numericDelta;
      const minus = numericDelta < 0 ? Math.abs(numericDelta) : 0;
      const plus = numericDelta > 0 ? numericDelta : 0;
      return {
        productId: numericId,
        currentOnHand: current,
        delta: numericDelta,
        minus,
        plus,
        newOnHand
      };
    });

    console.log('🔄 Cập nhật OnHand cho Firestore:', updatePayload);

    try {
      const response = await this.http.put(`${environment.domainUrl}/api/firebase/products/update_onhand_batch`, updatePayload).toPromise() as any;

      // ✅ NEW: Cập nhật IndexedDB ngay sau khi nhận response từ backend
      if (response && response.updated_products && Array.isArray(response.updated_products)) {
        console.log('✅ Cập nhật IndexedDB từ response:', response.updated_products);
        for (const updatedItem of response.updated_products) {
          try {
            await this.updateProductOnHandLocal(updatedItem.Id, updatedItem.new_OnHand);
          } catch (error) {
            console.error(`❌ Lỗi cập nhật IndexedDB cho product ${updatedItem.Id}:`, error);
          }
        }
      }

      return response;
    } catch (error) {
      console.error('❌ Lỗi khi gọi API update_onhand_batch:', error);
      throw error;
    }
  }

  async updateProductOnHandLocal(productId: number, onHand: number): Promise<void> {
    await this.ensureDBInitialized();
    const product = await this.indexedDBService.getByKey<Product>(this.dbName, this.dbVersion, this.storeName, productId);
    if (product) {
      // normalize to the Product model field
      (product as any).OnHand = onHand;
      await this.indexedDBService.put<Product>(this.dbName, this.dbVersion, this.storeName, product);
      console.log(`✅ [IndexedDB] Updated product ${productId} OnHand: ${onHand}`);
      if (this.indexedDbProductsCache) {
        const cached = this.indexedDbProductsCache.find(p => p.Id === productId);
        if (cached) {
          cached.OnHand = onHand;
        }
      }
      await this.syncOutOfStockEntry(product as Product);
    } else {
      console.warn(`⚠️ [IndexedDB] Product ${productId} not found in IndexedDB, cannot update OnHand to ${onHand}`);
    }
  }

  // Method để cập nhật OnHand cho nhiều sản phẩm cùng lúc
  async updateProductsOnHandLocal(products: Product[]): Promise<void> {
    await this.ensureDBInitialized();

    if (!products || products.length === 0) {
      console.warn('⚠️ Không có sản phẩm nào để cập nhật OnHand');
      return;
    }

    console.log(`🔄 Cập nhật OnHand cho ${products.length} sản phẩm...`);

    // Cập nhật tất cả sản phẩm cùng lúc
    await this.indexedDBService.putMany(
      this.dbName,
      this.dbVersion,
      this.storeName,
      products
    );

    console.log(`✅ Đã cập nhật OnHand cho ${products.length} sản phẩm`);

    if (this.indexedDbProductsCache && products.length > 0) {
      const onHandMap = new Map<number, number>();
      for (const p of products) {
        if (p && typeof p.Id === 'number') {
          onHandMap.set(p.Id, p.OnHand);
        }
      }

      for (const cached of this.indexedDbProductsCache) {
        const updatedOnHand = onHandMap.get(cached.Id);
        if (typeof updatedOnHand === 'number') {
          cached.OnHand = updatedOnHand;
        }
      }
    }

    for (const product of products) {
      await this.syncOutOfStockEntry(product);
    }
  }

  // Method để kiểm tra trạng thái đồng bộ với cache (không gọi API nếu cache còn hợp lệ)
  async getSyncStatusWithCache(): Promise<{ totalInFirebase: number; totalInIndexedDB: number; needsSync: boolean; usedCache: boolean }> {
    try {
      await this.ensureDBInitialized();

      const cacheInfo = this.getDetailedCacheInfo();
      let firebaseProducts: Product[] = [];
      let usedCache = false;

      if (cacheInfo.hasCache && !cacheInfo.isExpired) {
        // Sử dụng cache nếu còn hợp lệ
        firebaseProducts = this.firebaseProductsCache || [];
        usedCache = true;
        console.log(`📦 Sử dụng cache cho sync status: ${firebaseProducts.length} products`);
      } else {
        // Chỉ gọi API nếu cache không có hoặc đã hết hạn
        firebaseProducts = await this.getProductsFromFirebaseWithCache();
        usedCache = false;
      }

      const indexedDBProducts = await this.getAllProductsFromIndexedDB();

      // Log cache usage
      this.logCacheUsage('getSyncStatus', usedCache, firebaseProducts.length);

      return {
        totalInFirebase: firebaseProducts?.length || 0,
        totalInIndexedDB: indexedDBProducts?.length || 0,
        needsSync: (firebaseProducts?.length || 0) > (indexedDBProducts?.length || 0),
        usedCache: usedCache
      };
    } catch (error) {
      console.error('❌ Lỗi khi kiểm tra trạng thái đồng bộ:', error);
      return { totalInFirebase: 0, totalInIndexedDB: 0, needsSync: false, usedCache: false };
    }
  }

  // Method để kiểm tra trạng thái đồng bộ
  async getSyncStatus(): Promise<{ totalInFirebase: number; totalInIndexedDB: number; needsSync: boolean }> {
    try {
      await this.ensureDBInitialized();

      // Kiểm tra cache trước khi gọi API
      const cacheInfo = this.getDetailedCacheInfo();
      let firebaseProducts: Product[] = [];

      if (cacheInfo.hasCache && !cacheInfo.isExpired) {
        // Sử dụng cache nếu còn hợp lệ
        firebaseProducts = this.firebaseProductsCache || [];
        console.log(`📦 Sử dụng cache cho sync status check: ${firebaseProducts.length} products`);
      } else {
        // Chỉ gọi API nếu cache không có hoặc đã hết hạn
        firebaseProducts = await this.getProductsFromFirebaseWithCache();
      }

      const indexedDBProducts = await this.getAllProductsFromIndexedDB();

      return {
        totalInFirebase: firebaseProducts?.length || 0,
        totalInIndexedDB: indexedDBProducts?.length || 0,
        needsSync: (firebaseProducts?.length || 0) > (indexedDBProducts?.length || 0)
      };
    } catch (error) {
      console.error('❌ Lỗi khi kiểm tra trạng thái đồng bộ:', error);
      return { totalInFirebase: 0, totalInIndexedDB: 0, needsSync: false };
    }
  }

  // Method để force sync tất cả products từ Firebase (bỏ qua so sánh)
  async forceSyncAllProductsFromFirebase(): Promise<void> {
    try {
      await this.ensureDBInitialized();

      console.log('🔄 Force sync tất cả products từ Firebase...');

      // Force refresh cache và lấy products mới
      this.clearFirebaseCache();
      const allProducts = await this.getProductsFromFirebaseWithCache();

      if (!allProducts || allProducts.length === 0) {
        console.log('ℹ️ Không có products nào từ Firebase');
        return;
      }

      const validProducts = allProducts.filter(product => product && product.Id);

      if (validProducts.length > 0) {
        // Xóa tất cả products cũ và thêm mới
        await this.indexedDBService.clear(this.dbName, this.dbVersion, this.storeName);
        await this.indexedDBService.putMany(this.dbName, this.dbVersion, this.storeName, validProducts);

        console.log(`✅ Force sync thành công: ${validProducts.length} products`);
      }
    } catch (error) {
      console.error('❌ Lỗi khi force sync products:', error);
      throw error;
    }
  }

  // Method để force refresh cache (public)
  public async refreshFirebaseCache(): Promise<void> {
    this.clearFirebaseCache();
    await this.getProductsFromFirebaseWithCache();
  }

  // Method để kiểm tra trạng thái cache
  public getCacheStatus(): { hasCache: boolean; cacheAge: number; cacheSize: number } {
    const now = Date.now();
    const cacheAge = now - this.cacheTimestamp;

    return {
      hasCache: this.firebaseProductsCache !== null,
      cacheAge: cacheAge,
      cacheSize: this.firebaseProductsCache?.length || 0
    };
  }

  // Method để lấy thông tin cache chi tiết
  public getDetailedCacheInfo(): {
    hasCache: boolean;
    cacheAge: number;
    cacheSize: number;
    isExpired: boolean;
    timeUntilExpiry: number;
  } {
    const now = Date.now();
    const cacheAge = now - this.cacheTimestamp;
    const isExpired = cacheAge >= this.CACHE_DURATION;
    const timeUntilExpiry = Math.max(0, this.CACHE_DURATION - cacheAge);

    return {
      hasCache: this.firebaseProductsCache !== null,
      cacheAge: cacheAge,
      cacheSize: this.firebaseProductsCache?.length || 0,
      isExpired: isExpired,
      timeUntilExpiry: timeUntilExpiry
    };
  }

  // Method để lấy products từ Firebase với cache
  private async getProductsFromFirebaseWithCache(): Promise<Product[]> {
    const now = Date.now();

    // Kiểm tra cache có hợp lệ không
    if (this.firebaseProductsCache && (now - this.cacheTimestamp) < this.CACHE_DURATION) {
      console.log('📦 Sử dụng cache cho getProductsFromFirebaseWithCache');
      this.cacheHitCount++;
      this.logCacheUsage('getProductsFromFirebaseWithCache', true, this.firebaseProductsCache.length);
      return this.firebaseProductsCache;
    }

    // Nếu đang có request đang chạy, đợi kết quả
    if (this.currentFirebaseRequest) {
      console.log('⏳ Đợi request Firebase đang chạy...');
      try {
        const products = await this.currentFirebaseRequest;
        console.log(`📦 Nhận kết quả từ request đang chạy: ${products.length} products`);
        return products;
      } catch (error) {
        console.error('❌ Lỗi từ request đang chạy:', error);
        // Nếu request đang chạy bị lỗi, tiếp tục với request mới
      }
    }

    // Cache hết hạn hoặc chưa có, tạo request mới
    console.log('🔄 Tạo request Firebase mới (getProductsFromFirebaseWithCache)');
    this.currentFirebaseRequest = this.fetchProductsFromFirebase();

    try {
      const products = await this.currentFirebaseRequest;
      console.log(`📦 Đã nhận ${products.length} products từ request mới (getProductsFromFirebaseWithCache)`);
      this.logCacheUsage('getProductsFromFirebaseWithCache', false, products.length);
      return products;
    } catch (error) {
      console.error('❌ Lỗi khi lấy products từ request mới (getProductsFromFirebaseWithCache):', error);
      // Trả về cache cũ nếu có, hoặc array rỗng
      const fallbackProducts = this.firebaseProductsCache || [];
      this.logCacheUsage('getProductsFromFirebaseWithCache_fallback', true, fallbackProducts.length);
      return fallbackProducts;
    } finally {
      // Clear request đang chạy
      this.currentFirebaseRequest = null;
    }
  }

  // Method private để thực hiện việc fetch products từ Firebase
  private async fetchProductsFromFirebase(): Promise<Product[]> {
    try {
      console.log('🔎 [DEBUG] fetchProductsFromFirebase: gọi getAllProductsFromFirebase API');
      const products = await firstValueFrom(this.getAllProductsFromFirebase());
      console.log(`🔎 [DEBUG] fetchProductsFromFirebase: API trả về ${Array.isArray(products) ? products.length : 'non-array'} items`);
      return Array.isArray(products) ? products : [];
    } catch (error) {
      console.error('❌ Lỗi trong fetchProductsFromFirebase:', error);
      return []; // trả về mảng rỗng để không làm sập luồng
    }
  }

  // Clear cache khi cần thiết
  private clearFirebaseCache(): void {
    this.firebaseProductsCache = null;
    this.cacheTimestamp = 0;
    this.currentFirebaseRequest = null; // Clear shared request
    console.log('🗑️ Đã xóa cache Firebase products và shared request');
  }

  // Method để force clear shared request
  public forceClearSharedRequest(): void {
    this.currentFirebaseRequest = null;
    console.log('🔄 Đã force clear shared Firebase request');
  }

  // Method để force clear cache khi thực sự cần thiết
  public forceClearCache(): void {
    this.clearFirebaseCache();
    console.log('🔄 Đã force clear Firebase cache');
  }

  // Method để kiểm tra xem có cần clear cache không
  private shouldClearCache(): boolean {
    const cacheInfo = this.getDetailedCacheInfo();
    // Chỉ clear cache nếu cache quá cũ (hơn 10 phút) hoặc không có cache
    return !cacheInfo.hasCache || cacheInfo.cacheAge > 10 * 60 * 1000;
  }

  // Method để reset database (xóa và tạo lại)
  async resetDatabase(): Promise<void> {
    try {
      console.log('🔄 Reset ProductService IndexedDB...');

      // Đóng connection hiện tại nếu có
      await this.indexedDBService.closeDB(this.dbName);

      // Tăng version để force upgrade
      this.dbVersion++;
      console.log(`📦 Tăng database version lên ${this.dbVersion}`);

      // Khởi tạo lại database
      await this.initDB();

      console.log('✅ ProductService IndexedDB đã được reset thành công');
    } catch (error) {
      console.error('❌ Lỗi khi reset ProductService IndexedDB:', error);
      throw error;
    }
  }

  // Method để debug trạng thái database
  async debugDatabaseStatus(): Promise<void> {
    try {
      console.log('🔍 Debug ProductService IndexedDB status...');

      const connectionInfo = this.indexedDBService.getConnectionInfo(this.dbName);
      console.log(`📊 Connection info:`, connectionInfo);

      const objectStores = await this.indexedDBService.getObjectStoreNames(this.dbName, this.dbVersion);
      console.log(`📦 Object stores:`, objectStores);

      const storeExists = await this.indexedDBService.checkObjectStoreExists(this.dbName, this.dbVersion, this.storeName);
      console.log(`🔍 Store '${this.storeName}' exists:`, storeExists);

      if (storeExists) {
        try {
          const products = await this.getAllProductsFromIndexedDB();
          console.log(`📦 Products count: ${products.length}`);
        } catch (error) {
          console.error('❌ Không thể đọc products:', error);
        }
      }
    } catch (error) {
      console.error('❌ Lỗi khi debug database status:', error);
    }
  }

  // Method để log cache usage
  private logCacheUsage(operation: string, usedCache: boolean, productCount: number): void {
    const cacheInfo = this.getDetailedCacheInfo();
    console.log(`📊 Cache Usage [${operation}] - Used Cache: ${usedCache}, Products: ${productCount}, Cache Age: ${Math.round(cacheInfo.cacheAge / 1000)}s, Expired: ${cacheInfo.isExpired}`);
  }

  // Method để preload cache (gọi trước khi thực hiện các operation khác)
  async preloadFirebaseCache(): Promise<void> {
    try {
      console.log('🔄 Preloading Firebase cache...');
      const cacheInfo = this.getDetailedCacheInfo();

      if (!cacheInfo.hasCache || cacheInfo.isExpired) {
        console.log('📦 Cache không hợp lệ, bắt đầu preload...');
        await this.getProductsFromFirebaseWithCache(); // Sử dụng shared request mechanism
        console.log('✅ Firebase cache đã được preload');
      } else {
        console.log('ℹ️ Firebase cache đã có và còn hợp lệ, bỏ qua preload');
      }
    } catch (error) {
      console.error('❌ Lỗi khi preload Firebase cache:', error);
    }
  }

  // Method để preload cache với force refresh
  async forcePreloadFirebaseCache(): Promise<void> {
    try {
      console.log('🔄 Force preloading Firebase cache...');
      this.clearFirebaseCache(); // Clear cache và shared request
      await this.getProductsFromFirebaseWithCache(); // Tạo request mới
      console.log('✅ Firebase cache đã được force preload');
    } catch (error) {
      console.error('❌ Lỗi khi force preload Firebase cache:', error);
    }
  }

  // Method mới để xử lý việc gửi lên Firestore với debounce
  public async debouncedSaveToFirebase(products: Product[], delay = 1000): Promise<void> {
    // Thêm products vào danh sách chờ
    this.pendingProductsToSave.push(...products);

    // Clear timeout cũ nếu có
    if (this.saveToFirebaseTimeout) {
      clearTimeout(this.saveToFirebaseTimeout);
    }

    // Set timeout mới
    this.saveToFirebaseTimeout = setTimeout(async () => {
      await this.executeSaveToFirebase();
    }, delay);
  }

  public async flushPendingFirebaseSaves(): Promise<Product[] | null> {
    if (this.saveToFirebaseTimeout) {
      clearTimeout(this.saveToFirebaseTimeout);
      this.saveToFirebaseTimeout = null;
    }

    return await this.executeSaveToFirebase();
  }

  /**
   * Optimized sync method that:
   * 1. Calls the sync endpoint (fast, returns stats only)
   * 2. Fetches products separately from Firebase
   * 3. Returns comprehensive result with error details
   */
  public async syncKiotVietToFirebase(): Promise<{
    success: boolean;
    products?: Product[];
    stats?: any;
    error?: string;
    errorType?: string;
  }> {
    try {
      console.log('🔄 Bắt đầu sync KiotViet -> Firebase (optimized)...');

      // Step 1: Trigger sync (returns stats only, fast)
      const syncResult = await this.fetchAndSaveMergedProductsFromBackend(false);

      if (!syncResult.success) {
        console.error('❌ Sync failed:', syncResult.error);
        return {
          success: false,
          error: syncResult.error || 'Đồng bộ thất bại',
          errorType: 'sync_failed'
        };
      }

      console.log('✅ Sync succeeded:', syncResult.stats);

      // Step 2: Fetch products from Firebase separately (uses cache)
      console.log('📥 Fetching products from Firebase...');
      const products = await firstValueFrom(
        this.getAllProductsFromFirebase().pipe(
          catchError(err => {
            console.error('⚠️ Không thể lấy products từ Firebase:', err);
            return of([]);
          })
        )
      );

      // Step 3: Save to IndexedDB if we got products
      if (products && products.length > 0) {
        console.log(`💾 Lưu ${products.length} products vào IndexedDB...`);
        try {
          await this.indexedDBService.clear(this.dbName, this.dbVersion, this.storeName);
          const sanitized = products.map(p => this.sanitizeProductForStorage({ ...p }));
          await this.indexedDBService.putMany(this.dbName, this.dbVersion, this.storeName, sanitized);
          this.invalidateIndexedDbCache();
        } catch (dbErr) {
          console.error('⚠️ Lỗi khi lưu vào IndexedDB:', dbErr);
        }
      }

      return {
        success: true,
        products,
        stats: syncResult.stats
      };

    } catch (err: any) {
      console.error('❌ Lỗi trong syncKiotVietToFirebase:', err);
      return {
        success: false,
        error: err?.message || 'Lỗi không xác định',
        errorType: 'unexpected_error'
      };
    }
  }

  // Method để thực hiện việc gửi lên Firestore
  private async executeSaveToFirebase(): Promise<Product[] | null> {
    if (this.isSavingToFirebase || this.pendingProductsToSave.length === 0) {
      return null;
    }

    try {
      this.isSavingToFirebase = true;

      // Lấy tất cả products chờ và xóa danh sách chờ
      const productsToSave = [...this.pendingProductsToSave];
      this.pendingProductsToSave = [];

      console.log(`🔄 Thực hiện gửi ${productsToSave.length} sản phẩm lên Firestore...`);

      // Loại bỏ duplicates dựa trên Id
      const uniqueProducts = this.removeDuplicateProducts(productsToSave);

      if (uniqueProducts.length > 0) {
        // POST uniqueProducts to backend sync endpoint. Expect backend to return the merged final products list.
        try {
          const resp = await firstValueFrom(this.saveAllProductsToFirebase(uniqueProducts).pipe(
            catchError(err => {
              console.error('❌ Lỗi khi gọi POST sync endpoint (saveAllProductsToFirebase):', err);
              return of([] as unknown);
            })
          ));

          const merged = this.normalizeProductApiPayload(resp);

          if (merged && merged.length > 0) {
            // Persist merged result into IndexedDB (replace store)
            try {
              await this.indexedDBService.clear(this.dbName, this.dbVersion, this.storeName);
            } catch (clearErr) {
              console.warn('⚠️ Không thể clear store trước khi ghi merged products:', clearErr);
            }

            const sanitized = merged.map(p => this.sanitizeProductForStorage({ ...p }));
            await this.indexedDBService.putMany(this.dbName, this.dbVersion, this.storeName, sanitized);
            this.invalidateIndexedDbCache();
            this.firebaseProductsCache = sanitized;
            this.cacheTimestamp = Date.now();
            console.log(`✅ Đã gửi và lưu ${sanitized.length} sản phẩm trả về từ backend vào IndexedDB`);
          } else {
            console.log(`ℹ️ POST sync endpoint trả về rỗng sau khi gửi ${uniqueProducts.length} sản phẩm`);
          }

          this.clearFirebaseCache();

          return merged;
        } catch (err) {
          console.error('❌ Lỗi khi gửi sản phẩm lên Firestore và lưu kết quả:', err);
          return null;
        }
      }

    } catch (error) {
      console.error('❌ Lỗi khi gửi sản phẩm lên Firestore:', error);
      // Thêm lại products vào danh sách chờ nếu có lỗi
      this.pendingProductsToSave.unshift(...this.pendingProductsToSave);
    } finally {
      this.isSavingToFirebase = false;
    }
    return null;
  }

  // Method để loại bỏ products trùng lặp
  private removeDuplicateProducts(products: Product[]): Product[] {
    const uniqueMap = new Map<number, Product>();

    for (const product of products) {
      if (product.Id) {
        uniqueMap.set(product.Id, product);
      }
    }

    return Array.from(uniqueMap.values());
  }

  // Method để force execute save to Firebase ngay lập tức
  public async forceExecuteSaveToFirebase(): Promise<void> {
    // Clear timeout nếu có
    if (this.saveToFirebaseTimeout) {
      clearTimeout(this.saveToFirebaseTimeout);
      this.saveToFirebaseTimeout = null;
    }

    // Execute ngay lập tức
    await this.executeSaveToFirebase();
  }

  // Method để lấy trạng thái của debounce mechanism
  public getSaveToFirebaseStatus(): {
    isSaving: boolean;
    pendingCount: number;
    hasTimeout: boolean;
  } {
    return {
      isSaving: this.isSavingToFirebase,
      pendingCount: this.pendingProductsToSave.length,
      hasTimeout: this.saveToFirebaseTimeout !== null
    };
  }

  // Method để kiểm tra xem có thay đổi gì không (trừ OnHand)
  private hasProductChanges(existing: Product, newProduct: Product): boolean {
    // Danh sách các trường quan trọng cần so sánh
    const importantFields: (keyof Product)[] = [
      'Name', 'FullName', 'Code', 'Cost', 'BasePrice', 'Unit',
      'Description', 'CategoryId', 'MasterUnitId', 'MasterProductId',
      'ConversionValue', 'IsRewardPoint', 'isActive', 'isDeleted',
      'Image', 'ProductAttributes', 'NormalizedName', 'NormalizedCode',
      'OrderTemplate', 'ModifiedDate', 'CreatedDate'
    ];

    let hasChanges = false;
    const changes: string[] = [];

    for (const field of importantFields) {
      const existingValue = existing[field];
      const newValue = newProduct[field];

      // So sánh giá trị
      if (existingValue !== newValue) {
        changes.push(`${field}: ${existingValue} -> ${newValue}`);
        hasChanges = true;
      }
    }

    if (hasChanges) {
      console.log(`📊 Thay đổi cho product ${newProduct.Id} (${newProduct.Name}):`, changes.join(', '));
    }

    return hasChanges;
  }

  // Method để log chi tiết thay đổi của product
  private logProductChanges(existing: Product, newProduct: Product): void {
    console.log(`🔍 Chi tiết thay đổi cho product ${newProduct.Id}:`);
    console.log(`   Tên: ${existing.Name} -> ${newProduct.Name}`);
    console.log(`   Mã: ${existing.Code} -> ${newProduct.Code}`);
    console.log(`   Giá gốc: ${existing.Cost} -> ${newProduct.Cost}`);
    console.log(`   Giá bán: ${existing.BasePrice} -> ${newProduct.BasePrice}`);
    console.log(`   Đơn vị: ${existing.Unit} -> ${newProduct.Unit}`);
    console.log(`   OnHand: ${existing.OnHand} -> ${newProduct.OnHand}`);
  }

  // Method để log OnHand trước và sau khi sync
  private logOnHandComparison(productId: number, beforeOnHand: number, afterOnHand: number, source: string): void {
    if (beforeOnHand !== afterOnHand) {
      console.warn(`⚠️ OnHand thay đổi cho product ${productId}: ${beforeOnHand} -> ${afterOnHand} (${source})`);
    } else {
      console.log(`✅ OnHand giữ nguyên cho product ${productId}: ${beforeOnHand} (${source})`);
    }
  }

  // Method để debug OnHand trong toàn bộ quá trình
  public async debugOnHandForProduct(productId: number): Promise<void> {
    try {
      console.log(`🔍 Debug OnHand cho product ${productId}:`);

      // Lấy từ IndexedDB
      const indexedDBProduct = await this.getProductByIdFromIndexedDB(productId);
      console.log(`   IndexedDB OnHand: ${indexedDBProduct?.OnHand || 'N/A'}`);

      // Lấy từ Firestore (force clear cache)
      this.clearFirebaseCache();
      const firebaseProducts = await this.getProductsFromFirebaseWithCache();
      const firebaseProduct = firebaseProducts.find(p => p.Id === productId);
      console.log(`   Firestore OnHand: ${firebaseProduct?.OnHand || 'N/A'}`);

      // So sánh
      if (indexedDBProduct && firebaseProduct) {
        if (indexedDBProduct.OnHand === firebaseProduct.OnHand) {
          console.log(`   ✅ OnHand đồng bộ: ${indexedDBProduct.OnHand}`);
        } else {
          console.warn(`   ⚠️ OnHand không đồng bộ: IndexedDB=${indexedDBProduct.OnHand}, Firestore=${firebaseProduct.OnHand}`);
        }
      }

    } catch (error) {
      console.error(`❌ Lỗi khi debug OnHand cho product ${productId}:`, error);
    }
  }

  // Method để force sync OnHand từ IndexedDB lên Firestore
  public async forceSyncOnHandToFirestore(): Promise<void> {
    try {
      console.log('🔄 Force sync OnHand từ IndexedDB lên Firestore...');

      // Lấy tất cả products từ IndexedDB
      const indexedDBProducts = await this.getAllProductsFromIndexedDB();

      if (indexedDBProducts.length === 0) {
        console.log('ℹ️ Không có products nào trong IndexedDB');
        return;
      }

      // Lấy products từ Firestore
      this.clearFirebaseCache();
      const firebaseProducts = await this.getProductsFromFirebaseWithCache();
      const firebaseMap = new Map(firebaseProducts.map(p => [p.Id, p]));

      // Chuẩn bị products để gửi lên Firestore
      const productsToSync: Product[] = [];

      for (const indexedDBProduct of indexedDBProducts) {
        const firebaseProduct = firebaseMap.get(indexedDBProduct.Id);

        if (firebaseProduct) {
          // Tạo bản sao từ Firestore và cập nhật OnHand
          const productToSync = { ...firebaseProduct };
          productToSync.OnHand = indexedDBProduct.OnHand;

          if (firebaseProduct.OnHand !== indexedDBProduct.OnHand) {
            console.log(`🔄 Sync OnHand cho product ${indexedDBProduct.Id}: ${firebaseProduct.OnHand} -> ${indexedDBProduct.OnHand}`);
            productsToSync.push(productToSync);
          }
        }
      }

      if (productsToSync.length > 0) {
        console.log(`🔄 Gửi ${productsToSync.length} products với OnHand đã cập nhật lên Firestore...`);
        await this.debouncedSaveToFirebase(productsToSync);
        console.log(`✅ Đã force sync OnHand cho ${productsToSync.length} products`);
      } else {
        console.log('ℹ️ Tất cả OnHand đã đồng bộ, không cần cập nhật');
      }

    } catch (error) {
      console.error('❌ Lỗi khi force sync OnHand:', error);
      throw error;
    }
  }

  // Method để lấy trạng thái cache performance
  public getCachePerformanceStats(): {
    apiCallCount: number;
    cacheHitCount: number;
    cacheHitRate: number;
    cacheAge: number;
    cacheSize: number;
    isExpired: boolean;
  } {
    const totalCalls = this.apiCallCount + this.cacheHitCount;
    const cacheHitRate = totalCalls > 0 ? (this.cacheHitCount / totalCalls) * 100 : 0;
    const cacheInfo = this.getDetailedCacheInfo();

    return {
      apiCallCount: this.apiCallCount,
      cacheHitCount: this.cacheHitCount,
      cacheHitRate: Math.round(cacheHitRate * 100) / 100, // Làm tròn 2 chữ số thập phân
      cacheAge: cacheInfo.cacheAge,
      cacheSize: cacheInfo.cacheSize,
      isExpired: cacheInfo.isExpired
    };
  }

  // Method để reset cache performance stats
  public resetCachePerformanceStats(): void {
    this.apiCallCount = 0;
    this.cacheHitCount = 0;
    console.log('🔄 Đã reset cache performance stats');
  }

  // Method để log cache performance stats
  public logCachePerformanceStats(): void {
    const stats = this.getCachePerformanceStats();
    console.log('📊 Cache Performance Stats:');
    console.log(`   API Calls: ${stats.apiCallCount}`);
    console.log(`   Cache Hits: ${stats.cacheHitCount}`);
    console.log(`   Cache Hit Rate: ${stats.cacheHitRate}%`);
    console.log(`   Cache Age: ${Math.round(stats.cacheAge / 1000)}s`);
    console.log(`   Cache Size: ${stats.cacheSize} products`);
    console.log(`   Cache Expired: ${stats.isExpired}`);
    console.log(`   Shared Request Active: ${this.currentFirebaseRequest !== null}`);
  }

  // Method để lấy trạng thái shared request
  public getSharedRequestStatus(): {
    hasActiveRequest: boolean;
    cacheStatus: string;
    requestCount: number;
  } {
    const cacheInfo = this.getDetailedCacheInfo();
    let cacheStatus = 'No Cache';

    if (cacheInfo.hasCache) {
      if (cacheInfo.isExpired) {
        cacheStatus = 'Expired';
      } else {
        cacheStatus = 'Valid';
      }
    }

    return {
      hasActiveRequest: this.currentFirebaseRequest !== null,
      cacheStatus: cacheStatus,
      requestCount: this.apiCallCount
    };
  }

  // Method để debug API calls
  public debugAPICalls(): void {
    const stats = this.getCachePerformanceStats();
    const status = this.getSharedRequestStatus();

    console.log('🔍 API Calls Debug:');
    console.log(`   Total API Calls: ${stats.apiCallCount}`);
    console.log(`   Cache Hits: ${stats.cacheHitCount}`);
    console.log(`   Cache Hit Rate: ${stats.cacheHitRate}%`);
    console.log(`   Active Request: ${status.hasActiveRequest}`);
    console.log(`   Cache Status: ${status.cacheStatus}`);
    console.log(`   Should Clear Cache: ${this.shouldClearCache()}`);
  }

  async updateProductOnHandToFireStore(products: Product[]): Promise<void> {
    const minimalProducts = products.map(p => ({ Id: p.Id, OnHand: p.OnHand }));
    const url = `${environment.domainUrl}/api/firebase/update/products`;
    const t0 = performance.now();
    await this.http.put(url, minimalProducts).toPromise();
    const t1 = performance.now();
    console.log(`⏱️ Gửi lên Firestore (API /api/firebase/update/products) mất ${t1 - t0} ms`);
  }

  /**
   * Fetch latest product documents by IDs from backend polling endpoint.
   * Backend endpoint: POST /api/firebase/products/fetch with body { ids: [...] }
   * Updates IndexedDB with returned product documents.
   */
  public async fetchProductsByIds(ids: Array<number | string>): Promise<Product[]> {
    if (!ids || ids.length === 0) return [];
    try {
      const url = `${environment.domainUrl}/api/firebase/products/fetch`;
      const payload = { ids: ids.map(id => String(id)) };
      const res = await firstValueFrom(this.http.post<any[]>(url, payload).pipe(
        catchError(err => {
          console.warn('fetchProductsByIds: backend fetch failed', err);
          return of([]);
        })
      ));

      if (Array.isArray(res) && res.length > 0) {
        for (const p of res) {
          try {
            // ensure the returned doc is persisted into IndexedDB so UI sees freshest data
            await this.updateProductFromIndexedDB(p as Product);
          } catch (dbErr) {
            console.warn('fetchProductsByIds: failed to update IndexedDB for product', p?.Id, dbErr);
          }
        }
      }

      return Array.isArray(res) ? (res as Product[]) : [];
    } catch (err) {
      console.warn('fetchProductsByIds unexpected error', err);
      return [];
    }
  }

  /**
   * Fetch latest products (optionally limited) from backend endpoint.
   * GET /api/firebase/products/latest?limit=NN
   */
  public async fetchLatestProducts(limit?: number): Promise<Product[]> {
    try {
      const url = `${environment.domainUrl}/api/firebase/products/latest${limit ? `?limit=${limit}` : ''}`;
      const res = await firstValueFrom(this.http.get<any[]>(url).pipe(
        catchError(err => {
          console.warn('fetchLatestProducts: backend fetch failed', err);
          return of([]);
        })
      ));

      if (Array.isArray(res) && res.length > 0) {
        for (const p of res) {
          try {
            await this.updateProductFromIndexedDB(p as Product);
          } catch (dbErr) {
            console.warn('fetchLatestProducts: failed to update IndexedDB for product', p?.Id, dbErr);
          }
        }
      }

      return Array.isArray(res) ? (res as Product[]) : [];
    } catch (err) {
      console.warn('fetchLatestProducts unexpected error', err);
      return [];
    }
  }

  public async updateProductsBatchToFirebase(groupedProducts: Record<string, Product[]>): Promise<void> {
    // Nếu API backend nhận object group, gửi trực tiếp:
    // Nếu API backend chỉ nhận array, cần chuyển về array:
    // const allProducts: Product[] = Object.values(groupedProducts).flat();

    const url = `${environment.domainUrl}${this.firebaseService.update_multi_products_by_id_to_firebase}`;
    try {
      await this.http.put(url, groupedProducts).toPromise();
      console.log('✅ Đã gửi batch sản phẩm lên Firestore thành công!');
    } catch (error) {
      console.error('❌ Lỗi khi gửi batch sản phẩm lên Firestore:', error);
      throw error;
    }
  }

  // Lưu đơn đặt hàng vào IndexedDB
  async addOrderToIndexedDB(order: any): Promise<void> {
    await this.ensureDBInitialized();
    await this.indexedDBService.put('SalesDB', 1, 'order', order);
  }

  // Lấy toàn bộ đơn đặt hàng từ IndexedDB
  async getAllOrdersFromIndexedDB(): Promise<any[]> {
    await this.ensureDBInitialized();
    return await this.indexedDBService.getAll('SalesDB', 1, 'order');
  }

  // WebSocket initialization and listeners removed — backend no longer accepts incoming websocket updates.
  // The service now uses REST update endpoints and polling/fetch helpers to keep IndexedDB in sync.

  private async handleProductOnHandUpdated(
    productId: number,
    newOnHand: number | null,
    newBasePrice: number | null = null,
    newCost: number | null = null,
    newCode: string | null = null,
    newFullName: string | null = null,
    newName: string | null = null
  ): Promise<void> {
    try {
      const onHandValue = this.parseFiniteNumber(newOnHand);
      const basePriceValue = this.parseFiniteNumber(newBasePrice);
      const costValue = this.parseFiniteNumber(newCost);

      const hasOnHand = onHandValue !== null;
      const hasBasePrice = basePriceValue !== null;
      const hasCost = costValue !== null;
      const hasCode = typeof newCode === 'string' && newCode.trim().length > 0;
      const hasFullName = typeof newFullName === 'string' && newFullName.trim().length > 0;
      const hasName = typeof newName === 'string' && newName.trim().length > 0;
      if (!hasOnHand && !hasBasePrice && !hasCost && !hasCode && !hasFullName && !hasName) {
        console.warn(`⚠️ handleProductOnHandUpdated called without valid fields for id=${productId}`);
        return;
      }

      const codeValue = hasCode ? newCode!.trim() : null;
      const fullNameValue = hasFullName ? newFullName!.trim() : null;
      const nameValue = hasName ? newName!.trim() : null;

      // Use the same DB/store used across the service
      console.log(`ℹ️ handleProductOnHandUpdated called for id=${productId}, onHand=${onHandValue}, basePrice=${basePriceValue}, cost=${costValue}, code=${codeValue}, fullName=${fullNameValue}`);
      await this.ensureDBInitialized();

      // Try direct lookup first
      let product = await this.indexedDBService.getByKey<Product>(this.dbName, this.dbVersion, this.storeName, productId);
      if (!product) {
        console.warn(`⚠️ Real-time: Product ${productId} not found by numeric key. Attempting fallback lookups...`);

        try {
          // Read a few entries from the store to inspect keys and types
          const all = await this.indexedDBService.getAll<Product>(this.dbName, this.dbVersion, this.storeName);
          console.warn(`ℹ️ IndexedDB contains ${all.length} products (showing up to 5 ids):`,
            all.slice(0, 5).map((p: any) => ({ Id: p?.Id, typeOfId: typeof p?.Id })));

          // Try to find by loose equality in the dataset (covers string vs number mismatch cases)
          const found = all.find((p: any) => Number(p?.Id) === Number(productId));
          if (found) {
            product = found as Product;
            console.log(`ℹ️ Fallback: matched product in dataset by loose equality Id=${(product as any).Id}`);
          }

          if (!product) {
            // Try string-key lookup (some clients store keys as strings)
            const strKey = String(productId);
            const stringKeyMatch = await this.indexedDBService.getByKey<Product>(this.dbName, this.dbVersion, this.storeName, strKey as any);
            if (stringKeyMatch) {
              product = stringKeyMatch;
              console.log(`ℹ️ Fallback: found product with string key '${strKey}'`);
            }
          }
        } catch (readErr) {
          console.error('❌ Error during fallback IndexedDB inspection:', readErr);
        }
      }

      if (product) {
        let changed = false;
        if (onHandValue !== null && product) {
          const beforeOnHand = (product as Product).OnHand;
          if (beforeOnHand !== onHandValue) {
            (product as Product).OnHand = onHandValue;
            console.log(`✅ Real-time: Updated OnHand for product ${productId} in IndexedDB: ${beforeOnHand} -> ${onHandValue}`);
            changed = true;
          }
        }
        if (basePriceValue !== null && product) {
          const beforeBase = (product as Product).BasePrice;
          if (beforeBase !== basePriceValue) {
            (product as Product).BasePrice = basePriceValue;
            if (typeof (product as any).FinalBasePrice === 'number') {
              (product as any).FinalBasePrice = basePriceValue;
            }
            console.log(`✅ Real-time: Updated BasePrice for product ${productId} in IndexedDB: ${beforeBase} -> ${basePriceValue}`);
            changed = true;
          }
        }
        if (costValue !== null && product) {
          const beforeCost = (product as Product).Cost;
          if (beforeCost !== costValue) {
            (product as Product).Cost = costValue;
            changed = true;
          }
        }
        if (hasCode && product) {
          const beforeCode = (product as Product).Code;
          if (beforeCode !== codeValue) {
            (product as Product).Code = codeValue as string;
            changed = true;
          }
        }
        if (hasFullName && product) {
          const beforeFullName = (product as any).FullName;
          if (beforeFullName !== fullNameValue) {
            (product as any).FullName = fullNameValue as string;
            changed = true;
          }
        }
        if (hasName && product) {
          const beforeName = (product as any).Name;
          if (beforeName !== nameValue) {
            (product as any).Name = nameValue as string;
            changed = true;
          }
        }

        if (changed) {
          await this.indexedDBService.put<Product>(this.dbName, this.dbVersion, this.storeName, product as Product);

          // Verify write by reading back
          try {
            const verify = await this.indexedDBService.getByKey<Product>(this.dbName, this.dbVersion, this.storeName, (product as any).Id as any);
            console.log('🔍 Verified IndexedDB value after write:', {
              idRead: verify?.Id,
              OnHand: verify?.OnHand,
              BasePrice: (verify as any)?.BasePrice,
              Cost: (verify as any)?.Cost,
              Code: (verify as any)?.Code
            });
          } catch (verifyErr) {
            console.error('❌ Error verifying IndexedDB write:', verifyErr);
          }

          await this.syncOutOfStockEntry(product as Product);
        }
      } else {
        console.warn(`⚠️ Real-time: Product ${productId} not present in IndexedDB after fallback attempts — will retry apply shortly`);
        // Queue a few retry attempts to apply once the product list finishes syncing locally
        this.queueRetryApplyOnHand(productId, {
          onHand: onHandValue ?? undefined,
          basePrice: basePriceValue ?? undefined,
          cost: costValue ?? undefined,
          code: codeValue ?? undefined,
          fullName: fullNameValue ?? undefined,
          name: nameValue ?? undefined
        });
      }

      // Emit event for UI/components regardless (so UI can decide to reload or fetch)
      const payload: ProductRealtimeUpdate = { productId };
      const fallbackProduct = product as Product | undefined;
      if (onHandValue !== null) {
        payload.onHand = onHandValue;
      } else if (fallbackProduct && Number.isFinite(Number(fallbackProduct.OnHand))) {
        payload.onHand = Number(fallbackProduct.OnHand);
      }
      if (basePriceValue !== null) {
        payload.basePrice = basePriceValue;
      } else if (fallbackProduct && Number.isFinite(Number((fallbackProduct as any).BasePrice))) {
        payload.basePrice = Number((fallbackProduct as any).BasePrice);
      }
      if (costValue !== null) {
        payload.cost = costValue;
      } else if (fallbackProduct && Number.isFinite(Number((fallbackProduct as any).Cost))) {
        payload.cost = Number((fallbackProduct as any).Cost);
      }
      const finalCode = hasCode && codeValue ? codeValue : (typeof (fallbackProduct as any)?.Code === 'string' ? (fallbackProduct as any).Code : undefined);
      if (finalCode) {
        payload.code = finalCode;
      }
      const finalFullName = hasFullName && fullNameValue ? fullNameValue : (typeof (fallbackProduct as any)?.FullName === 'string' ? (fallbackProduct as any).FullName : undefined);
      if (finalFullName) {
        payload.fullName = finalFullName;
      }
      const finalName = hasName && nameValue ? nameValue : (typeof (fallbackProduct as any)?.Name === 'string' ? (fallbackProduct as any).Name : undefined);
      if (finalName) {
        payload.name = finalName;
      }

      if (
        payload.onHand !== undefined ||
        payload.basePrice !== undefined ||
        payload.cost !== undefined ||
        payload.code !== undefined ||
        payload.fullName !== undefined ||
        payload.name !== undefined
      ) {
        this.productOnHandUpdatedSubject.next(payload);
      }
    } catch (error) {
      console.error(`❌ Error handling product_onhand_updated:`, error);
    }
  }

  // Batch handler: [{ Id|productId, OnHand|onHand }]
  private async handleProductsOnHandUpdated(items: any[]): Promise<void> {
    try {
      if (!items || items.length === 0) return;
      await this.ensureDBInitialized();

      // Normalize and deduplicate by Id
      const map = new Map<number, {
        onHand?: number;
        basePrice?: number;
        cost?: number;
        code?: string;
        fullName?: string;
        name?: string;
      }>();
      for (const raw of items) {
        const id = Number(raw?.Id ?? raw?.productId ?? raw?.id);
        const onHandRaw = raw?.OnHand ?? raw?.onHand;
        const basePriceRaw = raw?.BasePrice ?? raw?.basePrice;
        const oh = Number(onHandRaw);
        const bp = Number(basePriceRaw);
        const hasOnHand = Number.isFinite(oh);
        const hasBasePrice = Number.isFinite(bp);
        const costRaw = raw?.Cost ?? raw?.cost;
        const cost = Number(costRaw);
        const hasCost = Number.isFinite(cost);
        const codeRaw = raw?.Code ?? raw?.code;
        const code = typeof codeRaw === 'string' && codeRaw.trim().length > 0 ? codeRaw.trim() : undefined;
        const fullNameRaw = raw?.FullName ?? raw?.fullName;
        const fullName = typeof fullNameRaw === 'string' && fullNameRaw.trim().length > 0 ? fullNameRaw.trim() : undefined;
        const nameRaw = raw?.Name ?? raw?.name;
        const name = typeof nameRaw === 'string' && nameRaw.trim().length > 0 ? nameRaw.trim() : undefined;
        if (Number.isFinite(id) && (hasOnHand || hasBasePrice || hasCost || code || fullName || name)) {
          const entry = map.get(id) ?? {};
          if (hasOnHand) entry.onHand = oh;
          if (hasBasePrice) entry.basePrice = bp;
          if (hasCost) entry.cost = cost;
          if (code) entry.code = code;
          if (fullName) entry.fullName = fullName;
          if (name) entry.name = name;
          map.set(id, entry);
        }
      }
      if (map.size === 0) return;

      // Read all current products once and update those present
      const updatedRecords: Product[] = [];
      const notFoundIds: number[] = [];
      for (const [id, payload] of map.entries()) {
        try {
          const prod = await this.indexedDBService.getByKey<Product>(this.dbName, this.dbVersion, this.storeName, id);
          if (prod) {
            let changed = false;
            if (payload.onHand !== undefined) {
              prod.OnHand = payload.onHand;
              changed = true;
            }
            if (payload.basePrice !== undefined) {
              const beforeBase = prod.BasePrice;
              prod.BasePrice = payload.basePrice;
              if (typeof (prod as any).FinalBasePrice === 'number') {
                (prod as any).FinalBasePrice = payload.basePrice;
              }
              if (beforeBase !== payload.basePrice) {
                changed = true;
              }
            }
            if (payload.cost !== undefined) {
              const beforeCost = (prod as any).Cost;
              if (beforeCost !== payload.cost) {
                (prod as any).Cost = payload.cost;
                changed = true;
              }
            }
            if (payload.code !== undefined) {
              const beforeCode = (prod as any).Code;
              if (beforeCode !== payload.code) {
                (prod as any).Code = payload.code;
                changed = true;
              }
            }
            if (payload.fullName !== undefined) {
              const beforeFullName = (prod as any).FullName;
              if (beforeFullName !== payload.fullName) {
                (prod as any).FullName = payload.fullName;
                changed = true;
              }
            }
            if (payload.name !== undefined) {
              const beforeName = (prod as any).Name;
              if (beforeName !== payload.name) {
                (prod as any).Name = payload.name;
                changed = true;
              }
            }
            if (changed) {
              updatedRecords.push(prod);
            }
          } else {
            notFoundIds.push(id);
          }
        } catch (e) {
          console.warn('⚠️ handleProductsOnHandUpdated: error reading id', id, e);
        }
      }

      if (updatedRecords.length > 0) {
        await this.indexedDBService.putMany<Product>(this.dbName, this.dbVersion, this.storeName, updatedRecords);
        console.log(`✅ Real-time batch: Updated ${updatedRecords.length} products in IndexedDB`);
        for (const rec of updatedRecords) {
          await this.syncOutOfStockEntry(rec);
        }
        // emit per-product UI events
        for (const rec of updatedRecords) {
          const payload: ProductRealtimeUpdate = {
            productId: rec.Id
          };
          if (typeof rec.OnHand === 'number' && Number.isFinite(rec.OnHand)) payload.onHand = rec.OnHand;
          if (typeof rec.BasePrice === 'number' && Number.isFinite(rec.BasePrice)) payload.basePrice = rec.BasePrice;
          if (typeof (rec as any).Cost === 'number' && Number.isFinite((rec as any).Cost)) payload.cost = (rec as any).Cost;
          if (typeof (rec as any).Code === 'string' && (rec as any).Code.trim().length > 0) payload.code = (rec as any).Code;
          if (typeof (rec as any).FullName === 'string' && (rec as any).FullName.trim().length > 0) payload.fullName = (rec as any).FullName;
          if (typeof (rec as any).Name === 'string' && (rec as any).Name.trim().length > 0) payload.name = (rec as any).Name;
          this.productOnHandUpdatedSubject.next(payload);
        }
      }

      // For not found ids, queue retry applies
      for (const id of notFoundIds) {
        const entry = map.get(id)!;
        this.queueRetryApplyOnHand(id, entry);
      }
    } catch (err) {
      console.error('❌ handleProductsOnHandUpdated error:', err);
    }
  }

  // Retry helper: attempt to apply OnHand to IndexedDB a few times to handle races with initial sync
  private queueRetryApplyOnHand(
    productId: number,
    payload: {
      onHand?: number | null;
      basePrice?: number | null;
      cost?: number | null;
      code?: string | null;
      fullName?: string | null;
      name?: string | null;
    },
    maxAttempts = 5,
    delayMs = 1500
  ): void {
    const normalizedOnHand = Number.isFinite(payload.onHand as number) ? Number(payload.onHand) : undefined;
    const normalizedBasePrice = Number.isFinite(payload.basePrice as number) ? Number(payload.basePrice) : undefined;
    const normalizedCost = Number.isFinite(payload.cost as number) ? Number(payload.cost) : undefined;
    const normalizedCode = typeof payload.code === 'string' && payload.code.trim().length > 0 ? payload.code.trim() : undefined;
    const normalizedFullName = typeof payload.fullName === 'string' && payload.fullName.trim().length > 0 ? payload.fullName.trim() : undefined;
    const normalizedName = typeof payload.name === 'string' && payload.name.trim().length > 0 ? payload.name.trim() : undefined;

    const existing = this.pendingOnHandLocalApplies.get(productId);
    const attempts = existing ? existing.attempts : 0;
    this.pendingOnHandLocalApplies.set(productId, {
      onHand: normalizedOnHand ?? existing?.onHand,
      basePrice: normalizedBasePrice ?? existing?.basePrice,
      cost: normalizedCost ?? existing?.cost,
      code: normalizedCode ?? existing?.code,
      fullName: normalizedFullName ?? existing?.fullName,
      name: normalizedName ?? existing?.name,
      attempts
    });

    const tryApply = async () => {
      const state = this.pendingOnHandLocalApplies.get(productId);
      if (!state) return; // already applied/cleared
      if (state.attempts >= maxAttempts) {
        console.warn(`⚠️ Gave up applying queued update for product ${productId} after ${state.attempts} attempts`);
        this.pendingOnHandLocalApplies.delete(productId);
        return;
      }

      try {
        await this.ensureDBInitialized();
        const prod = await this.indexedDBService.getByKey<Product>(this.dbName, this.dbVersion, this.storeName, productId);
        if (prod) {
          let updated = false;
          if (state.onHand !== undefined) {
            const beforeOnHand = prod.OnHand;
            prod.OnHand = state.onHand;
            console.log(`✅ Retried apply: Updated OnHand for product ${productId} in IndexedDB: ${beforeOnHand} -> ${state.onHand}`);
            updated = true;
          }
          if (state.basePrice !== undefined) {
            const beforeBase = prod.BasePrice;
            prod.BasePrice = state.basePrice;
            if (typeof (prod as any).FinalBasePrice === 'number') {
              (prod as any).FinalBasePrice = state.basePrice;
            }
            console.log(`✅ Retried apply: Updated BasePrice for product ${productId} in IndexedDB: ${beforeBase} -> ${state.basePrice}`);
            updated = true;
          }
          if (state.cost !== undefined) {
            const beforeCost = (prod as any).Cost;
            (prod as any).Cost = state.cost;
            console.log(`✅ Retried apply: Updated Cost for product ${productId} in IndexedDB: ${beforeCost} -> ${state.cost}`);
            updated = true;
          }
          if (state.code !== undefined) {
            const beforeCode = (prod as any).Code;
            (prod as any).Code = state.code;
            console.log(`✅ Retried apply: Updated Code for product ${productId} in IndexedDB: ${beforeCode} -> ${state.code}`);
            updated = true;
          }
          if (state.fullName !== undefined) {
            const beforeFullName = (prod as any).FullName;
            (prod as any).FullName = state.fullName;
            console.log(`✅ Retried apply: Updated FullName for product ${productId} in IndexedDB: ${beforeFullName} -> ${state.fullName}`);
            updated = true;
          }
          if (state.name !== undefined) {
            const beforeName = (prod as any).Name;
            (prod as any).Name = state.name;
            console.log(`✅ Retried apply: Updated Name for product ${productId} in IndexedDB: ${beforeName} -> ${state.name}`);
            updated = true;
          }
          if (updated) {
            await this.indexedDBService.put<Product>(this.dbName, this.dbVersion, this.storeName, prod);
            await this.syncOutOfStockEntry(prod as Product);
          }
          this.pendingOnHandLocalApplies.delete(productId);
          return;
        }

        // Not found yet — increment attempts and schedule next try
        this.pendingOnHandLocalApplies.set(productId, {
          onHand: state.onHand,
          basePrice: state.basePrice,
          cost: state.cost,
          code: state.code,
          fullName: state.fullName,
          name: state.name,
          attempts: state.attempts + 1
        });
        setTimeout(tryApply, delayMs);
      } catch (err) {
        console.warn(`⚠️ Retry apply failed for product ${productId} (attempt ${state.attempts + 1}):`, err);
        this.pendingOnHandLocalApplies.set(productId, {
          onHand: state.onHand,
          basePrice: state.basePrice,
          cost: state.cost,
          code: state.code,
          fullName: state.fullName,
          name: state.name,
          attempts: state.attempts + 1
        });
        setTimeout(tryApply, delayMs);
      }
    };

    // Kick off the first attempt with a short delay to allow concurrent writes to complete
    setTimeout(tryApply, delayMs);
  }

  // Helper: update single product OnHand locally and emit
  public async updateSingleProductOnHandLocal(productId: number | string, onHand: number): Promise<void> {
    try {
      await this.ensureDBInitialized();
      const id = Number(productId);
      const product = await this.indexedDBService.getByKey<Product>(this.dbName, this.dbVersion, this.storeName, id);
      if (product) {
        product.OnHand = onHand;
        await this.indexedDBService.put<Product>(this.dbName, this.dbVersion, this.storeName, product);
        await this.syncOutOfStockEntry(product as Product);
        this.productOnHandUpdatedSubject.next({ productId: id, onHand });
        console.log(`✅ updateSingleProductOnHandLocal: updated ${id} -> ${onHand}`);
      } else {
        console.warn(`⚠️ updateSingleProductOnHandLocal: product ${id} not found`);
      }
    } catch (err) {
      console.error('❌ updateSingleProductOnHandLocal error:', err);
    }
  }

  // Public method to initialize WebSocket safely
  public async initializeProductWebSocket(): Promise<void> {
    // WebSocket removed on server side. No initialization performed.
    console.log('ℹ️ initializeProductWebSocket called — websockets removed on server; no-op');
  }

  // Notify server about an OnHand change so server can emit to other connected clients
  // Payload: { productId, onHand, basePrice? }
  public async notifyServerProductOnHandChange(productId: number, onHand: number, basePrice?: number): Promise<void> {
    const pid = Number(productId);
    const oh = Number(onHand);
    const bp = basePrice !== undefined ? Number(basePrice) : undefined;
    const payload: any = { productId: pid, onHand: oh };
    if (bp !== undefined && Number.isFinite(bp)) {
      payload.basePrice = bp;
    }
    // Prefer emitting over socket when connected
    try {
      console.log('📡 notifyServerProductOnHandChange (HTTP)', payload);
      await this.http.put(`${environment.domainUrl}/api/firebase/update/products`, payload).toPromise();
    } catch (httpErr) {
      console.warn('⚠️ HTTP notify failed, enqueueing notification for later flush', httpErr);
      this.enqueuePendingOnHandNotification(pid, oh, bp);
    }
  }

  // Emit a single batched products change over socket only (no HTTP fallback)
  // This is used to avoid duplicate HTTP PUTs when we've already updated via REST.
  // Payload: [{ Id, OnHand?, BasePrice?, Cost?, Code?, FullName?, Name? }, ...]
  public emitProductsOnHandChangeViaSocket(products: Array<{
    Id: number;
    OnHand?: number;
    BasePrice?: number;
    Cost?: number;
    Code?: string;
    FullName?: string;
    Name?: string;
  }>): void {
    // WebSocket support removed on backend — do not emit updates from client.
    // Prefer calling REST update endpoints (e.g. `updateProductOnHandToFireStore`) and
    // then use `fetchProductsByIds` / `fetchLatestProducts` to refresh local data.
    console.warn('emitProductsOnHandChangeViaSocket called, but websockets are removed. Skipping emit. Use REST update + fetch instead.');
  }

  private enqueuePendingOnHandNotification(productId: number, onHand?: number, basePrice?: number) {
    const entry = {
      productId,
      onHand,
      basePrice,
      timestamp: Date.now()
    };
    this.pendingOnHandNotifications.push(entry);
    console.log('🗳️ Enqueued OnHand notification', entry, 'queueLength=', this.pendingOnHandNotifications.length);
    // Keep queue bounded to a sensible size (e.g., 500)
    if (this.pendingOnHandNotifications.length > 500) {
      this.pendingOnHandNotifications.shift();
    }
  }

  private async flushPendingOnHandNotifications(): Promise<void> {
    if (!this.pendingOnHandNotifications || this.pendingOnHandNotifications.length === 0) return;
    console.log('🔄 Flushing', this.pendingOnHandNotifications.length, 'pending OnHand notifications');
    const toFlush = this.pendingOnHandNotifications
      .filter(entry => entry.onHand !== undefined || entry.basePrice !== undefined)
      .map(entry => ({ ...entry }));
    this.pendingOnHandNotifications = [];

    // Send per-item HTTP calls sequentially to avoid overloading the backend
    for (const entry of toFlush) {
      try {
        const payload: any = { productId: entry.productId };
        if (entry.onHand !== undefined) {
          payload.onHand = entry.onHand;
        }
        if (entry.basePrice !== undefined) {
          payload.basePrice = entry.basePrice;
        }
        await this.http.put(`${environment.domainUrl}/api/firebase/update/products`, payload).toPromise();
      } catch (err) {
        console.warn('⚠️ flushPendingOnHandNotifications: HTTP notify failed for', entry, err);
        // re-enqueue failed ones at front
        this.pendingOnHandNotifications.unshift(entry);
        // stop further attempts for now
        break;
      }
    }
  }
  /**
   * ✅ NEW: Lấy TẤT CẢ products từ Firebase KHÔNG dùng cache
   * Sử dụng endpoint /api/firebase/products/fetch với { all: true }
   */
  getAllProductsFromFirebaseFresh(options?: {
    includeInactive?: boolean;
    includeDeleted?: boolean;
  }): Observable<Product[]> {
    console.log('🔄 Gọi API Firebase FRESH (không cache) - /api/firebase/products/fetch');

    const payload = {
      all: true,
      include_inactive: options?.includeInactive ?? false,
      include_deleted: options?.includeDeleted ?? false
    };

    return this.http.post<Product[]>(
      `${environment.domainUrl}/api/firebase/products/fetch`,
      payload
    ).pipe(
      map(products => {
        const result = Array.isArray(products) ? products : [];
        console.log(`📦 Nhận được ${result.length} products từ Firebase (fresh)`);

        // Update local cache
        this.firebaseProductsCache = result;
        this.cacheTimestamp = Date.now();

        return result;
      }),
      catchError((err) => {
        console.error('❌ Lỗi khi lấy products từ Firebase (fresh):', err);
        return of([]);
      })
    );
  }
  // WebSocket control methods removed — client no longer manages a socket connection.
  // If you were calling `disconnectProductSocket()` or checking socket status, prefer
  // to stop relying on socket state; use `fetchProductsByIds` / `fetchLatestProducts` instead.
}