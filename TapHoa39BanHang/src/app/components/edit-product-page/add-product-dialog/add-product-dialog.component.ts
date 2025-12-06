import { Component, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { BaseUnitDialogComponent } from './add-product-dialog-base-unit.component';
import { UnitDialogComponent } from './add-product-dialog-unit.component';
import { AttributeDialogComponent } from './add-product-dialog-attribute.component';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { KiotvietService } from '../../../services/kiotviet.service';
import { ProductService } from '../../../services/product.service';

export interface ProductUnit {
  name: string;
  price: number;
  conversion: number;
  isBase: boolean;
}

export interface ProductAttribute {
  name: string;
  values: string[];
}

export interface GeneratedProduct {
  Id: number;
  Code: string;
  Name: string;
  FullName: string;
  CategoryId: number | null;
  isActive: boolean;
  isDeleted: boolean;
  Cost: number;
  BasePrice: number;
  OnHand: number;
  OnHandNV: number;
  Unit: string;
  MasterUnitId: number | null;
  MasterProductId: number | null;
  ConversionValue: number;
  Description: string;
  IsRewardPoint: boolean;
  ModifiedDate: string;
  Image: string | null;
  CreatedDate: string;
  ProductAttributes: any[];
  NormalizedName: string;
  NormalizedCode: string;
  OrderTemplate: string;
}

@Component({
  selector: 'app-add-product-dialog',
  templateUrl: './add-product-dialog.component.html',
  styleUrls: ['./add-product-dialog.component.css'],
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule
  ]
})
export class InputProductDialogComponent implements OnInit {
  selectedTab: 'info' | 'desc' = 'info';
  
  product: any = {
    code: '',
    name: '',
    description: '',
    noteTemplate: '',
    group: null,
    brand: null,
    cost: 0,
    price: 0,
    stock: 0,
    minStock: 0,
    maxStock: 999999999,
    location: '',
    weight: 0
  };

  productUnits: ProductUnit[] = [];
  productAttributes: ProductAttribute[] = [];

  groups: Array<any> = [];
  loadingCategories = false;
  saving = false;

  brands = [
    { id: 'b1', name: 'Thương hiệu A' },
    { id: 'b2', name: 'Thương hiệu B' }
  ];

  imageDataUrl: string | null = null;

  constructor(
    private dialogRef: MatDialogRef<InputProductDialogComponent>,
    private dialog: MatDialog,
    private kiotvietService: KiotvietService,
    private productService: ProductService
  ) {}

  ngOnInit(): void {
    this.loadCategories();
  }

  async loadCategories(): Promise<void> {
    try {
      this. loadingCategories = true;
      const categories = await this. kiotvietService.getCategories();
      this.groups = categories.map(cat => ({
        id: cat.Id,
        name: cat.Name,
        path: cat.Path
      }));
      console.log(`✅ Đã tải ${this.groups.length} categories`);
    } catch (error) {
      console.error('❌ Error loading categories:', error);
      this.groups = [];
    } finally {
      this.loadingCategories = false;
    }
  }

  /**
   * Generate unique product ID using current timestamp (seconds)
   */
  private generateProductId(): number {
    return Math.floor(Date.now() / 1000);
  }

  /**
   * Generate normalized string for search (remove diacritics, uppercase)
   */
  private normalizeString(str: string): string {
    if (!str) return '';
    return str
      .normalize('NFD')
      . replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '_')
      .replace(/_+/g, '_');
  }

  /**
   * Generate all product variants based on units and attributes
   */
  generateAllProducts(): GeneratedProduct[] {
    const now = new Date(). toISOString();
    const baseId = this.generateProductId();
    const generatedProducts: GeneratedProduct[] = [];

    // Validate required fields
    if (! this.product.code || !this.product.name) {
      throw new Error('Mã hàng và tên hàng là bắt buộc');
    }

    if (this.productUnits.length === 0) {
      throw new Error('Cần có ít nhất một đơn vị tính');
    }

    // Get base unit
    const baseUnit = this.productUnits.find(u => u.isBase);
    if (!baseUnit) {
      throw new Error('Cần có đơn vị cơ bản');
    }

    // Collect all units (base + others)
    const allUnits = this. productUnits;

    // Collect all attribute combinations
    const attributeCombinations = this. generateAttributeCombinations();

    let productIndex = 0;

    // If no attributes, just create products for each unit
    if (attributeCombinations. length === 0) {
      for (const unit of allUnits) {
        const productId = baseId + productIndex;
        const masterId = unit.isBase ? null : baseId; // Base unit has no master

        const product = this.createProductObject({
          id: productId,
          masterId: masterId,
          masterProductId: null,
          unit: unit,
          attributeValues: [],
          now: now
        });

        generatedProducts.push(product);
        productIndex++;
      }
    } else {
      // Create products for each combination of unit × attribute values
      for (const attrCombo of attributeCombinations) {
        for (const unit of allUnits) {
          const productId = baseId + productIndex;
          
          // Determine master relationships
          let masterUnitId: number | null = null;
          let masterProductId: number | null = null;

          if (! unit.isBase) {
            // Non-base unit: MasterUnitId = base product Id
            masterUnitId = baseId;
          }

          if (attrCombo.length > 0) {
            // Has attributes: MasterProductId = base product Id
            masterProductId = baseId;
          }

          const product = this.createProductObject({
            id: productId,
            masterId: masterUnitId,
            masterProductId: masterProductId,
            unit: unit,
            attributeValues: attrCombo,
            now: now
          });

          generatedProducts.push(product);
          productIndex++;
        }
      }
    }

    console.log(`✅ Generated ${generatedProducts. length} products`);
    return generatedProducts;
  }

  /**
   * Generate all combinations of attribute values
   * Example: [{name: 'Color', values: ['Red', 'Blue']}, {name: 'Size', values: ['S', 'M']}]
   * Returns: [['Red', 'S'], ['Red', 'M'], ['Blue', 'S'], ['Blue', 'M']]
   */
  private generateAttributeCombinations(): string[][] {
    if (this.productAttributes.length === 0) {
      return [];
    }

    const attributes = this.productAttributes. filter(attr => attr. values.length > 0);
    if (attributes.length === 0) {
      return [];
    }

    // Cartesian product of all attribute values
    let combinations: string[][] = [[]];

    for (const attr of attributes) {
      const newCombinations: string[][] = [];
      for (const combo of combinations) {
        for (const value of attr.values) {
          newCombinations.push([...combo, value]);
        }
      }
      combinations = newCombinations;
    }

    return combinations;
  }

  /**
   * Create a single product object
   */
  private createProductObject(params: {
    id: number;
    masterId: number | null;
    masterProductId: number | null;
    unit: ProductUnit;
    attributeValues: string[];
    now: string;
  }): GeneratedProduct {
    const { id, masterId, masterProductId, unit, attributeValues, now } = params;

    // Build full name with unit and attributes
    let fullName = this.product.name;
    if (unit.name && ! unit.isBase) {
      fullName += ` - ${unit.name}`;
    }
    if (attributeValues.length > 0) {
      fullName += ` - ${attributeValues. join(' - ')}`;
    }

    // Build code with unit and attributes
    let code = this.product.code;
    if (! unit.isBase) {
      code += `-${this.normalizeString(unit.name)}`;
    }
    if (attributeValues.length > 0) {
      code += `-${attributeValues.map(v => this. normalizeString(v)).join('-')}`;
    }

    // Build ProductAttributes array
    const productAttributes: any[] = [];
    if (attributeValues.length > 0) {
      this.productAttributes.forEach((attr, index) => {
        if (attributeValues[index]) {
          productAttributes.push({
            AttributeName: attr.name,
            AttributeValue: attributeValues[index]
          });
        }
      });
    }

    return {
      Id: id,
      Code: code,
      Name: this.product.name,
      FullName: fullName,
      CategoryId: this.product.group || null,
      isActive: true,
      isDeleted: false,
      Cost: this.product.cost || 0,
      BasePrice: unit.price || this.product.price || 0,
      OnHand: this.product.stock || 0,
      OnHandNV: 0,
      Unit: unit.name,
      MasterUnitId: masterId,
      MasterProductId: masterProductId,
      ConversionValue: unit.conversion || 1,
      Description: this.product.description || '',
      IsRewardPoint: false,
      ModifiedDate: now,
      Image: this. imageDataUrl,
      CreatedDate: now,
      ProductAttributes: productAttributes,
      NormalizedName: this. normalizeString(fullName),
      NormalizedCode: this.normalizeString(code),
      OrderTemplate: this.product.noteTemplate || ''
    };
  }

  onFileSelected(ev: Event) {
    const input = ev.target as HTMLInputElement;
    if (! input.files || input.files.length === 0) return;
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = () => {
      this.imageDataUrl = reader. result as string;
    };
    reader. readAsDataURL(file);
  }

  async save() {
    try {
      this.saving = true;

      // Generate all product variants
      const products = this.generateAllProducts();

      // Call backend to save all products
      const result = await this.productService.addProducts(products);

      console.log('✅ Products saved:', result);

      this.dialogRef.close({ 
        saved: true, 
        products: products,
        result: result 
      });

    } catch (error: any) {
      console.error('❌ Error saving products:', error);
      alert(`Lỗi: ${error.message || 'Không thể lưu sản phẩm'}`);
    } finally {
      this.saving = false;
    }
  }

  // Open base unit dialog
  openAddBaseUnit() {
    const dialogRef = this.dialog. open(BaseUnitDialogComponent, {
      width: '450px',
      minHeight: '300px',
      maxHeight: '90vh',
      panelClass: 'custom-dialog-container'
    });
    dialogRef.afterClosed().subscribe((res: any) => {
      if (res && res.saved) {
        const base: ProductUnit = { 
          name: res.name, 
          price: Number(res.price || 0), 
          conversion: 1, 
          isBase: true 
        };
        this.productUnits = [base];
      }
    });
  }

  openAddUnit() {
    const base = this.productUnits. find(u => u.isBase);
    if (! base) return;
    const dialogRef = this. dialog.open(UnitDialogComponent, {
      width: '500px',
      minHeight: '350px',
      maxHeight: '90vh',
      panelClass: 'custom-dialog-container',
      data: { baseName: base.name }
    });
    dialogRef.afterClosed().subscribe((res: any) => {
      if (res && res.saved) {
        const unit: ProductUnit = { 
          name: res.name, 
          conversion: Number(res.conversion || 1), 
          price: Number(res. price || base.price),
          isBase: false
        };
        this.productUnits.push(unit);
      }
    });
  }

  selectTab(tab: 'info' | 'desc') {
    this.selectedTab = tab;
  }

  removeUnit(index: number) {
    if (index < 0 || index >= this.productUnits.length) return;
    this.productUnits. splice(index, 1);
  }

  openAddAttribute() {
    const dialogRef = this. dialog.open(AttributeDialogComponent, {
      width: '500px',
      minHeight: '350px',
      maxHeight: '90vh',
      panelClass: 'custom-dialog-container'
    });
    dialogRef.afterClosed().subscribe((res: any) => {
      if (res && res.saved) {
        const attribute: ProductAttribute = { 
          name: res.attributeName, 
          values: res.values 
        };
        this.productAttributes. push(attribute);
      }
    });
  }

  removeAttribute(index: number) {
    if (index < 0 || index >= this.productAttributes.length) return;
    this.productAttributes. splice(index, 1);
  }
}