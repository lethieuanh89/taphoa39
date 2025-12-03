import { Injectable } from '@angular/core';
import { environment } from "../../environments/environment";
import { InvoiceTab } from '../models/invoice.model';
import { IndexedDBService } from './indexed-db.service'; // Thêm import này
import { CategoryService } from './category.service';
import { HttpClient } from '@angular/common/http';
import { catchError, Observable, of } from 'rxjs';

interface KiotVietAuthResponse {
  access_token: string;
  retailer: number;
  LatestBranchId: string;
}
@Injectable({
  providedIn: 'root'
})
export class KiotvietService {

  constructor(
    private indexedDBService: IndexedDBService,
    private categoryService: CategoryService,
    private http: HttpClient
  ) { }
  private readonly updateItemUrl = 'https://api-man1.kiotviet.vn/api';
  private readonly getUpdateItemUrl = 'https://api-man1.kiotviet.vn/api/products';
  private retailerId = 500111210;
  private retailer: any | null = null;// Replace with your retailer
  private LatestBranchId: any | null = null; // Replace with your branch ID
  private accessToken: string | null = null;
  private dbName = 'SalesDB';
  private dbVersion = 3; // Synchronized with CategoryService version
  private storeName = 'outofstock';

  kiotviet_items_api = "/api/kiotviet/items/all";
  kiotviet_customers_api = "/api/kiotviet/customers";
  kiotviet_item_outofstock_api = "/api/kiotviet/items/out_of_stock";
  kiotviet_categories_api = "/api/kiotviet/categories";

  async getOutOfStockItems(params?: any): Promise<any> {
    return await this.http.get(`${environment.domainUrl}${this.kiotviet_item_outofstock_api}`, { params }).toPromise();
  }

  async getCategories(): Promise<any[]> {
    try {
      console.log('🔍 [getCategories] Bắt đầu kiểm tra cache...');

      // Kiểm tra xem có categories trong IndexedDB không
      const hasCategories = await this.categoryService.hasCategories();
      console.log(`🔍 [getCategories] hasCategories = ${hasCategories}`);

      if (hasCategories) {
        // Kiểm tra cache có còn hợp lệ không (theo TTL)
        const isCacheValid = await this.categoryService.isCacheValid();
        console.log(`🔍 [getCategories] isCacheValid = ${isCacheValid}`);

        if (isCacheValid) {
          // Cache còn hợp lệ, dùng luôn không cần fetch API
          console.log('📦 Lấy categories từ IndexedDB (cache còn hợp lệ) ✅');
          return await this.categoryService.getAllCategories();
        } else {
          // Cache hết hạn, fetch API và update cache
          console.log('🔄 Cache hết hạn, đang làm mới từ API...');
          const cachedCategories = await this.categoryService.getAllCategories();
          // Fetch API trong background để update cache
          this.fetchAndCacheCategories().catch(err =>
            console.warn('⚠️ Không thể cập nhật categories cache:', err)
          );
          // Trả về cache cũ ngay để không làm chậm UI
          return cachedCategories;
        }
      }

      // Nếu chưa có cache, fetch từ API
      console.log('🌐 Lấy categories từ API (lần đầu)');
      return await this.fetchAndCacheCategories();
    } catch (error) {
      console.error('❌ Error fetching categories:', error);
      // Fallback: thử lấy từ cache nếu API fail
      try {
        const cachedCategories = await this.categoryService.getAllCategories();
        if (cachedCategories.length > 0) {
          console.log('✅ Sử dụng categories từ cache (fallback)');
          return cachedCategories;
        }
      } catch (cacheError) {
        console.error('❌ Không thể lấy categories từ cache:', cacheError);
      }
      return [];
    }
  }

  /**
   * Fetch categories từ API và lưu vào IndexedDB
   */
  private async fetchAndCacheCategories(): Promise<any[]> {
    try {
      const result = await this.http.get<any[]>(
        `${environment.domainUrl}${this.kiotviet_categories_api}`
      ).toPromise();

      const categories = result || [];

      if (categories.length > 0) {
        // Lưu vào IndexedDB
        await this.categoryService.saveCategories(categories);
        console.log(`✅ Đã lưu ${categories.length} categories vào IndexedDB`);
      }

      return categories;
    } catch (error) {
      console.error('❌ Error fetching and caching categories:', error);
      throw error;
    }
  }

  /**
   * Force refresh categories từ API và cập nhật cache
   */
  async refreshCategories(): Promise<any[]> {
    console.log('🔄 Làm mới categories từ API...');
    return await this.fetchAndCacheCategories();
  }

  // ========= Auth helpers & unified retry-on-401/403 =========
  private loadStoredCredentials(): boolean {
    const storedToken = localStorage.getItem('kv_access_token');
    const storedRetailer = localStorage.getItem('kv_retailer');
    const storedBranchId = localStorage.getItem('kv_branch_id');
    if (storedToken && storedRetailer && storedBranchId) {
      this.accessToken = storedToken;
      this.retailer = storedRetailer;
      this.LatestBranchId = storedBranchId;
      return true;
    }
    return false;
  }

  // Run a KiotViet fetch, and if unauthorized (401/403), attempt to get token again then retry ONCE
  private async performKiotVietFetchWithRetry<T>(
    makeRequest: (token: string) => Promise<Response>,
    parseJson: boolean = true
  ): Promise<T> {
    // Ensure we have creds in memory; avoid calling getAccessToken unless needed
    if (!this.accessToken || !this.retailer || !this.LatestBranchId) {
      this.loadStoredCredentials();
    }
    const token1 = this.accessToken || '';

    let res = await makeRequest(token1);
    if (res.status === 401 || res.status === 403) {
      // token might be expired — try to get token again (only now)
      try {
        const newToken = await this.getAccessToken();
        res = await makeRequest(newToken);
      } catch (reAuthErr) {
        // Propagate a clear error for UI to handle (e.g., prompt re-login)
        throw new Error(`KIOTVIET_TOKEN_EXPIRED: ${res.status} ${res.statusText}`);
      }
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP error! status: ${res.status}, message: ${text}`);
    }

    return (parseJson ? (await res.json()) : (await (res as any))) as T;
  }
  private async getAccessToken(): Promise<string> {
    // Ưu tiên lấy từ localStorage nếu đã đăng nhập
    const storedToken = localStorage.getItem('kv_access_token');
    const storedRetailer = localStorage.getItem('kv_retailer');
    const storedBranchId = localStorage.getItem('kv_branch_id');

    if (storedToken && storedRetailer && storedBranchId) {
      // Kiểm tra token có expired không
      if (this.isTokenExpired(storedToken)) {
        console.log('Token đã hết hạn, yêu cầu đăng nhập lại');
        this.clearStoredCredentials();
        throw new Error('Token đã hết hạn. Vui lòng đăng nhập lại.');
      }

      this.accessToken = storedToken;
      this.retailer = storedRetailer;
      this.LatestBranchId = storedBranchId;
      return this.accessToken;
    }

    // Nếu chưa có, yêu cầu đăng nhập lại
    throw new Error('Chưa đăng nhập KiotViet. Vui lòng đăng nhập lại.');
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
    this.accessToken = null;
    this.retailer = null;
    this.LatestBranchId = null;
  }

  async getRequestBody(Id: number) {
    try {
      const url = `${this.getUpdateItemUrl}/${Id}/initialdata?Includes=ProductAttributes&ProductType=2`;
      const data = await this.performKiotVietFetchWithRetry<any>(async (token) => {
        return await fetch(url, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': token,
            'Retailer': this.retailer as any,
            'BranchId': this.LatestBranchId as any,
          }
        });
      });
      return data;
    } catch (error) {
      console.error('Error getting product', error);
      throw error;
    }
  }
  async updateProductToKiotviet(formDataGetFromKiotViet: any): Promise<any> {
    const fD = new FormData();
    fD.append("product", JSON.stringify(formDataGetFromKiotViet.Product))
    fD.append("BranchForProductCostss", `[{ "Id": ${this.LatestBranchId}, "Name": "Chi nhánh trung tâm" }]`)
    fD.append("ListUnitPriceBookDetail", "[]")
    try {
      const url = `${this.updateItemUrl}/products/photo`;
      const result = await this.performKiotVietFetchWithRetry<any>(async (token) => {
        return await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': token || '',
            'Retailer': this.retailer as any,
            'BranchId': this.LatestBranchId as any
          },
          body: fD
        });
      });
      return result;
    } catch (error) {
      console.error('Error sending product data:', error);
      throw error;
    }
  }

  async updateOnHandFromInvoiceToKiotviet(
    invoice: InvoiceTab,
    groupedProducts: { [x: string]: any; [x: number]: any[]; },
    operation: 'decrease' | 'increase' = 'decrease'
  ): Promise<any> {
    const results: { productId: any; result?: any; error?: any; }[] = []; // Tạo mảng để lưu kết quả

    for (const cartItem of invoice.cartItems) {
      const masterUnitId = cartItem.product.MasterUnitId || cartItem.product.Id;
      const group = groupedProducts[masterUnitId];
      const masterItem = group?.find(item => item.MasterUnitId == null);

      if (!masterItem) {
        console.warn('⚠️ Không tìm thấy master item để cập nhật tồn kho KiotViet cho sản phẩm', cartItem?.product?.Id);
        continue;
      }

      const formDataGetFromKiotViet = await this.getRequestBody(masterItem.Id)
      const conversion = Number(cartItem.product?.ConversionValue) || 1;
      const delta = Number(cartItem.quantity ?? 0) * conversion;
      if (operation === 'decrease') {
        formDataGetFromKiotViet.Product.OnHand = formDataGetFromKiotViet.Product.OnHand - delta;
      } else {
        formDataGetFromKiotViet.Product.OnHand = formDataGetFromKiotViet.Product.OnHand + delta;
      }
      await this.updateProductToKiotviet(formDataGetFromKiotViet)
        .then(result => {
          results.push({ productId: masterItem.Id, result });
        })
        .catch(error => {
          console.error(`Error updating product ${masterItem.Id}:`, error);
          results.push({ productId: masterItem.Id, error: error.message });
        });
    }

    return results; // Return tất cả kết quả sau khi hoàn thành vòng lặp
  }

  async addCustomer(customerData: any): Promise<any> {
    const payload = {
      Customer: {
        BranchId: Number(this.LatestBranchId),
        IsActive: true,
        Uuid: crypto.randomUUID(),
        Type: 0,
        temploc: "",
        tempw: "",
        EmployeeInChargeIds: [],
        Name: customerData.name,
        Organization: customerData.organization || "",
        ContactNumber: customerData.phone,
        Gender: customerData.gender === 'Nam' ? 1 : (customerData.gender === 'Nữ' ? 0 : null),
        BirthDate: customerData.birthDate ? new Date(customerData.birthDate).toISOString() : null,
        TaxCode: customerData.taxCode,
        IdentificationNumber: customerData.idCard,
        Email: customerData.email,
        Facebook: customerData.facebook,
        Comments: customerData.notes,
        LocationName: "",
        AdministrativeAreaId: null,
        WardName: "",
        CustomerGroupDetails: [],
        RetailerId: this.retailerId
      },
      isMergedSupplier: false,
      isCreateNewSupplier: false,
      MergedSupplierId: 0,
      SkipValidateEmail: false,
    };

    try {
      const url = `https://api-man1.kiotviet.vn/api/customers`;
      const result = await this.performKiotVietFetchWithRetry<any>(async (token) => {
        return await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': token,
            'Retailer': this.retailer as any,
            'BranchId': this.LatestBranchId as any
          },
          body: JSON.stringify(payload)
        });
      });
      return result;
    } catch (error) {
      console.error('Error adding customer:', error);
      throw error;
    }
  }
  async syncProductFromKiotvietToFirebase(data: any): Promise<void> {
    (await this.http.post(`${environment.domainUrl}/api/sync/kiotviet/firebase/products`, data)
      .pipe(
        catchError((err) => {
          console.error('❌ Lỗi khi tải tất cả sản phẩm:', err);
          return of([]);
        })
      ).toPromise()) ?? [];
  }

  async syncCustomerFromKiotvietToFirebase(data: any): Promise<void> {
    // Lấy dữ liệu từ API
    (await this.http.put(`${environment.domainUrl}/api/sync/kiotviet/firebase/customers`, data)
      .pipe(
        catchError((err) => {
          console.error('❌ Lỗi khi tải tất cả khách hàng:', err);
          return of([]);
        })
      ).toPromise()) ?? [];
  }
}
