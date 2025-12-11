import { Component, OnInit, OnDestroy, NgZone } from '@angular/core';
import { Observable, Subscription, fromEvent } from 'rxjs';
import { map, startWith } from 'rxjs/operators';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { RouterModule } from '@angular/router';
import { FormsModule, FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ProductEditService, EditedProduct } from './services/product-edit.service';
import { EditedItemDialog } from './edited-products-dialog.component';
import { InputProductDialogComponent } from './add-product-dialog/add-product-dialog.component';
import { ProductRowComponent } from './product-row/product-row.component';
import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';

interface IWindow extends Window {
  webkitSpeechRecognition: any;
}

interface ProductGroup {
  master: EditedProduct;
  children: EditedProduct[];
}

@Component({
  selector: 'edit-product-page-refactored',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatToolbarModule,
    MatButtonModule,
    MatTooltipModule,
    MatDialogModule,
    RouterModule,
    FormsModule,
    MatAutocompleteModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
    MatIconModule,
    ProductRowComponent,
    ScrollingModule
  ],
  templateUrl: './edit-product-page-refactored.component.html',
  styleUrls: [
    './button.component.css',
    './edit-product-page-refactored.component.css'
  ],
})
export class EditProductPageRefactoredComponent implements OnInit, OnDestroy {
  searchControl = new FormControl('');
  filteredOptions!: Observable<{ value: string; Name: string; Image: string; }[]>;
  options: { Name: string; Image: string }[] = [];

  productColors: Record<string, string> = {};
  isLoading = false;

  // New: Grouped products for optimized display
  productGroups: ProductGroup[] = [];

  recognition: any;
  showOfflineHint = false;
  hintMessage = '';
  private isNetworkOffline = false;
  private connectivitySubscriptions = new Subscription();

  searchTerm = '';
  userChangedFinalBasePrice: Record<string, boolean> = {};

  constructor(
    public dialog: MatDialog,
    private ngZone: NgZone,
    private productEditService: ProductEditService
  ) {
    const { webkitSpeechRecognition }: IWindow = (window as unknown) as IWindow;
    this.recognition = new webkitSpeechRecognition();
    this.recognition.lang = 'vi-VN';
    this.recognition.continuous = false;
    this.recognition.interimResults = false;

    this.recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      this.ngZone.run(() => {
        this.searchControl.setValue(transcript);
      });
    };

    this.recognition.onerror = (event: any) => {
      console.error('Lỗi khi nhận giọng nói:', event.error);
    };
  }

  startVoiceInput() {
    this.recognition.start();
  }

  ngOnInit() {
    // Clean up old editing data on component init
    this.cleanOldEditingData();

    this.filteredOptions = this.searchControl.valueChanges.pipe(
      startWith(''),
      map(value => this._filter(value || ''))
    );

    this.searchControl.valueChanges.subscribe(value => {
      const selectedOption = this.options.find(option => option.Name === value);
      if (selectedOption) {
        this.searchTerm = selectedOption.Name;
      }
    });

    this.setupConnectivityHint();
  }

  /**
   * Clean up old editing data from localStorage
   * This prevents localStorage from growing indefinitely
   */
  private cleanOldEditingData() {
    try {
      const keysToCheck: string[] = [];
      const keysToRemove: string[] = [];

      // Get all localStorage keys
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('editing_childProduct_')) {
          keysToCheck.push(key);
        }
      }

      // Remove editing_childProduct_* data that's older than current session
      // Strategy: Remove ALL editing data on component init, forcing fresh start
      keysToRemove.push(...keysToCheck);

      // Also clean up old search/grouped data if too many entries
      const searchKeys = Object.keys(localStorage).filter(k => k.startsWith('search_'));

      // Keep only the most recent 10 searches
      if (searchKeys.length > 10) {
        const sortedSearchKeys = searchKeys
          .map(key => ({
            key,
            timestamp: this.getKeyTimestamp(key)
          }))
          .sort((a, b) => b.timestamp - a.timestamp);

        // Remove old searches (keep only latest 10)
        sortedSearchKeys.slice(10).forEach(item => {
          keysToRemove.push(item.key);
          // Also remove corresponding grouped_ data
          const groupedKey = item.key.replace('search_', 'grouped_');
          if (localStorage.getItem(groupedKey)) {
            keysToRemove.push(groupedKey);
          }
        });
      }

      // Remove all marked keys
      keysToRemove.forEach(key => localStorage.removeItem(key));

      if (keysToRemove.length > 0) {
        console.log(`🧹 Cleaned up ${keysToRemove.length} old localStorage entries`);
      }
    } catch (error) {
      console.error('Error cleaning old editing data:', error);
    }
  }

  /**
   * Get timestamp from localStorage key or creation time
   * Fallback to 0 if unable to determine
   */
  private getKeyTimestamp(key: string): number {
    try {
      const data = localStorage.getItem(key);
      if (data) {
        const parsed = JSON.parse(data);
        // If data is an array, check first item's timestamp
        if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].timestamp) {
          return parsed[0].timestamp;
        }
      }
    } catch (error) {
      // Ignore parsing errors
    }
    return 0;
  }

  ngOnDestroy(): void {
    this.connectivitySubscriptions.unsubscribe();
  }

  private _filter(value: string): any[] {
    const filterValue = value.toLowerCase();
    const searchKeys = Object.keys(localStorage).filter((key) => key.startsWith('search_'));

    const allGroupedProducts = searchKeys.map((key) => JSON.parse(localStorage.getItem(key) || '[]'));

    this.options = allGroupedProducts.flatMap(product =>
      product.map((item: { Name: any; Image: string; }) => ({
        Name: item.Name,
        Image: item.Image
      }))
    );
    return this.options.filter(option => option.Name.toLowerCase().includes(filterValue));
  }

  async onSearch(event: Event) {
    this.searchTerm = (event.target as HTMLInputElement).value.trim();

    if (!this.searchTerm) {
      this.productGroups = [];
      return;
    }

    this.isLoading = true;

    try {
      const products = await this.productEditService.searchProducts(
        this.searchTerm,
        this.productColors
      );

      // Group products by master
      this.productGroups = this.groupProductsByMaster(products);

      console.log('✅ Grouped products:', this.productGroups.length, 'groups');
    } catch (error) {
      console.error('❌ Search error:', error);
      this.productGroups = [];
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Group products by MasterUnitId
   * Master = product with MasterUnitId === null
   * Children = products with MasterUnitId === master.Id
   * Returns array of { master, children[] }
   */
  private groupProductsByMaster(products: EditedProduct[]): ProductGroup[] {
    const groups: ProductGroup[] = [];
    const processedIds = new Set<number>();

    // First pass: Find all masters (MasterUnitId === null)
    const masters = products.filter(p => !p.MasterUnitId || p.MasterUnitId === null);

    masters.forEach(master => {
      if (processedIds.has(master.Id)) return;

      // Find children: products with MasterUnitId === master.Id
      const children = products.filter(p =>
        p.MasterUnitId === master.Id &&
        p.Id !== master.Id &&
        !processedIds.has(p.Id)
      );

      // Sort children by ConversionValue (ascending)
      children.sort((a, b) => {
        const convA = Number(a.ConversionValue) || 0;
        const convB = Number(b.ConversionValue) || 0;
        return convA - convB;
      });

      groups.push({
        master: master,
        children: children
      });

      processedIds.add(master.Id);
      children.forEach(c => processedIds.add(c.Id));
    });

    // Handle orphan products (have MasterUnitId but master not in list)
    products.forEach(product => {
      if (!processedIds.has(product.Id)) {
        groups.push({
          master: product,
          children: []
        });
        processedIds.add(product.Id);
      }
    });

    return groups;
  }

  onProductChange(updatedProduct: EditedProduct, groupIndex: number) {
    this.productGroups[groupIndex].master = updatedProduct;
    this.saveToLocalStorage(updatedProduct);
  }

  onChildrenChange(updatedChildren: EditedProduct[], groupIndex: number) {
    this.productGroups[groupIndex].children = updatedChildren;
    updatedChildren.forEach(child => this.saveToLocalStorage(child));
  }

  private saveToLocalStorage(product: EditedProduct) {
    try {
      localStorage.setItem(`editing_childProduct_${product.Id}`, JSON.stringify(product));
    } catch (err) {
      console.error('Failed to save product to localStorage:', err);
    }
  }

  onUpdate() {
    console.log('🔍 [onUpdate] Starting update process');

    // Flatten all products from groups
    const allProducts: EditedProduct[] = [];
    this.productGroups.forEach(group => {
      allProducts.push(group.master);
      allProducts.push(...group.children);
    });

    // Save to edited_products_*
    this.productEditService.saveEditedProducts(this.searchTerm);

    // Filter only EDITED products
    const editedProducts = allProducts.filter(p => p.Edited === true);

    console.log('🚀 [onUpdate] Opening dialog with', editedProducts.length, 'edited products');

    this.dialog.open(EditedItemDialog, {
      width: '70vw',
      height: 'auto',
      maxWidth: '100vw',
      data: { products: editedProducts }
    });
  }

  /**
   * Clear all cache data from localStorage
   * Includes: editing_*, search_*, grouped_*, edited_products_*
   */
  clearAllCache() {

    try {
      this.productEditService.clearCache();

      // Also clear current editing session
      this.productGroups = [];
      this.searchTerm = '';
      this.searchControl.setValue('');

      console.log('✅ All cache cleared successfully');
    } catch (error) {
      console.error('❌ Error clearing cache:', error);
      alert('❌ Lỗi khi xóa cache!');
    }
  }

  addProduct() {
    const dialogRef = this.dialog.open(InputProductDialogComponent, {
      width: '900px',
      maxWidth: '96vw'
    });

    dialogRef.afterClosed().subscribe((result: any) => {
      if (result && result.saved && result.product) {
        console.log('✅ New product added:', result.product);
        // Optionally refresh the search
        if (this.searchTerm) {
          this.onSearch({ target: { value: this.searchTerm } } as any);
        }
      }
    });
  }

  private setupConnectivityHint() {
    if (typeof window === 'undefined') {
      return;
    }

    this.isNetworkOffline = !this.getNavigatorOnlineStatus();
    this.updateOfflineHint();

    this.connectivitySubscriptions.add(fromEvent(window, 'online').subscribe(() => {
      this.isNetworkOffline = false;
      this.updateOfflineHint();
    }));

    this.connectivitySubscriptions.add(fromEvent(window, 'offline').subscribe(() => {
      this.isNetworkOffline = true;
      this.updateOfflineHint();
    }));
  }

  private getNavigatorOnlineStatus(): boolean {
    return typeof navigator === 'undefined' ? true : navigator.onLine;
  }

  private updateOfflineHint() {
    if (this.isNetworkOffline) {
      this.showOfflineHint = true;
      this.hintMessage = 'Không thể kết nối internet, dữ liệu sẽ được đồng bộ khi có mạng trở lại.';
      return;
    }

    this.showOfflineHint = false;
    this.hintMessage = '';
  }

  getProductColor(productId: string | number): string {
    const key = String(productId);
    return this.productColors[key] || '#ffffff';
  }

  trackByGroup(index: number, group: ProductGroup): number {
    return group.master.Id;
  }
}
