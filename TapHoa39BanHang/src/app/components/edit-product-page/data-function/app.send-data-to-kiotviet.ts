import { Injectable } from "@angular/core";
import { KiotvietService } from "../../../services/kiotviet.service";
@Injectable({
  providedIn: 'root'
})
export class SendDataToKiotVietService {
    constructor( private kiotvietService: KiotvietService) { } 
    
    async sendProductData(editedProduct: any, remainEditedProducts: any[]): Promise<any> {
        const payload = await this.kiotvietService.getRequestBody(editedProduct.Id);

        if (!payload?.Product) {
            throw new Error('Không thể lấy dữ liệu sản phẩm từ KiotViet');
        }

        const allEdited = [editedProduct, ...remainEditedProducts].map((item) => ({
            ...item,
            OriginalCode: item?.OriginalCode ?? item?.Code,
            OriginalFullName: item?.OriginalFullName ?? item?.FullName
        }));

        const editedMap = new Map<string, any>();
        allEdited.forEach((item) => {
            if (item?.OriginalCode) {
                editedMap.set(String(item.OriginalCode), item);
            }
        });

        payload.Product.FullName = editedProduct.FullName;
        if ('Description' in payload.Product) {
            payload.Product.Description = editedProduct.Description;
        }
        if ('BasePrice' in payload.Product) {
            payload.Product.BasePrice = editedProduct.BasePrice;
        }
        if ('Cost' in payload.Product) {
            payload.Product.Cost = editedProduct.Cost;
        }
        if ('OnHand' in payload.Product) {
            payload.Product.OnHand = editedProduct.OnHand;
        }

        if (Array.isArray(payload.Product.ProductUnits)) {
            payload.Product.ProductUnits = payload.Product.ProductUnits.map((unit: any) => {
                const unitCode = unit?.Code ?? unit?.ProductCode;
                const match = editedMap.get(String(unitCode)) ?? editedMap.get(String(unit?.OriginalCode));

                if (match) {
                    const updatedCode = match.Code;
                    const updatedName = match.FullName;
                    if ('FullName' in unit) {
                        unit.FullName = updatedName;
                    }
                    if ('ProductName' in unit) {
                        unit.ProductName = updatedName;
                    }
                    if ('BasePrice' in unit) {
                        unit.BasePrice = match.BasePrice;
                    }
                    if ('Cost' in unit) {
                        unit.Cost = match.Cost;
                    }
                    if ('FinalBasePrice' in unit && match.FinalBasePrice !== undefined) {
                        unit.FinalBasePrice = match.FinalBasePrice;
                    }
                }

                return unit;
            });
        }

        await this.kiotvietService.updateProductToKiotviet(payload);
    }

}
