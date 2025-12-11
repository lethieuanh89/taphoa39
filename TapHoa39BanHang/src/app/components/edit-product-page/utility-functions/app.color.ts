/**
 * Group products by Master's Id for color assignment
 * Products are already grouped and have Master flag set by ProductEditService
 * All products in the same unit group (same MasterUnitId chain) will have the same color
 */
function groupProductsByMaster(products: any[]): Record<string, any[]> {
    const grouped: Record<string, any[]> = {};

    // Build a map of all products by their MasterUnitId for quick lookup
    const productsByMasterUnitId = new Map<number, any[]>();
    const allProductsById = new Map<number, any>();

    products.forEach((product) => {
        allProductsById.set(product.Id, product);

        if (product.MasterUnitId !== null && product.MasterUnitId !== undefined) {
            if (!productsByMasterUnitId.has(product.MasterUnitId)) {
                productsByMasterUnitId.set(product.MasterUnitId, []);
            }
            productsByMasterUnitId.get(product.MasterUnitId)!.push(product);
        }
    });

    // Find the master for each product (Master flag is already set)
    const productToMaster = new Map<number, number>(); // productId -> masterId

    products.forEach((product) => {
        if (product.Master) {
            // This product IS the master
            productToMaster.set(product.Id, product.Id);

            // All products that share the same MasterUnitId should map to this master
            if (product.MasterUnitId !== null && product.MasterUnitId !== undefined) {
                const siblings = productsByMasterUnitId.get(product.MasterUnitId) || [];
                siblings.forEach(sibling => {
                    productToMaster.set(sibling.Id, product.Id);
                });
                // Also include the base unit (ConversionValue=1, MasterUnitId=null)
                const baseUnit = allProductsById.get(product.MasterUnitId);
                if (baseUnit) {
                    productToMaster.set(baseUnit.Id, product.Id);
                }
            }
        }
    });

    // Group all products by their master's Id
    products.forEach((product) => {
        let masterId = productToMaster.get(product.Id);

        if (!masterId) {
            // Fallback: try to find master through siblings
            if (product.MasterUnitId !== null && product.MasterUnitId !== undefined) {
                const siblings = productsByMasterUnitId.get(product.MasterUnitId) || [];
                const masterSibling = siblings.find(s => s.Master);
                masterId = masterSibling ? masterSibling.Id : product.Id;
            } else {
                // This might be the base unit - find if any product has this as MasterUnitId
                const children = productsByMasterUnitId.get(product.Id) || [];
                const masterChild = children.find(c => c.Master);
                masterId = masterChild ? masterChild.Id : product.Id;
            }
        }

        const groupKey = String(masterId);

        if (!grouped[groupKey]) {
            grouped[groupKey] = [];
        }
        grouped[groupKey].push(product);
    });

    return grouped;
}

function darkenColor(color: string): string {
    // Darken color by reducing all RGB components equally to maintain hue
    const colorValue = parseInt(color.slice(1), 16);
    const darkenAmount = 40; // Amount to darken (0-255)

    const r = Math.max((colorValue >> 16) - darkenAmount, 0);
    const g = Math.max(((colorValue >> 8) & 0x00ff) - darkenAmount, 0);
    const b = Math.max((colorValue & 0x0000ff) - darkenAmount, 0);

    return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, '0')}`;
}

export function assignColorsToProductList(filteredProducts: any[], productColors: Record<string, string>) {
    // Group products by Master's Id (products already have Master flag set)
    const groupedProducts = groupProductsByMaster(filteredProducts);
    const colors = [
        '#cdd8f7ff',
        '#d9e7c9ff', // Màu xanh lá sáng nhạt
        '#eedec6ff', // Màu cam nhạt
        '#ffab91', // Màu đỏ nhạt
        '#b4e7eeff', // Màu xanh nhạt
        '#e6ee9c', // Màu vàng nhạt
        '#e6d7d2ff', // Màu nâu nhạt
        '#ce93d8', // Màu tím nhạt
        '#b0bec5', // Màu xám nhạt
        '#f48fb1', // Màu hồng nhạt
        '#ffd54f', // Màu vàng cam nhạt
        '#81d4fa', // Màu xanh dương nhạt
        '#c5e1a5', // Màu xanh lá cây nhạt
        '#ff8a65', // Màu cam đỏ nhạt
        '#d4e157', // Màu xanh chanh nhạt
        '#9575cd', // Màu tím đậm nhạt
        '#4fc3f7', // Màu xanh biển nhạt
        '#ffb74d', // Màu cam sáng nhạt
        '#ecadadff', // Màu đỏ sáng nhạt
    ];

    Object.keys(groupedProducts).forEach((groupKey, index) => {
        const groupColor = colors[index % colors.length];
        const darkerColor = darkenColor(groupColor);

        groupedProducts[groupKey].forEach((product: any) => {
            // Use Id as key for color mapping - it's immutable and unique
            // This ensures color persists even if user edits the Code field
            const colorKey = String(product.Id);

            if (product.Master) {
                // Master gets darker color
                productColors[colorKey] = darkerColor;
            } else {
                // Child products get lighter color
                productColors[colorKey] = groupColor;
            }
        });
    });
}
