import { Component, Input, Output, EventEmitter, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTooltipModule } from '@angular/material/tooltip';

@Component({
  selector: 'app-menu-bar',
  standalone: true,
  imports: [CommonModule, MatTooltipModule],
  templateUrl: './menu-bar.component.html',
  styleUrls: ['./menu-bar.component.css'],
  encapsulation: ViewEncapsulation.None
})
export class MenuBarComponent {
  @Input() hasOfflineInvoices: boolean = false;
  @Input() isReloading: boolean = false;
  @Input() isOrderMode: boolean = false;
  @Input() isPrintEnabled: boolean = false;
  @Input() showMenuDropdown: boolean = false;
  @Input() userEmail: string = '';

  @Output() offlineInvoicesClick = new EventEmitter<void>();
  @Output() reloadClick = new EventEmitter<void>();
  @Output() orderModeToggle = new EventEmitter<void>();
  @Output() printToggle = new EventEmitter<void>();
  @Output() outOfStockClick = new EventEmitter<void>();
  @Output() menuClick = new EventEmitter<string>();
  @Output() menuDropdownStateChange = new EventEmitter<boolean>();

  /**
   * Get display name from email (remove @gmail.com or any domain)
   */
  get displayName(): string {
    if (! this.userEmail) return 'admin';
    const atIndex = this.userEmail.indexOf('@');
    return atIndex > 0 ? this. userEmail.substring(0, atIndex) : this.userEmail;
  }

  openOfflineInvoicesDialog() {
    this.offlineInvoicesClick.emit();
  }

  reload() {
    this.reloadClick.emit();
  }

  enableOrderMode() {
    this.orderModeToggle.emit();
  }

  togglePrint() {
    this.printToggle.emit();
  }

  openOutOfStockDialog() {
    this. outOfStockClick.emit();
  }

  onMenuClick(menu: string) {
    this. menuClick.emit(menu);
  }

  openExternalLink(url: string) {
    window.open(url, '_blank');
  }

  showMenu() {
    this.showMenuDropdown = true;
    this.menuDropdownStateChange. emit(true);
  }

  hideMenu() {
    this.showMenuDropdown = false;
    this.menuDropdownStateChange. emit(false);
  }
}