import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { assignColorsToProductList } from './utility-functions/app.color';
import { SendDataToKiotVietService } from './data-function/app.send-data-to-kiotviet';
import { groupProducts } from './utility-functions/app.group-item';
import { showNotification } from './utility-functions/app.notification';
import { clearCache } from './data-function/app.save';
import { IndexedDBService } from '../../services/indexed-db.service';
import { ProductService } from '../../services/product.service';

@Component({
  selector: 'edited-products-dialog', standalone: true,
  imports: [
    CommonModule,
    MatDialogModule, // Đảm bảo MatDialogModule được import
    MatTableModule,
    MatButtonModule,
    MatIconModule

  ],
  templateUrl: './edited-products-dialog.component.html',
  styleUrls: ['./dialog.component.css', './button.component.css']
})

export class EditedItemDialog {
  displayedColumns: string[] = ['Image', 'Code', 'FullName', 'BasePrice', 'OldBasePrice', 'Cost', 'OldCost', 'OnHand'];
  filteredProducts: any[] = []; // Lưu danh sách sản phẩm đã lọc
  productColors: Record<string, string> = {};
  constructor(
    public dialogRef: MatDialogRef<EditedItemDialog>,
    @Inject(MAT_DIALOG_DATA) public data: any,
    private sendDataToKiotVietService: SendDataToKiotVietService,
    private indexedDBService: IndexedDBService,
    private productService: ProductService
  ) {
    const seen = new Set<string>();

    data.products.forEach((item: any) => {
      Object.values(item).forEach((group: any) => {
        Object.values(group as any).forEach((arr: any) => {
          (arr as any[]).forEach((y: any) => {
            const dedupeKey = String(y?.Id ?? y?.Code ?? JSON.stringify(y));
            if (seen.has(dedupeKey)) {
              return;
            }

            seen.add(dedupeKey);

            const originalCode = y?.OriginalCode ?? y?.originalCode ?? y?.Code ?? '';
            const originalFullName = y?.OriginalFullName ?? y?.originalFullName ?? y?.FullName ?? '';

            const cloned = {
              ...y,
              OriginalCode: originalCode,
              OriginalFullName: originalFullName
            } as any;

            if (Array.isArray(cloned.ListProduct)) {
              cloned.ListProduct = (cloned.ListProduct as any[]).map((child: any) => ({
                ...child,
                OriginalCode: child?.OriginalCode ?? child?.Code
              }));
            }

            this.filteredProducts.push(cloned);
          });
        });
      });
    });
    assignColorsToProductList(this.filteredProducts, this.productColors)
  }
  getProductColor(productCode: string): string {
    return this.productColors[productCode] || '#ffffff'; // Mặc định là màu trắng
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
    console.log(groupedProduct);

    const allToUpdate: any[] = [];

    for (const [key, products] of Object.entries(groupedProduct)) {
      // products là array các sản phẩm trong group
      const lowestConversionItem = products.reduce((prev: any, curr: any) => {
        return parseFloat(curr.ConversionValue) < parseFloat(prev.ConversionValue) ? curr : prev;
      }, products[0]);
      const rest = products.filter((item: any) => item !== lowestConversionItem);

      await this.sendDataToKiotVietService.sendProductData(lowestConversionItem, rest);

      allToUpdate.push(...[lowestConversionItem, ...rest]);
    }

    // --- Cập nhật lại dữ liệu vào IndexedDB ---
    for (const prod of allToUpdate) {
      // Tìm sản phẩm mới nhất trong filteredProducts (đã chỉnh sửa trên UI)
      const updated = this.filteredProducts.find(p => p.Id === prod.Id);
      const dbProduct = await this.productService.getProductByIdFromIndexedDB(prod.Id);
      if (dbProduct && updated) {
        dbProduct.FullName = updated.FullName;
        dbProduct.Code = updated.Code;
        dbProduct.BasePrice = updated.BasePrice;
        dbProduct.Cost = updated.Cost;
        dbProduct.OnHand = updated.OnHand;
        await this.productService.updateProductFromIndexedDB(dbProduct);
      }
    }

    // --- Đồng bộ lên Firestore ---
    await this.productService.updateProductsBatchToFirebase(groupedProduct);

    // Backend will broadcast updates after the REST batch update (`updateProductsBatchToFirebase`).
    // Clients should not send incoming product updates over WebSocket anymore.
    clearCache();
    showNotification('Đã gửi dữ liệu thành công!');
  }
}