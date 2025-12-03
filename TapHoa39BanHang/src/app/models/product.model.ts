export interface Product {
  Id: number;
  Code: string;
  Name: string;
  FullName: string;
  CategoryId: number;
  isActive: boolean;
  isDeleted: boolean;
  Cost: number;
  BasePrice: number;
  OnHand: number;
  Unit: string;
  MasterUnitId: number;
  MasterProductId: number;
  ConversionValue: number;
  Description: string;
  IsRewardPoint: boolean;
  ModifiedDate: Date;
  Image: string;
  CreatedDate: Date;
  ProductAttributes: any[];
  NormalizedName: string;
  NormalizedCode: string;
  OrderTemplate: string
}
