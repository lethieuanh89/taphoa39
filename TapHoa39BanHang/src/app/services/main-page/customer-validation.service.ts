import { Injectable } from '@angular/core';
import { Customer } from '../../models/customer.model';

/**
 * CustomerValidationService
 * Handles customer data validation, normalization, and search operations
 */
@Injectable({
  providedIn: 'root'
})
export class CustomerValidationService {

  /**
   * Normalize search text by removing accents and special characters
   */
  normalizeSearchText(value: string | null | undefined): string {
    if (!value) {
      return '';
    }

    return value
      .toString()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  /**
   * Build searchable target string from customer data
   */
  buildCustomerSearchTarget(customer: Customer): string {
    const parts: Array<string | null | undefined> = [
      customer?.Name,
      customer?.ContactNumber,
      customer?.CompareName,
      customer?.CompareCode,
      customer?.Organization,
      (customer as any)?.Note,
      customer?.Code
    ];
    return this.normalizeSearchText(parts.filter(Boolean).join(' '));
  }

  /**
   * Check if customer matches search query tokens
   */
  matchesCustomerSearch(customer: Customer, tokens: string[]): boolean {
    if (!customer || tokens.length === 0) {
      return false;
    }

    const target = this.buildCustomerSearchTarget(customer);
    if (!target) {
      return false;
    }

    return tokens.every((token) => target.includes(token));
  }

  /**
   * Normalize customer data with safe number conversions
   */
  normalizeCustomer(
    customer: Customer,
    coerceToNumberFn: (value: unknown, fallback?: number) => number
  ): Customer {
    const rawCustomer = customer as Customer & { [key: string]: unknown };
    const debt = coerceToNumberFn(rawCustomer.Debt);
    const totalPoint = coerceToNumberFn(rawCustomer.TotalPoint ?? rawCustomer.RewardPoint ?? 0);

    return {
      ...customer,
      Debt: debt,
      TotalPoint: totalPoint,
      RewardPoint: totalPoint
    };
  }

  /**
   * Get customer debt value safely
   */
  getCustomerDebtValue(customer: Customer | null, coerceToNumberFn: (value: unknown, fallback?: number) => number): number {
    return customer ? coerceToNumberFn((customer as any).Debt) : 0;
  }

  /**
   * Get customer total point value safely
   */
  getCustomerTotalPointValue(customer: Customer | null, coerceToNumberFn: (value: unknown, fallback?: number) => number): number {
    if (!customer) {
      return 0;
    }
    return coerceToNumberFn((customer as any).TotalPoint ?? (customer as any).RewardPoint);
  }

  /**
   * Format customer display text for search input
   */
  formatCustomerDisplayText(customer: Customer): string {
    return `${customer.Name} - ${customer.ContactNumber || ''}`;
  }

  /**
   * Filter customers by search query
   */
  filterCustomersByQuery(customers: Customer[], query: string): Customer[] {
    const normalizedQuery = this.normalizeSearchText(query);
    if (!normalizedQuery) {
      return customers;
    }

    const queryTokens = normalizedQuery.split(' ').filter(t => t.length > 0);
    if (queryTokens.length === 0) {
      return customers;
    }

    return customers.filter(customer =>
      this.matchesCustomerSearch(customer, queryTokens)
    );
  }
}
