import { Component, Input, Output, EventEmitter, ChangeDetectorRef, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { EditedProduct } from '../services/product-edit.service';
import { validateNumber } from '../utility-functions/app.validate-number';

@Component({
  selector: 'app-child-units-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    MatTooltipModule
  ],
  templateUrl: './child-units-list.component.html',
  styleUrls: ['./child-units-list.component.css']
})
export class ChildUnitsListComponent implements OnChanges {
  @Input() childProducts: EditedProduct[] = [];
  @Input() masterProduct!: EditedProduct;
  @Input() baseColor: string = '#ffffff';

  @Output() childEdit = new EventEmitter<EditedProduct>();

  // Expose Math for template
  Math = Math;

  // Store original values for diff calculation
  private originalValues = new Map<number, { BasePrice: number; Cost: number; OnHand: number }>();

  constructor(private cdr: ChangeDetectorRef) {}

  ngOnChanges(changes: SimpleChanges) {
    // Force change detection when childProducts input changes
    if (changes['childProducts']) {
      // Load original values for diff calculation
      this.loadOriginalValues();
      this.cdr.detectChanges();
    }
  }

  private loadOriginalValues() {
    // Get original products from grouped_* localStorage
    const oldProducts = Object.entries(localStorage)
      .filter(([key]) => key.startsWith('grouped_'))
      .map(([_, value]) => JSON.parse(value || '[]'));

    this.childProducts.forEach(child => {
      if (!this.originalValues.has(child.Id)) {
        let originalBasePrice = child.BasePrice;
        let originalCost = child.Cost;
        let originalOnHand = child.OnHand;
        let found = false;

        // Find original child product by searching all groups for matching Code
        oldProducts.forEach((oP) => {
          // Search through all product groups in this localStorage entry
          Object.values(oP).forEach((productList: any) => {
            if (Array.isArray(productList)) {
              const matchingProduct = productList.find((p: any) => p.Code === child.Code);
              if (matchingProduct) {
                originalBasePrice = matchingProduct.BasePrice;
                originalCost = matchingProduct.Cost;
                originalOnHand = matchingProduct.OnHand;
                found = true;
              }
            }
          });
        });

        // Only set original values if found in localStorage
        if (found) {
          this.originalValues.set(child.Id, {
            BasePrice: originalBasePrice,
            Cost: originalCost,
            OnHand: originalOnHand
          });
        }
      }
    });
  }

  getOriginalBasePrice(child: EditedProduct): number {
    const original = this.originalValues.get(child.Id);
    return original ? original.BasePrice : 0;
  }

  getBasePriceDiff(child: EditedProduct): number {
    const original = this.originalValues.get(child.Id);
    if (!original) return 0;
    return child.BasePrice - original.BasePrice;
  }

  getCostDiff(child: EditedProduct): number {
    const original = this.originalValues.get(child.Id);
    if (!original) return 0;
    return child.Cost - original.Cost;
  }

  getOnHandDiff(child: EditedProduct): number {
    const original = this.originalValues.get(child.Id);
    if (!original) return 0;
    return child.OnHand - original.OnHand;
  }

  isIncrease(diff: number): boolean {
    return diff > 0;
  }

  isDecrease(diff: number): boolean {
    return diff < 0;
  }

  isUnchanged(diff: number): boolean {
    return diff === 0;
  }

  onBasePriceChange(child: EditedProduct, event: any) {
    const value = this.parseNumberInput(event.target.value);
    child.BasePrice = value;
    child.Edited = true;

    this.emitChildEdit(child);
  }

  onBasePriceBlur(event: any) {
    event.target.value = this.formatNumber(this.parseNumberInput(event.target.value));
  }

  onCostChange(child: EditedProduct, event: any) {
    const value = this.parseNumberInput(event.target.value);
    child.Cost = value;
    child.Edited = true;

    this.emitChildEdit(child);
  }

  onCostBlur(event: any) {
    event.target.value = this.formatNumber(this.parseNumberInput(event.target.value));
  }

  getConversionText(child: EditedProduct): string {
    const masterUnit = this.masterProduct.Unit || 'đơn vị';
    const childConversion = Number(child.ConversionValue) || 1;
    const masterConversion = Number(this.masterProduct.ConversionValue) || 1;

    if (childConversion === masterConversion) {
      return `1 ${child.Unit} = 1 ${masterUnit}`;
    }

    // Calculate relative conversion
    const ratio = childConversion / masterConversion;
    return `1 ${child.Unit} = ${this.formatNumber(ratio)} ${masterUnit}`;
  }

  formatNumber(value: any): string {
    const num = Number(value);
    if (isNaN(num)) return '0';

    // Format with max 3 decimal places, remove trailing zeros
    
    return num.toLocaleString('en-US');
  }

  validateNumber(event: KeyboardEvent) {
    validateNumber(event);
  }

  private parseNumberInput(value: string): number {
    const cleaned = value.replace(/,/g, '');
    const num = Number(cleaned);
    return isNaN(num) ? 0 : num;
  }

  private emitChildEdit(child: EditedProduct) {
    this.childEdit.emit(child);
  }
}
