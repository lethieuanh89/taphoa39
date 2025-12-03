import { Component, OnInit, OnDestroy, Inject, NgZone } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, Subscription, fromEvent } from 'rxjs';
import { map, startWith } from 'rxjs/operators';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatCardModule } from '@angular/material/card';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { RouterModule, Routes } from '@angular/router';
import { FormsModule, FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { assignColorsToProductList } from './utility-functions/app.color';
import { validateNumber } from './utility-functions/app.validate-number';
import { onSearch } from './data-function/app.search';
import { onSave, clearCache } from './data-function/app.save';
import { showEditedProducts } from './utility-functions/app.show';
import { loadData } from './data-function/app.load-data';
import { CostService } from './services/cost.service';
import { InputDialog } from './input-dialog.component';
import { LowStockDialog } from './low-stock-dialog.component';
import { EditedItemDialog } from './edited-products-dialog.component';
import { ProductService } from '../../services/product.service';
import { InputProductDialogComponent } from './add-product-dialog/add-product-dialog.component';


interface IWindow extends Window {
  webkitSpeechRecognition: any;
}
@Component({
  selector: 'edit-product-page',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatToolbarModule,
    MatButtonModule,
    MatTableModule,
    MatTooltipModule,
    MatDialogModule,
    RouterModule,
    FormsModule,
    MatAutocompleteModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
    MatIconModule
  ],
  templateUrl: './edit-product-page.component.html',
  styleUrls: [
    './edit-product-page.component.css',
    './button.component.css',
    './category.component.css'
  ],
})

export class EditProductPageComponent implements OnInit, OnDestroy {

  searchControl = new FormControl('');
  filteredOptions!: Observable<{ value: string; FullName: string; Image: string; }[]>;
  options: { FullName: string; Image: string }[] = []; // Replace with your data source

  productColors: Record<string, string> = {}; // Lưu màu sắc cho từng nhóm ProductList
  displayedRows: any[] = [];
  isLoading = false;
  data$!: Observable<any[]>;
  error: string | null = null;
  filteredProducts: any[] = [];
  categories: { id?: number; name: string; path: string; }[] = [];
  activeCategory: string | null = null;
  displayedColumns: string[] = [
    'Image',
    'Code',
    'FullName',
    'AverageCheckPoint',
    'FinalBasePrice',
    'BasePrice',
    'Cost',
    'OnHand',
    'Unit',
    // 'PackCost',
    // 'OriginalBoxPrice',
    // 'Description',
    // 'PackingSpec',
    'UnitSpec',
    'Box',
    'Retail',
    'Discount',
    'Discount2',
    'TotalPrice'

  ];
  dataSource: any;
  recognition: any;
  showOfflineHint = false;
  hintMessage = '';
  private isNetworkOffline = false;
  private isRealtimeUnavailable = false;
  private connectivitySubscriptions = new Subscription();
  constructor(
    private http: HttpClient,
    public dialog: MatDialog,
    private costService: CostService,
    private ngZone: NgZone,
    private productService: ProductService,


  ) {
    const { webkitSpeechRecognition }: IWindow = (window as unknown) as IWindow;
    this.recognition = new webkitSpeechRecognition();
    this.recognition.lang = 'vi-VN'; // hoặc 'en-US' nếu muốn tiếng Anh
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
  activeButton = '';
  userChangedFinalBasePrice: Record<string, boolean> = {};
  changedFinalBasePrice = '';
  ngOnInit() {
    // const groupedProducts = groupProducts(this.filteredProducts);
    assignColorsToProductList(this.filteredProducts, this.productColors);
    this.filteredOptions = this.searchControl.valueChanges.pipe(
      startWith(''),
      map(value => this._filter(value || ''))
    );

    this.searchControl.valueChanges.subscribe(value => {
      const selectedOption = this.options.find(option => option.FullName === value);
      if (selectedOption) {
        this.searchTerm = selectedOption.FullName; // Update searchTerm with the selected option
      }
    });

    this.setupConnectivityHint();
  }

  ngOnDestroy(): void {
    this.connectivitySubscriptions.unsubscribe();
  }

  private _filter(value: string): any[] {
    const filterValue = value.toLowerCase();
    const searchKeys = Object.keys(localStorage).filter((key) => key.startsWith("search_"));

    const allGroupedProducts = searchKeys.map((key) => JSON.parse(localStorage.getItem(key) || "[]"));

    this.options = allGroupedProducts.flatMap(product =>
      product.map((item: { FullName: any; Image: string; }) => ({
        FullName: item.FullName,
        Image: item.Image
      }))
    );
    return this.options.filter(option => option.FullName.toLowerCase().includes(filterValue));
  }

  loadData(category: string) {
    loadData(
      category,
      this.http,
      (products) => this.setInitialBasePrices(products), // snapshot const basePrice then assign
      (isLoading) => (this.isLoading = isLoading), // Cập nhật trạng thái loading
      (showWarning) => (this.showLowStockWarning = showWarning) // Cập nhật cảnh báo tồn kho thấp
    );
  }
  // Hàm xử lý sự kiện khi người dùng nhấp vào danh mục

  onCategoryClick(category: string) {
    this.activeCategory = category; // Cập nhật danh mục đang hoạt động
    loadData(
      category,
      this.http,
      (products) => this.setInitialBasePrices(products), // snapshot const basePrice then assign
      (isLoading) => (this.isLoading = isLoading), // Cập nhật trạng thái loading
      (showWarning) => (this.showLowStockWarning = showWarning) // Cập nhật cảnh báo tồn kho thấp
    );
  }


  getProductColor(productCode: string): string {
    return this.productColors[productCode] || '#ffffff'; // Mặc định là màu trắng
  }

  searchTerm = '';
  onSearch(event: Event) {

    this.searchTerm = (event.target as HTMLInputElement).value.trim().toLowerCase();
    // Sử dụng search từ IndexedDB thay vì onSearch cũ
    onSearch(this.http,
      this.productColors,
      this.filteredProducts,
      (isLoading) => (this.isLoading = isLoading),
      this.searchTerm, (data) => this.setInitialBasePrices(data));
  }

  // Ensure each product has an immutable snapshot of BasePrice for rendering
  private setInitialBasePrices(products: any[] | null | undefined): void {
    if (!products) {
      this.filteredProducts = [];
      return;
    }

    for (const p of products) {
      if (p && p._constBasePrice === undefined) {
        // store the current BasePrice as a const snapshot
        Object.defineProperty(p, '_constBasePrice', {
          value: p.BasePrice,
          writable: false,
          enumerable: false,
          configurable: false
        });
      }
    }

    this.filteredProducts = products;
  }

  lowStockProducts: any[] = []; // Biến để lưu danh sách sản phẩm tồn kho thấp
  showLowStockWarning = false; // Biến để kiểm soát hiển thị dấu chấm than

  checkRemains() {
    // Lọc các sản phẩm có OnHand < 3
    this.lowStockProducts = this.filteredProducts.filter(product => product.OnHand < 3 && !/thùng/i.test(product.Unit) && !/lốc/i.test(product.Unit));
    this.showLowStockWarning = this.lowStockProducts.length > 0;

    // Mở popup hiển thị danh sách sản phẩm tồn kho thấp
    this.dialog.open(LowStockDialog, {
      width: '600px',
      data: { products: this.lowStockProducts }
    });
  }

  onSave() {
    // If user hasn't changed any FinalBasePrice values, ensure we persist
    // FinalBasePrice using the immutable snapshot `_constBasePrice` so saved
    // data reflects the intended default sale price.
    // For products where the user did not explicitly change FinalBasePrice,
    // populate FinalBasePrice from the immutable snapshot or BasePrice.
    this.filteredProducts.forEach((item: any) => {
      const userChanged = !!this.userChangedFinalBasePrice[item?.Code];
      if (userChanged) return;
        if (!item) return;
        const fallback = item._constBasePrice !== undefined ? item._constBasePrice : item.BasePrice;
        if (fallback !== undefined) {
          item.FinalBasePrice = fallback;
        }
        // mark as edited and persist to the same localStorage key the save routine reads
        item.Edited = true;
        try {
          localStorage.setItem(`editing_childProduct_${item.Code}`, JSON.stringify(item));
        } catch (err) {
          console.error('Failed to persist editing_childProduct for', item.Code, err);
        }
      });

    onSave(this.searchTerm);
  }
  clearCache() {
    clearCache()
  }
  showEditedProducts() {
    showEditedProducts(this.searchTerm, this.filteredProducts);
  }

  updateCost(element: any) {
    if (element.Master) {
      this.costService.updateCostMaster(element);
      this.costService.updateCostChildItems(this.filteredProducts);
    } else {
      this.costService.saveFinal(this.filteredProducts);
    }
  }

  validateNumber(event: KeyboardEvent) {
    validateNumber(event);
  }


  handleNumericKeyDown(event: KeyboardEvent, element: any) {
    if (event.key === ' ' || event.code === 'Space') {
      event.preventDefault();

      if (this.shouldBlockDialog((event.target as HTMLInputElement).value)) {
        return;
      }

      this.openInputDialog(element);
      return;
    }

    this.validateNumber(event);
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

    // productConnection$ is deprecated: backend no longer supports realtime socket status.
    // For compatibility, treat as always connected (REST-only sync).
    this.isRealtimeUnavailable = false;
    this.updateOfflineHint();
  }
  addProduct() {
    const dialogRef = this.dialog.open(InputProductDialogComponent, {
      width: '900px',
      maxWidth: '96vw'
    });

    dialogRef.afterClosed().subscribe((result: any) => {
      if (result && result.saved && result.product) {
        // Insert the new product into the filteredProducts list and persist if needed
        const newProduct = result.product;
        // Basic normalization to match product shape expected in the table
        newProduct.Code = newProduct.code || `P${Date.now()}`;
        newProduct.FullName = newProduct.name || '';
        newProduct.BasePrice = Number(newProduct.price || 0);
        newProduct.Cost = Number(newProduct.cost || 0);
        newProduct.OnHand = Number(newProduct.stock || 0);
        newProduct.Unit = 'Cái';
        newProduct.Master = true;

        this.filteredProducts.unshift(newProduct);
        // Optionally persist to localStorage or call productService to save
        try {
          const key = `new_product_${newProduct.Code}`;
          localStorage.setItem(key, JSON.stringify(newProduct));
        } catch (e) {
          // ignore storage errors
        }
      }
    });
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

    if (this.isRealtimeUnavailable) {
      this.showOfflineHint = true;
      this.hintMessage = 'Mất kết nối realtime tới máy chủ, dữ liệu sẽ tự đồng bộ khi máy chủ hoạt động lại.';
      return;
    }

    this.showOfflineHint = false;
    this.hintMessage = '';
  }

  private shouldBlockDialog(currentValue: string | null | undefined): boolean {
    if (currentValue == null) {
      return false;
    }

    const normalized = currentValue.replace(/,/g, '').trim();

    if (normalized === '') {
      return false;
    }

    const numericValue = Number(normalized);

    if (!Number.isNaN(numericValue) && numericValue === 0) {
      return true;
    }

    return normalized.length > 0;
  }


  formatNumber(value: any): string {
    const num = Number(value);
    if (isNaN(num)) return '';
    return num.toLocaleString('en-US');
  }
  onInputDiscount(event: any, element: any) {
    const input = event.target.value.replace(/,/g, ''); // Bỏ dấu phẩy
    if (!isNaN(Number(input))) {
      element.Discount = Number(input);
    }
  }
  onInputDiscount2(event: any, element: any) {
    const input = event.target.value.replace(/,/g, ''); // Bỏ dấu phẩy
    if (!isNaN(Number(input))) {
      element.Discount2 = Number(input);
    }
  }
  onInputTotalPrice(event: any, element: any) {
    const input = event.target.value.replace(/,/g, ''); // Bỏ dấu phẩy
    if (!isNaN(Number(input))) {
      element.TotalPrice = Number(input);
    }
  }

  onInputFinalBasePrice(event: any, element: any) {
    const input = event.target.value.replace(/,/g, ''); // Bỏ dấu phẩy
    if (!isNaN(Number(input))) {
      element.FinalBasePrice = Number(input);
    }
    if (element && element.Code) {
      this.userChangedFinalBasePrice[element.Code] = true;
    }
  }

  onInputBasePrice(event: any, element: any) {
    const input = event.target.value.replace(/,/g, ''); // Bỏ dấu phẩy
    if (!isNaN(Number(input))) {
      element.BasePrice = Number(input);
    }
  }

  onInputFocus(event: FocusEvent) {
    const input = event.target as HTMLInputElement;

    input.classList.add('tabbed');
    setTimeout(() => input.classList.remove('tabbed'), 300); // gỡ class sau hiệu ứng
  }

  onUpdate() {
    const editedProducts = Object.keys(localStorage)
      .filter((key) => key.startsWith("edited_products_"))
      .map((key) => JSON.parse(localStorage.getItem(key) || "[]"));
    const oldProducts = Object.keys(localStorage)
      .filter((key) => key.startsWith("grouped_"))
      .map((key) => JSON.parse(localStorage.getItem(key) || "[]"));

    const editedProductKeys: any[] = [];
    editedProducts.forEach((editedProduct: any) => {
      editedProduct.forEach((i: any) => {
        editedProductKeys.push(Object.keys(i))
      })
    })

    editedProducts.forEach((editedProduct: any) => {

      editedProductKeys.forEach((keys) => {
        oldProducts.forEach((oldProduct) => {
          keys.forEach((key: any) => {
            if (oldProduct[key]) {


              editedProduct.forEach((editedItem: any) => {
                Object.values(editedItem).forEach((e: any) => {
                  e.forEach((p: any) => {
                    if (p.FinalBasePrice > 0) {
                      p.BasePrice = p.FinalBasePrice
                    }

                    const matchingOldItem = oldProduct[key].find((oldItem: any) => oldItem.Code === p.Code);

                    if (matchingOldItem) {
                      p['OldCost'] = matchingOldItem.Cost;
                      p['OldBasePrice'] = matchingOldItem.BasePrice;
                    }
                  })

                })

              });
            }
          })

        });
      });
    });

    this.dialog.open(EditedItemDialog, {
      width: '70vw',   // hoặc '1000px'
      height: 'auto',  // hoặc 'auto'
      maxWidth: '100vw',
      data: { products: editedProducts }
    });
  }
  openInputDialog(element: any) {
    const dialogRef = this.dialog.open(InputDialog, {
      width: '80vw',   // hoặc '1000px'
      height: 'auto',  // hoặc 'auto'
      maxWidth: '100vw'
    });
    const currentCost = element.Cost;
    dialogRef.afterClosed().subscribe(result => {
      if (result !== undefined) {
        element.Box = result.box
        element.Retail = result.retail
        element.Discount = result.discount
        element.Discount2 = result.discount2
        element.TotalPrice = result.totalPrice

        element.Cost = (parseInt(element.TotalPrice) / (parseInt(element.Box) * parseInt(element.ConversionValue) + parseInt(element.Retail))) * parseInt(element.ConversionValue) || 0;

        if (element.Discount2 > 0) {
          element.Cost = (parseInt(element.TotalPrice) - parseInt(element.Discount2)) / (parseInt(element.Box) * parseInt(element.ConversionValue) + parseInt(element.Retail)) * parseInt(element.ConversionValue) || 0;
        }
        element.OnHand = ((parseFloat(element.OnHand) * parseInt(element.ConversionValue) + parseInt(element.Retail) + parseInt(element.Box) * parseInt(element.ConversionValue)) / parseInt(element.ConversionValue)) || 0
        element.BasePrice = Math.round((parseInt(element.BasePrice) + (parseInt(element.Cost) - parseInt(currentCost))) / 100) * 100;

        localStorage.setItem(`editing_childProduct_${element.Code}`, JSON.stringify(element));
        const oldProducts = Object.entries(localStorage)
          .filter(([key]) => key.startsWith("grouped_"))
          .map(([_, value]) => JSON.parse(value || "[]"));

        this.costService.masterCode = element.Code;
        this.costService.masterOnHand = element.OnHand;
        this.costService.masterConversionValue = element.ConversionValue;
        this.costService.masterDiscount = element.Discount;
        this.costService.masterFinalBasePrice = element.FinalBasePrice;
        this.costService.masterCost = element.Cost;
        this.filteredProducts.forEach((currentItem) => {
          oldProducts.forEach((oP) => {
            const productGroup = oP[this.costService.masterCode];
            if (productGroup) {
              // Tìm sản phẩm trong nhóm sản phẩm
              const matchingProduct = productGroup.find((o: any) => o.Code === currentItem.Code);
              if (matchingProduct) {

                if (currentItem.Master) {
                  currentItem.Cost = Math.round(currentItem.Cost) || 0;
                  currentItem.BasePrice = Math.round(currentItem.BasePrice * 100) / 100 || 0;
                } else {
                  currentItem.OnHand = (parseFloat(this.costService.masterOnHand) * parseFloat(this.costService.masterConversionValue)) / parseFloat(currentItem.ConversionValue) || 0;
                  currentItem.Cost = Math.round((parseInt(this.costService.masterCost) / parseInt(this.costService.masterConversionValue) * parseInt(currentItem.ConversionValue)) || 0);
                  if (parseInt(this.costService.masterDiscount) > 0) {
                    currentItem.Cost = (currentItem.Cost - (parseInt(this.costService.masterDiscount) * parseInt(currentItem.ConversionValue))) || 0;
                  }
                  currentItem.BasePrice = Math.round((matchingProduct.BasePrice + (currentItem.Cost - matchingProduct.Cost)) / 100) * 100 || 0;
                  // if (parseInt(this.costService.masterFinalBasePrice) > 0) {
                  //   currentItem.FinalBasePrice = Math.round((parseInt(this.costService.masterFinalBasePrice) / parseInt(this.costService.masterConversionValue) * parseInt(currentItem.ConversionValue)) || 0);

                  // }
                }

                currentItem.Edited = true;
                if (!currentItem.Master) {
                  localStorage.setItem(`editing_childProduct_${currentItem.Code}`, JSON.stringify(currentItem));
                }
              }
            }
          });
        });
      }
    });
  }
}