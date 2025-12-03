import { Injectable } from '@angular/core';
import { Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { InvoiceTab } from '../../models/invoice.model';
import { Product } from '../../models/product.model';
import { CartItem } from '../../models/cart-item.model';

/**
 * InitializationOrchestratorService
 * Handles the initialization logic previously in ngOnInit()
 */
@Injectable({
  providedIn: 'root'
})
export class InitializationOrchestratorService {

  /**
   * Setup search subscription with debounce
   */
  setupSearchSubscription(
    searchChanged$: any,
    onSearchCallback: (query: string) => void
  ): Subscription {
    return searchChanged$.pipe(
      debounceTime(400)
    ).subscribe((query: string) => {
      onSearchCallback(query);
    });
  }

  /**
   * Setup invoice created subscription
   */
  setupInvoiceCreatedSubscription(
    invoiceCreated$: any,
    onInvoiceCreatedCallback: (invoice: InvoiceTab) => void
  ): Subscription {
    return invoiceCreated$.subscribe((invoice: InvoiceTab) => {
      console.log(`🆕 Main page: Invoice created from order - ${invoice.id}`);

      // If the invoice name contains "từ đơn hàng", it was converted from an order
      if (invoice.name && invoice.name.includes('từ đơn hàng')) {
        console.log(`✅ Invoice ${invoice.id} was converted from an order and is now available in the invoice system`);
      }

      onInvoiceCreatedCallback(invoice);
    });
  }

  /**
   * Setup order processed subscription
   */
  setupOrderProcessedSubscription(
    orderProcessed$: any,
    onOrderProcessedCallback: (data: any) => void
  ): Subscription {
    return orderProcessed$.subscribe((data: any) => {
      console.log(`🔄 Main page: Received order processed data - ${data.orderId}`);
      onOrderProcessedCallback(data);
    });
  }

  /**
   * Setup product OnHand update subscription
   */
  setupProductOnHandSubscription(
    productOnHandUpdated$: any,
    context: {
      cartItems: CartItem[];
      filteredProducts: Product[];
      groupedProducts: { [key: number]: Product[] };
      updateItemTotal: (item: CartItem) => void;
      updateInvoiceTotalPrice: () => void;
      groupProduct: () => Promise<void>;
    }
  ): Subscription {
    return productOnHandUpdated$.subscribe((update: any) => {
      try {
        const { productId } = update;
        if (typeof productId !== 'number') {
          return;
        }

        console.log('🟢 MainPageComponent: received productOnHandUpdated', update);

        const applyUpdateToProduct = (product: any): boolean => {
          if (!product || product.Id !== productId) {
            return false;
          }

          let mutated = false;

          if (typeof update.onHand === 'number' && product.OnHand !== update.onHand) {
            product.OnHand = update.onHand;
            mutated = true;
          }

          if (typeof update.basePrice === 'number' && product.BasePrice !== update.basePrice) {
            product.BasePrice = update.basePrice;
            if (typeof product.FinalBasePrice === 'number') {
              product.FinalBasePrice = update.basePrice;
            }
            mutated = true;
          }

          if (typeof update.cost === 'number' && product.Cost !== update.cost) {
            product.Cost = update.cost;
            mutated = true;
          }

          if (update.code && product.Code !== update.code) {
            product.Code = update.code;
            mutated = true;
          }

          if (update.fullName && product.FullName !== update.fullName) {
            product.FullName = update.fullName;
            mutated = true;
          }

          if (update.name && product.Name !== update.name) {
            product.Name = update.name;
            mutated = true;
          }

          return mutated;
        };

        let updated = false;

        // Update cart items
        for (const item of context.cartItems) {
          if (item.product && applyUpdateToProduct(item.product)) {
            updated = true;
            context.updateItemTotal(item);
          }
        }

        // Update filtered products
        if (Array.isArray(context.filteredProducts) && context.filteredProducts.length > 0) {
          for (const product of context.filteredProducts) {
            if (applyUpdateToProduct(product)) {
              updated = true;
            }
          }
        }

        // Update grouped products
        for (const groupKey of Object.keys(context.groupedProducts || {})) {
          const groupItems = context.groupedProducts[Number(groupKey)] || [];
          for (const product of groupItems) {
            if (applyUpdateToProduct(product)) {
              updated = true;
            }
          }
        }

        if (updated) {
          context.updateInvoiceTotalPrice();
          context.groupProduct().catch(err =>
            console.error('Error refreshing groupedProducts after product update', err)
          );
        }
      } catch (err) {
        console.error('Error handling productOnHandUpdated in MainPageComponent', err);
      }
    });
  }

  /**
   * Setup cart items OnHand reload interval
   */
  setupOnHandReloadInterval(
    reloadCallback: () => void,
    intervalMs: number = 10000
  ): any {
    return setInterval(() => {
      reloadCallback();
    }, intervalMs);
  }

  /**
   * Initialize all subscriptions and intervals
   * Returns an object containing all subscriptions and intervals
   */
  initializeSubscriptionsAndIntervals(config: {
    searchChanged$: any;
    invoiceCreated$: any;
    orderProcessed$: any;
    productOnHandUpdated$: any;
    onSearchCallback: (query: string) => void;
    onInvoiceCreatedCallback: (invoice: InvoiceTab) => void;
    onOrderProcessedCallback: (data: any) => void;
    reloadCartItemsOnHand: () => void;
    productUpdateContext: {
      cartItems: CartItem[];
      filteredProducts: Product[];
      groupedProducts: { [key: number]: Product[] };
      updateItemTotal: (item: CartItem) => void;
      updateInvoiceTotalPrice: () => void;
      groupProduct: () => Promise<void>;
    };
  }): {
    subscriptions: Subscription[];
    interval: any;
  } {
    const subscriptions: Subscription[] = [];

    // Setup search subscription
    subscriptions.push(
      this.setupSearchSubscription(config.searchChanged$, config.onSearchCallback)
    );

    // Setup invoice created subscription
    subscriptions.push(
      this.setupInvoiceCreatedSubscription(config.invoiceCreated$, config.onInvoiceCreatedCallback)
    );

    // Setup order processed subscription
    subscriptions.push(
      this.setupOrderProcessedSubscription(config.orderProcessed$, config.onOrderProcessedCallback)
    );

    // Setup product OnHand subscription
    subscriptions.push(
      this.setupProductOnHandSubscription(config.productOnHandUpdated$, config.productUpdateContext)
    );

    // Setup OnHand reload interval
    const interval = this.setupOnHandReloadInterval(config.reloadCartItemsOnHand);

    return {
      subscriptions,
      interval
    };
  }
}
