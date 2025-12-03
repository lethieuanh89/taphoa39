import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { Customer } from '../models/customer.model';
import { InvoiceTab } from '../models/invoice.model';
import { catchError, of, firstValueFrom, throwError, Observable, Subject, BehaviorSubject } from 'rxjs';
import { IndexedDBService } from './indexed-db.service';
import { KiotvietService } from '../services/kiotviet.service';
import { FirebaseService } from '../services/firebase.service';
// WebSocket client removed — backend no longer accepts incoming websocket updates
@Injectable({
  providedIn: 'root'
})
export class CustomerService {
  private dbName = 'Client';
  private dbVersion = 1;
  private storeName = 'customers';
  get_all_customers_from_kiotviet = "/api/kiotviet/customers";
  get_customer_all_invoices_from_firebase = "/api/firebase/customers/invoices/";//+ <customer_id>
  get_all_customers_firebase = "/api/firebase/get/customers";
  private customerInvoicesCache = new Map<string, { timestamp: number; data: InvoiceTab[] }>();
  private readonly CUSTOMER_INVOICE_CACHE_DURATION = 2 * 60 * 1000; // 2 minutes
  private readonly CUSTOMER_SOCKET_NAMESPACE = '/api/websocket/customers';
  private readonly CUSTOMER_SOCKET_PATH = '/api/websocket/socket.io';
  private readonly CUSTOMER_MAX_RECONNECT_ATTEMPTS = 5;
  private readonly CUSTOMER_RECONNECT_DELAY = 2000;


  private customersUpdatedSubject = new Subject<void>();
  public customersUpdated$ = this.customersUpdatedSubject.asObservable();

  private customerConnectionSubject = new BehaviorSubject<boolean>(false);
  public customerConnection$ = this.customerConnectionSubject.asObservable();

  private customerSeedInFlight: Promise<void> | null = null;
  private customerDbReady = false;
  private ensureCustomerDbPromise: Promise<void> | null = null;
  
  constructor(
    private http: HttpClient,
    private indexedDBService: IndexedDBService,
    private kiotvietService: KiotvietService,
    private firebaseService: FirebaseService
  ) {
  }

  private async ensureCustomerDbInitialized(): Promise<void> {
    if (this.customerDbReady && this.indexedDBService.isConnectionOpen(this.dbName)) {
      return;
    }

    if (this.ensureCustomerDbPromise) {
      await this.ensureCustomerDbPromise;
      return;
    }

    this.ensureCustomerDbPromise = (async () => {
      try {
        await this.initDB();
        this.customerDbReady = true;
      } catch (error) {
        this.customerDbReady = false;
        throw error;
      } finally {
        this.ensureCustomerDbPromise = null;
      }
    })();

    await this.ensureCustomerDbPromise;
  }

  async ensureCustomersSeededFromFirebase(forceRefresh = false, emitUpdate = false): Promise<void> {
    await this.ensureCustomerDbInitialized();

    if (this.customerSeedInFlight) {
      if (forceRefresh) {
        try {
          await this.customerSeedInFlight;
        } finally {
          this.customerSeedInFlight = null;
        }
      } else {
        await this.customerSeedInFlight;
        return;
      }
    }

    const seedPromise = this.performCustomerSeed(forceRefresh, emitUpdate)
      .catch((error) => {
        console.error('❌ Lỗi khi đồng bộ khách hàng từ Firebase:', error);
        throw error;
      })
      .finally(() => {
        this.customerSeedInFlight = null;
      });

    this.customerSeedInFlight = seedPromise;
    await seedPromise;
  }

  private async performCustomerSeed(forceRefresh = false, emitUpdate = false): Promise<void> {
    await this.ensureCustomerDbInitialized();

    const remoteCustomers = await this.fetchCustomersFromFirebase(forceRefresh);

    if (!remoteCustomers || remoteCustomers.length === 0) {
      console.warn('⚠️ Không nhận được dữ liệu khách hàng từ Firebase, giữ nguyên dữ liệu IndexedDB hiện tại.');
      return;
    }

    await this.replaceCustomersInIndexedDB(remoteCustomers);
    console.log(`✅ Đã đồng bộ ${remoteCustomers.length} khách hàng từ Firebase xuống IndexedDB.`);

    if (emitUpdate) {
      this.customersUpdatedSubject.next();
    }
  }

  private async replaceCustomersInIndexedDB(customers: Customer[]): Promise<void> {
    if (!Array.isArray(customers) || customers.length === 0) {
      return;
    }

    await this.ensureCustomerDbInitialized();

    try {
      await this.indexedDBService.clear(this.dbName, this.dbVersion, this.storeName);
    } catch (error) {
      console.warn('⚠️ Không thể xóa dữ liệu cũ trong IndexedDB, sẽ ghi đè từng bản ghi:', error);
    }

    await this.indexedDBService.putMany(this.dbName, this.dbVersion, this.storeName, customers);
  }

  private getBackendBaseUrl(): string {
    let base = environment.domainUrl || '';
    try {
      const override = localStorage.getItem('backendBaseUrl');
      if (override && override.trim().length > 0) {
        base = override.trim();
      }
    } catch (_) {
      /* ignore localStorage access issues */
    }

    if (base.endsWith('/')) {
      base = base.slice(0, -1);
    }

    return base;
  }

  private async fetchCustomersFromFirebase(_forceRefresh = false): Promise<Customer[]> {
    const url = `${this.getBackendBaseUrl()}${this.get_all_customers_firebase}`;

    return await firstValueFrom(
      this.http.get<Customer[]>(url).pipe(
        catchError((err) => {
          console.error('❌ Lỗi khi tải khách hàng từ Firebase:', err);
          return of([] as Customer[]);
        })
      )
    ) ?? [];
  }

  public async initializeCustomerWebSocket(): Promise<void> {
    // No-op: backend no longer accepts incoming websocket updates
    console.log('ℹ️ initializeCustomerWebSocket called — websockets removed on server; no-op');
  }

  public disconnectCustomerSocket(): void {
    // No-op: websockets removed
    this.customerConnectionSubject.next(false);
  }

  public isCustomerSocketConnected(): boolean {
    return false; // websockets removed
  }

  // Customer WebSocket initialization removed — backend no longer accepts incoming websocket events.
  // Use REST endpoints and polling/fetch helpers for synchronization. The connection subject
  // remains available but will not emit true in this client.

  private async handleCustomersUpdated(payload: any): Promise<void> {
    try {
      console.log('ℹ️ Xử lý customers_updated với payload:', payload);
      await this.ensureCustomersSeededFromFirebase(false);
      this.customersUpdatedSubject.next();
    } catch (error) {
      console.error('❌ Lỗi khi xử lý sự kiện customers_updated:', error);
    }
  }

  private async handleCustomerUpdated(payload: any): Promise<void> {
    try {
      const customer = this.extractCustomerFromPayload(payload);
      if (!customer || customer.Id === undefined || customer.Id === null) {
        console.warn('⚠️ customer_updated payload không hợp lệ:', payload);
        return;
      }

      await this.upsertCustomerLocally(customer);
      this.customersUpdatedSubject.next();
    } catch (error) {
      console.error('❌ Lỗi khi xử lý sự kiện customer_updated:', error);
    }
  }

  private async handleCustomerDeleted(payload: any): Promise<void> {
    try {
      const customerId = this.extractCustomerId(payload);
      if (customerId === null) {
        console.warn('⚠️ customer_deleted payload không hợp lệ:', payload);
        return;
      }

      await this.ensureCustomerDbInitialized();

      await this.indexedDBService.delete(this.dbName, this.dbVersion, this.storeName, customerId);
      this.customerInvoicesCache.delete(String(customerId));
      this.customersUpdatedSubject.next();
    } catch (error) {
      console.error('❌ Lỗi khi xử lý sự kiện customer_deleted:', error);
    }
  }

  private extractCustomerFromPayload(payload: any): Customer | null {
    if (!payload) {
      return null;
    }

    const candidate = payload.customer ?? payload.data ?? payload;
    if (candidate && typeof candidate === 'object') {
      return candidate as Customer;
    }

    return null;
  }

  private extractCustomerId(payload: any): number | null {
    if (payload === null || payload === undefined) {
      return null;
    }

    const raw = payload.id ?? payload.Id ?? payload.customerId ?? payload.customer_id ?? payload;
    const parsed = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private async upsertCustomerLocally(customer: Customer): Promise<void> {
    if (!customer || customer.Id === undefined || customer.Id === null) {
      return;
    }

    await this.ensureCustomerDbInitialized();

    await this.indexedDBService.put(this.dbName, this.dbVersion, this.storeName, customer);
  }

  private emitCustomerRealtimeUpdate(customer: Customer): void {
    if (!customer) {
      return;
    }

    // WebSocket removed on server; instead broadcast update locally so UI updates.
    try {
      this.customersUpdatedSubject.next();
    } catch (err) {
      console.warn('⚠️ emitCustomerRealtimeUpdate (local broadcast) failed', err);
    }
  }

  async getCustomerInvoicesFromFirebase(customerId: number | string, forceRefresh = false): Promise<InvoiceTab[]> {
    const cacheKey = String(customerId);
    const now = Date.now();

    if (!forceRefresh) {
      const cached = this.customerInvoicesCache.get(cacheKey);
      if (cached && now - cached.timestamp < this.CUSTOMER_INVOICE_CACHE_DURATION) {
        return cached.data;
      }
    }

    const url = `${environment.domainUrl}${this.get_customer_all_invoices_from_firebase}${customerId}`;

    const invoices = await firstValueFrom(
      this.http.get<InvoiceTab[]>(url).pipe(
        catchError((err) => {
          console.error(`❌ Lỗi khi tải hóa đơn của khách hàng ${customerId}:`, err);
          return of([] as InvoiceTab[]);
        })
      )
    ) ?? [];

    const normalized = invoices
      .map((invoice) => ({
        ...invoice,
        createdDate: invoice.createdDate ?? ''
      }))
      .sort((a, b) => {
        const aTime = a.createdDate ? new Date(a.createdDate).getTime() : 0;
        const bTime = b.createdDate ? new Date(b.createdDate).getTime() : 0;
        return bTime - aTime;
      });

    this.customerInvoicesCache.set(cacheKey, { timestamp: now, data: normalized });
    return normalized;
  }

  clearCustomerInvoicesCache(customerId?: number | string | null): void {
    if (customerId === undefined || customerId === null) {
      return;
    }
    this.customerInvoicesCache.delete(String(customerId));
  }

  async initDB(): Promise<void> {
    // Khởi tạo database với upgrade function
    const upgradeFn = (db: any) => {
      if (!db.objectStoreNames.contains(this.storeName)) {
        db.createObjectStore(this.storeName, { keyPath: 'Id' });
      }
    };

    await this.indexedDBService.getDB(this.dbName, this.dbVersion, upgradeFn);

    // Double-check and upgrade if the store wasn't created (existing DB with same version)
    const stores = await this.indexedDBService.getObjectStoreNames(this.dbName, this.dbVersion);
    if (!stores.includes(this.storeName)) {
      console.warn(`⚠️ Object store '${this.storeName}' missing in DB '${this.dbName}', attempting upgrade`);
      await this.indexedDBService.closeDB(this.dbName);
      await this.indexedDBService.getDB(this.dbName, this.dbVersion + 1, upgradeFn);
    }

    this.customerDbReady = true;
  }
  async searchCustomers(query: string): Promise<Customer[]> {
    const allCustomers = await this.getAllCustomersFromIndexedDB();

    if (!query || query.trim() === '') {
      return allCustomers;
    }

    const searchTerm = query.toLowerCase().trim();

    return allCustomers.filter(customer =>
      customer.Name?.toLowerCase().includes(searchTerm) ||
      customer.ContactNumber?.toLowerCase().includes(searchTerm)
      //|| customer.Email?.toLowerCase().includes(searchTerm) ||
      // customer.Address?.toLowerCase().includes(searchTerm)
    );
  }
  async loadCustomersFromKiotvietToIndexedDB(): Promise<void> {
    // Lấy dữ liệu từ API
    const customers = (await this.http.get<Customer[]>(`${environment.domainUrl}${this.get_all_customers_from_kiotviet}`)
      .pipe(
        catchError((err) => {
          console.error('❌ Lỗi khi tải tất cả khách hàng:', err);
          return of([]);
        })
      ).toPromise()) ?? [];

    if (customers.length === 0) return;

    await this.ensureCustomerDbInitialized();

    // Lấy toàn bộ khách hàng đang có trong IndexedDB
    const existingCustomers: Customer[] = await this.indexedDBService.getAll(
      this.dbName,
      this.dbVersion,
      this.storeName
    );

    const existingMap = new Map(existingCustomers.map(c => [c.Id, c]));

    // Chuẩn bị danh sách khách hàng cần cập nhật
    const customersToUpdate: Customer[] = [];

    for (const customer of customers) {
      const existing = existingMap.get(customer.Id);

      // So sánh nội dung
      if (!existing || JSON.stringify(existing) !== JSON.stringify(customer)) {
        if (!customer.Id) {
          console.warn('Customer missing Id:', customer);
          continue;
        }
        customersToUpdate.push(customer);
      }
    }

    // Cập nhật nhiều khách hàng cùng lúc nếu có thay đổi
    if (customersToUpdate.length > 0) {
      await this.indexedDBService.putMany(
        this.dbName,
        this.dbVersion,
        this.storeName,
        customersToUpdate
      );
      console.log(`✅ Đã cập nhật ${customersToUpdate.length} khách hàng`);
    }
  }

  async syncCustomersFromFirebaseToIndexedDB(): Promise<void> {
    const customers = await firstValueFrom(this.getAllCustomersFromFirebase()) ?? [];

    if (customers.length === 0) return;

    await this.ensureCustomerDbInitialized();

    const existingCustomers: Customer[] = await this.indexedDBService.getAll(
      this.dbName,
      this.dbVersion,
      this.storeName
    );

    const existingMap = new Map(existingCustomers.map(c => [c.Id, c]));
    const customersToUpdate: Customer[] = [];

    for (const customer of customers) {
      const existing = existingMap.get(customer.Id);
      if (!existing || JSON.stringify(existing) !== JSON.stringify(customer)) {
        if (!customer.Id) {
          console.warn('Customer missing Id:', customer);
          continue;
        }
        customersToUpdate.push(customer);
      }
    }

    if (customersToUpdate.length > 0) {
      await this.indexedDBService.putMany(
        this.dbName,
        this.dbVersion,
        this.storeName,
        customersToUpdate
      );
      console.log(`✅ Đã cập nhật ${customersToUpdate.length} khách hàng từ Firebase`);
    }
  }

  async syncAllCustomersFromIndexedDBToFirebase(): Promise<void> {
    try {
      await this.ensureCustomerDbInitialized();

      const allCustomers = await this.getAllCustomersFromIndexedDB();
      if (allCustomers.length > 0) {
        await firstValueFrom(this.saveAllCustomersToFirebase(allCustomers));
        console.log(`✅ Đã đồng bộ ${allCustomers.length} khách hàng lên Firebase.`);
      } else {
        console.log('Không có khách hàng nào trong IndexedDB để đồng bộ.');
      }
    } catch (error) {
      console.error('❌ Lỗi khi đồng bộ khách hàng từ IndexedDB lên Firebase:', error);
    }
  }

  saveAllCustomersToFirebase(customers: Customer[]): Observable<any> {
    return this.http.post(`${environment.domainUrl}${this.firebaseService.post_add_customers}`, customers);
  }

  async addCustomerTofireBase(customer: any): Promise<any> {
    const url = `${this.getBackendBaseUrl()}${this.firebaseService.post_add_customer}`;

    try {
      const createdCustomer = await firstValueFrom(
        this.http.post<Customer | null | undefined>(url, customer).pipe(
          catchError((err) => {
            console.error('❌ Lỗi khi thêm khách hàng lên Firebase:', err);
            return throwError(() => err);
          })
        )
      );

      if (createdCustomer && typeof createdCustomer === 'object' && createdCustomer.Id !== undefined && createdCustomer.Id !== null) {
        await this.upsertCustomerLocally(createdCustomer);
        this.emitCustomerRealtimeUpdate(createdCustomer);
        this.customersUpdatedSubject.next();
        return createdCustomer;
      }

      console.warn('⚠️ API thêm khách hàng không trả về dữ liệu khách hàng, thực hiện đồng bộ lại.');
      await this.ensureCustomersSeededFromFirebase(true, true);
      return createdCustomer;
    } catch (error) {
      console.error('❌ Không thể thêm khách hàng lên Firebase qua API:', error);
      throw error;
    }
  }

  getAllCustomersFromKiotviet(): Observable<Customer[]> {
    return this.http.get<Customer[]>(`${environment.domainUrl}${this.kiotvietService.kiotviet_customers_api}`).pipe(
      catchError((err) => {
        console.error('❌ Lỗi khi tải tất cả khách hàng từ Kiotviet:', err);
        return of([]);
      })
    );
  }

  getAllCustomersFromFirebase(): Observable<Customer[]> {
    return this.http.get<Customer[]>(`${environment.domainUrl}${this.firebaseService.get_all_customers}`).pipe(
      catchError((err) => {
        console.error('❌ Lỗi khi tải tất cả khách hàng từ Firebase:', err);
        return of([]);
      })
    );
  }
  // Thêm các method tiện ích CRUD
  async getCustomerByIdFromIndexedDB(id: number): Promise<Customer | undefined> {
    await this.ensureCustomerDbInitialized();

    return await this.indexedDBService.getByKey(
      this.dbName,
      this.dbVersion,
      this.storeName,
      id
    );
  }

  async getAllCustomersFromIndexedDB(): Promise<Customer[]> {
    await this.ensureCustomerDbInitialized();

    return await this.indexedDBService.getAll(
      this.dbName,
      this.dbVersion,
      this.storeName
    );
  }

  async getCustomerCountFromIndexedDB(): Promise<number> {
    await this.ensureCustomerDbInitialized();

    try {
      return await this.indexedDBService.count(this.dbName, this.dbVersion, this.storeName);
    } catch (error) {
      console.warn('⚠️ Không thể đếm khách hàng trong IndexedDB, fallback sang getAll:', error);
      const customers = await this.getAllCustomersFromIndexedDB();
      return customers.length;
    }
  }

  async addCustomerFromIndexedDB(customer: Customer): Promise<void> {
    await this.ensureCustomerDbInitialized();

    await this.indexedDBService.put(
      this.dbName,
      this.dbVersion,
      this.storeName,
      customer
    );
  }

  async updateCustomerFromIndexedDB(customer: Customer): Promise<void> {
    await this.ensureCustomerDbInitialized();

    await this.indexedDBService.put(
      this.dbName,
      this.dbVersion,
      this.storeName,
      customer
    );
  }

  async deleteCustomerFromIndexedDB(id: number): Promise<void> {
    await this.ensureCustomerDbInitialized();

    await this.indexedDBService.delete(
      this.dbName,
      this.dbVersion,
      this.storeName,
      id
    );
  }

  async deleteCustomersBatch(ids: number[]): Promise<boolean> {
    if (!ids || ids.length === 0) {
      return true;
    }

    const url = `${environment.domainUrl}/api/firebase/customers/batch_delete`;

    try {
      await firstValueFrom(
        this.http.post(url, { ids }).pipe(
          catchError((err) => {
            console.error(`❌ Lỗi khi xóa danh sách khách hàng trên backend:`, err);
            return throwError(() => err);
          })
        )
      );

      ids.forEach((id) => this.customerInvoicesCache.delete(String(id)));
      return true;
    } catch (error) {
      console.error('❌ Không thể xóa danh sách khách hàng trên backend:', error);
      return false;
    }
  }

  async clearAllCustomersFromIndexedDB(): Promise<void> {
    await this.ensureCustomerDbInitialized();

    await this.indexedDBService.clear(
      this.dbName,
      this.dbVersion,
      this.storeName
    );
  }

  // Tìm kiếm khách hàng

  /**
   * Cập nhật công nợ (Debt) của khách hàng vào cả IndexedDB và Firestore
   */
  async updateCustomerDebt(customerId: number, newDebt: number): Promise<void> {
    await this.ensureCustomerDbInitialized();

    // Cập nhật trong IndexedDB
    const customer = await this.getCustomerByIdFromIndexedDB(customerId);
    if (customer) {
      customer.Debt = newDebt;
      await this.updateCustomerFromIndexedDB(customer);
      console.log(`✅ Đã cập nhật Debt cho khách hàng ${customerId} trong IndexedDB: ${newDebt}`);
      // Cập nhật lên Firestore nếu có hàm
      try {
        await this.addCustomerTofireBase(customer); // Hàm này sẽ upsert customer lên Firestore
        console.log(`✅ Đã cập nhật Debt cho khách hàng ${customerId} lên Firestore: ${newDebt}`);
      } catch (err) {
        console.error('❌ Lỗi khi cập nhật Debt lên Firestore:', err);
      }
    } else {
      console.warn(`❌ Không tìm thấy khách hàng ${customerId} trong IndexedDB để cập nhật Debt.`);
    }
  }
}