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
  // which tab is active: 'info' or 'desc'
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

  // units: first element with isBase=true is base unit (conversion=1)
  // other units: { name, conversion, price }
  productUnits: Array<any> = [];

  // attributes: { name, values: string[] }
  productAttributes: Array<any> = [];

  groups: Array<any> = [];
  loadingCategories = false;

  brands = [
    { id: 'b1', name: 'Thương hiệu A' },
    { id: 'b2', name: 'Thương hiệu B' }
  ];

  imageDataUrl: string | null = null;

  constructor(
    private dialogRef: MatDialogRef<InputProductDialogComponent>,
    private dialog: MatDialog,
    private kiotvietService: KiotvietService
  ) {}

  ngOnInit(): void {
    this.loadCategories();
  }

  async loadCategories(): Promise<void> {
    try {
      this.loadingCategories = true;
      // Categories sẽ được lấy từ IndexedDB cache nếu có, hoặc từ API
      const categories = await this.kiotvietService.getCategories();
      this.groups = categories.map(cat => ({
        id: cat.Id,
        name: cat.Name,
        path: cat.Path
      }));
      console.log(`✅ Đã tải ${this.groups.length} categories (từ cache hoặc API)`);
    } catch (error) {
      console.error('❌ Error loading categories:', error);
      // Fallback to empty array if both API and cache fail
      this.groups = [];
    } finally {
      this.loadingCategories = false;
    }
  }

  onFileSelected(ev: Event) {
    const input = ev.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = () => {
      this.imageDataUrl = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  save() {
    // Return product data to caller. In real app, validate & call service.
    // attach units and attributes into product
    this.product.units = this.productUnits.slice();
    this.product.attributes = this.productAttributes.slice();
    this.dialogRef.close({ saved: true, product: this.product });
  }

  // Open base unit dialog
  openAddBaseUnit() {
    const dialogRef = this.dialog.open(BaseUnitDialogComponent, {
      width: '450px',
      minHeight: '300px',
      maxHeight: '90vh',
      panelClass: 'custom-dialog-container'
    });
    dialogRef.afterClosed().subscribe((res: any) => {
      if (res && res.saved) {
        // base unit stored with conversion 1
        const base = { name: res.name, price: Number(res.price || 0), conversion: 1, isBase: true };
        this.productUnits = [base];
      }
    });
  }

  openAddUnit() {
    const base = this.productUnits.find(u => u.isBase);
    if (!base) return;
    const dialogRef = this.dialog.open(UnitDialogComponent, {
      width: '500px',
      minHeight: '350px',
      maxHeight: '90vh',
      panelClass: 'custom-dialog-container',
      data: { baseName: base.name }
    });
    dialogRef.afterClosed().subscribe((res: any) => {
      if (res && res.saved) {
        const unit = { name: res.name, conversion: Number(res.conversion || 1), price: Number(res.price || base.price) };
        this.productUnits.push(unit);
      }
    });
  }

  selectTab(tab: 'info' | 'desc') {
    this.selectedTab = tab;
  }

  removeUnit(index: number) {
    if (index < 0 || index >= this.productUnits.length) return;
    this.productUnits.splice(index, 1);
    // keep product.units in sync if user inspects before saving
    this.product.units = this.productUnits.slice();
  }

  // Open attribute dialog
  openAddAttribute() {
    const dialogRef = this.dialog.open(AttributeDialogComponent, {
      width: '500px',
      minHeight: '350px',
      maxHeight: '90vh',
      panelClass: 'custom-dialog-container'
    });
    dialogRef.afterClosed().subscribe((res: any) => {
      if (res && res.saved) {
        const attribute = { name: res.attributeName, values: res.values };
        this.productAttributes.push(attribute);
      }
    });
  }

  removeAttribute(index: number) {
    if (index < 0 || index >= this.productAttributes.length) return;
    this.productAttributes.splice(index, 1);
    // keep product.attributes in sync if user inspects before saving
    this.product.attributes = this.productAttributes.slice();
  }

}
