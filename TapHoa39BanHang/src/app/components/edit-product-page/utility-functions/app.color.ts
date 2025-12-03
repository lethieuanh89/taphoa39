import { groupProducts } from "./app.group-item";

export function assignColorsToProductList(filteredProducts: any[], productColors: Record<string, string>) {
    // Group products based on the ListProduct field of the first product
    const groupedProducts = groupProducts(filteredProducts);
    const colors = [
        '#aabcee',
        '#aed581', // Màu xanh lá sáng nhạt
        '#ffcc80', // Màu cam nhạt
        '#ffab91', // Màu đỏ nhạt
        '#80deea', // Màu xanh nhạt
        '#e6ee9c', // Màu vàng nhạt
        '#bcaaa4', // Màu nâu nhạt
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
        
        '#e57373', // Màu đỏ sáng nhạt
    ];

    Object.keys(groupedProducts).forEach((parentCode, index) => {

        const groupColor = colors[index % colors.length];
        const darkerColor = darkenColor(groupColor); // Function to darken the color
        productColors[parentCode] = groupColor;
        groupedProducts[parentCode].forEach((childProduct) => {
            if (childProduct.Master) {
                productColors[childProduct.Code] = darkerColor;
            } else {
                productColors[childProduct.Code] = groupColor;
            }
        });

        function darkenColor(color: string): string {
            // Simple function to darken a hex color
            const colorValue = parseInt(color.slice(1), 16);
            const r = Math.max((colorValue >> 16) - 30, 0);
            const g = Math.max(((colorValue >> 8) & 0x00ff) - 30, 0);
            const b = Math.max((colorValue & 0x0000ff) - 30, 0);
            return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, '0')}`;
        }
    });
}
