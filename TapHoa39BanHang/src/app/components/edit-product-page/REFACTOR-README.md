# Edit Product Page - Refactored Architecture

## 📋 Overview

Refactored giao diện cập nhật giá hàng hóa để tối ưu cho **4000+ sản phẩm** và **10,000+ children units**.

### ✨ Key Features

1. **Compact UI**: Mỗi sản phẩm chỉ chiếm 1 hàng (master row)
2. **Collapsible Children**: Children units được ẩn trong accordion/collapse
3. **Sticky Header & Columns**: Header và cột Mã/Tên cố định khi scroll
4. **Virtual Scrolling**: CDK Virtual Scroll cho performance tối ưu
5. **Quick Calc Dialog**: Popup tính toán nhanh với hỗ trợ biểu thức (100*4, etc.)
6. **Auto-Calculate**: Tự động tính BasePrice/Cost/OnHand theo ConversionValue

---

## 🏗️ Architecture

### Component Structure

```
edit-product-page/
├── edit-product-page-refactored.component.ts     # Main container
├── edit-product-page-refactored.component.html
├── edit-product-page-refactored.component.css
│
├── product-row/                                   # Master row component
│   ├── product-row.component.ts
│   ├── product-row.component.html
│   └── product-row.component.css
│
├── child-units-list/                              # Children units list
│   ├── child-units-list.component.ts
│   ├── child-units-list.component.html
│   └── child-units-list.component.css
│
├── quick-calc-dialog/                             # Calculation popup
│   ├── quick-calc-dialog.component.ts
│   ├── quick-calc-dialog.component.html
│   └── quick-calc-dialog.component.css
│
└── services/
    ├── product-edit.service.ts                    # Business logic
    └── cost.service.ts                            # Cost calculations
```

---

## 🎯 Component Details

### 1. EditProductPageRefactoredComponent

**Main container component**

- Quản lý search và load products
- Group products thành master + children
- Virtual scrolling cho performance
- Handle update và save

**Key Methods:**
- `onSearch()`: Tìm kiếm và load products
- `groupProductsByMaster()`: Group products theo Master flag
- `onUpdate()`: Save và mở dialog xác nhận

---

### 2. ProductRowComponent

**Master product row với collapse**

**Props:**
- `@Input() product`: Master product
- `@Input() childProducts`: Array of children units
- `@Input() productColor`: Background color
- `@Output() productChange`: Emit khi master thay đổi
- `@Output() childrenChange`: Emit khi children thay đổi

**Features:**
- Editable: Code, Name, Box, Retail, Discount, Discount2, TotalPrice
- Read-only: BasePrice, Cost, OnHand
- Space key trên TotalPrice → Mở Quick Calc Dialog
- Auto-calculate khi thay đổi giá trị

**Calculation Logic:**
```typescript
// When master changes → Update all children
updateChildrenByCost() {
  const costPerBaseUnit = masterCost / masterConversion;
  child.Cost = costPerBaseUnit * childConversion;
  child.BasePrice = ...;
}

// When child changes → Update master & siblings
updateMasterAndSiblingsFromChild() {
  const basePricePerUnit = childBasePrice / childConversion;
  master.BasePrice = basePricePerUnit * masterConversion;
  // Update all siblings...
}
```

---

### 3. ChildUnitsListComponent

**Hiển thị danh sách children units khi expand**

**Props:**
- `@Input() childProducts`: Array of children
- `@Input() masterProduct`: Master product reference
- `@Output() childEdit`: Emit khi child được edit

**Display:**
- Unit name badge
- Conversion text: "1 lốc = 4 chai"
- Editable: BasePrice, Cost
- Read-only: OnHand

---

### 4. QuickCalcDialogComponent

**Popup tính toán nhanh**

**Features:**
- Hỗ trợ biểu thức toán học: `100*4`, `1000+500`, etc.
- Real-time calculation display
- Enter để save
- Auto-evaluate expressions khi close

**Data:**
```typescript
{
  box: number,
  retail: number,
  discount: number,
  discount2: number,
  totalPrice: number
}
```

---

## 💡 Usage

### Basic Usage

```typescript
// Import refactored component
import { EditProductPageRefactoredComponent } from './edit-product-page-refactored.component';

// In your routing
{
  path: 'edit-products',
  component: EditProductPageRefactoredComponent
}
```

### Search Products

1. Nhập mã hoặc tên sản phẩm
2. Nhấn Enter
3. Products được load và group theo Master

### Edit Master Product

1. Click vào field muốn edit (Code, Name, Box, Retail, etc.)
2. Nhập giá trị mới
3. Tab hoặc click ra ngoài → Auto-save

### Quick Calc

1. Focus vào field "Thành tiền"
2. Nhấn **Space** → Mở Quick Calc Dialog
3. Nhập biểu thức: `1000*24` hoặc giá trị thông thường
4. Nhấn **Enter** hoặc click **Lưu**

### Expand/Collapse Children

1. Click nút **expand** (⌄) bên trái master row
2. Children units hiển thị dưới dạng danh sách
3. Edit children → Tự động update master & siblings

---

## 🔧 Configuration

### Virtual Scroll Settings

```typescript
// In edit-product-page-refactored.component.html
<cdk-virtual-scroll-viewport
  [itemSize]="50"           // Chiều cao mỗi row (px)
  [minBufferPx]="500"       // Buffer phía trước
  [maxBufferPx]="1000"      // Buffer phía sau
>
```

### Sticky Columns

```css
/* In product-row.component.css */
.sticky-column {
  position: sticky;
  z-index: 2;
}

.code-cell.sticky-column {
  left: 100px;  /* Adjust based on previous columns */
}
```

---

## 📊 Performance Optimizations

### 1. Virtual Scrolling
- Chỉ render 20-30 rows visible
- Buffer thêm 10-15 rows trên/dưới
- **Result**: Render 4000 products = ~50 DOM nodes

### 2. Containment
```css
app-product-row {
  contain: layout style paint;
}
```

### 3. TrackBy Function
```typescript
trackByGroup(index: number, group: ProductGroup): number {
  return group.master.Id;
}
```

### 4. OnPush Change Detection (Future)
```typescript
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush
})
```

---

## 🧮 Calculation Examples

### Example 1: Master Update

**Scenario**: Master product "Chai" giá 1000
- 1 chai = 1000 (ConversionValue = 1)
- 1 lốc (4 chai) = 4000 (ConversionValue = 4)
- 1 thùng (24 chai) = 24000 (ConversionValue = 24)

**Action**: Update master cost từ 800 → 1000

**Result**:
- Lốc: 800*4 → 1000*4 = 4000
- Thùng: 800*24 → 1000*24 = 24000

### Example 2: Child Update

**Scenario**: Same as above

**Action**: Update lốc BasePrice từ 4000 → 5000

**Result**:
- Base price per unit = 5000 / 4 = 1250
- Master (1 chai): 1000 → 1250
- Thùng (24 chai): 24000 → 30000 (1250 * 24)

---

## 🎨 UI/UX Features

### Sticky Header
- Header cố định khi scroll vertical
- Luôn nhìn thấy tên cột

### Sticky Columns
- Cột Mã & Tên cố định khi scroll horizontal
- Dễ dàng đối chiếu sản phẩm

### Color Coding
- Mỗi product group có màu riêng
- Master row màu đậm hơn children

### Visual Feedback
- Hover: Highlight row
- Focus: Border glow
- Expanded: Bottom border + background tint

---

## 🚀 Migration Guide

### From Old to New

**Old Code:**
```html
<table mat-table [dataSource]="filteredProducts">
  <ng-container matColumnDef="Code">
    <td mat-cell *matCellDef="let element">
      <input [(ngModel)]="element.Code" />
    </td>
  </ng-container>
</table>
```

**New Code:**
```html
<cdk-virtual-scroll-viewport>
  <ng-container *cdkVirtualFor="let group of productGroups">
    <app-product-row
      [product]="group.master"
      [childProducts]="group.children"
    ></app-product-row>
  </ng-container>
</cdk-virtual-scroll-viewport>
```

### Update Routing

```typescript
// Old
{ path: 'edit', component: EditProductPageComponent }

// New
{ path: 'edit', component: EditProductPageRefactoredComponent }
```

---

## 📝 TODO / Future Improvements

- [ ] Add keyboard shortcuts (Ctrl+S to save, etc.)
- [ ] Implement undo/redo functionality
- [ ] Add batch edit mode (select multiple products)
- [ ] Export to Excel feature
- [ ] Add filters (by category, price range, etc.)
- [ ] Implement OnPush change detection
- [ ] Add unit tests
- [ ] Add E2E tests with Cypress

---

## 🐛 Known Issues

1. **Initial scroll jump**: CDK Virtual Scroll có thể jump khi first load
   - **Workaround**: Set `itemSize` chính xác

2. **Sticky columns z-index**: Có thể overlap với dialog
   - **Workaround**: Adjust z-index in CSS

---

## 📞 Support

For questions or issues, contact:
- **Developer**: Your Name
- **Email**: your.email@example.com
- **Slack**: #frontend-team

---

## 📜 License

Internal use only - TapHoa39 Project
