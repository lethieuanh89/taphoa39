import { Customer } from '../../../models/customer.model';
import { normalizeVietnamese } from './product.functions';

/**
 * Search customers by name or phone
 */
export function searchCustomers(
  customers: Customer[],
  searchTerm: string,
  maxResults: number = 10
): Customer[] {
  if (!searchTerm || searchTerm.trim().length === 0) {
    return [];
  }

  const normalizedSearch = normalizeVietnamese(searchTerm.toLowerCase().trim());
  const searchWords = normalizedSearch.split(/\s+/);

  return customers
    .filter(customer => {
      const normalizedName = normalizeVietnamese((customer.Name || '').toLowerCase());
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
export function getCustomerDisplayText(customer: Customer | null): string {
  if (!customer) return '';
  const phone = customer.ContactNumber ? ` - ${customer.ContactNumber}` : '';
  return `${customer.Name}${phone}`;
}

/**
 * Normalize customer data
 */
export function normalizeCustomer(customer: Customer | null): Customer | null {
  if (!customer) return null;

  return {
    ...customer,
    Debt: customer.Debt || 0,
    TotalPoint: customer.TotalPoint || 0
  };
}

/**
 * Get customer debt value
 */
export function getCustomerDebtValue(customer: Customer | null): number {
  return customer?.Debt || 0;
}

/**
 * Get customer total points
 */
export function getCustomerTotalPointValue(customer: Customer | null): number {
  return customer?.TotalPoint || 0;
}

/**
 * Check if customer has debt
 */
export function customerHasDebt(customer: Customer | null): boolean {
  return getCustomerDebtValue(customer) > 0;
}

/**
 * Check if customer has points
 */
export function customerHasPoints(customer: Customer | null): boolean {
  return getCustomerTotalPointValue(customer) > 0;
}

/**
 * Find customer by ID
 */
export function findCustomerById(
  customers: Customer[],
  id: number
): Customer | undefined {
  return customers.find(c => c.Id === id);
}

/**
 * Find customer by phone
 */
export function findCustomerByPhone(
  customers: Customer[],
  phone: string
): Customer | undefined {
  return customers.find(c => c.ContactNumber === phone);
}

/**
 * Validate customer data
 */
export function validateCustomer(customer: Customer): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!customer.Name || customer.Name.trim().length === 0) {
    errors.push('Tên khách hàng không được để trống');
  }

  if (customer.ContactNumber && !isValidPhoneNumber(customer.ContactNumber)) {
    errors.push('Số điện thoại không hợp lệ');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Check if phone number is valid
 */
function isValidPhoneNumber(phone: string): boolean {
  // Vietnamese phone number pattern
  const phonePattern = /^(0|\+84)[0-9]{9,10}$/;
  return phonePattern.test(phone);
}
