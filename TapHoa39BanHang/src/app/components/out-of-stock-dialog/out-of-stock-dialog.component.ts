import { Component, Inject, OnDestroy, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { KiotvietService } from '../../services/kiotviet.service';
import { IndexedDBService } from '../../services/indexed-db.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { UpdateStockDialogComponent } from './update-stock/update-stock-dialog.component';
import { Product } from '../../models/product.model';
import { ProductService } from '../../services/product.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-out-of-stock-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule],
  templateUrl: './out-of-stock-dialog.component.html',
  styleUrls: ['./out-of-stock-dialog.component.css']
})
export class OutOfStockDialogComponent implements OnInit, OnDestroy {
  items: Product[] = [];
  filteredItems: Product[] = [];
  searchTerm = '';
  isLoading = false;
  private readonly lowStockThreshold = 5;

  private dbName = 'SalesDB';
  private storeName = 'outofstock';

  // Paging
  page = 1;
  pageSize = 20;
  totalPages = 1;
  totalItems = 0;
  private realtimeSubscription?: Subscription;

  constructor(
    public dialogRef: MatDialogRef<OutOfStockDialogComponent>,
    private kiotvietService: KiotvietService,
    private indexedDBService: IndexedDBService,
    private dialog: MatDialog,
    private productService: ProductService,
    @Inject(MAT_DIALOG_DATA) public data: any
  ) { }

  async ngOnInit() {
    // Khi mở dialog, load từ IndexedDB và phân trang local
    this.isLoading = true;
    try {
      await this.indexedDBService.getDB(this.dbName, 1, db => {
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'Id' });
        }
      });
      const data = await this.indexedDBService.getAll<Product>(this.dbName, 1, this.storeName);
      this.items = data as Product[];
      this.totalItems = data.length;
      this.page = 1;
      this.totalPages = Math.max(1, Math.ceil(this.totalItems / this.pageSize));
      this.updateFilteredItems();
    } catch (e) {
      this.items = [];
      this.filteredItems = [];
      this.totalItems = 0;
      this.page = 1;
      this.totalPages = 1;
    }
    this.isLoading = false;
    this.listenForRealtimeUpdates();
  }

  ngOnDestroy(): void {
    this.realtimeSubscription?.unsubscribe();
  }

  private listenForRealtimeUpdates(): void {
    this.realtimeSubscription = this.productService.productOnHandUpdated$
      .subscribe(update => {
        const productId = Number((update as any)?.productId);
        const onHandValue = Number((update as any)?.onHand);
        if (!Number.isFinite(productId) || !Number.isFinite(onHandValue)) {
          return;
        }
        void this.applyRealtimeOutOfStockChange(productId, onHandValue);
      });
  }

  private async applyRealtimeOutOfStockChange(productId: number, onHand: number): Promise<void> {
    const existingIndex = this.items.findIndex(item => Number(item?.Id) === productId);
    let hasChanged = false;

    if (onHand <= 0) {
      if (existingIndex >= 0) {
        const existing = this.items[existingIndex];
        this.items[existingIndex] = { ...existing, OnHand: onHand } as Product;
        hasChanged = true;
      } else {
        try {
          const product = await this.productService.getProductByIdFromIndexedDB(productId);
          if (!product) {
            return;
          }
          const newEntry = { ...product, OnHand: onHand } as Product;
          this.items.unshift(newEntry);
          hasChanged = true;
        } catch (error) {
          console.warn('⚠️ Không thể thêm sản phẩm vào danh sách hết hàng realtime:', error);
          return;
        }
      }
    } else if (existingIndex >= 0) {
      this.items.splice(existingIndex, 1);
      hasChanged = true;
    }

    if (!hasChanged) {
      return;
    }

    this.totalItems = this.items.length;
    this.totalPages = Math.max(1, Math.ceil(this.totalItems / this.pageSize));
    if (this.searchTerm.trim()) {
      this.filter();
    } else {
      this.updateFilteredItems();
    }
  }

  updateFilteredItems() {
    const start = (this.page - 1) * this.pageSize;
    const end = start + this.pageSize;
    this.filteredItems = this.items.slice(start, end);
  }

  async reload() {
    this.isLoading = true;
    try {
      const result: any = await this.kiotvietService.getOutOfStockItems();
      if (result && result.items) {
        await this.indexedDBService.clear(this.dbName, 1, this.storeName);
        await this.indexedDBService.putMany(this.dbName, 1, this.storeName, result.items);
        this.items = (result.items as Product[]) || [];
        this.totalItems = result.total_items || result.items.length;
        this.page = 1;
        this.totalPages = Math.max(1, Math.ceil(this.totalItems / this.pageSize));
        this.updateFilteredItems();
      } else {
        this.items = [];
        this.filteredItems = [];
        this.totalItems = 0;
        this.page = 1;
        this.totalPages = 1;
      }
    } catch (e) {
      alert('Lỗi khi tải dữ liệu!');
    }
    this.isLoading = false;
  }
  filter() {
    const term = this.searchTerm.trim().toLowerCase();
    if (!term) {
      this.filteredItems = this.items;
      return;
    }
    this.filteredItems = this.items.filter(item =>
      (item.Code && item.Code.toLowerCase().includes(term)) ||
      (item.FullName && item.FullName.toLowerCase().includes(term))
    );
  }
  async goToPage(page: number) {
    if (page < 1 || page > this.totalPages) return;
    this.page = page;
    this.updateFilteredItems();
  }
  nextPage() { if (this.page < this.totalPages) { this.page++; this.updateFilteredItems(); } }
  prevPage() { if (this.page > 1) { this.page--; this.updateFilteredItems(); } }

  openUpdateStockDialog(item: Product): void {
    const dialogRef = this.dialog.open(UpdateStockDialogComponent, {
      width: '420px',
      data: { productId: item.Id, product: item }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result?.updatedProducts) {
        this.applyUpdatedProducts(result.updatedProducts as Product[]);
      }
    });
  }

  private applyUpdatedProducts(updatedProducts: Product[]): void {
    let hasChanges = false;
    for (const product of updatedProducts) {
      const idx = this.items.findIndex(item => item.Id === product.Id);
      if (idx !== -1) {
        this.items[idx] = { ...this.items[idx], OnHand: product.OnHand } as Product;
        hasChanges = true;
      }
    }

    if (hasChanges) {
      this.updateFilteredItems();
    }
  }

  trackByProductId(_index: number, item: Product): number {
    return item?.Id ?? _index;
  }

  getStockBadgeClass(product: Product): string {
    const onHand = Number(product?.OnHand ?? 0);
    if (onHand <= 0) {
      return 'stock-empty';
    }
    if (onHand <= this.lowStockThreshold) {
      return 'stock-low';
    }
    return 'stock-ok';
  }
}