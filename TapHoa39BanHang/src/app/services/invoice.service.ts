import { Injectable, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { catchError, firstValueFrom, from, Observable, of, Subject } from 'rxjs';
import { InvoiceTab } from '../models/invoice.model';
import { IndexedDBService } from './indexed-db.service';
import { FirebaseService } from '../services/firebase.service';
import { TimeZoneService } from '../services/time-zone.service';
// WebSocket client removed — backend no longer accepts incoming websocket updates
import { ProductService } from '../services/product.service';
import { GroupService } from '../services/group.service';
import { KiotvietService } from './kiotviet.service';
import { Product } from '../models/product.model';
import { CustomerService } from './customer.service';

interface ReportCacheEntry<T = unknown> {
  key: string;
  data: T;
  updatedAt: string;
}

export interface ReportFilterPreferences {
  id: string;
  lastDailyDate?: string | null;
  lastTopYear?: number | null;
  lastTopMonth?: number | null;
  lastMonthlyYear?: number | null;
  lastSelectedMode?: 'daily' | 'monthly' | 'yearly';
}

@Injectable({
  providedIn: 'root'
})
export class InvoiceService implements OnInit {
  private dbName = 'Invoices';
  private dbVersion = 3; // Synchronized with CategoryService version
  private storeName = 'invoice';
  private readonly REPORT_CACHE_STORE = 'ReportsCache';
  private reportsDbName = 'ReportsDB';
  private reportsDbVersion = 1;
  private readonly REPORT_FILTER_STORE = 'ReportFilters';
  private readonly REPORT_FILTER_DOC_ID = 'global-preferences';
  private readonly DEFAULT_INITIAL_SYNC_DAYS = 30;

  // Socket fields removed — rely on REST endpoints and polling to stay in sync

  // Real-time event subjects
  private invoiceCreatedSubject = new Subject<InvoiceTab>();
  private invoiceUpdatedSubject = new Subject<InvoiceTab>();
  private invoiceDeletedSubject = new Subject<string>();
  private syncCompletedSubject = new Subject<void>();
  private dailySummarySubject = new Subject<{ date: string; summary: any }>();
  private monthlySummarySubject = new Subject<{ year: number; month: number; summary: any }>();
  private yearlySummarySubject = new Subject<{ year: number; summary: any }>();
  private topProductsSubject = new Subject<{ filters: Record<string, any>; products: any[] }>();

  // Public observables for components to subscribe
  public invoiceCreated$ = this.invoiceCreatedSubject.asObservable();
  public invoiceUpdated$ = this.invoiceUpdatedSubject.asObservable();
  public invoiceDeleted$ = this.invoiceDeletedSubject.asObservable();
  public syncCompleted$ = this.syncCompletedSubject.asObservable();
  public dailySummary$ = this.dailySummarySubject.asObservable();
  public monthlySummary$ = this.monthlySummarySubject.asObservable();
  public yearlySummary$ = this.yearlySummarySubject.asObservable();
  public topProducts$ = this.topProductsSubject.asObservable();

  // Sync tracking
  private lastSyncTimestamp: Date | null = null;
  private syncInProgress = false;
  private reportCacheInFlight = new Map<string, Promise<unknown>>();
  private groupedProductsCache: Record<number, Product[]> | null = null;
  private groupedProductsCacheTimestamp = 0;
  private readonly GROUPED_PRODUCTS_CACHE_TTL = 60 * 1000;

  constructor(
    private http: HttpClient,
    private indexedDBService: IndexedDBService,
    private timeZoneService: TimeZoneService,
    private firebaseService: FirebaseService,
    private productService: ProductService,
    private groupService: GroupService,
    private kiotvietService: KiotvietService,
    private customerService: CustomerService,
  ) {

    // Remove immediate WebSocket initialization - will be initialized lazily
  }

  private buildReportCacheKey(type: string, params: Record<string, unknown>): string {
    const normalizedEntries = Object.entries(params)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => `${key}=${value}`)
      .sort()
      .join('&');

    return normalizedEntries.length > 0 ? `${type}:${normalizedEntries}` : type;
  }

  private async getCachedReportEntry<T>(key: string): Promise<ReportCacheEntry<T> | undefined> {
    try {
      await this.initReportsDB();
      return await this.indexedDBService.getByKey<ReportCacheEntry<T>>(
        this.reportsDbName,
        this.reportsDbVersion,
        this.REPORT_CACHE_STORE,
        key
      );
    } catch (error) {
      console.error(`❌ Lỗi khi đọc cache báo cáo '${key}':`, error);
      return undefined;
    }
  }

  private async saveReportCacheEntry<T>(key: string, data: T): Promise<void> {
    try {
      await this.initReportsDB();
      const entry: ReportCacheEntry<T> = {
        key,
        data,
        updatedAt: new Date().toISOString()
      };
      await this.indexedDBService.put(
        this.reportsDbName,
        this.reportsDbVersion,
        this.REPORT_CACHE_STORE,
        entry
      );
    } catch (error) {
      console.error(`❌ Lỗi khi ghi cache báo cáo '${key}':`, error);
    }
  }

  private async invalidateReportCacheKeys(keys: string[]): Promise<void> {
    if (!keys.length) {
      return;
    }

    try {
      await this.initReportsDB();
      await Promise.all(keys.map(async key => {
        this.reportCacheInFlight.delete(key);
        try {
          await this.indexedDBService.delete(
            this.reportsDbName,
            this.reportsDbVersion,
            this.REPORT_CACHE_STORE,
            key
          );
        } catch (deleteErr) {
          console.warn(`⚠️ Không thể xóa cache báo cáo '${key}':`, deleteErr);
        }
      }));
    } catch (error) {
      console.error('❌ Lỗi khi xóa cache báo cáo:', error);
    }
  }

  private async invalidateReportCacheForInvoice(invoice: InvoiceTab | null | undefined): Promise<void> {
    if (!invoice || !invoice.createdDate) {
      return;
    }

    try {
      const parsed = this.timeZoneService.parseApiDate(invoice.createdDate);
      if (isNaN(parsed.getTime())) {
        return;
      }

      const dateKey = this.timeZoneService.formatDateToVietnamString(parsed);
      const year = parsed.getFullYear();
      const month = parsed.getMonth() + 1;
      const monthStr = month.toString().padStart(2, '0');
      const yearStr = year.toString();

      const keys = [
        this.buildReportCacheKey('daily-summary', { date: dateKey }),
        this.buildReportCacheKey('monthly-summary', { year: yearStr, month: monthStr }),
        this.buildReportCacheKey('yearly-summary', { year: yearStr }),
        this.buildReportCacheKey('top-products', { date: dateKey }),
        this.buildReportCacheKey('top-products', { year: yearStr, month: monthStr }),
        this.buildReportCacheKey('top-products', { year: yearStr })
      ];

      await this.invalidateReportCacheKeys(Array.from(new Set(keys)));
    } catch (error) {
      console.error('❌ Lỗi khi xóa cache báo cáo theo hóa đơn:', error);
    }
  }

  private async handleDailySummaryEvent(payload: any): Promise<void> {
    try {
      const date = typeof payload?.date === 'string' ? payload.date : null;
      if (!date) {
        return;
      }

      const summary = payload?.summary ?? {};
      const cacheKey = this.buildReportCacheKey('daily-summary', { date });
      await this.saveReportCacheEntry(cacheKey, summary);
      this.dailySummarySubject.next({ date, summary });
    } catch (error) {
      console.error('❌ Lỗi khi xử lý sự kiện daily_summary:', error);
    }
  }

  private async handleMonthlySummaryEvent(payload: any): Promise<void> {
    try {
      const yearRaw = payload?.year;
      const monthRaw = payload?.month;
      if (yearRaw == null || monthRaw == null) {
        return;
      }

      const yearStr = String(yearRaw);
      const normalizedMonthStr = String(monthRaw).padStart(2, '0');
      const summary = payload?.summary ?? {};

      const cacheKey = this.buildReportCacheKey('monthly-summary', {
        year: yearStr,
        month: normalizedMonthStr
      });
      await this.saveReportCacheEntry(cacheKey, summary);

      this.monthlySummarySubject.next({
        year: Number(yearRaw),
        month: Number(monthRaw),
        summary
      });
    } catch (error) {
      console.error('❌ Lỗi khi xử lý sự kiện monthly_summary:', error);
    }
  }

  private async handleYearlySummaryEvent(payload: any): Promise<void> {
    try {
      const yearRaw = payload?.year;
      if (yearRaw == null) {
        return;
      }

      const yearStr = String(yearRaw);
      const summary = payload?.summary ?? {};
      const cacheKey = this.buildReportCacheKey('yearly-summary', { year: yearStr });
      await this.saveReportCacheEntry(cacheKey, summary);

      this.yearlySummarySubject.next({
        year: Number(yearRaw),
        summary
      });
    } catch (error) {
      console.error('❌ Lỗi khi xử lý sự kiện yearly_summary:', error);
    }
  }

  private async handleTopProductsEvent(payload: any): Promise<void> {
    try {
      const filters = payload?.filters ?? {};
      const products = Array.isArray(payload?.products) ? payload.products : [];

      const sanitizedFilters: Record<string, string> = {};
      const normalizedFilters: Record<string, any> = {};

      if (filters.date) {
        sanitizedFilters['date'] = String(filters.date);
        normalizedFilters['date'] = String(filters.date);
      }

      if (filters.year != null) {
        const yearStr = String(filters.year);
        sanitizedFilters['year'] = yearStr;
        normalizedFilters['year'] = Number(filters.year);
      }

      if (filters.month != null) {
        const monthStr = String(filters.month);
        sanitizedFilters['month'] = monthStr.padStart(2, '0');
        normalizedFilters['month'] = Number(filters.month);
      }

      const cacheKey = this.buildReportCacheKey('top-products', sanitizedFilters);
      await this.saveReportCacheEntry(cacheKey, products);

      this.topProductsSubject.next({
        filters: normalizedFilters,
        products
      });
    } catch (error) {
      console.error('❌ Lỗi khi xử lý sự kiện top_products:', error);
    }
  }

  private async getReportData<T>(
    cacheKey: string,
    fetcher: () => Promise<T>,
    forceRefresh: boolean
  ): Promise<T> {
    if (!forceRefresh) {
      const cached = await this.getCachedReportEntry<T>(cacheKey);
      if (cached) {
        return cached.data;
      }

      const inflight = this.reportCacheInFlight.get(cacheKey) as Promise<T> | undefined;
      if (inflight) {
        return inflight;
      }
    } else {
      this.reportCacheInFlight.delete(cacheKey);
    }

    const fetchPromise = (async (): Promise<T> => {
      const fallback = forceRefresh ? await this.getCachedReportEntry<T>(cacheKey) : undefined;
      try {
        const fresh = await fetcher();
        await this.saveReportCacheEntry(cacheKey, fresh);
        return fresh;
      } catch (error) {
        if (fallback) {
          console.warn(`⚠️ Không thể fetch báo cáo '${cacheKey}', sử dụng dữ liệu cache.`, error);
          return fallback.data;
        }
        throw error;
      }
    })();

    this.reportCacheInFlight.set(cacheKey, fetchPromise);

    try {
      return await fetchPromise;
    } finally {
      this.reportCacheInFlight.delete(cacheKey);
    }
  }

  public async restoreInventoryAfterInvoiceDeletion(invoice: InvoiceTab): Promise<void> {
    if (!invoice || !Array.isArray(invoice.cartItems) || invoice.cartItems.length === 0) {
      return;
    }

    try {
      const products = await this.productService.getAllProductsFromIndexedDB();
      if (!Array.isArray(products) || products.length === 0) {
        console.warn('⚠️ restoreInventoryAfterInvoiceDeletion: không tìm thấy sản phẩm trong IndexedDB');
        return;
      }

      const groupedProducts = this.groupService.group(products as any[]);
      const productMap = new Map<number, Product>();
      for (const product of products as Product[]) {
        if (product && typeof product.Id === 'number') {
          productMap.set(product.Id, product);
        }
      }

      const deltaMap = new Map<number, number>();

      for (const cartItem of invoice.cartItems) {
        const masterUnitId = cartItem.product?.MasterUnitId || cartItem.product?.Id;
        if (masterUnitId == null) {
          continue;
        }

        const group = groupedProducts[Number(masterUnitId)] as Product[] | undefined;
        if (!Array.isArray(group) || group.length === 0) {
          continue;
        }

        const baseConversion = Number(cartItem.product?.ConversionValue) || 1;
        const masterQty = Number(cartItem.quantity ?? 0) * baseConversion;

        for (const variant of group) {
          if (!variant || typeof variant.Id !== 'number') {
            continue;
          }

          const variantConversion = Number((variant as any)?.ConversionValue) || 1;
          if (variantConversion === 0) {
            continue;
          }

          const delta = masterQty / variantConversion;
          const current = deltaMap.get(variant.Id) || 0;
          deltaMap.set(variant.Id, current + delta);
        }
      }

      if (deltaMap.size === 0) {
        console.log('ℹ️ restoreInventoryAfterInvoiceDeletion: không có sản phẩm nào cần hoàn kho');
        return;
      }

      const productsToUpdate: Product[] = [];
      const socketPayload: { Id: number; OnHand: number }[] = [];

      for (const [productId, delta] of deltaMap.entries()) {
        const product = productMap.get(productId);
        if (!product) {
          continue;
        }

        const currentOnHand = Number(product.OnHand ?? 0);
        const newOnHand = currentOnHand + delta;
        const clampedOnHand = Math.max(0, newOnHand);
        productsToUpdate.push({ ...product, OnHand: clampedOnHand });
        socketPayload.push({ Id: productId, OnHand: clampedOnHand });
      }

      try {
        await this.productService.updateProductsOnHandFromInvoiceToFireBase(
          invoice,
          groupedProducts,
          new Set<number>(),
          'increase'
        );
      } catch (firebaseErr) {
        console.error('❌ Lỗi khi hoàn tồn kho lên Firebase:', firebaseErr);
      }

      if (productsToUpdate.length > 0) {
        await this.productService.updateProductsOnHandLocal(productsToUpdate);
        // Backend no longer accepts incoming WS updates; request latest docs via REST polling
        try {
          const ids = productsToUpdate.map(p => p.Id);
          await this.productService.fetchProductsByIds(ids);
        } catch (fetchErr) {
          console.warn('Failed to fetch latest products after restoreInventoryAfterInvoiceDeletion', fetchErr);
        }
      }

      try {
        await this.kiotvietService.updateOnHandFromInvoiceToKiotviet(invoice, groupedProducts, 'increase');
      } catch (kiotErr) {
        console.error('❌ Lỗi khi hoàn tồn kho lên KiotViet:', kiotErr);
      }

      const customerId = invoice.customer?.Id ?? (invoice.customer as any)?.id ?? null;
      if (customerId !== null) {
        try {
          await this.customerService.ensureCustomersSeededFromFirebase(true, true);
        } catch (customerRefreshErr) {
          console.error('❌ Lỗi khi đồng bộ lại dữ liệu khách hàng sau khi xóa hóa đơn:', customerRefreshErr);
        }
      }
    } catch (error) {
      console.error('❌ restoreInventoryAfterInvoiceDeletion thất bại:', error);
    }
  }
  ngOnInit() {
  }
  async initDB(): Promise<void> {
    try {
      const upgradeFn = (db: any) => {
        console.log('Upgrade callback running for DB:', this.dbName, 'version:', this.dbVersion);

        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
          // create index on createdDate for efficient range queries by date
          try {
            store.createIndex('by_createdDate', 'createdDate', { unique: false });
            console.log('Created index by_createdDate on', this.storeName);
          } catch (e) {
            console.warn('Could not create index by_createdDate during upgrade:', e);
          }
          console.log('Created object store:', this.storeName);
        } else {
          console.log(`ℹ️ Object store '${this.storeName}' already exists`);
        }

        if (!db.objectStoreNames.contains('Offline')) {
          db.createObjectStore('Offline', { keyPath: 'id' });
          console.log('Created object store: Offline');
        }

        if (!db.objectStoreNames.contains('SyncMetadata')) {
          db.createObjectStore('SyncMetadata', { keyPath: 'key' });
          console.log('Created object store: SyncMetadata');
        }
      };

      await this.indexedDBService.getDB(this.dbName, this.dbVersion, upgradeFn);
      const connectionInfo = this.indexedDBService.getConnectionInfo(this.dbName);
      if (connectionInfo.version && connectionInfo.version > this.dbVersion) {
        this.dbVersion = connectionInfo.version;
      }

      const stores = await this.indexedDBService.getObjectStoreNames(this.dbName, this.dbVersion);
      const required = [this.storeName, 'Offline', 'SyncMetadata'];
      const missing = required.filter(s => !stores.includes(s));
      if (missing.length > 0) {
        console.warn(`⚠️ Missing stores (${missing.join(',')}) in ${this.dbName}, attempting upgrade`);
        await this.indexedDBService.closeDB(this.dbName);
        const upgradedVersion = this.dbVersion + 1;
        await this.indexedDBService.getDB(this.dbName, upgradedVersion, upgradeFn);
        this.dbVersion = upgradedVersion;
        const postUpgradeStores = await this.indexedDBService.getObjectStoreNames(this.dbName, this.dbVersion);
        const stillMissing = required.filter(s => !postUpgradeStores.includes(s));
        if (stillMissing.length > 0) {
          console.error(`❌ Không thể tạo đầy đủ object stores sau khi nâng cấp: ${stillMissing.join(',')}`);
        }
      }

      console.log('initDB completed for', this.dbName);
    } catch (error) {
      console.error('❌ Error initializing IndexedDB:', error);
    }
  }

  private async initReportsDB(): Promise<void> {
    try {
      const upgradeFn = (db: any) => {
        if (!db.objectStoreNames.contains(this.REPORT_CACHE_STORE)) {
          db.createObjectStore(this.REPORT_CACHE_STORE, { keyPath: 'key' });
        }

        if (!db.objectStoreNames.contains(this.REPORT_FILTER_STORE)) {
          db.createObjectStore(this.REPORT_FILTER_STORE, { keyPath: 'id' });
        }
      };

      await this.indexedDBService.getDB(this.reportsDbName, this.reportsDbVersion, upgradeFn);
      const connectionInfo = this.indexedDBService.getConnectionInfo(this.reportsDbName);
      if (connectionInfo.version && connectionInfo.version > this.reportsDbVersion) {
        this.reportsDbVersion = connectionInfo.version;
      }

      const stores = await this.indexedDBService.getObjectStoreNames(this.reportsDbName, this.reportsDbVersion);
      const required = [this.REPORT_CACHE_STORE, this.REPORT_FILTER_STORE];
      const missing = required.filter(s => !stores.includes(s));
      if (missing.length > 0) {
        console.warn(`⚠️ Missing stores (${missing.join(',')}) in ${this.reportsDbName}, attempting upgrade`);
        await this.indexedDBService.closeDB(this.reportsDbName);
        const upgradedVersion = this.reportsDbVersion + 1;
        await this.indexedDBService.getDB(this.reportsDbName, upgradedVersion, upgradeFn);
        this.reportsDbVersion = upgradedVersion;
      }

    } catch (error) {
      console.error('❌ Error initializing ReportsDB:', error);
    }
  }

  async loadReportFilters(): Promise<ReportFilterPreferences | null> {
    try {
      await this.initReportsDB();
      const existing = await this.indexedDBService.getByKey<ReportFilterPreferences>(
        this.reportsDbName,
        this.reportsDbVersion,
        this.REPORT_FILTER_STORE,
        this.REPORT_FILTER_DOC_ID
      );
      return existing ?? null;
    } catch (error) {
      console.error('❌ Lỗi khi tải bộ lọc báo cáo đã lưu:', error);
      return null;
    }
  }

  async saveReportFilters(partial: Partial<ReportFilterPreferences>): Promise<void> {
    try {
      await this.initReportsDB();
      const current = (await this.loadReportFilters()) ?? { id: this.REPORT_FILTER_DOC_ID };
      const updated: ReportFilterPreferences = {
        ...current,
        ...partial,
        id: this.REPORT_FILTER_DOC_ID
      };
      await this.indexedDBService.put(
        this.reportsDbName,
        this.reportsDbVersion,
        this.REPORT_FILTER_STORE,
        updated
      );
    } catch (error) {
      console.error('❌ Lỗi khi lưu bộ lọc báo cáo:', error);
    }
  }

  async clearReportFilters(): Promise<void> {
    try {
      await this.initReportsDB();
      await this.indexedDBService.delete(
        this.reportsDbName,
        this.reportsDbVersion,
        this.REPORT_FILTER_STORE,
        this.REPORT_FILTER_DOC_ID
      );
    } catch (error) {
      console.error('❌ Lỗi khi xóa bộ lọc báo cáo:', error);
    }
  }

  async getCachedReportData<T>(type: 'daily-summary' | 'monthly-summary' | 'yearly-summary' | 'top-products', params: Record<string, unknown>): Promise<T | undefined> {
    const cacheKey = this.buildReportCacheKey(type, params);
    const entry = await this.getCachedReportEntry<T>(cacheKey);
    return entry?.data as T | undefined;
  }

  public async ensureInvoicesSeededFromFirestore(forceFullSync = false, recentDays?: number): Promise<boolean> {
    try {
      await this.initDB();
      let invoiceCount = 0;
      try {
        invoiceCount = await this.indexedDBService.count(this.dbName, this.dbVersion, this.storeName);
      } catch (err) {
        console.warn('⚠️ Không thể đếm số hóa đơn trong IndexedDB:', err);
        invoiceCount = 0;
      }

      const needsSeed = forceFullSync || invoiceCount === 0;
      if (!needsSeed) {
        return false;
      }

      // If caller explicitly requested a full sync, perform it here.
      // However, when this method is called without forceFullSync (common during UI init),
      // defer network seeding to the caller (e.g., invoices page) so that API calls are
      // initiated from a single, explicit place. This prevents duplicate API calls.
      if (forceFullSync) {
        console.log('🔄 IndexedDB empty or forceFullSync requested, performing full sync from Firestore...');
        await this.syncInvoicesBetweenFirestoreAndIndexedDB(true, recentDays);
        return true;
      }

      // DB is empty but forceFullSync not requested — defer fetching to caller.
      console.log('ℹ️ IndexedDB invoices empty; deferring initial network seed to caller (no automatic fetch)');
      return true;
    } catch (error) {
      console.error('❌ Lỗi khi seed dữ liệu hóa đơn từ Firestore:', error);
      return false;
    }
  }

  // Get last sync timestamp from IndexedDB
  private async getLastSyncTimestamp(): Promise<Date | null> {
    try {
      const metadata = await this.indexedDBService.getByKey<{ timestamp?: string }>(
        this.dbName,
        this.dbVersion,
        'SyncMetadata',
        'lastSync'
      );
      const meta = metadata as { timestamp?: string } | null;
      return meta && meta.timestamp ? new Date(meta.timestamp) : null;
    } catch (error) {
      console.error('❌ Error getting last sync timestamp:', error);
      return null;
    }
  }

  // Save last sync timestamp to IndexedDB
  private async saveLastSyncTimestamp(): Promise<void> {
    try {
      await this.indexedDBService.put(
        this.dbName,
        this.dbVersion,
        'SyncMetadata',
        {
          key: 'lastSync',
          timestamp: new Date().toISOString()
        }
      );
    } catch (error) {
      console.error('❌ Error saving last sync timestamp:', error);
    }
  }

  // Get map of synced dates (YYYY-MM-DD -> ISO timestamp)
  private async getSyncedDatesMap(): Promise<Record<string, string>> {
    try {
      const entry = await this.indexedDBService.getByKey<{ dates?: Record<string, string> }>(
        this.dbName,
        this.dbVersion,
        'SyncMetadata',
        'syncedDates'
      );
      return (entry && entry.dates) ? entry.dates : {};
    } catch (err) {
      console.warn('⚠️ Error reading synced dates map:', err);
      return {};
    }
  }

  private async saveSyncedDatesMap(map: Record<string, string>): Promise<void> {
    try {
      await this.indexedDBService.put(
        this.dbName,
        this.dbVersion,
        'SyncMetadata',
        { key: 'syncedDates', dates: map }
      );
    } catch (err) {
      console.warn('⚠️ Error saving synced dates map:', err);
    }
  }

  // Check whether a particular date (YYYY-MM-DD) has been synced and stored locally
  async isDateSynced(dateKey: string): Promise<boolean> {
    try {
      const map = await this.getSyncedDatesMap();
      return !!map[dateKey];
    } catch (err) {
      return false;
    }
  }

  // Mark a date as synced (save current timestamp)
  private async markDateSynced(dateKey: string): Promise<void> {
    try {
      const map = await this.getSyncedDatesMap();
      map[dateKey] = new Date().toISOString();
      await this.saveSyncedDatesMap(map);
    } catch (err) {
      console.warn('⚠️ Error marking date as synced:', err);
    }
  }

  // Optimized sync method that only fetches recent changes
  async syncInvoicesBetweenFirestoreAndIndexedDB(forceFullSync = false, recentDays?: number): Promise<void> {
    if (this.syncInProgress) {
      console.log('⚠️ Sync already in progress, skipping...');
      return;
    }

    this.syncInProgress = true;
    try {
      console.log('🔄 Starting sync with server...');

      // Đảm bảo IndexedDB đã được khởi tạo
      await this.initDB();

      const lastSync = await this.getLastSyncTimestamp();
      console.log(`🔄 Starting sync from ${lastSync ? lastSync.toISOString() : 'beginning'}`);

      // Nếu forceFullSync hoặc IndexedDB rỗng, luôn lấy lại toàn bộ hóa đơn từ Firestore
      const indexedDBInvoices: InvoiceTab[] = await this.indexedDBService.getAll<InvoiceTab>(
        this.dbName,
        this.dbVersion,
        this.storeName
      );

      if (forceFullSync || indexedDBInvoices.length === 0) {
        if (recentDays && recentDays > 0) {
          console.log(`🔄 Force partial sync - lấy hóa đơn ${recentDays} ngày gần nhất từ Firestore`);
          await this.performPartialInitialSync(recentDays);
          return;
        }
        console.log('🔄 Force full sync - lấy lại toàn bộ hóa đơn từ Firestore');
        await this.performInitialSync();
        return;
      }

      // Backend no longer accepts incoming WebSocket events. Always perform minimal sync via REST.
      console.log('🔄 Performing minimal sync (websocket support removed)');
      await this.performMinimalSync(lastSync);
      await this.saveLastSyncTimestamp();
      this.lastSyncTimestamp = new Date();
      this.syncCompletedSubject.next();

    } catch (error) {
      console.error('❌ Error during sync:', error);
      throw error; // Re-throw để component có thể xử lý
    } finally {
      this.syncInProgress = false;
    }
  }

  // Initial sync - only called when IndexedDB is empty
  async performInitialSync(days?: number): Promise<void> {
    const targetDays = typeof days === 'number' && days > 0 ? days : this.DEFAULT_INITIAL_SYNC_DAYS;
    console.log(`🔄 Performing initial sync by fetching last ${targetDays} days from Firestore...`);
    await this.performPartialInitialSync(targetDays);
  }

  // Partial initial sync: fetch invoices for the last `days` days (inclusive)
  private async performPartialInitialSync(days: number): Promise<void> {
    try {
      const normalizedDays = Math.max(1, Math.floor(days));
      console.log(`🔄 Performing partial initial sync for last ${normalizedDays} days...`);
      const allFetched: any[] = [];

      for (let i = 0; i < normalizedDays; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0]; // YYYY-MM-DD
        try {
          const resp = await firstValueFrom(this.getInvoicesByDateFromFirestore(dateStr).pipe(catchError(err => {
            console.warn(`⚠️ Error fetching invoices for ${dateStr}:`, err);
            return of([]);
          })));

          const items = Array.isArray(resp) ? resp : (resp && resp.data && Array.isArray(resp.data) ? resp.data : []);
          if (items.length > 0) {
            console.log(`🔎 Fetched ${items.length} invoices for ${dateStr}`);
            allFetched.push(...items);
          }
        } catch (err) {
          console.warn(`⚠️ Exception fetching invoices for ${dateStr}:`, err);
        }
      }

      const validInvoices = allFetched.filter((inv: any) => inv && inv.id) as InvoiceTab[];
      if (validInvoices.length > 0) {
        await this.indexedDBService.putMany(this.dbName, this.dbVersion, this.storeName, validInvoices);
        console.log(`✅ Partial initial sync completed: ${validInvoices.length} invoices loaded`);
      } else {
        console.log('ℹ️ No invoices fetched during partial initial sync');
      }

      await this.saveLastSyncTimestamp();
      this.lastSyncTimestamp = new Date();
      this.syncCompletedSubject.next();

    } catch (error) {
      console.error('❌ Error during partial initial sync:', error);
      throw error;
    }
  }

  // Minimal sync - only fetch recent changes
  private async performMinimalSync(lastSync: Date | null): Promise<void> {
    try {
      console.log('🔄 Performing minimal sync...');

      if (!lastSync) {
        // If no last sync, do initial sync
        console.log('🔄 No last sync timestamp, performing initial sync');
        await this.performInitialSync();
        return;
      }

      // Check if we have recent local changes that need to be pushed to Firestore
      const localInvoices = await this.getAllInvoicesFromDB();
      const recentLocalChanges = localInvoices.filter(invoice => {
        if (!invoice) {
          return false;
        }

        const hasItems = Array.isArray((invoice as any).cartItems) && (invoice as any).cartItems.length > 0;
        if (!hasItems) {
          return false;
        }

        const invoiceDate = new Date(invoice.createdDate || 0);
        return invoiceDate > lastSync;
      });

      if (recentLocalChanges.length > 0) {
        console.log(`🔄 Found ${recentLocalChanges.length} recent local changes, pushing to Firestore`);
        // Push recent changes to Firestore
        for (const invoice of recentLocalChanges) {
          try {
            await firstValueFrom(this.addInvoiceToFirestore(invoice));
            console.log(`✅ Pushed invoice ${invoice.id} to Firestore`);
            await this.ensureInvoiceOnHandSynced(invoice, undefined, { localOnly: true });
          } catch (error) {
            console.error(`❌ Failed to push invoice ${invoice.id} to Firestore:`, error);
          }
        }
      } else {
        console.log('ℹ️ No recent local changes to sync');
      }

      // Update sync timestamp
      await this.saveLastSyncTimestamp();
      this.lastSyncTimestamp = new Date();
      this.syncCompletedSubject.next();

      console.log('✅ Minimal sync completed');

    } catch (error) {
      console.error('❌ Error during minimal sync:', error);
      throw error;
    }
  }

  // API Methods - giữ nguyên
  addInvoiceToFirestore(invoiceData: any): Observable<any> {
    // Gửi dữ liệu hóa đơn lên Firestore qua API backend
    return this.http.post(`${environment.domainUrl}${this.firebaseService.post_add_invoice}`, invoiceData);
  }

  updateInvoiceToFirestore(invoiceID: string, invoiceData: any): Observable<any> {
    // Gửi dữ liệu hóa đơn lên Firestore qua API backend
    return this.http.put(`${environment.domainUrl}${this.firebaseService.put_update_invoice}${invoiceID}`, invoiceData);
  }
  // Xóa hóa đơn khỏi Firestore qua API backend
  deleteInvoiceToFirestore(invoiceId: string): Observable<any> {
    return this.http.delete(`${environment.domainUrl}${this.firebaseService.delete_del_invoice}${invoiceId}`);
  }
  // Lấy hóa đơn theo ID từ API
  getInvoiceByIdFromFirestore(invoiceId: string): Observable<any> {
    return this.http.get(`${environment.domainUrl}${this.firebaseService.get_invoice_by_id}${invoiceId}`);
  }

  // Lấy hóa đơn theo ngày từ API
  getInvoicesByDateFromFirestore(date: string): Observable<any> {
    const url = `${environment.domainUrl}${this.firebaseService.get_invoice_by_date}`;
    try {
      console.log('[InvoiceService] getInvoicesByDateFromFirestore ->', { url, date });
    } catch (e) {
      // swallow logging errors in environments that may not support console
    }

    return this.http.get(url, { params: { date } });
  }

  // Lấy hóa đơn theo khách hàng từ API
  getInvoicesByCustomerFromFirestore(customer: string): Observable<any> {
    return this.http.get(`${environment.domainUrl}/api/firebase/invoices/customer/${customer}`);
  }

  // IndexedDB Methods - CRUD operations
  async getInvoiceFromDBById(id: string): Promise<InvoiceTab | undefined> {
    await this.initDB();
    return await this.indexedDBService.getByKey(
      this.dbName,
      this.dbVersion,
      this.storeName,
      id
    );
  }

  async getAllInvoicesFromDB(): Promise<InvoiceTab[]> {
    await this.initDB();
    return await this.indexedDBService.getAll(
      this.dbName,
      this.dbVersion,
      this.storeName
    );
  }

  async addInvoiceToDB(invoice: InvoiceTab): Promise<void> {
    await this.initDB();
    await this.indexedDBService.put(
      this.dbName,
      this.dbVersion,
      this.storeName,
      invoice
    );
    await this.invalidateReportCacheForInvoice(invoice);
  }

  async updateInvoiceInDB(invoice: InvoiceTab): Promise<void> {
    await this.initDB();
    await this.indexedDBService.put(
      this.dbName,
      this.dbVersion,
      this.storeName,
      invoice
    );
    await this.invalidateReportCacheForInvoice(invoice);
  }

  async deleteInvoiceFromDB(id: string): Promise<void> {
    await this.initDB();
    const existing = await this.getInvoiceFromDBById(id);
    await this.indexedDBService.delete(
      this.dbName,
      this.dbVersion,
      this.storeName,
      id
    );
    if (existing) {
      await this.invalidateReportCacheForInvoice(existing);
    }
  }

  async clearAllInvoicesFromDB(): Promise<void> {
    await this.initDB();
    await this.indexedDBService.clear(
      this.dbName,
      this.dbVersion,
      this.storeName
    );
  }

  /**
   * Replace all invoices for a specific date in a single transaction.
   * This is much faster than deleting/inserting one-by-one because it
   * performs all operations within the same IDB transaction.
   */
  async replaceInvoicesForDate(date: Date, invoices: InvoiceTab[], options?: { invalidateReportCache?: boolean }): Promise<void> {
    await this.initDB();
    try {
      const db = await this.indexedDBService.getDB(this.dbName, this.dbVersion);

      const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
      const startOfNextDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

      // Use ISO strings for lexicographic range queries (ISO order matches chronological order)
      const startISO = startOfDay.toISOString();
      const endISO = startOfNextDay.toISOString();

      const tx = db.transaction(this.storeName, 'readwrite');

      // If index exists, use it to only iterate records in the date range (fast). Otherwise fall back to full scan.
      try {
        const store = tx.store;
        const hasIndex = (store as any).indexNames && (store as any).indexNames.contains && (store as any).indexNames.contains('by_createdDate');
        if (hasIndex) {
          const idx = store.index('by_createdDate');
          let cursor = await idx.openCursor(IDBKeyRange.bound(startISO, endISO, false, true));
          while (cursor) {
            try {
              await cursor.delete();
            } catch (err) {
              console.warn('⚠️ Error deleting invoice via index cursor during replace:', err);
            }
            cursor = await cursor.continue();
          }
        } else {
          // Full scan fallback
          let cursor = await store.openCursor();
          while (cursor) {
            try {
              const current = cursor.value as InvoiceTab;
              if (current && current.createdDate) {
                const d = new Date(current.createdDate);
                if (d >= startOfDay && d < startOfNextDay) {
                  await cursor.delete();
                }
              }
            } catch (err) {
              console.warn('⚠️ Error while deleting invoice during replace (fallback):', err);
            }
            cursor = await cursor.continue();
          }
        }

        // Insert new invoices in the same transaction using put
        for (const inv of invoices || []) {
          try {
            await tx.store.put(inv as any);
          } catch (putErr) {
            console.warn('⚠️ Error while putting invoice during replace:', putErr);
          }
        }

        await tx.done;
      } catch (cursorErr) {
        // If something goes wrong with cursor/index iteration, abort transaction and rethrow
        try { tx.abort(); } catch(_) {}
        throw cursorErr;
      }

      // Batch-invalidate report cache for this date (ReportsCache is used by report-page)
      // Allow callers to skip cache invalidation via options (e.g., invoices-page manual sync should not affect report cache)
      const shouldInvalidate = options?.invalidateReportCache !== false;
      if (shouldInvalidate) {
        try {
          // Compute the set of keys we need to invalidate based on the date range
          const parsed = new Date(startOfDay);
          const dateKey = this.timeZoneService.formatDateToVietnamString(parsed);
          const year = parsed.getFullYear();
          const month = parsed.getMonth() + 1;
          const monthStr = month.toString().padStart(2, '0');
          const yearStr = year.toString();

          const keys = [
            this.buildReportCacheKey('daily-summary', { date: dateKey }),
            this.buildReportCacheKey('monthly-summary', { year: yearStr, month: monthStr }),
            this.buildReportCacheKey('yearly-summary', { year: yearStr }),
            this.buildReportCacheKey('top-products', { date: dateKey }),
            this.buildReportCacheKey('top-products', { year: yearStr, month: monthStr }),
            this.buildReportCacheKey('top-products', { year: yearStr })
          ];

          const uniqueKeys = Array.from(new Set(keys));
          await this.invalidateReportCacheKeys(uniqueKeys);
        } catch (cacheErr) {
          console.warn('⚠️ Error invalidating report cache after replace (batched):', cacheErr);
        }
      }
      // Mark date as synced in metadata so the UI can avoid re-fetching the same date
      try {
        const parsed = new Date(startOfDay);
        const dateKey = this.timeZoneService.formatDateToVietnamString(parsed);
        await this.markDateSynced(dateKey);
      } catch (err) {
        console.warn('⚠️ Error marking date as synced after replace:', err);
      }
    } catch (error) {
      console.error('❌ replaceInvoicesForDate failed:', error);
      throw error;
    }
  }

  // Utility methods
  async searchInvoicesInDB(query: string): Promise<InvoiceTab[]> {
    await this.initDB();
    const allInvoices = await this.getAllInvoicesFromDB();

    if (!query || query.trim() === '') {
      return allInvoices;
    }

    const searchTerm = query.toLowerCase().trim();

    return allInvoices.filter(invoice =>
      invoice.id?.toLowerCase().includes(searchTerm) ||
      invoice.customer?.Name?.toLowerCase().includes(searchTerm)
    );
  }

  async getInvoicesByDateFromDB(date: Date): Promise<InvoiceTab[]> {
    await this.initDB();
    const allInvoices = await this.getAllInvoicesFromDB();
    console.log('Total invoices in DB:', allInvoices.length);

    // Tạo ngày bắt đầu và kết thúc của ngày được chọn
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const result = allInvoices.filter(invoice => {
      if (!invoice.createdDate) {
        return false;
      }

      try {
        const invoiceDate = new Date(invoice.createdDate);
        if (isNaN(invoiceDate.getTime())) {
          return false;
        }
        const isInRange = invoiceDate >= startOfDay && invoiceDate <= endOfDay;
        return isInRange;
      } catch (error) {
        console.error('Error parsing date for invoice:', invoice.id, error);
        return false;
      }
    });

    return result;
  }

  async getInvoicesByCustomerFromDB(customerName: string): Promise<InvoiceTab[]> {
    await this.initDB();
    const allInvoices = await this.getAllInvoicesFromDB();

    return allInvoices.filter(invoice =>
      invoice.customer?.Name.toLowerCase().includes(customerName.toLowerCase())
    );
  }

  // Hybrid methods - combine API and IndexedDB
  async getInvoiceHybrid(id: string, useCache = true): Promise<InvoiceTab | any> {
    if (useCache) {
      // Thử lấy từ IndexedDB trước
      const cachedInvoice = await this.getInvoiceFromDBById(id);
      if (cachedInvoice) {
        return cachedInvoice;
      }
    }

    // Nếu không có trong cache hoặc không dùng cache, lấy từ API
    try {
      const apiInvoice = await firstValueFrom(this.getInvoiceByIdFromFirestore(id));

      // Lưu vào cache nếu lấy được từ API
      if (apiInvoice) {
        await this.addInvoiceToDB(apiInvoice);
      }

      return apiInvoice;
    } catch (error) {
      console.error('Lỗi khi lấy hóa đơn từ API:', error);
      // Fallback về cache nếu API lỗi
      return await this.getInvoiceFromDBById(id);
    }
  }

  // API tổng hợp mới
  getDailySummary(date: string, forceRefresh = false): Observable<any> {
    const cacheKey = this.buildReportCacheKey('daily-summary', { date });
    const fetcher = async () => {
      const result = await firstValueFrom(
        this.http.get<any>(`${environment.domainUrl}${this.firebaseService.get_revenue_by_daily}`, {
          params: { date }
        })
      );
      return result ?? {};
    };

    return from(this.getReportData(cacheKey, fetcher, forceRefresh));
  }

  getMonthlySummary(year: number, month: number, forceRefresh = false): Observable<any> {
    const params = {
      year: year.toString(),
      month: month.toString().padStart(2, '0')
    };
    const cacheKey = this.buildReportCacheKey('monthly-summary', params);
    const fetcher = async () => {
      const result = await firstValueFrom(
        this.http.get<any>(`${environment.domainUrl}${this.firebaseService.get_revenue_by_monthly}`, {
          params
        })
      );
      return result ?? {};
    };

    return from(this.getReportData(cacheKey, fetcher, forceRefresh));
  }

  getYearlySummary(year: number, forceRefresh = false): Observable<any> {
    const params = { year: year.toString() };
    const cacheKey = this.buildReportCacheKey('yearly-summary', params);
    const fetcher = async () => {
      const result = await firstValueFrom(
        this.http.get<any>(`${environment.domainUrl}${this.firebaseService.get_revenue_by_yearly}`, {
          params
        })
      );
      return result ?? {};
    };

    return from(this.getReportData(cacheKey, fetcher, forceRefresh));
  }

  getTopSellProducts(
    params: { date?: string; year?: number; month?: number },
    forceRefresh = false
  ): Observable<any[]> {
    const sanitizedParams: Record<string, string> = {};
    if (params.date) {
      sanitizedParams['date'] = params.date;
    }
    if (params.year !== undefined) {
      sanitizedParams['year'] = params.year.toString();
    }
    if (params.month !== undefined) {
      sanitizedParams['month'] = params.month.toString().padStart(2, '0');
    }

    const cacheKey = this.buildReportCacheKey('top-products', sanitizedParams);
    const fetcher = async () => {
      const raw = await firstValueFrom(
        this.http.get<any[]>(`${environment.domainUrl}${this.firebaseService.get_top_sell_products}`, {
          params: sanitizedParams
        })
      );
      return Array.isArray(raw) ? raw : [];
    };

    return from(this.getReportData(cacheKey, fetcher, forceRefresh));
  }

  // Offline Methods
  async saveInvoiceToOffline(invoice: InvoiceTab): Promise<void> {
    await this.initDB();
    const payload: InvoiceTab = {
      ...invoice,
      onHandSynced: Boolean(invoice.onHandSynced)
    };

    await this.indexedDBService.put(
      this.dbName,
      this.dbVersion,
      'Offline',
      payload
    );
  }

  async getAllOfflineInvoices(): Promise<InvoiceTab[]> {
    await this.initDB();
    return await this.indexedDBService.getAll(
      this.dbName,
      this.dbVersion,
      'Offline'
    );
  }

  async deleteOfflineInvoice(id: string): Promise<void> {
    await this.initDB();
    await this.indexedDBService.delete(
      this.dbName,
      this.dbVersion,
      'Offline',
      id
    );
  }

  async markOfflineInvoiceOnHandSynced(invoiceId: string, synced = true): Promise<void> {
    if (!invoiceId) {
      return;
    }

    try {
      await this.initDB();
      const existing = await this.indexedDBService.getByKey<InvoiceTab>(
        this.dbName,
        this.dbVersion,
        'Offline',
        invoiceId
      );

      if (existing) {
        existing.onHandSynced = synced;
        await this.indexedDBService.put(
          this.dbName,
          this.dbVersion,
          'Offline',
          existing
        );
      }
    } catch (error) {
      console.error(`❌ Lỗi khi cập nhật trạng thái onHandSynced cho invoice offline ${invoiceId}:`, error);
    }
  }

  async ensureInvoiceOnHandSynced(
    invoice: InvoiceTab,
    groupedProductsOverride?: Record<number, any[]>,
    options?: { localOnly?: boolean }
  ): Promise<boolean> {
    if (!invoice || !Array.isArray(invoice.cartItems) || invoice.cartItems.length === 0) {
      return false;
    }

    if (invoice.onHandSynced && !options?.localOnly) {
      return false;
    }

    let groupedProducts: Record<number, Product[]>;
    if (groupedProductsOverride && Object.keys(groupedProductsOverride).length > 0) {
      groupedProducts = groupedProductsOverride as Record<number, Product[]>;
    } else {
      groupedProducts = await this.getGroupedProductsSnapshot();
    }

    try {
      await this.productService.updateProductsOnHandFromInvoiceToFireBase(
        invoice,
        groupedProducts as any,
        new Set<number>(),
        'decrease',
        undefined,
        { skipRemote: options?.localOnly === true }
      );
      invoice.onHandSynced = true;
      await this.markOfflineInvoiceOnHandSynced(invoice.id, true);
      return true;
    } catch (error) {
      console.error(`❌ Lỗi khi sync tồn kho cho invoice ${invoice.id}:`, error);
      return false;
    }
  }

  private async getGroupedProductsSnapshot(forceRefresh = false): Promise<Record<number, Product[]>> {
    const now = Date.now();
    if (!forceRefresh && this.groupedProductsCache && (now - this.groupedProductsCacheTimestamp) < this.GROUPED_PRODUCTS_CACHE_TTL) {
      return this.groupedProductsCache;
    }

    const allProducts = await this.productService.getAllProductsFromIndexedDB();
    const grouped = this.groupService.group(allProducts as any[]) as Record<number, Product[]>;
    this.groupedProductsCache = grouped;
    this.groupedProductsCacheTimestamp = now;
    return grouped;
  }

  // Socket.IO removed. Kept a no-op initializer for API compatibility.
  private async initializeSocketIfNeeded(): Promise<void> {
    // No-op: backend no longer accepts incoming websocket updates for invoices.
    return Promise.resolve();
  }

  // Server-originated WebSocket events are not subscribed to by the client
  // since the backend no longer accepts incoming websocket updates. Use
  // polling / REST fetch endpoints (e.g., `getInvoicesByDateFromFirestore`,
  // `getInvoiceByIdFromFirestore`) to refresh server-authoritative data.

  

  private async handleInvoiceCreated(invoice: InvoiceTab): Promise<void> {
    try {
      console.log('🆕 Real-time: Received invoice created event:', invoice);

      // Kiểm tra xem hóa đơn đã tồn tại trong IndexedDB chưa
      const existing = await this.indexedDBService.getByKey(this.dbName, this.dbVersion, this.storeName, invoice.id);

      if (!existing) {
        // Thêm hóa đơn mới vào IndexedDB
        await this.indexedDBService.put(this.dbName, this.dbVersion, this.storeName, invoice);
        console.log(`✅ Real-time: Đã thêm hóa đơn ${invoice.id} vào IndexedDB`);

        // === Build groupedProducts from all products in IndexedDB ===
        const allProducts: any[] = await this.productService.getAllProductsFromIndexedDB();
        const groupedProducts = this.groupService.group(allProducts);


        // === Build currentOnHandMap for all involved productIds ===
        const productIds = new Set<number>();
        for (const cartItem of invoice.cartItems) {
          const masterUnitId = cartItem.product.MasterUnitId || cartItem.product.Id;
          const group = groupedProducts[masterUnitId];
          if (group) {
            group.forEach(product => productIds.add(product.Id));
          }
        }
        const currentOnHandMap: Record<number, number> = {};
        for (const productId of productIds) {
          const product = await this.productService.getProductByIdFromIndexedDB(productId);
          if (product) {
            currentOnHandMap[productId] = product.OnHand;
          }
        }

        // === Calculate updates for each product in group ===
        const updates: Record<number, number> = {};
        for (const cartItem of invoice.cartItems) {
          const masterUnitId = cartItem.product.MasterUnitId || cartItem.product.Id;
          const group = groupedProducts[masterUnitId];
          if (!group) continue;
          const masterQty = cartItem.quantity * cartItem.product.ConversionValue;
          for (const product of group) {
            const minus = masterQty / product.ConversionValue;
            updates[product.Id] = (updates[product.Id] || 0) + minus;
          }
        }

        // === Update OnHand for each product in IndexedDB ===
        for (const productIdStr of Object.keys(updates)) {
          const productId = Number(productIdStr);
          try {
            const dbName = 'SalesDB';
            const dbVersion = 3; // Synchronized with CategoryService version
            const storeName = 'products';
            const existingProduct = await this.productService.getProductByIdFromIndexedDB(productId);
            if (existingProduct) {
              const oldOnHand = currentOnHandMap[productId] ?? existingProduct.OnHand ?? 0;
              existingProduct.OnHand = oldOnHand - updates[productId];
              await this.productService.updateProductFromIndexedDB(existingProduct);
              console.log(`✅ Real-time: Đã cập nhật OnHand cho sản phẩm ${productId} (${existingProduct.FullName || existingProduct.Name || ''}) = ${existingProduct.OnHand}`);
            }
          } catch (err) {
            console.error(`❌ Lỗi khi cập nhật OnHand cho sản phẩm ${productId}:`, err);
          }
        }

        // Emit event để components có thể cập nhật UI
        this.invoiceCreatedSubject.next(invoice);
      } else {
        console.log(`ℹ️ Real-time: Hóa đơn ${invoice.id} đã tồn tại trong IndexedDB`);
      }

      await this.invalidateReportCacheForInvoice(invoice);
    } catch (error) {
      console.error(`❌ Error handling invoice created:`, error);
    }
  }

  private async handleInvoiceUpdated(invoice: InvoiceTab): Promise<void> {
    try {
      console.log('🔄 Real-time: Received invoice updated event:', invoice);

      const existing = await this.indexedDBService.getByKey<InvoiceTab>(this.dbName, this.dbVersion, this.storeName, invoice.id);

      // Cập nhật hóa đơn trong IndexedDB
      await this.indexedDBService.put(this.dbName, this.dbVersion, this.storeName, invoice);
      console.log(`✅ Real-time: Đã cập nhật hóa đơn ${invoice.id} trong IndexedDB`);

      await this.invalidateReportCacheForInvoice(invoice);
      if (existing && existing.createdDate !== invoice.createdDate) {
        await this.invalidateReportCacheForInvoice(existing);
      }

      // Emit event để components có thể cập nhật UI
      this.invoiceUpdatedSubject.next(invoice);
    } catch (error) {
      console.error(`❌ Error handling invoice updated:`, error);
    }
  }

  private async handleInvoiceDeleted(invoiceId: string): Promise<void> {
    try {
      console.log('🗑️ Real-time: Received invoice deleted event:', invoiceId);

      const existing = await this.indexedDBService.getByKey<InvoiceTab>(this.dbName, this.dbVersion, this.storeName, invoiceId);

      // Xóa hóa đơn khỏi IndexedDB
      await this.indexedDBService.delete(this.dbName, this.dbVersion, this.storeName, invoiceId);
      console.log(`✅ Real-time: Đã xóa hóa đơn ${invoiceId} khỏi IndexedDB`);

      if (existing) {
        await this.invalidateReportCacheForInvoice(existing);
      }

      // Emit event để components có thể cập nhật UI
      this.invoiceDeletedSubject.next(invoiceId);
    } catch (error) {
      console.error(`❌ Error handling invoice deleted:`, error);
    }
  }

  private async handleSyncRequest(data: any): Promise<void> {
    // Socket-based sync requests are no longer supported. Trigger a local
    // sync-completed notification so callers can reconcile if needed.
    try {
      const localInvoices = await this.getAllInvoicesFromDB();
      this.syncCompletedSubject.next();
    } catch (error) {
      console.error(`❌ Error handling sync request (REST mode):`, error);
      this.syncCompletedSubject.next();
    }
  }

  private async sendSocketMessage(event: string, data: any): Promise<void> {
    // WebSocket removed. Kept for compatibility but will not send socket messages.
    console.info('sendSocketMessage called — websockets removed; no-op');
    return Promise.resolve();
  }

  // Public method để gửi thông báo tạo hóa đơn mới
  public async notifyInvoiceCreated(invoice: InvoiceTab): Promise<void> {
    try {
      const resp = await firstValueFrom(this.addInvoiceToFirestore(invoice).pipe(catchError(err => of(err))));
      const createdId = resp && (resp.id || resp.data?.id || resp.insertedId || resp.name);
      if (createdId) {
        try {
          const serverInvoice = await firstValueFrom(this.getInvoiceByIdFromFirestore(createdId).pipe(catchError(err => of(null))));
          if (serverInvoice) {
            await this.addInvoiceToDB(serverInvoice as InvoiceTab);
            this.invoiceCreatedSubject.next(serverInvoice as InvoiceTab);
            return;
          }
        } catch {}
      }
      await this.addInvoiceToDB(invoice);
      this.invoiceCreatedSubject.next(invoice);
    } catch (error) {
      console.error('❌ Error notifying invoice created (REST fallback):', error);
      await this.addInvoiceToDB(invoice);
      this.invoiceCreatedSubject.next(invoice);
    }
  }

  // Public method để gửi thông báo cập nhật hóa đơn
  public async notifyInvoiceUpdated(invoice: InvoiceTab): Promise<void> {
    try {
      if (!invoice || !invoice.id) {
        await this.updateInvoiceInDB(invoice as InvoiceTab);
        this.invoiceUpdatedSubject.next(invoice as InvoiceTab);
        return;
      }
      await firstValueFrom(this.updateInvoiceToFirestore(invoice.id as string, invoice).pipe(catchError(err => of(err))));
      try {
        const serverInvoice = await firstValueFrom(this.getInvoiceByIdFromFirestore(invoice.id as string).pipe(catchError(err => of(null))));
        if (serverInvoice) {
          await this.updateInvoiceInDB(serverInvoice as InvoiceTab);
          this.invoiceUpdatedSubject.next(serverInvoice as InvoiceTab);
          return;
        }
      } catch {}
      await this.updateInvoiceInDB(invoice as InvoiceTab);
      this.invoiceUpdatedSubject.next(invoice as InvoiceTab);
    } catch (error) {
      console.error('❌ Error notifying invoice updated (REST fallback):', error);
      await this.updateInvoiceInDB(invoice as InvoiceTab);
      this.invoiceUpdatedSubject.next(invoice as InvoiceTab);
    }
  }

  // Public method để gửi thông báo xóa hóa đơn
  public async notifyInvoiceDeleted(invoiceId: string): Promise<void> {
    // NOTE: This method no longer performs the remote DELETE.
    // Components that originate a deletion should call `deleteInvoiceToFirestore` themselves
    // and then call this notifier to emit the deletion and perform local cleanup.
    try {
      try {
        await this.deleteInvoiceFromDB(invoiceId);
      } catch (dbErr) {
        // If local delete fails, continue and still emit notification so UI updates.
        console.warn('⚠️ notifyInvoiceDeleted: failed to delete locally:', dbErr);
      }

      // Emit event so other parts of the app can react to deletion
      this.invoiceDeletedSubject.next(invoiceId);
    } catch (error) {
      console.error('❌ Error in notifyInvoiceDeleted:', error);
      // Still emit to ensure UI consistency
      try { this.invoiceDeletedSubject.next(invoiceId); } catch {}
    }
  }

  // Socket control removed: backend no longer accepts incoming websocket events.
  // The following methods are retained as no-ops so callers remain safe.
  public disconnectSocket(): void {
    // No-op: socket support removed
  }

  public async initializeWebSocket(): Promise<void> {
    // No-op: socket support removed
    console.log('ℹ️ initializeWebSocket called — websockets removed on server; no-op');
  }

  public isWebSocketConnected(): boolean {
    // WebSocket support removed — always return false
    return false;
  }

  public getWebSocketStatus(): { connected: boolean; initialized: boolean; socketExists: boolean } {
    return { connected: false, initialized: false, socketExists: false };
  }
}
  // Socket initialization and listeners removed — backend no longer accepts incoming websocket events.
  // Rely on REST endpoints and polling/fetch helpers for sync.