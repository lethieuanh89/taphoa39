import { Injectable } from '@angular/core';
import { Customer } from '../../models/customer.model';

@Injectable({
  providedIn: 'root'
})
export class CustomerHandlerService {
  private allCustomers: Customer[] = [];

  setCustomers(customers: Customer[]) {
    this.allCustomers = customers;
  }

  /**
   * Search customers by name or phone
   */
  searchCustomers(searchTerm: string, maxResults: number = 10): Customer[] {
    if (!searchTerm || searchTerm.trim().length === 0) {
      return [];
    }

    const normalizedSearch = this.normalizeVietnamese(searchTerm.toLowerCase().trim());
    const searchWords = normalizedSearch.split(/\s+/);

    return this.allCustomers
      .filter(customer => {
        const normalizedName = this.normalizeVietnamese((customer.Name || '').toLowerCase());
        const normalizedPhone = (customer.ContactNumber || '').toLowerCase();

        return searchWords.every(word =>
          normalizedName.includes(word) || normalizedPhone.includes(word)
        );
      })
      .slice(0, maxResults);
  }

  /**
   * Get customer display text
   */
  getCustomerDisplayText(customer: Customer): string {
    const phone = customer.ContactNumber ? ` - ${customer.ContactNumber}` : '';
    return `${customer.Name}${phone}`;
  }

  /**
   * Normalize customer data
   */
  normalizeCustomer(customer: Customer): Customer {
    return {
      ...customer,
      Debt: customer.Debt || 0,
      TotalPoint: customer.TotalPoint || 0
    };
  }

  /**
   * Get customer debt value
   */
  getCustomerDebtValue(customer: Customer | null): number {
    return customer?.Debt || 0;
  }

  /**
   * Get customer total points
   */
  getCustomerTotalPointValue(customer: Customer | null): number {
    return customer?.TotalPoint || 0;
  }

  /**
   * Check if customer has debt
   */
  hasDebt(customer: Customer | null): boolean {
    return (customer?.Debt || 0) > 0;
  }

  /**
   * Check if customer has points
   */
  hasPoints(customer: Customer | null): boolean {
    return (customer?.TotalPoint || 0) > 0;
  }

  /**
   * Normalize Vietnamese text for search
   */
  private normalizeVietnamese(str: string): string {
    return str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D');
  }

  /**
   * Find customer by ID
   */
  findCustomerById(id: number): Customer | undefined {
    return this.allCustomers.find(c => c.Id === id);
  }

  /**
   * Find customer by phone
   */
  findCustomerByPhone(phone: string): Customer | undefined {
    return this.allCustomers.find(c => c.ContactNumber === phone);
  }
}
