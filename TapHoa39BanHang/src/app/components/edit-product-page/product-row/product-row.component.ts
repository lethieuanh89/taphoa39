import { Component, Input, Output, EventEmitter, OnInit, OnChanges, SimpleChanges, ChangeDetectorRef, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { EditedProduct } from '../services/product-edit.service';
import { ChildUnitsListComponent } from '../child-units-list/child-units-list.component';
import { QuickCalcDialogComponent } from '../quick-calc-dialog/quick-calc-dialog.component';
import { validateNumber } from '../utility-functions/app.validate-number';

@Component({
  selector: 'app-product-row',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    MatTooltipModule,
    MatCheckboxModule,
    MatDialogModule,
    ChildUnitsListComponent
  ],
  templateUrl: './product-row.component.html',
  styleUrls: ['./product-row.component.css']
})
export class ProductRowComponent implements OnInit, OnChanges, AfterViewInit {
  @Input() product!: EditedProduct;
  @Input() childProducts: EditedProduct[] = [];
  @Input() productColor: string = '#ffffff';

  @Output() productChange = new EventEmitter<EditedProduct>();
  @Output() childrenChange = new EventEmitter<EditedProduct[]>();

  @ViewChild('basePriceInput') basePriceInput?: ElementRef<HTMLInputElement>;
  @ViewChild('costDisplay') costDisplay?: ElementRef<HTMLSpanElement>;

  expanded = false;

  // Expose Math for template
  Math = Math;

  // Store original values from grouped_* localStorage or from product as loaded
  private originalBasePrice: number = 0;
  private originalCost: number = 0;
  private originalOnHand: number = 0;

  // Prevent multiple dialog opens
  private isDialogOpen = false;

  constructor(
    private dialog: MatDialog,
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit() {
    // Initial load (component creation)
    this.loadOriginalValues();
  }

  ngOnChanges(changes: SimpleChanges) {
    // IMPORTANT: ProductRow instances are reused by virtual scroll.
    // When the @Input() product changes we MUST reload original values used for calculations.
    if (changes['product'] && changes['product'].currentValue) {
      // Update original values to match the newly bound product
      this.loadOriginalValues();

      // Force update of input fields and view so calculations use the correct originals
      this.updateInputFields();
      this.cdr.detectChanges();
    }
  }

  ngAfterViewInit() {
    // ViewChild references are available here
  }

  /**
   * Load original product values for calculation.
   * Called on component init AND every time @Input product changes (ngOnChanges).
   */
  private loadOriginalValues() {
    // Use numeric-parsed values to avoid string issues
    this.originalBasePrice = this.parseNumber(this.product?.BasePrice);
    this.originalCost = this.parseNumber(this.product?.Cost);
    this.originalOnHand = this.parseNumber(this.product?.OnHand);

    // If product was just loaded and has no Edited flag, ensure Edited is boolean
    if (this.product && typeof this.product.Edited === 'undefined') {
      this.product.Edited = false;
    }
  }

  /**
   * Parse number from various input formats
   */
  private parseNumber(value: any): number {
    if (typeof value === 'string') {
      const normalized = value.replace(/[^0-9.-]/g, '');
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : 0;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  get darkerColor(): string {
    // Make master row color 15% darker than children
    const hex = this.productColor.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    const darkerR = Math.max(0, Math.floor(r * 0.85));
    const darkerG = Math.max(0, Math.floor(g * 0.85));
    const darkerB = Math.max(0, Math.floor(b * 0.85));

    return `rgb(${darkerR}, ${darkerG}, ${darkerB})`;
  }

  toggleExpand() {
    this.expanded = !this.expanded;
  }

  onRowClick(event: MouseEvent) {
    // Only toggle if there are children and not clicking on input fields
    const target = event.target as HTMLElement;

    // Don't toggle if clicking on input, button, mat-icon, or mat-checkbox
    if (target.tagName === 'INPUT' ||
      target.tagName === 'BUTTON' ||
      target.tagName === 'MAT-ICON' ||
      target.tagName === 'MAT-CHECKBOX' ||
      target.closest('input') ||
      target.closest('button') ||
      target.closest('mat-checkbox')) {
      return;
    }

    // Only toggle if there are children
    if (this.childProducts && this.childProducts.length > 0) {
      this.toggleExpand();
    }
  }

  /**
   * onCodeChange: support both (event) and direct value:
   * - If template uses (input) or (blur) => event object
   * - If template uses (ngModelChange) => receives string value
   *
   * Because [(ngModel)] updates the model before blur/ngModelChange, we always persist.
   */
  onCodeChange(eventOrValue: any) {
    const newCode = typeof eventOrValue === 'string'
      ? eventOrValue.trim()
      : (eventOrValue?.target?.value ?? '').toString().trim();

    this.product.Code = newCode;
    this.product.Edited = true;
    this.saveToLocalStorage();
    this.emitProductChange();
  }

  /**
   * onNameChange: support both (event) and direct value (ngModelChange)
   */
  onNameChange(eventOrValue: any) {
    const newName = typeof eventOrValue === 'string'
      ? eventOrValue.trim()
      : (eventOrValue?.target?.value ?? '').toString().trim();


    this.product.Name = newName;
    this.product.Edited = true;
    this.saveToLocalStorage();
    this.emitProductChange();
  }

  onBasePriceChange(event: any) {
    const value = this.parseNumberInput(event.target.value);
    this.product.BasePrice = value;
    this.product.Edited = true;
    this.saveToLocalStorage();
    this.emitProductChange();
  }

  onBasePriceBlur() {
    // Format the value when user leaves the input
    if (this.basePriceInput?.nativeElement) {
      this.basePriceInput.nativeElement.value = this.formatNumber(this.product.BasePrice || 0);
    }
  }

  onBoxChange(event: any) {
    const value = this.parseNumberInput(event.target.value);
    this.product.Box = value;
    this.recalculateCost();
  }

  onBoxBlur(event: any) {
    event.target.value = this.formatNumber(this.product.Box || 0);
  }

  onRetailChange(event: any) {
    const value = this.parseNumberInput(event.target.value);
    this.product.Retail = value;
    this.recalculateCost();
  }

  onRetailBlur(event: any) {
    event.target.value = this.formatNumber(this.product.Retail || 0);
  }

  onDiscountChange(event: any) {
    const value = this.parseNumberInput(event.target.value);
    this.product.Discount = value;
    this.recalculateCost();
  }

  onDiscountBlur(event: any) {
    event.target.value = this.product.Discount ? this.formatNumber(this.product.Discount) : '';
  }

  onDiscount2Change(event: any) {
    const value = this.parseNumberInput(event.target.value);
    this.product.Discount2 = value;
    this.recalculateCost();
  }

  onDiscount2Blur(event: any) {
    event.target.value = this.product.Discount2 ? this.formatNumber(this.product.Discount2) : '';
  }

  onTotalPriceChange(event: any) {
    const value = this.parseNumberInput(event.target.value);
    this.product.TotalPrice = value;
    this.recalculateCost();
  }

  onTotalPriceBlur(event: any) {
    event.target.value = this.product.TotalPrice ? this.formatNumber(this.product.TotalPrice) : '';
  }

  onTotalPriceKeydown(event: KeyboardEvent) {
    if (event.key === ' ' || event.code === 'Space') {
      event.preventDefault();
      event.stopPropagation(); // Stop event from bubbling up

      // Prevent multiple opens
      if (!this.isDialogOpen) {
        this.openQuickCalcDialog();
      }
      return;
    }

    validateNumber(event);
  }

  onAverageCheckPointChange() {
    // When checkbox changes, recalculate cost with new mode
    this.product.Edited = true;
    this.recalculateCost();
  }

  openQuickCalcDialog() {
    // Prevent multiple dialog opens
    if (this.isDialogOpen) {
      return;
    }

    this.isDialogOpen = true;

    // Calculate the largest child ConversionValue ratio
    let largestChildRatio = 1;
    if (this.childProducts && this.childProducts.length > 0) {
      const largestChild = this.childProducts.reduce((prev, curr) => {
        const prevConv = Number(prev?.ConversionValue ?? -Infinity);
        const currConv = Number(curr?.ConversionValue ?? -Infinity);
        return currConv > prevConv ? curr : prev;
      }, this.childProducts[0]);

      const masterConversion = Number(this.product.ConversionValue) || 1;
      const largestChildConversion = Number(largestChild.ConversionValue) || 1;
      largestChildRatio = largestChildConversion / masterConversion;
    }

    const dialogRef = this.dialog.open(QuickCalcDialogComponent, {
      width: '500px',
      data: {
        box: this.product.Box || 0,
        retail: this.product.Retail || 0,
        discount: this.product.Discount || 0,
        discount2: this.product.Discount2 || 0,
        totalPrice: this.product.TotalPrice || 0,
        largestChildRatio: largestChildRatio // Pass ratio to dialog
      },
      disableClose: false // Allow closing with ESC or backdrop click
    });

    dialogRef.afterClosed().subscribe(result => {
      // Reset flag when dialog closes
      this.isDialogOpen = false;

      if (result && result.saved) {
        this.product.Box = result.box;
        this.product.Retail = result.retail;
        this.product.Discount = result.discount;
        this.product.Discount2 = result.discount2;
        this.product.TotalPrice = result.totalPrice;

        this.recalculateCost();
      }
    });
  }

  private parseNumberInput(value: string): number {
    const cleaned = value.replace(/,/g, '');
    const num = Number(cleaned);
    return isNaN(num) ? 0 : num;
  }

  /**
   * Manually update input field values after programmatic changes
   * This is needed because [value] binding doesn't auto-update
   */
  private updateInputFields() {
    // Update BasePrice input field
    if (this.basePriceInput?.nativeElement) {
      this.basePriceInput.nativeElement.value = this.formatNumber(this.product.BasePrice || 0);
    }

    // Force cost display update if available
    if (this.costDisplay?.nativeElement) {
      this.costDisplay.nativeElement.textContent = this.formatNumber(this.product.Cost);
    }

    // Force change detection to update view
    this.cdr.detectChanges();
  }

  private recalculateCost() {
    // 1) Lấy ConversionValue lớn nhất của master + child
    const allConversions = [
      this.parseNumber(this.product.ConversionValue) || 1,
      ...this.childProducts.map(c => this.parseNumber(c.ConversionValue) || 1)
    ];
    const largestConversion = Math.max(...allConversions);  // <-- conversion lớn nhất

    const conversionValue = this.parseNumber(this.product.ConversionValue) || 1;
    const originalRetail = this.parseNumber(this.product.Retail);
    const totalPrice = this.parseNumber(this.product.TotalPrice);
    const discountOnMaster = this.parseNumber(this.product.Discount);
    const discountOnTotal = this.parseNumber(this.product.Discount2);
    let box = 0;

    let retail = originalRetail;

    // Handle retail > conversionValue case (same as cost.service.ts)
    if (originalRetail > largestConversion) {
      retail = originalRetail % largestConversion;
      box = (originalRetail - retail) / largestConversion;
    } else {
      box = this.parseNumber(this.product.Box)
    }

    const totalUnits = (box * largestConversion) + retail;
    const addedOnHand = conversionValue > 0 ? totalUnits / conversionValue : 0;

    if (box === 0 && retail === 0 && totalPrice === 0) {
      // No input yet - keep original values (matching cost.service.ts line 67-71)
      this.product.Cost = this.originalCost;
      this.product.BasePrice = this.originalBasePrice;
      this.product.OnHand = this.originalOnHand;
    } else if ((box > 0 || retail > 0) && totalPrice === 0) {
      // Only Box/Retail entered, no TotalPrice - only update OnHand (matching cost.service.ts line 72-76)
      this.product.Cost = this.originalCost;
      this.product.BasePrice = this.originalBasePrice;
      this.product.OnHand = (this.originalOnHand + addedOnHand) || 0;

      // Mark as edited and emit change for UI update
      this.product.Edited = true;
      this.emitProductChange();

      // Manually update input fields to reflect new values
      this.updateInputFields();
    } else {
      // Has TotalPrice - proceed with calculation (matching cost.service.ts line 78-104)
      if (this.product.AverageCheckPoint === true) {
        // WEIGHTED AVERAGE MODE (matching cost.service.ts line 79-90)
        const netTotalPrice = Math.max(totalPrice - discountOnTotal, 0);
        const newCostPerUnit = addedOnHand > 0 ? netTotalPrice / addedOnHand : 0;
        const combinedOnHand = this.originalOnHand + addedOnHand;

        if (addedOnHand > 0 && combinedOnHand > 0) {
          this.product.Cost = ((this.originalCost * this.originalOnHand) + (newCostPerUnit * addedOnHand)) / combinedOnHand;
        } else if (addedOnHand > 0) {
          this.product.Cost = newCostPerUnit || this.originalCost;
        } else {
          this.product.Cost = this.originalCost;
        }
      } else {
        // SIMPLE MODE (direct division) (matching cost.service.ts line 91-100)
        if (totalUnits > 0) {
          this.product.Cost = (totalPrice / totalUnits) * conversionValue || 0;
          if (discountOnTotal > 0) {
            this.product.Cost = ((totalPrice - discountOnTotal) / totalUnits) * conversionValue || 0;
          }
           if (discountOnMaster > 0) {
            this.product.Cost = ((totalPrice-(discountOnMaster*totalUnits))/totalUnits)* conversionValue || 0;
          }
        } else {
          this.product.Cost = 0;
        }
      }

      // Update OnHand and BasePrice (matching cost.service.ts line 102-103)
      this.product.OnHand = (this.originalOnHand + addedOnHand) || 0;

      // Update BasePrice based on cost change
      this.product.BasePrice = Math.round((this.originalBasePrice + (this.product.Cost - this.originalCost)) / 100) * 100;

      this.product.Edited = true;

      // Update all children based on master changes
      this.updateChildrenByCost();

      // Save to localStorage using product Id (and Code fallback)
      this.saveToLocalStorage();

      this.emitProductChange();

      // Manually update input fields to reflect new values
      this.updateInputFields();
    }
  }

  /**
   * Save edited product to localStorage using product Id (and Code fallback)
   */
  private saveToLocalStorage() {
    try {
      const payload = { ...this.product };
      const keyById = this.product.Id ? `editing_childProduct_${this.product.Id}` : null;
      const keyByCode = this.product.Code ? `editing_childProduct_${this.product.Code}` : null;

      if (keyById) {
        localStorage.setItem(keyById, JSON.stringify(payload));
      }

      // Also write by Code to help recovery when Id is missing or Code changed
      if (keyByCode) {
        localStorage.setItem(keyByCode, JSON.stringify(payload));
      }
    } catch (err) {
      console.error('Failed to save product to localStorage:', err);
    }
  }

  /**
   * Update all children units based on master's cost change
   * Using ConversionValue to calculate proportional prices
   * Matches cost.service.ts updateCostChildItems logic
   */
  private updateChildrenByCost() {
    if (!this.childProducts || this.childProducts.length === 0) return;

    const masterCost = this.product.Cost;
    const masterConversion = this.parseNumber(this.product.ConversionValue) || 1;
    const masterOnHand = this.product.OnHand;
    const masterDiscount = this.parseNumber(this.product.Discount) || 0;

    // Get original products from grouped_* localStorage
    const oldProducts = Object.entries(localStorage)
      .filter(([key]) => key.startsWith('grouped_'))
      .map(([_, value]) => JSON.parse(value || '[]'));

    // Create new array to trigger Angular change detection
    this.childProducts = this.childProducts.map(child => {
      const childConversion = this.parseNumber(child.ConversionValue) || 1;

      // Find original child product for BasePrice calculation
      let originalChildBasePrice = child.BasePrice;
      let originalChildCost = child.Cost;

      oldProducts.forEach((oP) => {
        const productGroup = oP[this.product.Code];
        if (productGroup) {
          const matchingProduct = productGroup.find((o: any) => o.Code === child.Code);
          if (matchingProduct) {
            originalChildBasePrice = matchingProduct.BasePrice;
            originalChildCost = matchingProduct.Cost;
          }
        }
      });

      // Update OnHand proportionally
      child.OnHand = (parseFloat(String(masterOnHand)) * parseFloat(String(masterConversion))) / parseFloat(String(childConversion)) || 0;

      // Calculate cost proportionally: (masterCost / masterConversion) * childConversion
      child.Cost = Math.round((masterCost / masterConversion) * childConversion) || 0;

      // Apply discount if exists
      if (masterDiscount > 0) {
        child.Cost = (child.Cost - (masterDiscount * childConversion)) || 0;
      }

      // Update BasePrice based on cost change from original
      child.BasePrice = Math.round((originalChildBasePrice + (child.Cost - originalChildCost)) / 100) * 100 || 0;

      child.Edited = true;

      // Save child to localStorage using Id (and Code fallback)
      try {
        if (child.Id) {
          localStorage.setItem(`editing_childProduct_${child.Id}`, JSON.stringify(child));
        }
        if (child.Code) {
          localStorage.setItem(`editing_childProduct_${child.Code}`, JSON.stringify(child));
        }
      } catch (err) {
        console.error('Failed to save child to localStorage:', err);
      }

      return child; // Return the modified child for map
    });

    this.emitChildrenChange();
  }

  onChildEdit(editedChild: EditedProduct) {
    // When a child is edited, just update it in the list
    // Child edits no longer affect master or siblings
    const childIndex = this.childProducts.findIndex(c => c.Id === editedChild.Id);
    if (childIndex >= 0) {
      this.childProducts[childIndex] = editedChild;

      // Save child to localStorage
      try {
        if (editedChild.Id) {
          localStorage.setItem(`editing_childProduct_${editedChild.Id}`, JSON.stringify(editedChild));
        }
        if (editedChild.Code) {
          localStorage.setItem(`editing_childProduct_${editedChild.Code}`, JSON.stringify(editedChild));
        }
      } catch (err) {
        console.error('Failed to save editedChild to localStorage:', err);
      }

      this.emitChildrenChange();
    }
  }

  formatNumber(value: any): string {
    const num = Number(value);
    if (isNaN(num)) return '';
    return num.toLocaleString('en-US');
  }

  validateNumber(event: KeyboardEvent) {
    validateNumber(event);
  }

  /**
   * Get BasePrice difference from original
   */
  getBasePriceDiff(): number {
    return this.product.BasePrice - this.originalBasePrice;
  }

  /**
   * Get Cost difference from original
   */
  getCostDiff(): number {
    return this.product.Cost - this.originalCost;
  }

  /**
   * Get OnHand difference from original
   */
  getOnHandDiff(): number {
    return this.product.OnHand - this.originalOnHand;
  }

  /**
   * Check if value increased
   */
  isIncrease(diff: number): boolean {
    return diff > 0;
  }

  /**
   * Check if value decreased
   */
  isDecrease(diff: number): boolean {
    return diff < 0;
  }

  /**
   * Check if value unchanged
   */
  isUnchanged(diff: number): boolean {
    return diff === 0;
  }

  private emitProductChange() {
    this.productChange.emit(this.product);
  }

  private emitChildrenChange() {
    this.childrenChange.emit(this.childProducts);
  }
}