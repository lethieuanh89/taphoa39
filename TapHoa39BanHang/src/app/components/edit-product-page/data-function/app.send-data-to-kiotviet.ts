import { Injectable } from "@angular/core";
import { KiotvietService } from "../../../services/kiotviet.service";
@Injectable({
  providedIn: 'root'
})
export class SendDataToKiotVietService {
    constructor( private kiotvietService: KiotvietService) { }

    /**
     * Send ALL product groups to KiotViet API in ONE single call
     */
    async sendAllProductData(groups: Array<{ master: any; children: any[] }>): Promise<any> {
        console.log('🚀 [SendAllData] Received', groups.length, 'groups to send');

        if (groups.length === 0) {
            console.warn('⚠️ No groups to send');
            return;
        }

        // Use the FIRST master product to get the payload
        const firstMaster = groups[0].master;
        console.log('🔵 [SendAllData] Using master product Id:', firstMaster.Id);

        // Get fresh payload from KiotViet API
        const payload = await this.kiotvietService.getRequestBody(firstMaster.Id);

        if (!payload?.Product) {
            throw new Error('Không thể lấy dữ liệu sản phẩm từ KiotViet');
        }

        console.log('🟢 [SendAllData] Payload from KiotViet:', {
            ProductId: payload.Product.Id,
            ProductCode: payload.Product.Code,
            Product_BasePrice: payload.Product.BasePrice,
            Product_Cost: payload.Product.Cost,
            Product_OnHand: payload.Product.OnHand,
            ProductUnitsCount: payload.Product.ProductUnits?.length || 0
        });

        // Collect ALL edited products from all groups
        const allEditedProducts: any[] = [];
        groups.forEach(group => {
            allEditedProducts.push(group.master);
            allEditedProducts.push(...group.children);
        });

        console.log('🟡 [SendAllData] Total edited products:', allEditedProducts.length);

        // Create map of ALL edited products using OriginalCode as key
        const editedMap = new Map<string, any>();
        allEditedProducts.forEach((item) => {
            const key = item?.OriginalCode ?? item?.Code;
            if (key) {
                editedMap.set(String(key), item);
            }
        });

        console.log('🟡 [SendAllData] editedMap keys:', Array.from(editedMap.keys()));

        // CRITICAL: Save OLD values from KiotViet payload BEFORE updating
        const oldCode = payload.Product.Code;
        const oldName = payload.Product.Name;
        const oldBasePrice = payload.Product.BasePrice;
        const oldCost = payload.Product.Cost;
        const oldOnHand = payload.Product.OnHand;

        console.log('🔵 [SendAllData] OLD values from KiotViet:', {
            oldCode,
            oldName,
            oldBasePrice,
            oldCost,
            oldOnHand
        });

        // Update main product fields (use first master)
        // CRITICAL: Try to find match by OriginalCode (old Code) first, then by current Code
        let masterMatch = editedMap.get(String(payload.Product.Code));

        // If not found, try to find by Id (most reliable)
        if (!masterMatch) {
            for (const item of allEditedProducts) {
                if (item.Id === payload.Product.Id) {
                    masterMatch = item;
                    console.log(`✅ [SendAllData] Found master by Id: ${item.Id}`);
                    break;
                }
            }
        }

        // CRITICAL: Determine if BasePrice was changed by user
        const basePriceChanged = masterMatch?.BasePrice !== undefined &&
                                  masterMatch?.FinalBasePrice !== undefined &&
                                  masterMatch.BasePrice !== masterMatch.FinalBasePrice;

        console.log('----------------', {
            FinalBasePrice: masterMatch?.FinalBasePrice,
            BasePrice: masterMatch?.BasePrice,
            basePriceChanged: basePriceChanged
        });

        if (masterMatch) {
            // Update Code if changed (KiotViet allows Code update via Id)
            if (masterMatch.Code && masterMatch.Code !== payload.Product.Code) {
                console.log(`🔄 [SendAllData] Updating Code: ${payload.Product.Code} → ${masterMatch.Code}`);
                payload.Product.Code = masterMatch.Code;
                // CRITICAL: CompareCode MUST be OLD value for KiotViet to detect change
                payload.Product.CompareCode = oldCode;
            }

            // Update Name if available - IMPORTANT: Do NOT update FullName (auto-generated from Name + Attributes + Unit)
            if (masterMatch.Name && masterMatch.Name !== payload.Product.Name) {
                console.log(`🔄 [SendAllData] Updating Name: ${payload.Product.Name} → ${masterMatch.Name}`);
                payload.Product.Name = masterMatch.Name;
                // CRITICAL: CompareName MUST be OLD value for KiotViet to detect change
                payload.Product.CompareName = oldName;
            }

            // CRITICAL: Use BasePrice if user changed it, otherwise use OriginalBasePrice (FinalBasePrice)
            let basePriceToUse: number;
            if (basePriceChanged) {
                // User changed BasePrice → use the new value
                basePriceToUse = masterMatch.BasePrice;
                console.log(`✅ [SendAllData] BasePrice changed by user: ${masterMatch.FinalBasePrice} → ${masterMatch.BasePrice}`);
            } else {
                // BasePrice not changed → use original value
                basePriceToUse = masterMatch.FinalBasePrice || masterMatch.BasePrice;
                console.log(`ℹ️ [SendAllData] BasePrice unchanged, using: ${basePriceToUse}`);
            }

            if (basePriceToUse !== undefined) {
                payload.Product.BasePrice = basePriceToUse;
                // CRITICAL: CompareBasePrice MUST be OLD value for KiotViet to detect change
                payload.Product.CompareBasePrice = oldBasePrice;
            }
            if (masterMatch.Cost !== undefined) {
                payload.Product.Cost = masterMatch.Cost;
                // CRITICAL: CompareCost MUST be OLD value for KiotViet to detect change
                payload.Product.CompareCost = oldCost;
            }
            if (masterMatch.OnHand !== undefined) {
                payload.Product.OnHand = masterMatch.OnHand;
                // CRITICAL: CompareOnHand MUST be OLD value for KiotViet to detect change
                payload.Product.CompareOnHand = oldOnHand;
            }

            console.log('✏️ [SendAllData] Updated main product fields:', {
                Code: payload.Product.Code,
                CompareCode: payload.Product.CompareCode,
                Name: payload.Product.Name,
                CompareName: payload.Product.CompareName,
                BasePrice: payload.Product.BasePrice,
                CompareBasePrice: payload.Product.CompareBasePrice,
                Cost: payload.Product.Cost,
                CompareCost: payload.Product.CompareCost,
                OnHand: payload.Product.OnHand,
                CompareOnHand: payload.Product.CompareOnHand
            });
        }

        // Update ProductUnits array (ALL child products from ALL groups)
        if (Array.isArray(payload.Product.ProductUnits)) {
            payload.Product.ProductUnits = payload.Product.ProductUnits.map((unit: any) => {
                const unitCode = unit?.Code ?? unit?.ProductCode;
                let match = editedMap.get(String(unitCode));

                // If not found by Code, try to find by Id (in case Code was changed)
                if (!match && unit.Id) {
                    for (const item of allEditedProducts) {
                        if (item.Id === unit.Id) {
                            match = item;
                            console.log(`✅ [SendAllData] Found unit by Id: ${unit.Id}`);
                            break;
                        }
                    }
                }

                console.log(`🔍 [SendAllData] Checking unit ${unitCode}: match =`, match ? 'FOUND' : 'NOT FOUND');

                if (match) {
                    // CRITICAL: Save OLD values from unit BEFORE updating
                    const oldUnitCode = unitCode;
                    const oldUnitBasePrice = unit.BasePrice;
                    const oldUnitCost = unit.Cost;
                    const oldUnitOnHand = unit.OnHand;

                    // CRITICAL: Determine if child BasePrice was changed by user
                    const childBasePriceChanged = match.BasePrice !== undefined &&
                                                   match.FinalBasePrice !== undefined &&
                                                   match.BasePrice !== match.FinalBasePrice;

                    // CRITICAL: Use BasePrice if user changed it, otherwise use OriginalBasePrice (FinalBasePrice)
                    let unitBasePriceToUse: number;
                    if (childBasePriceChanged) {
                        // User changed BasePrice → use the new value
                        unitBasePriceToUse = match.BasePrice;
                    } else {
                        // BasePrice not changed → use original value
                        unitBasePriceToUse = match.FinalBasePrice || match.BasePrice;
                    }

                    console.log(`✅ [SendAllData] Updating unit ${unitCode}:`, {
                        OldCode: unitCode,
                        NewCode: match.Code,
                        Name: match.Name,
                        NewBasePrice: unitBasePriceToUse,
                        OldBasePrice: oldUnitBasePrice,
                        BasePriceChanged: childBasePriceChanged,
                        NewCost: match.Cost,
                        OldCost: oldUnitCost,
                        NewOnHand: match.OnHand,
                        OldOnHand: oldUnitOnHand
                    });

                    // Update Code if changed (KiotViet allows Code update via Id)
                    if (match.Code && match.Code !== unitCode) {
                        console.log(`🔄 [SendAllData] Updating unit Code: ${unitCode} → ${match.Code}`);
                        if ('Code' in unit) {
                            unit.Code = match.Code;
                            // CRITICAL: CompareCode MUST be OLD value for KiotViet to detect change
                            unit.CompareCode = oldUnitCode;
                        }
                        if ('ProductCode' in unit) {
                            unit.ProductCode = match.Code;
                        }
                    }

                    // IMPORTANT: Do NOT update FullName - it's auto-generated by KiotViet from Name + Attributes + Unit
                    // Only update Name if available
                    if (match.Name && 'Name' in unit && match.Name !== unit.Name) {
                        console.log(`🔄 [SendAllData] Updating unit Name: ${unit.Name} → ${match.Name}`);
                        const oldUnitName = unit.Name;
                        unit.Name = match.Name;
                        // CRITICAL: CompareName MUST be OLD value for KiotViet to detect change
                        if ('CompareName' in unit) {
                            unit.CompareName = oldUnitName;
                        }
                    }

                    if (unitBasePriceToUse !== undefined) {
                        unit.BasePrice = unitBasePriceToUse;
                        // CRITICAL: CompareBasePrice MUST be OLD value for KiotViet to detect change
                        unit.CompareBasePrice = oldUnitBasePrice;
                        if ('Price' in unit) {
                            unit.Price = unitBasePriceToUse;
                        }
                    }
                    if (match.Cost !== undefined) {
                        unit.Cost = match.Cost;
                        // CRITICAL: CompareCost MUST be OLD value for KiotViet to detect change
                        unit.CompareCost = oldUnitCost;
                    }
                    if (match.OnHand !== undefined) {
                        unit.OnHand = match.OnHand;
                        // CRITICAL: CompareOnHand MUST be OLD value for KiotViet to detect change
                        unit.CompareOnHand = oldUnitOnHand;
                    }
                }

                return unit;
            });
        }

        console.log('🚀 [SendAllData] Final payload being sent to KiotViet:', JSON.stringify(payload, null, 2));

        // Send to KiotViet API ONCE
        const response = await this.kiotvietService.updateProductToKiotviet(payload);
        console.log('✅ [SendAllData] Response from KiotViet:', response);

        if (response) {
            console.log('✅ [SendAllData] Successfully sent to KiotViet!');
        } else {
            console.error('❌ [SendAllData] KiotViet returned empty response');
        }
    }

    /**
     * Send single product group to KiotViet API
     */
    async sendProductData(editedProduct: any, remainEditedProducts: any[]): Promise<any> {
        console.log('🔵 [SendData] editedProduct (lowest ConversionValue):', {
            Id: editedProduct.Id,
            Code: editedProduct.Code,
            FullName: editedProduct.FullName,
            ConversionValue: editedProduct.ConversionValue,
            BasePrice: editedProduct.BasePrice,
            Cost: editedProduct.Cost
        });
        console.log('🔵 [SendData] remainEditedProducts:', remainEditedProducts.map(p => ({
            Id: p.Id,
            Code: p.Code,
            ConversionValue: p.ConversionValue
        })));

        // Get fresh payload from KiotViet API
        const payload = await this.kiotvietService.getRequestBody(editedProduct.Id);

        if (!payload?.Product) {
            throw new Error('Không thể lấy dữ liệu sản phẩm từ KiotViet');
        }

        console.log('🟢 [SendData] Payload from KiotViet:', {
            ProductId: payload.Product.Id,
            ProductCode: payload.Product.Code,
            Product_BasePrice: payload.Product.BasePrice,
            Product_CompareBasePrice: payload.Product.CompareBasePrice,
            Product_Cost: payload.Product.Cost,
            Product_CompareCost: payload.Product.CompareCost,
            Product_OnHand: payload.Product.OnHand,
            Product_CompareOnHand: payload.Product.CompareOnHand,
            ProductUnits: payload.Product.ProductUnits?.map((u: any) => ({
                Id: u.Id,
                Code: u.Code,
                Unit: u.Unit,
                ConversionValue: u.ConversionValue,
                BasePrice: u.BasePrice,
                CompareBasePrice: u.CompareBasePrice,
                Cost: u.Cost,
                OnHand: u.OnHand
            }))
        });

        // Create map of edited products using OriginalCode as key
        const allEdited = [editedProduct, ...remainEditedProducts];
        const editedMap = new Map<string, any>();

        allEdited.forEach((item) => {
            const key = item?.OriginalCode ?? item?.Code;
            if (key) {
                editedMap.set(String(key), item);
            }
        });

        console.log('🟡 [SendData] editedMap keys:', Array.from(editedMap.keys()));

        // Only update fields that exist in the payload and have changed
        // Update main product fields
        if (editedProduct.FullName) {
            payload.Product.FullName = editedProduct.FullName;
        }
        // Use FinalBasePrice if available, otherwise BasePrice
        const basePriceToUse = editedProduct.FinalBasePrice > 0 ? editedProduct.FinalBasePrice : editedProduct.BasePrice;
        if (basePriceToUse !== undefined) {
            payload.Product.BasePrice = basePriceToUse;
        }
        if (editedProduct.Cost !== undefined) {
            payload.Product.Cost = editedProduct.Cost;
        }
        if (editedProduct.OnHand !== undefined) {
            payload.Product.OnHand = editedProduct.OnHand;
        }

        console.log('✏️ [SendData] Updated main product fields:', {
            FullName: payload.Product.FullName,
            BasePrice: payload.Product.BasePrice,
            Cost: payload.Product.Cost,
            OnHand: payload.Product.OnHand
        });

        // Update ProductUnits array (child products)
        if (Array.isArray(payload.Product.ProductUnits)) {
            payload.Product.ProductUnits = payload.Product.ProductUnits.map((unit: any) => {
                // Find matching edited product by Code
                const unitCode = unit?.Code ?? unit?.ProductCode;
                const match = editedMap.get(String(unitCode));

                console.log(`🔍 [SendData] Checking unit ${unitCode}: match =`, match ? 'FOUND' : 'NOT FOUND');

                if (match) {
                    // Use FinalBasePrice if available, otherwise BasePrice
                    const unitBasePriceToUse = match.FinalBasePrice > 0 ? match.FinalBasePrice : match.BasePrice;

                    console.log(`✅ [SendData] Updating unit ${unitCode}:`, {
                        FullName: match.FullName,
                        BasePrice: unitBasePriceToUse,
                        Cost: match.Cost,
                        OnHand: match.OnHand
                    });

                    // Update all fields - add them even if they don't exist in the payload
                    if (match.FullName && 'FullName' in unit) {
                        unit.FullName = match.FullName;
                    }
                    if (match.FullName && 'ProductName' in unit) {
                        unit.ProductName = match.FullName;
                    }
                    if (unitBasePriceToUse !== undefined) {
                        unit.BasePrice = unitBasePriceToUse;
                        if ('Price' in unit) {
                            unit.Price = unitBasePriceToUse;
                        }
                    }
                    // ALWAYS add Cost and OnHand, even if not in original payload
                    if (match.Cost !== undefined) {
                        unit.Cost = match.Cost;
                    }
                    if (match.OnHand !== undefined) {
                        unit.OnHand = match.OnHand;
                    }
                }

                return unit;
            });
        }

        console.log('🚀 [SendData] Final payload being sent to KiotViet:', JSON.stringify(payload, null, 2));

        await this.kiotvietService.updateProductToKiotviet(payload);
    }

}
