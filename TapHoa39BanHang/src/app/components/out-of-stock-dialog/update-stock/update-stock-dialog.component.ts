import { CommonModule } from '@angular/common';
import { Component, Inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { Product } from '../../../models/product.model';
import { ProductService } from '../../../services/product.service';
import { KiotvietService } from '../../../services/kiotviet.service';
import { GroupService } from '../../../services/group.service';

interface UpdateStockDialogData {
  productId?: number;
  product?: Product;
}

@Component({
  selector: 'app-update-stock-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSnackBarModule
  ],
  templateUrl: './update-stock-dialog.component.html',
  styleUrls: ['./update-stock-dialog.component.css']
})
export class UpdateStockDialogComponent implements OnInit {
  product: Product | null = null;
  newOnHand = 0;
  isSaving = false;
  errorMessage = '';
  private productId: number | null = null;

  constructor(
    private dialogRef: MatDialogRef<UpdateStockDialogComponent>,
    @Inject(MAT_DIALOG_DATA) private data: UpdateStockDialogData,
    private productService: ProductService,
    private kiotvietService: KiotvietService,
    private groupService: GroupService,
    private snackBar: MatSnackBar
  ) { }

  async ngOnInit(): Promise<void> {
    await this.loadProduct();
  }

  private async loadProduct(): Promise<void> {
    try {
      const productId = this.data?.productId || this.data?.product?.Id;
      if (!productId) {
        throw new Error('Không xác định được sản phẩm để chỉnh sửa.');
      }
      this.productId = productId;

      const indexedDbProduct = await this.productService.getProductByIdFromIndexedDB(productId);
      if (!indexedDbProduct) {
        throw new Error('Không tìm thấy dữ liệu sản phẩm trong IndexedDB.');
      }

      this.product = {
        ...this.data?.product,
        ...indexedDbProduct
      } as Product;
      this.newOnHand = Number(this.product.OnHand ?? 0);
    } catch (error) {
      console.error('Failed to load product for update-stock dialog:', error);
      this.errorMessage = 'Không thể tải dữ liệu sản phẩm. Vui lòng thử lại sau.';
    }
  }

  cancel(): void {
    this.dialogRef.close();
  }

  async save(): Promise<void> {
    if (!this.productId) {
      return;
    }

    const parsedOnHand = Number(this.newOnHand);
    if (!Number.isFinite(parsedOnHand) || parsedOnHand < 0) {
      this.errorMessage = 'Giá trị tồn kho không hợp lệ.';
      return;
    }

    this.isSaving = true;
    this.errorMessage = '';

    try {
      const refreshedProduct = await this.productService.getProductByIdFromIndexedDB(this.productId);
      if (!refreshedProduct) {
        throw new Error('Không thể lấy dữ liệu sản phẩm đầy đủ từ IndexedDB.');
      }
      const masterUnitId = refreshedProduct.MasterUnitId || refreshedProduct.Id;

      const allProducts = await this.productService.getAllProductsFromIndexedDB();
      const groupedProducts = this.groupService.group(allProducts);
      const group = groupedProducts[masterUnitId];

      if (!group || group.length === 0) {
        throw new Error('Không tìm thấy nhóm đơn vị cho sản phẩm này.');
      }

      const targetProduct = group.find(p => p.Id === refreshedProduct.Id) || refreshedProduct;
      const masterItem = group.find(p => p.MasterUnitId == null) || group[0];

      if (!masterItem) {
        throw new Error('Không xác định được sản phẩm master để cập nhật.');
      }

      const conversionValue = Number(targetProduct.ConversionValue) || 1;
      const masterOnHand = parsedOnHand * conversionValue;

      await this.updateKiotViet(masterItem.Id, masterOnHand);

      const productsToUpdate = group.map(productInGroup => {
        const unitConversion = Number(productInGroup.ConversionValue) || 1;
        const updated = { ...productInGroup } as Product;
        updated.OnHand = masterOnHand / unitConversion;
        return updated;
      });

      await this.applyLocalUpdates(productsToUpdate);
      await this.pushUpdatesToRemote(productsToUpdate);
      // Backend removed incoming websocket updates. Poll the backend fetch endpoint
      // to get the freshest product documents and persist them locally.
      try {
        const ids = productsToUpdate.map(p => p.Id);
        await this.productService.fetchProductsByIds(ids);
      } catch (fetchErr) {
        console.warn('Failed to fetch latest products after remote update', fetchErr);
      }

      this.product = refreshedProduct;
      this.product.OnHand = parsedOnHand;

      try {
        await this.productService.deleteOutOfStockEntry(this.productId);
      } catch (deleteError) {
        console.warn('Không thể xóa sản phẩm khỏi SalesDB/outofstock sau khi cập nhật:', deleteError);
      }

      this.snackBar.open('Đã cập nhật tồn kho sản phẩm.', 'Đóng', { duration: 4000 });
      this.dialogRef.close({ updatedProducts: productsToUpdate });
    } catch (error) {
      console.error('Failed to save OnHand changes:', error);
      this.errorMessage = 'Không thể cập nhật tồn kho. Vui lòng thử lại.';
      this.snackBar.open('Cập nhật tồn kho thất bại. Thử lại sau.', 'Đóng', { duration: 4000 });
    } finally {
      this.isSaving = false;
    }
  }

  private async applyLocalUpdates(productsToUpdate: Product[]): Promise<void> {
    try {
      await this.productService.updateProductsOnHandLocal(productsToUpdate);
    } catch (dbError) {
      console.error('Không thể cập nhật batch OnHand trong IndexedDB:', dbError);
    }

    for (const productToEmit of productsToUpdate) {
      try {
        await this.productService.updateSingleProductOnHandLocal(productToEmit.Id, productToEmit.OnHand);
      } catch (singleError) {
        console.warn('Không thể cập nhật IndexedDB cho sản phẩm', productToEmit.Id, singleError);
      }
    }
  }

  private emitSocketNotification(productsToUpdate: Product[]): void {
    // WebSocket is removed on backend; instead poll the backend fetch endpoint
    try {
      const ids = productsToUpdate.map(p => p.Id);
      // fire-and-forget refresh of latest docs
      this.productService.fetchProductsByIds(ids).catch(err => console.warn('emitSocketNotification: fetchProductsByIds failed', err));
    } catch (err) {
      console.warn('emitSocketNotification replacement failed', err);
    }
  }

  private async pushUpdatesToRemote(productsToUpdate: Product[]): Promise<void> {
    try {
      if (typeof this.productService.updateProductOnHandToFireStore === 'function') {
        await this.productService.updateProductOnHandToFireStore(productsToUpdate);
        return;
      }

      const serviceAsAny = this.productService as any;
      const httpClient = serviceAsAny.http;
      const firebaseConfig = serviceAsAny.firebase;

      if (httpClient && firebaseConfig?.update_products_api) {
        const url = `${environment.domainUrl}${firebaseConfig.update_products_api}`;
        await firstValueFrom(httpClient.put(url, productsToUpdate));
        return;
      }

      if (httpClient) {
        const fallbackUrl = `${environment.domainUrl}/api/firebase/update/products`;
        await firstValueFrom(httpClient.put(fallbackUrl, productsToUpdate));
        return;
      }

      console.warn('Không có HTTP client để đồng bộ tồn kho lên backend.');
    } catch (remoteError) {
      console.error('Không thể đồng bộ tồn kho lên backend/Firestore:', remoteError);
    }
  }

  private async updateKiotViet(masterProductId: number, masterOnHand: number): Promise<void> {
    try {
      const formData = await this.kiotvietService.getRequestBody(masterProductId);
      if (formData?.Product) {
        formData.Product.OnHand = masterOnHand;
        await this.kiotvietService.updateProductToKiotviet(formData);
      } else {
        console.warn('Không lấy được thông tin sản phẩm từ KiotViet để cập nhật OnHand.');
      }
    } catch (error) {
      console.error('Không thể cập nhật KiotViet trong update-stock dialog:', error);
      // Không throw để tránh chặn các bước tiếp theo
    }
  }
}
