import { Injectable } from '@angular/core';
import { IndexedDBService } from './indexed-db.service';

interface Category {
  Id: number;
  Name: string;
  Path: string;
  [key: string]: any;
}

@Injectable({
  providedIn: 'root'
})
export class CategoryService {
  private readonly dbName = 'SalesDB';
  private readonly dbVersion = 3; // Tăng lên 3 để tạo categoriesMeta store
  private readonly storeName = 'categories';
  private readonly metaStoreName = 'categoriesMeta';
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 phút (đơn vị: milliseconds)

  constructor(private indexedDBService: IndexedDBService) {
    this.initDatabase();
  }

  /**
   * Khởi tạo database và tạo object store nếu chưa có
   */
  private async initDatabase(): Promise<void> {
    try {
      await this.indexedDBService.getDB(this.dbName, this.dbVersion, (db) => {
        // Tạo object store cho categories nếu chưa tồn tại
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'Id' });
          store.createIndex('Name', 'Name', { unique: false });
          store.createIndex('Path', 'Path', { unique: false });
          console.log(`✅ Đã tạo object store '${this.storeName}'`);
        }

        // Tạo object store cho metadata (timestamp) nếu chưa tồn tại
        if (!db.objectStoreNames.contains(this.metaStoreName)) {
          db.createObjectStore(this.metaStoreName, { keyPath: 'key' });
          console.log(`✅ Đã tạo object store '${this.metaStoreName}'`);
        }
      });
      console.log(`✅ Database '${this.dbName}' đã sẵn sàng`);
    } catch (error) {
      console.error(`❌ Lỗi khi khởi tạo database '${this.dbName}':`, error);
    }
  }

  /**
   * Lưu tất cả categories vào IndexedDB (xóa dữ liệu cũ trước)
   */
  async saveCategories(categories: Category[]): Promise<void> {
    try {
      console.log(`🔄 Đang lưu ${categories.length} categories vào IndexedDB...`);

      // Xóa dữ liệu cũ trước
      await this.indexedDBService.clear(this.dbName, this.dbVersion, this.storeName);

      // Lưu dữ liệu mới
      await this.indexedDBService.putMany(this.dbName, this.dbVersion, this.storeName, categories);

      // Lưu timestamp hiện tại
      await this.updateCacheTimestamp();

      console.log(`✅ Đã lưu ${categories.length} categories vào IndexedDB thành công`);
    } catch (error) {
      console.error('❌ Lỗi khi lưu categories vào IndexedDB:', error);
      throw error;
    }
  }

  /**
   * Cập nhật timestamp của cache
   */
  private async updateCacheTimestamp(): Promise<void> {
    try {
      const meta = {
        key: 'lastUpdated',
        timestamp: Date.now()
      };
      await this.indexedDBService.put(this.dbName, this.dbVersion, this.metaStoreName, meta);
    } catch (error) {
      console.error('❌ Lỗi khi cập nhật cache timestamp:', error);
    }
  }

  /**
   * Lấy timestamp lần cập nhật cache cuối cùng
   */
  private async getCacheTimestamp(): Promise<number | null> {
    try {
      const meta = await this.indexedDBService.getByKey<{ key: string; timestamp: number }>(
        this.dbName,
        this.dbVersion,
        this.metaStoreName,
        'lastUpdated'
      );
      return meta?.timestamp || null;
    } catch (error) {
      console.error('❌ Lỗi khi lấy cache timestamp:', error);
      return null;
    }
  }

  /**
   * Kiểm tra xem cache có còn hợp lệ không (chưa hết hạn)
   */
  async isCacheValid(): Promise<boolean> {
    try {
      const timestamp = await this.getCacheTimestamp();
      console.log(`🔍 [isCacheValid] timestamp = ${timestamp}`);

      if (!timestamp) {
        console.log('🔍 [isCacheValid] Không có timestamp, cache không hợp lệ');
        return false;
      }

      const age = Date.now() - timestamp;
      const isValid = age < this.CACHE_TTL;

      console.log(`🔍 [isCacheValid] age = ${Math.round(age / 1000)}s, TTL = ${this.CACHE_TTL / 1000}s, isValid = ${isValid}`);

      if (!isValid) {
        console.log(`⏰ Cache đã hết hạn (${Math.round(age / 1000)}s, TTL: ${this.CACHE_TTL / 1000}s)`);
      }

      return isValid;
    } catch (error) {
      console.error('❌ Lỗi khi kiểm tra cache validity:', error);
      return false;
    }
  }

  /**
   * Lưu hoặc cập nhật một category
   */
  async saveCategory(category: Category): Promise<void> {
    try {
      await this.indexedDBService.put(this.dbName, this.dbVersion, this.storeName, category);
      console.log(`✅ Đã lưu category '${category.Name}' (ID: ${category.Id})`);
    } catch (error) {
      console.error('❌ Lỗi khi lưu category:', error);
      throw error;
    }
  }

  /**
   * Lấy tất cả categories từ IndexedDB
   */
  async getAllCategories(): Promise<Category[]> {
    try {
      const categories = await this.indexedDBService.getAll<Category>(
        this.dbName,
        this.dbVersion,
        this.storeName
      );
      console.log(`✅ Đã tải ${categories.length} categories từ IndexedDB`);
      return categories;
    } catch (error) {
      console.error('❌ Lỗi khi lấy categories từ IndexedDB:', error);
      return [];
    }
  }

  /**
   * Lấy category theo ID
   */
  async getCategoryById(id: number): Promise<Category | undefined> {
    try {
      const category = await this.indexedDBService.getByKey<Category>(
        this.dbName,
        this.dbVersion,
        this.storeName,
        id
      );
      return category;
    } catch (error) {
      console.error(`❌ Lỗi khi lấy category ID ${id}:`, error);
      return undefined;
    }
  }

  /**
   * Xóa category theo ID
   */
  async deleteCategory(id: number): Promise<void> {
    try {
      await this.indexedDBService.delete(this.dbName, this.dbVersion, this.storeName, id);
      console.log(`✅ Đã xóa category ID ${id}`);
    } catch (error) {
      console.error(`❌ Lỗi khi xóa category ID ${id}:`, error);
      throw error;
    }
  }

  /**
   * Xóa tất cả categories
   */
  async clearAllCategories(): Promise<void> {
    try {
      await this.indexedDBService.clear(this.dbName, this.dbVersion, this.storeName);
      console.log('✅ Đã xóa tất cả categories');
    } catch (error) {
      console.error('❌ Lỗi khi xóa tất cả categories:', error);
      throw error;
    }
  }

  /**
   * Đếm số lượng categories trong IndexedDB
   */
  async countCategories(): Promise<number> {
    try {
      const count = await this.indexedDBService.count(this.dbName, this.dbVersion, this.storeName);
      return count;
    } catch (error) {
      console.error('❌ Lỗi khi đếm categories:', error);
      return 0;
    }
  }

  /**
   * Kiểm tra xem có categories trong IndexedDB không
   */
  async hasCategories(): Promise<boolean> {
    try {
      const count = await this.countCategories();
      return count > 0;
    } catch (error) {
      return false;
    }
  }
}
