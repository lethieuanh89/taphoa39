import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { assignColorsToProductList } from './utility-functions/app.color';
import { SendDataToKiotVietService } from './data-function/app.send-data-to-kiotviet';
import { groupProducts } from './utility-functions/app.group-item';
import { showNotification } from './utility-functions/app.notification';
import { IndexedDBService } from '../../services/indexed-db.service';
import { ProductService } from '../../services/product.service';
import { ProductRowComponent } from './product-row/product-row.component';
import { EditedProduct } from './services/product-edit.service';

interface ProductGroup {
  master: EditedProduct;
  children: EditedProduct[];
}

@Component({
  selector: 'edited-products-dialog', standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    ScrollingModule,
    ProductRowComponent
  ],
  templateUrl: './edited-products-dialog.component.html',
  styleUrls: ['./dialog.component.css', './button.component.css']
})

export class EditedItemDialog {
  // New: Use ProductGroup structure like edit-product-page-refactored
  productGroups: ProductGroup[] = [];
  productColors: Record<string, string> = {};

  // Keep old for backward compatibility with sendDataClick
  filteredProducts: EditedProduct[] = [];

  constructor(
    public dialogRef: MatDialogRef<EditedItemDialog>,
    @Inject(MAT_DIALOG_DATA) public data: any,
    private sendDataToKiotVietService: SendDataToKiotVietService,
    private indexedDBService: IndexedDBService,
    private productService: ProductService
  ) {
    console.log('🔵 [Dialog Constructor] Received data:', data.products);

    // Process products into flat array
    const allProducts: EditedProduct[] = [];
    const seen = new Set<string>();

    if (Array.isArray(data.products)) {
      data.products.forEach((product: any) => {
        const dedupeKey = String(product?.Id ?? product?.Code);
        if (!seen.has(dedupeKey)) {
          seen.add(dedupeKey);
          allProducts.push(product);
        }
      });
    }

    console.log('🟢 [Dialog Constructor] Processed products:', allProducts.length);

    // Assign colors to all products
    assignColorsToProductList(allProducts, this.productColors);

    // Group products by master
    this.productGroups = this.groupProductsByMaster(allProducts);

    // Keep flat list for backward compatibility
    this.filteredProducts = allProducts;

    console.log('✅ [Dialog Constructor] Created', this.productGroups.length, 'groups');
  }

  /**
   * Group products by MasterUnitId
   * Master = product with MasterUnitId === null
   * Children = products with MasterUnitId === master.Id
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

  getProductColor(productId: string | number): string {
    // Convert to string to match the key format used in productColors map
    const key = String(productId);
    return this.productColors[key] || '#ffffff'; // Mặc định là màu trắng
  }

  trackByGroup(index: number, group: ProductGroup): number {
    return group.master.Id;
  }

  getCostClass(cost: number, oldCost: number): string {
    if (cost > oldCost) return 'text-red';
    if (cost < oldCost) return 'text-green';
    return '';
  }
  getCostClassHighlight(cost: number, oldCost: number, isMaster: boolean): any {
    return {
      [this.getCostClass(cost, oldCost)]: true,
      'highlight': isMaster
    };
  }
  getBasePriceClass(basePrice: number, oldbasePrice: number): string {
    if (basePrice < oldbasePrice) return 'text-red';
    if (basePrice > oldbasePrice) return 'text-green';
    return '';
  }
  getBasePriceClassHighlight(cost: number, oldCost: number, isMaster: boolean): any {
    return {
      [this.getBasePriceClass(cost, oldCost)]: true,
      'highlight': isMaster
    };
  }
  async sendDataClick(): Promise<void> {
    const groupedProduct = groupProducts(this.filteredProducts);
    console.log('🔷 [sendDataClick] filteredProducts count:', this.filteredProducts.length);
    console.log('🔷 [sendDataClick] groupedProduct:', groupedProduct);

    const allToUpdate: any[] = [];
    const groupsToSend: Array<{ master: any; children: any[] }> = [];

    // Step 1: Prepare all groups WITHOUT calling KiotViet API yet
    for (const [key, initialProducts] of Object.entries(groupedProduct)) {
      console.log(`\n🔷 [sendDataClick] Processing group "${key}":`, initialProducts.map((p: any) => ({
        Id: p.Id,
        Code: p.Code,
        ConversionValue: p.ConversionValue,
        MasterProductId: p.MasterProductId,
        MasterUnitId: p.MasterUnitId
      })));

      let products = initialProducts;

      // CRITICAL: If group has only 1 product with MasterProductId, we need to fetch its siblings!
      if (products.length === 1 && products[0].MasterProductId) {
        const masterId = products[0].MasterProductId;
        console.warn(`⚠️ [sendDataClick] Group has only 1 child product (Id=${products[0].Id}) with MasterProductId=${masterId}!`);
        console.warn(`⚠️ Need to load all products in this group from filteredProducts...`);

        // CRITICAL: Find siblings from this.filteredProducts FIRST (has updated BasePrice/Cost)
        const expandedProducts: any[] = [...products];

        this.filteredProducts.forEach((p: any) => {
          if ((p.Id === masterId || p.MasterProductId === masterId) &&
            !expandedProducts.find(existing => existing.Id === p.Id)) {
            console.log(`✅ Adding product from filteredProducts: Id=${p.Id}, Code=${p.Code}, BasePrice=${p.BasePrice}`);
            expandedProducts.push(p);
          }
        });

        // If still not enough, fallback to localStorage grouped_* (but this should rarely happen now)
        if (expandedProducts.length < 2) {
          console.warn(`⚠️ Still only ${expandedProducts.length} products, checking localStorage grouped_*...`);
          const allGroupedProducts = Object.entries(localStorage)
            .filter(([k]) => k.startsWith('grouped_'))
            .map(([_, v]) => JSON.parse(v));

          allGroupedProducts.forEach((grouped: any) => {
            Object.values(grouped).forEach((productList: any) => {
              if (Array.isArray(productList)) {
                productList.forEach((p: any) => {
                  if (p.Id === masterId || p.MasterProductId === masterId) {
                    if (!expandedProducts.find(existing => existing.Id === p.Id)) {
                      console.log(`✅ Adding product from localStorage: Id=${p.Id}, Code=${p.Code}`);
                      expandedProducts.push(p);
                    }
                  }
                });
              }
            });
          });
        }

        products = expandedProducts;
        console.log(`📊 Expanded group to ${products.length} products`);
      }

      // Find the REAL KiotViet master product
      let masterProduct = products.find((p: any) =>
        !p.MasterProductId || p.MasterProductId === null || p.MasterProductId === undefined
      );

      console.log('🔍 [Strategy 1] Product without MasterProductId:', masterProduct ? {
        Id: masterProduct.Id,
        Code: masterProduct.Code,
        ConversionValue: masterProduct.ConversionValue
      } : 'NOT FOUND');

      // If not found, use MasterProductId to find the master
      if (!masterProduct && products.length > 0 && products[0].MasterProductId) {
        const masterId = products[0].MasterProductId;
        console.log(`⚠️ All products have MasterProductId. Looking for Id=${masterId} in group...`);

        masterProduct = products.find((p: any) => p.Id === masterId);

        console.log('🔍 [Strategy 2] Search by MasterProductId:', masterProduct ? {
          Id: masterProduct.Id,
          Code: masterProduct.Code,
          ConversionValue: masterProduct.ConversionValue
        } : 'NOT FOUND');
      }

      // Last resort: find by lowest ConversionValue
      if (!masterProduct) {
        console.log('⚠️ Falling back to lowest ConversionValue...');
        masterProduct = products.reduce((prev: any, curr: any) => {
          return parseFloat(curr.ConversionValue) < parseFloat(prev.ConversionValue) ? curr : prev;
        }, products[0]);

        console.log('🔍 [Strategy 3] Lowest ConversionValue:', {
          Id: masterProduct.Id,
          Code: masterProduct.Code,
          ConversionValue: masterProduct.ConversionValue
        });
      }

      const rest = products.filter((item: any) => item.Id !== masterProduct.Id);

      console.log('📍 [sendDataClick] Prepared group for sending:', {
        masterProduct: {
          Id: masterProduct.Id,
          Code: masterProduct.Code,
          BasePrice: masterProduct.BasePrice,
          FinalBasePrice: masterProduct.FinalBasePrice || 0,
          Cost: masterProduct.Cost,
          OnHand: masterProduct.OnHand
        },
        childProducts: rest.map((p: any) => ({
          Id: p.Id,
          Code: p.Code,
          BasePrice: p.BasePrice,
          FinalBasePrice: p.FinalBasePrice || 0,
          Cost: p.Cost,
          OnHand: p.OnHand
        }))
      });

      groupsToSend.push({ master: masterProduct, children: rest });
      allToUpdate.push(...[masterProduct, ...rest]);
    }

    // Step 2: Call KiotViet API ONCE with all groups
    console.log('🚀 [sendDataClick] Calling KiotViet API with', groupsToSend.length, 'groups');
    for (const group of groupsToSend) {
      console.log("🚀 Sending group: ", {
        master: group.master.Code,
        childrenCount: group.children.length
      });

      await this.sendDataToKiotVietService.sendAllProductData([group]);
    }

    // --- Cập nhật lại dữ liệu vào IndexedDB ---
    for (const prod of allToUpdate) {
      // Tìm sản phẩm mới nhất trong filteredProducts (đã chỉnh sửa trên UI)
      const updated = this.filteredProducts.find(p => p.Id === prod.Id);
      const dbProduct = await this.productService.getProductByIdFromIndexedDB(prod.Id);
      if (dbProduct && updated) {
        // CRITICAL: Determine if BasePrice was changed by user
        const basePriceChanged = updated.BasePrice !== undefined &&
          updated.FinalBasePrice !== undefined &&
          updated.BasePrice !== updated.FinalBasePrice;

        // CRITICAL: Use BasePrice if user changed it, otherwise use OriginalBasePrice (FinalBasePrice)
        let newBasePrice: number;
        if (basePriceChanged) {
          // User changed BasePrice → use the new value
          newBasePrice = updated.BasePrice;
        } else {
          // BasePrice not changed → use original value
          newBasePrice = updated.FinalBasePrice || updated.BasePrice;
        }

        console.log(`🔄 [sendDataClick] Updating IndexedDB for product Id=${updated.Id}:`, {
          OldCode: dbProduct.Code,
          NewCode: updated.Code,
          OldName: dbProduct.Name,
          NewName: updated.Name,
          OldBasePrice: dbProduct.BasePrice,
          NewBasePrice: newBasePrice,
          BasePriceChanged: basePriceChanged,
          OldCost: dbProduct.Cost,
          NewCost: updated.Cost,
          OldOnHand: dbProduct.OnHand,
          NewOnHand: updated.OnHand
        });

        // Update Code - CRITICAL: Code can be changed by user
        if (updated.Code && updated.Code !== dbProduct.Code) {
          console.log(`✅ [sendDataClick] Updating Code in IndexedDB: ${dbProduct.Code} → ${updated.Code}`);
          dbProduct.Code = updated.Code;
        }

        // Update Name - CRITICAL: Name can be changed by user
        if (updated.Name && updated.Name !== dbProduct.Name) {
          console.log(`✅ [sendDataClick] Updating Name in IndexedDB: ${dbProduct.Name} → ${updated.Name}`);
          dbProduct.Name = updated.Name;
        }

        // IMPORTANT: Do NOT update FullName - it's auto-generated from Name + ProductAttributes + Unit
        // When Name changes, KiotViet will automatically regenerate FullName

        // Update BasePrice
        if (newBasePrice !== dbProduct.BasePrice) {
          console.log(`✅ [sendDataClick] Updating BasePrice in IndexedDB: ${dbProduct.BasePrice} → ${newBasePrice}`);
          dbProduct.BasePrice = newBasePrice;
        }

        if (updated.Cost !== dbProduct.Cost) {
          console.log(`✅ [sendDataClick] Updating Cost in IndexedDB: ${dbProduct.Cost} → ${updated.Cost}`);
          dbProduct.Cost = updated.Cost;
        }

        if (updated.OnHand !== dbProduct.OnHand) {
          console.log(`✅ [sendDataClick] Updating OnHand in IndexedDB: ${dbProduct.OnHand} → ${updated.OnHand}`);
          dbProduct.OnHand = updated.OnHand;
        }

        // Remove FinalBasePrice from dbProduct - it's only for UI calculation, should not be stored
        if ('FinalBasePrice' in dbProduct) {
          delete (dbProduct as any).FinalBasePrice;
        }

        await this.productService.updateProductFromIndexedDB(dbProduct);
      }
    }

    // --- Đồng bộ lên Firestore ---
    await this.productService.updateProductsBatchToFirebase(groupedProduct);

    // Backend will broadcast updates after the REST batch update (`updateProductsBatchToFirebase`).
    // Clients should not send incoming product updates over WebSocket anymore.

    // Clear all cache after successful update
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (
          key.startsWith('grouped_') ||
          key.startsWith('search_') ||
          key.startsWith('edited_products_') ||
          key.startsWith('editing_childProduct_')
        )) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => localStorage.removeItem(key));
    } catch (error) {
      console.error('Error clearing cache:', error);
    }

    showNotification('Đã gửi dữ liệu và xóa cache thành công!');
  }
}