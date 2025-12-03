export function groupProducts(products: any[]): Record<string, any[]> {
    const groupedProducts: Record<string, any[]> = {};

    if (!Array.isArray(products) || products.length === 0) {
        return groupedProducts;
    }

    const findByOriginalOrCurrentCode = (code: string | null | undefined) => {
        if (!code) {
            return undefined;
        }
        return products.find((p) => (p?.OriginalCode ?? p?.Code) === code);
    };

    products.forEach((product) => {
        if (product) {
            product.Master = false;
        }
        const parentCode = product?.ParentCode ?? product?.OriginalParentCode ?? product?.OriginalCode ?? product?.Code;
        const groupKey = parentCode ?? product?.Code;

        if (!groupKey) {
            return;
        }

        if (!groupedProducts[groupKey]) {
            groupedProducts[groupKey] = [];
        }

        const currentGroup = groupedProducts[groupKey];

        const ensureInGroup = (item: any) => {
            if (!item) {
                return;
            }
            if (!currentGroup.some((existing: any) => existing?.Id === item?.Id)) {
                currentGroup.push(item);
            }
        };

        ensureInGroup(product);

        if (Array.isArray(product?.ListProduct) && product.ListProduct.length > 0) {
            product.ListProduct.forEach((childProduct: any) => {
                const childOriginalCode = childProduct?.OriginalCode ?? childProduct?.Code;
                const matched = findByOriginalOrCurrentCode(childOriginalCode) ?? childProduct;

                if (matched && matched !== product) {
                    ensureInGroup(matched);
                }
            });
        }
    });

    Object.values(groupedProducts).forEach((group) => {
        if (group.length === 0) {
            return;
        }
        const masterCandidate = group.reduce((prev: any, curr: any) => {
            const prevConversion = Number(prev?.ConversionValue ?? 0);
            const currConversion = Number(curr?.ConversionValue ?? 0);

            return currConversion > prevConversion ? curr : prev;
        }, group[0]);

        if (masterCandidate) {
            masterCandidate.Master = true;
        }
    });

    return groupedProducts;
}