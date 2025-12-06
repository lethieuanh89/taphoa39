export interface Product {
  Id: number;
  Code: string;
  Name: string;
  FullName: string;
  CategoryId: number | null;  // ✅ Cho phép null
  isActive: boolean;
  isDeleted: boolean;
  Cost: number;
  BasePrice: number;
  OnHand: number;
  OnHandNV?: number;  // ✅ Thêm field này (optional)
  Unit: string;
  MasterUnitId: number | null;  // ✅ Cho phép null (master product không có)
  MasterProductId: number | null;  // ✅ Cho phép null (master product không có)
  ConversionValue: number;
  Description: string;
  IsRewardPoint: boolean;
  ModifiedDate: Date | string;  // ✅ Cho phép string (ISO format từ API)
  Image: string | null;  // ✅ Cho phép null
  CreatedDate: Date | string;  // ✅ Cho phép string
  ProductAttributes: any[];
  NormalizedName: string;
  NormalizedCode: string;
  OrderTemplate: string;
}