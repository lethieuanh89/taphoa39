import { Injectable } from '@angular/core';
import { Product } from '../models/product.model';

@Injectable({
  providedIn: 'root'
})
export class GroupService {

  constructor() { }
  group(products: any[],): Record<number, any[]> {
    const groupedProducts: Record<number, any[]> = {};

    products.forEach((product: any) => {
      // Check if this is a master product (parent)
      if (product.MasterProductId !== null && product.MasterUnitId === null) {
        // Convert Id to number
        const masterId = Number(product.Id);
        // Initialize array for this master product if not exists
        if (!groupedProducts[masterId]) {
          groupedProducts[masterId] = [];
        }
        // Add the master product itself as the first item
        groupedProducts[masterId].push(product);
      }
    });
    products.forEach((product: any) => {
      // Check if this is a master product (parent)
      if (product.MasterProductId === null && product.MasterUnitId === null) {
        // Convert Id to number
        const masterId = Number(product.Id);
        // Initialize array for this master product if not exists
        if (!groupedProducts[masterId]) {
          groupedProducts[masterId] = [];
        }
        // Add the master product itself as the first item
        groupedProducts[masterId].push(product);
      }
    });

    // Now add child products to their respective master groups
    products.forEach((product: any) => {
      // Check if this is a child product
      if (product.MasterProductId !== null && product.MasterUnitId !== null) {
        // Convert MasterProductId to number
        const masterId = Number(product.MasterUnitId);
        // If the master group exists, add this child to it
        if (groupedProducts[masterId]) {
          groupedProducts[masterId].push(product);
        }
      }
    });
    return groupedProducts;
  }


  // transformApiData(data: Product[]): any[] {
  //   return data.map(item => ({
  //     Id: item.Id || null,
  //     Code: item.Code || null,
  //     Name: item.Name || null,
  //     FullName: item.FullName || null,
  //     CategoryId: item.CategoryId || null,
  //     isActive: item.isActive || null,
  //     isDeleted: item.isDeleted || null,
  //     Cost: item.Cost || null,
  //     BasePrice: item.BasePrice || null,
  //     OnHand: item.OnHand || null,
  //     Unit: item.Unit || null,
  //     MasterUnitId: item.MasterUnitId || null,
  //     MasterProductId: item.MasterProductId || null,
  //     ConversionValue: item.ConversionValue || null,
  //     Description: item.Description || null,
  //     IsRewardPoint: item.IsRewardPoint || null,
  //     ModifiedDate: item.ModifiedDate || null,
  //     Image: item.Image || null,
  //     CreatedDate: item.CreatedDate || null,
  //     ProductAttributes: item.ProductAttributes || [],
  //     NormalizedName: item.NormalizedName || null,
  //     NormalizedCode: item.NormalizedCode || null,
  //   }));
  // }
}
