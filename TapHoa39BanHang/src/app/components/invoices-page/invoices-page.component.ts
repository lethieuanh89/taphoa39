import { Component, ViewEncapsulation, OnInit, ViewChild, OnDestroy } from '@angular/core';
import { MatDialogRef, MatDialogModule, MatDialog } from '@angular/material/dialog';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule, DateAdapter, MAT_DATE_FORMATS, MAT_DATE_LOCALE } from '@angular/material/core';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { InvoiceTab } from '../../models/invoice.model';
import { ViewSwlectedInvoiceDialogComponent } from './view-selected-invoice.component';
import { InvoiceDetailComponent } from '../invoice-detail/invoice-detail.component';
import { PrintService } from '../../services/print.service';
import { VietnameseService } from '../../services/vietnamese.service';
import { InvoiceService } from '../../services/invoice.service';
import { TimeZoneService } from '../../services/time-zone.service';
import { ConfirmPopupComponent } from '../confirm-popup/confirm-popup.component';
import { firstValueFrom, Subscription } from 'rxjs';
import { FirebaseWebsocketService } from '../../services/firebase-websocket.service';
import { NotificationService } from '../../services/notification.service';
import { LogService } from '../../services/log.service';

@Component({
  selector: 'app-invoices-page',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatSelectModule,
    MatTableModule,
    MatIconModule,
    MatButtonModule
  ],
  templateUrl: './invoices-page.component.html',
  styleUrls: ['./invoices-page.component.css'],
  encapsulation: ViewEncapsulation.None
})
export class InvoicesPageComponent implements OnInit, OnDestroy {
  allInvoices: InvoiceTab[] = [];
  filteredInvoices: InvoiceTab[] = [];
  searchTerm = '';
  searchTermProduct = ''
  selectedDate: Date | null = null;
  selectedTime: string | null = null; // kept for compatibility with existing filters
  selectedHour: string | null = '';
  selectedMinute: string | null = '';
  hours: string[] = Array.from({ length: 24 }, (_, i) => (i < 10 ? '0' + i : '' + i));
  minutes: string[] = [ '15', '30', '45', '59'];
  selectedCustomer = '';
  customers: string[] = [];
  pageSize = 10;
  currentPage = 1;
  displayedColumns: string[] = ['id', 'customer', 'date', 'totalPrice', 'actions'];
  isLoading = false;
  isWebSocketConnected = false;
  lastSyncTime: Date | null = null;
  // Controls visibility of filters/status bar in template
  hideFilters = false;
  // Timestamp when the user pressed the manual "Đồng bộ" button
  lastManualSyncAt: Date | null = null;

  // Real-time subscriptions
  private subscriptions: Subscription[] = [];
  private isSyncing = false; // Flag to prevent multiple simultaneous syncs
  private syncDebounceTimer: any = null; // Debounce timer for sync operations

  // Total price filter
  selectedMinTotal: number | null = null;
  selectedMaxTotal: number | null = null;

  // Inline notification message shown at top of page (replaces snackbar for invoices)
  inlineNotifyMessage: string | null = null;
  // Debug: last websocket event received for invoices
  lastWsEvent: string | null = null;
  // Animated indicator for recent WS events
  lastWsEventAnimated = false;
  private lastWsEventTimer: any = null;
  // Timestamp (ms) when inline notification was last cleared by user/manual sync
  private lastClearedNotifyAt: number | null = null;

  constructor(
    private dialogRef: MatDialogRef<InvoicesPageComponent>,
    private dialog: MatDialog,
    private printService: PrintService,
    private dateAdapter: DateAdapter<Date>,
    private vi: VietnameseService,
    private invoiceService: InvoiceService,
    private timeZoneService: TimeZoneService,
    private websocketService: FirebaseWebsocketService,
    private notification: NotificationService,
    private logger: LogService
  ) {
    this.dateAdapter.setLocale('vi-VN');
  }

  closeInlineNotify(): void {
    this.inlineNotifyMessage = null;
    try {
      this.lastClearedNotifyAt = Date.now();
      localStorage.setItem('invoices_inline_notify_cleared_at', String(this.lastClearedNotifyAt));
    } catch {}
  }

  // Helper: normalize notify payload to a readable string
  private formatNotifyPayload(payload: any): string {
    const defaultText = 'Hóa đơn đã thay đổi, hãy đồng bộ';
    try {
      if (payload == null) return defaultText;
      if (typeof payload === 'string') return payload;
      if (typeof payload === 'number' || typeof payload === 'boolean') return String(payload);
      if (typeof payload === 'object') {
        // Priority 1: Check for invoice ID (most important for user)
        const invoiceId = payload.id || payload.Id || payload.invoiceId || payload.InvoiceId;
        if (invoiceId) {
          return `Hóa đơn mới: ${invoiceId}`;
        }

        // Priority 2: Check for explicit message fields
        if (typeof payload.message === 'string' && payload.message.trim()) return payload.message;
        if (typeof payload.msg === 'string' && payload.msg.trim()) return payload.msg;
        if (typeof payload.text === 'string' && payload.text.trim()) return payload.text;

        // Priority 3: Try to stringify but keep it short
        try {
          const s = JSON.stringify(payload);
          return s.length > 200 ? s.slice(0, 200) + '...' : s;
        } catch {
          return defaultText;
        }
      }
      return String(payload);
    } catch {
      return defaultText;
    }
  }

  // Try to extract a numeric timestamp (ms since epoch) from common payload fields
  private getPayloadTimestamp(payload: any): number | null {
    if (!payload) return null;
    try {
      if (typeof payload === 'number') return payload;
      if (typeof payload === 'string') {
        // try parse ISO or numeric
        const asNum = Number(payload);
        if (!Number.isNaN(asNum) && asNum > 0) return asNum;
        const parsed = Date.parse(payload);
        if (!Number.isNaN(parsed)) return parsed;
        return null;
      }
      if (typeof payload === 'object') {
        const keys = ['timestamp', 'ts', 'time', 'created_at', 'updated_at', 'modified_at', 'date'];
        for (const k of keys) {
          if (payload[k]) {
            const v = payload[k];
            const asNum = Number(v);
            if (!Number.isNaN(asNum) && asNum > 0) return asNum;
            const parsed = Date.parse(String(v));
            if (!Number.isNaN(parsed)) return parsed;
          }
        }
      }
    } catch {}
    return null;
  }

  async ngOnInit() {
    // 1. Xác định ngày hôm nay
    const now = new Date();
    this.selectedDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

    // 2. Đảm bảo IndexedDB cho hóa đơn đã có dữ liệu khi mở trang
    await this.invoiceService.ensureInvoicesSeededFromFirestore();



    // 4. Đọc lại hóa đơn của ngày hôm nay từ IndexedDB để hiển thị
    this.allInvoices = await this.invoiceService.getInvoicesByDateFromDB(this.selectedDate) || [];
    this.filteredInvoices = [...this.allInvoices];
    this.applyFilters();

    // 5. Các bước khởi tạo khác
    // Start websocket client and setup realtime subscriptions
    try {
      this.websocketService.connect();
      // small best-effort check
      setTimeout(() => {
        try { this.isWebSocketConnected = this.websocketService.isConnected('invoices'); } catch { this.isWebSocketConnected = false; }
      }, 200);
    } catch {
      this.isWebSocketConnected = false;
    }

    this.setupRealTimeSubscriptions();
    this.loadLastSyncTime();
    // Ensure no stale inline notification is shown when opening the page
    this.inlineNotifyMessage = null;
    // Load last cleared timestamp (persist so reopen doesn't show old queued notifies)
    try {
      const v = localStorage.getItem('invoices_inline_notify_cleared_at');
      this.lastClearedNotifyAt = v ? Number(v) : null;
    } catch {
      this.lastClearedNotifyAt = null;
    }
  }

  ngOnDestroy() {
    // Disconnect websocket and unsubscribe from all real-time events
    try { this.websocketService.disconnectAll(); } catch {}
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions = [];

    // Clear any pending sync timers
    if (this.syncDebounceTimer) {
      clearTimeout(this.syncDebounceTimer);
    }
  }

  private async loadLastSyncTime(): Promise<void> {
    try {
      // getLastSyncTime is not available; use lastSyncTimestamp property if present
      this.lastSyncTime = (this.invoiceService as any).lastSyncTimestamp || null;
      this.logger.info('Last sync time loaded:', this.lastSyncTime);
    } catch (error) {
      this.logger.error('Error loading last sync time', error);
    }
  }

  // WebSocket-related initialization removed (server no longer supports websockets).

  private setupRealTimeSubscriptions(): void {
    // Subscribe to invoice created events
    const createdSub = this.invoiceService.invoiceCreated$.subscribe(invoice => {
      this.logger.info(`Real-time: Invoice created - ${invoice.id}`);
      this.handleInvoiceCreated(invoice);
    });

    // Subscribe to invoice updated events
    const updatedSub = this.invoiceService.invoiceUpdated$.subscribe(invoice => {
      this.logger.info(`Real-time: Invoice updated - ${invoice.id}`);
      this.handleInvoiceUpdated(invoice);
    });

    // Subscribe to invoice deleted events
    const deletedSub = this.invoiceService.invoiceDeleted$.subscribe(invoiceId => {
      this.logger.info(`Real-time: Processing invoice deleted - ${invoiceId}`);
      this.handleInvoiceDeleted(invoiceId);
    });

    // Subscribe to sync completed events - update last sync time
    const syncSub = this.invoiceService.syncCompleted$.subscribe(async () => {
      this.logger.info('Real-time: Sync completed, updating last sync time...');
      this.isSyncing = false;
      await this.loadLastSyncTime();
    });

    // Add all subscriptions to the array for cleanup
    // Also subscribe to websocket invoice-created events so other clients' changes show immediately
    const wsInvoiceSub = this.websocketService.invoiceCreated$().subscribe((invoice) => {
      try {
        const invoiceId = invoice?.id || invoice?.Id || '(no id)';
        this.logger.info(`WS Event: Invoice created - ${invoiceId}`);
        if (invoiceId !== '(no id)') {
          this.notification.info(`Hóa đơn mới: ${invoiceId}`);
        }
      } catch (e) {
        this.logger.warn('Error showing invoice created notification', e);
      }
      // Apply the same handling as local realtime events
      try {
        this.handleInvoiceCreated(invoice);
        // DO auto-show inline banner for invoice-created events with ID
        const invoiceId = invoice?.id || invoice?.Id;
        if (invoiceId && !this.isLoading && !this.isSyncing) {
          this.inlineNotifyMessage = `Hóa đơn mới: ${invoiceId}`;
        }
        this.setLastWsEvent('invoice_created (received)');
      } catch (err) {
        this.logger.warn('Error handling invoice created event', err);
      }
    });
    // Also subscribe to lightweight invoice notify events (no payload data expected)
    const wsInvoiceNotifySub = this.websocketService.notify$('invoices').subscribe((payload) => {
      // set inline notification message (shown at top of page) until user triggers sync
      try {
        const text = this.formatNotifyPayload(payload);
        const payloadTs = this.getPayloadTimestamp(payload);
        // If we have a last-cleared time and the payload timestamp exists, ignore if payload is older/equal
        if (this.lastClearedNotifyAt && payloadTs && payloadTs <= this.lastClearedNotifyAt) {
          // suppressed because this notify predates the user's last clear
          this.setLastWsEvent(`notify (ignored old): ${text}`);
        } else {
          if (!this.isLoading && !this.isSyncing) {
            this.inlineNotifyMessage = text;
          } else {
            this.setLastWsEvent(`notify: ${text}`);
          }
        }
      } catch (err) {
        this.logger.warn('Error processing notify$ payload', err);
      }
    });

    // Diagnostic subscription: log all events for invoices namespace and handle fallbacks
    const anyInvoicesSub = this.websocketService.any$.pipe().subscribe((e) => {
      try {
        if (e.namespace !== 'invoices') return;
        this.logger.debug('WS[invoices] event:', e.event, e.args);
        if (e.event === 'connect') {
          this.isWebSocketConnected = true;
        }
        if (e.event === 'disconnect') {
          this.isWebSocketConnected = false;
        }
        const notifyNames = new Set(['notify', 'changed', 'data_changed', 'update', 'updated', 'sync_needed', 'invoice_created']);
        if (notifyNames.has(e.event)) {
          // Prefer server-sent message if provided, else fallback to default text
          const payload = e.args && e.args[0] ? e.args[0] : null;
          const text = this.formatNotifyPayload(payload);
          // Only show inline message when not currently syncing/loading
          if (!this.isLoading && !this.isSyncing) {
            this.inlineNotifyMessage = text;
          } else {
            // suppress showing banner during sync; keep a trace in lastWsEvent
            this.setLastWsEvent(`${e.event} (suppressed): ${text}`);
          }
          try {
            if (!this.lastWsEvent) this.setLastWsEvent(`${e.event}: ${text}`);
          } catch {}
        } else {
          try { this.setLastWsEvent(e.event); } catch {}
        }
      } catch (err) {
        this.logger.warn('Error processing any$ event for invoices', err);
      }
    });

    // helper to set lastWsEvent with a short animation
    // (keeps a short animated indicator for recent WS activity)
    this.subscriptions.push(createdSub, updatedSub, deletedSub, syncSub, wsInvoiceSub, wsInvoiceNotifySub);
    this.subscriptions.push(anyInvoicesSub);

  }

  private setLastWsEvent(text: string | null): void {
    if (!text) return;
    try {
      this.lastWsEvent = text;
      this.lastWsEventAnimated = true;
      if (this.lastWsEventTimer) clearTimeout(this.lastWsEventTimer);
      this.lastWsEventTimer = setTimeout(() => {
        this.lastWsEventAnimated = false;
      }, 4200);
    } catch {}
  }

  // Map a websocket event text to a Material icon name for compact UI
  getWsEventIcon(eventText: string | null): string {
    if (!eventText) return 'cloud_off';
    const e = (eventText || '').toLowerCase();
    if (e.includes('connect')) return 'cloud_done';
    if (e.includes('disconnect') || e.includes('offline')) return 'cloud_off';
    if (e.includes('invoice_created') || e.includes('invoice_created (received)') || e.includes('invoice')) return 'receipt_long';
    if (e.includes('notify') || e.includes('changed') || e.includes('update') || e.includes('updated')) return 'campaign';
    if (e.includes('sync') || e.includes('đồng bộ') || e.includes('dong bo')) return 'sync';
    if (e.includes('error') || e.includes('fail')) return 'error';
    return 'info';
  }


  // Enhanced fetch method WITHOUT automatic sync to prevent infinite loops
  async fetchInvoicesByDate() {
    this.isLoading = true;
    if (!this.selectedDate) {
      this.allInvoices = [];
      this.filteredInvoices = [];
      this.isLoading = false;
      return;
    }

    try {
      // Format ngày theo Vietnam timezone để lấy từ indexedDB
      const date = this.timeZoneService.formatDateToVietnamString(this.selectedDate);

      // Lấy hóa đơn từ indexedDB theo ngày
      const invoices: InvoiceTab[] = await this.invoiceService.getInvoicesByDateFromDB(this.selectedDate);
      this.allInvoices = invoices || [];

      // Sort invoices to show the newest first
      this.allInvoices.sort((a, b) => {
        if (!a.createdDate) return 1;
        if (!b.createdDate) return -1;
        return new Date(b.createdDate).getTime() - new Date(a.createdDate).getTime()
      });

      this.filteredInvoices = [...this.allInvoices];
      this.customers = [...new Set(this.allInvoices.map(invoice =>
        typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.Name ?? ''
      ))];
      this.applyFilters();

    } catch (err) {
      this.logger.error('Error fetching invoices from indexedDB', err);
      this.allInvoices = [];
      this.filteredInvoices = [];
    } finally {
      this.isLoading = false;
    }
  }

  // Debounced sync method to prevent multiple rapid calls
  private async debouncedSync(): Promise<void> {
    if (this.syncDebounceTimer) {
      clearTimeout(this.syncDebounceTimer);
    }

    this.syncDebounceTimer = setTimeout(async () => {
      if (!this.isSyncing) {
        await this.performSync();
      }
    }, 1000); // 1 second debounce
  }

  // Actual sync method with proper locking
  private async performSync(): Promise<void> {
    if (this.isSyncing) {
      this.logger.warn('Sync already in progress, skipping...');
      return;
    }

    this.isSyncing = true;
    try {
      this.logger.info('Starting sync with server...');
      if (!this.selectedDate) {
        this.isSyncing = false;
        return;
      }
      // Lấy ngày dạng string cho API
      const dateStr = this.timeZoneService.formatDateToVietnamString(this.selectedDate);
      this.logger.debug('InvoicesPage.performSync -> dateStr for API:', dateStr, 'selectedDate:', this.selectedDate);
      // 1. Lấy hóa đơn từ API (Firestore) theo ngày
      const apiInvoices = await firstValueFrom(this.invoiceService.getInvoicesByDateFromFirestore(dateStr)) as InvoiceTab[];

      // 2+3. Replace all invoices for the selected date in a single transaction
      if (Array.isArray(apiInvoices)) {
        try {
          // Manual sync from invoices page should NOT invalidate report cache (reports are separate)
          await this.invoiceService.replaceInvoicesForDate(this.selectedDate, apiInvoices as InvoiceTab[], { invalidateReportCache: false });
        } catch (replaceErr) {
          this.logger.error('Lỗi khi thay thế hóa đơn trong IndexedDB', replaceErr);
          // Fallback to per-item operations if bulk replace fails
          const allLocalInvoices = await this.invoiceService.getInvoicesByDateFromDB(this.selectedDate);
          if (Array.isArray(allLocalInvoices)) {
            for (const inv of allLocalInvoices) {
              try {
                await this.invoiceService.deleteInvoiceFromDB(inv.id);
              } catch (delErr) {
                this.logger.warn('Không xóa được hóa đơn local (fallback):', inv.id, delErr);
              }
            }
          }

          for (const invoice of apiInvoices) {
            try {
              await this.invoiceService.addInvoiceToDB(invoice);
            } catch (addErr) {
              this.logger.error('Lỗi khi lưu invoice vào DB (fallback):', invoice.id, addErr);
            }
          }
        }
      }

      // 3. Refresh data sau khi sync
      await this.fetchInvoicesByDate();

      // 4. Update last sync time
      await this.loadLastSyncTime();

      this.logger.info('Sync completed successfully');
      this.notification.success('Đồng bộ thành công');
    } catch (error) {
      this.logger.error('Error during sync', error);
      this.notification.error('Lỗi khi đồng bộ');
    } finally {
      this.isSyncing = false;
    }
  }

  private async syncInvoicesWithServer(): Promise<void> {
    await this.performSync();
  }

  // Real-time update methods
  async handleInvoiceCreated(invoice: InvoiceTab): Promise<void> {
    this.logger.info(`Real-time: Processing invoice created - ${invoice.id}`);

    // Check if the invoice belongs to the current date
    if (this.selectedDate && this.isInvoiceInSelectedDate(invoice)) {
      // Add to local list if not already present
      const existingIndex = this.allInvoices.findIndex(inv => inv.id === invoice.id);
      if (existingIndex === -1) {
        this.allInvoices.unshift(invoice); // Add to beginning
        this.updateFilteredInvoices();
        this.logger.info(`Invoice ${invoice.id} added to current view`);
      } else {
        this.logger.debug(`Invoice ${invoice.id} already exists in current view`);
      }
    } else {
      this.logger.debug(`Invoice ${invoice.id} does not belong to current date, skipping UI update`);
    }
  }

  async handleInvoiceUpdated(invoice: InvoiceTab): Promise<void> {
    this.logger.info(`Real-time: Processing invoice updated - ${invoice.id}`);

    // Update in local list
    const existingIndex = this.allInvoices.findIndex(inv => inv.id === invoice.id);
    if (existingIndex !== -1) {
      this.allInvoices[existingIndex] = invoice;
      this.updateFilteredInvoices();
      this.logger.info(`Invoice ${invoice.id} updated in current view`);
    } else {
      this.logger.debug(`Invoice ${invoice.id} not found in current view, may need to refresh`);
      // Nếu không tìm thấy, có thể cần refresh data
      await this.fetchInvoicesByDate();
    }
  }

  async handleInvoiceDeleted(invoiceId: string): Promise<void> {
    this.logger.info(`Real-time: Processing invoice deleted - ${invoiceId}`);

    // Remove from local list
    const initialLength = this.allInvoices.length;
    this.allInvoices = this.allInvoices.filter(inv => inv.id !== invoiceId);

    if (this.allInvoices.length < initialLength) {
      this.updateFilteredInvoices();
      this.logger.info(`Invoice ${invoiceId} removed from current view`);
    } else {
      this.logger.debug(`Invoice ${invoiceId} not found in current view`);
    }
  }

  private isInvoiceInSelectedDate(invoice: InvoiceTab): boolean {
    if (!this.selectedDate || !invoice.createdDate) return false;

    const invoiceDate = new Date(invoice.createdDate);
    const selectedDateOnly = new Date(
      this.selectedDate.getFullYear(),
      this.selectedDate.getMonth(),
      this.selectedDate.getDate()
    );

    return invoiceDate >= selectedDateOnly &&
      invoiceDate < new Date(selectedDateOnly.getTime() + 24 * 60 * 60 * 1000);
  }

  private updateFilteredInvoices(): void {
    this.filteredInvoices = [...this.allInvoices];
    this.applyFilters();
  }

  // Enhanced delete method with WebSocket notification
  async deleteInvoicesByFilter() {
    const dialogRef = this.dialog.open(ConfirmPopupComponent, {
      width: '300px',
      data: { message: 'Bạn có chắc chắn muốn xóa tất cả hóa đơn đang hiển thị?' }
    });

    dialogRef.afterClosed().subscribe(async (result) => {
      if (result === true) {
        this.isLoading = true;
        let successCount = 0;
        let errorCount = 0;

        // Xóa từng invoice trong filteredInvoices
        for (const invoice of this.filteredInvoices) {
          try {
            // Xóa ở IndexedDB
            await this.invoiceService.deleteInvoiceFromDB(invoice.id);
            this.logger.info('Hóa đơn đã được xóa thành công từ IndexedDB');

            // Xóa ở Firestore
            await firstValueFrom(this.invoiceService.deleteInvoiceToFirestore(invoice.id));
            this.logger.info(`Đã xóa thành công từ Firestore: ${invoice.id}`);

            // Notify other clients via service notify (REST or no-op)
            if (this.invoiceService.notifyInvoiceDeleted) {
              await this.invoiceService.notifyInvoiceDeleted(invoice.id);
            }

            successCount++;
          } catch (error: any) {
            this.logger.error('Lỗi khi xóa hóa đơn', error);
            errorCount++;
          }
        }

        // Show summary
        if (successCount > 0) {
          this.logger.info(`Successfully deleted ${successCount} invoices`);
          this.notification.success(`Đã xóa ${successCount} hóa đơn`);
        }
        if (errorCount > 0) {
          this.logger.error(`Failed to delete ${errorCount} invoices`);
          this.notification.error(`Lỗi khi xóa ${errorCount} hóa đơn`);
        }

        // Cập nhật lại danh sách
        this.fetchInvoicesByDate();
      }
    });
  }

  // Manual sync method with proper locking
    // Manual sync method with proper locking
  async manualSync(): Promise<void> {
    if (this.isSyncing) {
      this.logger.warn('Sync already in progress, please wait.. .');
      this.notification.warning('Đang đồng bộ, vui lòng đợi...');
      return;
    }

    if (this.isLoading) {
      this.logger. warn('Component is loading, please wait...');
      this.notification.warning('Đang tải dữ liệu, vui lòng đợi...');
      return;
    }

    this.logger.info('Manual sync requested.. .');
    
    // Nếu chưa chọn ngày, mới fallback về ngày hôm nay
    // Nếu đã chọn ngày, giữ nguyên ngày đã chọn để sync
    if (!this.selectedDate) {
      const now = new Date();
      this.selectedDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    }
    
    this.isLoading = true;
    try {
      await this.performSync();
      // Set lastManualSyncAt after a successful sync
      this. lastManualSyncAt = new Date();
      // Clear inline notification banner on successful manual sync
      this. inlineNotifyMessage = null;
      try {
        this. lastClearedNotifyAt = Date.now();
        localStorage.setItem('invoices_inline_notify_cleared_at', String(this.lastClearedNotifyAt));
      } catch {}
      this.logger.info('Manual sync completed successfully — inline notification cleared');
    } catch (error) {
      this. logger.error('Manual sync failed', error);
      this.notification.error('Đồng bộ thất bại');
    } finally {
      this.isLoading = false;
    }
  }

  // Handler for the inline 'Đồng bộ' button: perform manual sync then clear the inline message
  // Note: inline banner and top 'Đồng bộ' button share `manualSync()` as the single sync entrypoint.

  // Connection status no longer represents WebSocket — show REST sync indicator
  getConnectionStatus(): string {
    return 'Polling / Manual sync';
  }

  // Method to trigger sync when needed (e.g., when WebSocket connects)
  async triggerSyncIfNeeded(): Promise<void> {
    // Trigger sync if not already syncing or loading
    if (!this.isSyncing && !this.isLoading) {
      this.logger.info('Triggering sync (manual/periodic)...');
      await this.debouncedSync();
    }
  }

  // Optional: Periodic sync check (can be called by parent components)
  async checkAndSyncIfNeeded(): Promise<void> {
    // Only sync if:
    // 1. WebSocket is connected
    // 2. Not currently syncing
    // 3. Not loading
    // 4. Last sync was more than 5 minutes ago
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const shouldSync = !this.isSyncing &&
      !this.isLoading &&
      (!this.lastSyncTime || this.lastSyncTime < fiveMinutesAgo);

    if (shouldSync) {
      this.logger.info('Periodic sync check triggered...');
      await this.debouncedSync();
    } else {
      this.logger.debug('Periodic sync check skipped (conditions not met)');
    }
  }

  // Public method to check sync status for template
  isCurrentlySyncing(): boolean {
    return this.isSyncing;
  }

  // WebSocket readiness removed — not applicable

  // Get last sync time
  getLastSyncTime(): string {
    // Prefer the manual-sync timestamp (when user pressed the button)
    const baseTime = this.lastManualSyncAt || this.lastSyncTime;
    if (baseTime) {
      const now = new Date();
      const diffMs = now.getTime() - baseTime.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 1) {
        return 'Vừa xong';
      } else if (diffMins < 60) {
        return `${diffMins} phút trước`;
      } else if (diffHours < 24) {
        return `${diffHours} giờ trước`;
      } else if (diffDays < 7) {
        return `${diffDays} ngày trước`;
      } else {
        return baseTime.toLocaleDateString('vi-VN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        });
      }
    }

    return 'Chưa đồng bộ';
  }

  // Template helper: format a date for display (date part + time)
  formatDate(date?: string | Date | null): string {
    if (!date) return '';
    try {
      const d = typeof date === 'string' ? new Date(date) : date;
      // Use TimeZoneService formatting for date portion, append time
      const datePart = this.timeZoneService.formatDateToVietnamString(d);
      const timePart = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
      return `${datePart} ${timePart}`;
    } catch (err) {
      return String(date);
    }
  }

  // Template event handler: onScroll (kept simple to avoid template errors)
  onScroll(event: Event): void {
    // No-op for now; reserved for future sticky header / lazy-load behavior
    // Example: const el = event.target as HTMLElement; // use el.scrollTop
  }

  async onDateChange(event: any) {
    if (event.value) {
      // Keep selectedDate as the day (00:00). Filtering will use createdDate range [00:00,24:00)
      this.selectedDate = new Date(event.value.getFullYear(), event.value.getMonth(), event.value.getDate(), 0, 0, 0, 0);
    } else {
      this.selectedDate = null;
    }

    if (this.selectedDate) {
      // Prefer reading from local IndexedDB if we've already synced this date.
      // If not present locally, fetch from server and store the results.
      const dateKey = this.timeZoneService.formatDateToVietnamString(this.selectedDate);
      this.logger.debug('InvoicesPage.onDateChange -> selectedDate:', this.selectedDate, 'dateKey:', dateKey);
      try {
        const already = await this.invoiceService.isDateSynced(dateKey);
        if (already) {
          this.logger.debug('InvoicesPage.onDateChange -> date already synced, reading from IndexedDB:', dateKey);
          await this.fetchInvoicesByDate();
        } else {
          this.logger.info('InvoicesPage.onDateChange -> date not yet synced, fetching from server:', dateKey);
          try {
            await this.performSync();
          } catch (err) {
            this.logger.error('Error syncing invoices on date change, falling back to local DB', err);
            await this.fetchInvoicesByDate();
          }
        }
      } catch (err) {
        this.logger.warn('InvoicesPage.onDateChange -> error checking synced status, falling back to server', err);
        try {
          await this.performSync();
        } catch (err2) {
          this.logger.error('Error syncing invoices after fallback check', err2);
          await this.fetchInvoicesByDate();
        }
      }
    }
  }

  onTimePartsChange() {
    if (this.selectedHour) {
      const mm = this.selectedMinute ? this.selectedMinute : '00';
      this.selectedTime = `${this.selectedHour}:${mm}`;
    } else {
      this.selectedTime = null;
    }
    this.applyFilters();
  }

  clearTime(event?: MouseEvent) {
    if (event) event.stopPropagation();
    this.selectedHour = '';
    this.selectedMinute = '';
    this.selectedTime = null;
    this.applyFilters();
  }
  clearFilters() {
    this.selectedDate = null;
    this.searchTerm = '';
    this.searchTermProduct = '';
    this.selectedCustomer = '';
    this.selectedHour = '';
    this.selectedMinute = '';
    this.selectedTime = null;
    this.selectedMinTotal = null;
    this.selectedMaxTotal = null;
    this.fetchInvoicesByDate();
  }

  applyFilters() {
    this.filteredInvoices = this.allInvoices.filter(invoice => {
      const matchesSearch = this.searchTerm
        ? String(invoice.id).toLowerCase().includes(this.searchTerm.toLowerCase()) ||
        invoice.customer?.Name?.toLowerCase().includes(this.searchTerm.toLowerCase())
        : true;
      const matchesProduct = this.checkProductFilter(invoice, this.searchTermProduct);
      const matchesCustomer = this.checkCustomerFilter(invoice);
      const matchesDate = this.checkDateFilter(invoice);
      const matchesTotal = this.checkTotalFilter(invoice);
      this.currentPage = 1;
      return matchesSearch && matchesCustomer && matchesProduct && matchesDate && matchesTotal;
    });
  }

  private checkTotalFilter(invoice: InvoiceTab): boolean {
    // Nếu không nhập giá trị, không lọc theo tổng
    if (this.selectedMinTotal === null || this.selectedMinTotal === undefined) {
      return true;
    }

    const total = typeof invoice.totalPrice === 'number' ? invoice.totalPrice : Number(invoice.totalPrice || 0);
    if (isNaN(total)) return false;

    // Lọc chính xác bằng số nhập vào (không phải khoảng)
    const target = Number(this.selectedMinTotal);
    return total === target;
  }
  
  private checkDateFilter(invoice: InvoiceTab): boolean {
    // No date selected -> match all
    if (!this.selectedDate) return true;
    if (!invoice.createdDate) return false;
    const invoiceDate = new Date(invoice.createdDate);
    if (isNaN(invoiceDate.getTime())) return false;

    // Start of selected day (00:00:00.000)
    const startOfDay = new Date(this.selectedDate.getFullYear(), this.selectedDate.getMonth(), this.selectedDate.getDate(), 0, 0, 0, 0);
    // End is exclusive: startOfNextDay (00:00 of next day)
    const startOfNextDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

    // Invoice must be within [startOfDay, startOfNextDay)
    if (!(invoiceDate >= startOfDay && invoiceDate < startOfNextDay)) {
      return false;
    }

    // If no hour selected, accept
    if (!this.selectedHour) return true;

    const hh = parseInt(this.selectedHour as string, 10);
    if (isNaN(hh)) return true;

    const invHour = invoiceDate.getHours();
    const invMin = invoiceDate.getMinutes();

    // If minute not selected -> treat as "all minutes in that hour"
    if (!this.selectedMinute) {
      return invHour === hh;
    }

    // Map selectedMinute to ranges:
    // '15' => 01..15
    // '30' => 16..30
    // '45' => 31..45
    // '00' => 46..00 (i.e., 46..59 of hh OR minute 0 of next hour)
    const selMin = this.selectedMinute;

    if (selMin === '15') {
      return invHour === hh && invMin >= 1 && invMin <= 15;
    }

    if (selMin === '30') {
      return invHour === hh && invMin >= 16 && invMin <= 30;
    }

    if (selMin === '45') {
      return invHour === hh && invMin >= 31 && invMin <= 45;
    }
    if (selMin === '59') {
      // Two parts: minutes 46-59 of selected hour OR minute 0 of next hour
      if (invHour === hh && invMin >= 46 && invMin <= 59) return true;
    }


    // Fallback: if minute is numeric but not one of buckets, try exact match
    const mm = parseInt(selMin as string, 10);
    if (!isNaN(mm)) {
      return invHour === hh && invMin === mm;
    }

    return true;
  }
  
  private checkCustomerFilter(invoice: InvoiceTab): boolean {
    if (!this.selectedCustomer) {
      return true;
    }

    return typeof invoice.customer === 'string'
      ? invoice.customer === this.selectedCustomer
      : invoice.customer?.Name === this.selectedCustomer;
  }

  viewInvoice(invoice: InvoiceTab) {
    const dialogRef = this.dialog.open(ViewSwlectedInvoiceDialogComponent, {
      width: '600px',
      data: {
        invoices: invoice,
        cartItems: invoice.cartItems || [],
      }
    });

    dialogRef.afterClosed().subscribe((result: any) => {
      // result could be: { edit: true, invoice, cartItems, isInvoiceEdit }
      if (result === true || result?.deleted) {
        this.allInvoices = this.allInvoices.filter(i => i.id !== invoice.id);
        this.applyFilters();
      } else if (result?.edit) {
        // Forward edit payload to the opener (main-page) including isInvoiceEdit flag
        try {
          this.dialogRef.close({
            edit: true,
            invoice: result.invoice,
            cartItems: result.cartItems || [],
            isInvoiceEdit: !!result.isInvoiceEdit
          });
        } catch (err) {
          this.logger.error('Error while forwarding edit request to opener', err);
        }
      }
    });
  }

  @ViewChild(InvoiceDetailComponent, { static: false })
  invoiceDetailComponent!: InvoiceDetailComponent;

  printInvoice(invoice: InvoiceTab) {
    const dialogRef = this.dialog.open(InvoiceDetailComponent, {
      data: { invoice },
      width: '0px',
      height: '0px',
      panelClass: 'hidden-dialog',
      disableClose: true
    });

    dialogRef.afterOpened().subscribe(() => {
      const componentInstance = dialogRef.componentInstance;
      if (componentInstance) {
        const html = componentInstance.getHtmlContent();
        if (!html) {
          this.logger.error('Không lấy được nội dung HTML hóa đơn!');
          this.notification.error('Không thể in hóa đơn');
          dialogRef.close();
          return;
        }
        this.printService.printHtml(html);
        dialogRef.close();
      } else {
        this.logger.error('Không thể lấy componentInstance của InvoiceDetailComponent!');
        this.notification.error('Lỗi khi in hóa đơn');
        dialogRef.close();
      }
    });
  }

  // Duplicate performSync removed. See correct implementation above.
  get totalPages(): number {
    return Math.ceil(this.filteredInvoices.length / this.pageSize);
  }

  get pagedInvoices(): InvoiceTab[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredInvoices.slice(start, start + this.pageSize);
  }
  goToPage(page: number) {
    if (page < 1 || page > this.totalPages) return;
    this.currentPage = page;
  }

  nextPage() {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
    }
  }

  prevPage() {
    if (this.currentPage > 1) {
      this.currentPage--;
    }
  }

  private searchInvoicesByProduct(searchTerm: string): boolean {
    if (!searchTerm || searchTerm.trim() === '') {
      return true; // Không có điều kiện tìm kiếm thì trả về true
    }

    const queryTokens = this.vi.normalizeAndTokenize(searchTerm);
    const queryStr = queryTokens.join(' ').toLowerCase();
    const rawQuery = searchTerm.toLowerCase();

    return this.filteredInvoices.some(invoice => {
      if (!invoice.cartItems || invoice.cartItems.length === 0) {
        return false;
      }

      // Tìm kiếm trong tất cả sản phẩm của hóa đơn
      return invoice.cartItems.some(item => {
        if (!item.product || !item.product.Name) {
          return false;
        }

        const productName = item.product.Name;
        const productCode = item.product.Code || '';

        // Chuẩn hóa tên sản phẩm
        const normalizedProductName = this.vi.normalizeAndTokenize(productName).join(' ').toLowerCase();

        // 1. Kiểm tra tên sản phẩm bắt đầu bằng từ khóa tìm kiếm
        if (normalizedProductName.startsWith(queryStr)) {
          return true;
        }

        // 2. Kiểm tra tên sản phẩm chứa từ khóa tìm kiếm
        if (normalizedProductName.includes(queryStr) || productName.toLowerCase().includes(rawQuery)) {
          return true;
        }

        // 3. Kiểm tra mã sản phẩm
        const productCodeLower = productCode.toLowerCase();

        // Kiểm tra nếu query có dạng "XXXXXXX-X" (có chứa dấu gạch ngang)
        if (rawQuery.includes('-')) {
          const baseQuery = rawQuery.split('-')[0];
          return productCodeLower === baseQuery;
        }

        return productCodeLower.includes(rawQuery);
      });
    });
  }
  private checkProductFilter(invoice: InvoiceTab, searchTerm: string): boolean {
    if (!searchTerm || searchTerm.trim() === '') {
      return true;
    }

    if (!invoice.cartItems || invoice.cartItems.length === 0) {
      return false;
    }

    const queryTokens = this.vi.normalizeAndTokenize(searchTerm);
    const queryStr = queryTokens.join(' ').toLowerCase();
    const rawQuery = searchTerm.toLowerCase();

    return invoice.cartItems.some(item => {
      if (!item.product || !item.product.Name) {
        return false;
      }

      const productName = item.product.Name;
      const productCode = item.product.Code || '';

      // Chuẩn hóa tên sản phẩm
      const normalizedProductName = this.vi.normalizeAndTokenize(productName).join(' ').toLowerCase();

      // 1. Kiểm tra tên sản phẩm bắt đầu bằng từ khóa tìm kiếm (độ ưu tiên cao nhất)
      if (normalizedProductName.startsWith(queryStr)) {
        return true;
      }

      // 2. Kiểm tra tên sản phẩm chứa từ khóa tìm kiếm
      if (normalizedProductName.includes(queryStr) || productName.toLowerCase().includes(rawQuery)) {
        return true;
      }

      // 3. Kiểm tra mã sản phẩm
      const productCodeLower = productCode.toLowerCase();

      // Kiểm tra nếu query có dạng "XXXXXXX-X" (có chứa dấu gạch ngang)
      if (rawQuery.includes('-')) {
        const baseQuery = rawQuery.split('-')[0];
        return productCodeLower === baseQuery;
      }

      return productCodeLower.includes(rawQuery);
    });
  }
  searchInvoicesByProductName(productSearchTerm: string): InvoiceTab[] {
    if (!productSearchTerm || productSearchTerm.trim() === '') {
      return this.allInvoices;
    }

    const queryTokens = this.vi.normalizeAndTokenize(productSearchTerm);
    const queryStr = queryTokens.join(' ').toLowerCase();
    const rawQuery = productSearchTerm.toLowerCase();

    // 1. Hóa đơn chứa sản phẩm có tên bắt đầu bằng từ khóa
    const startsWithMatches = this.allInvoices.filter(invoice =>
      invoice.cartItems?.some(item => {
        if (!item.product?.Name) return false;
        const normalizedName = this.vi.normalizeAndTokenize(item.product.Name).join(' ').toLowerCase();
        return normalizedName.startsWith(queryStr);
      })
    );

    // 2. Hóa đơn chứa sản phẩm có tên chứa từ khóa (nhưng không bắt đầu)
    const containsNameMatches = this.allInvoices.filter(invoice => {
      if (startsWithMatches.includes(invoice)) return false;

      return invoice.cartItems?.some(item => {
        if (!item.product?.Name) return false;
        const normalizedName = this.vi.normalizeAndTokenize(item.product.Name).join(' ').toLowerCase();
        return normalizedName.includes(queryStr) || item.product.Name.toLowerCase().includes(rawQuery);
      });
    });

    // 3. Hóa đơn chứa sản phẩm có mã chứa từ khóa
    const codeMatches = this.allInvoices.filter(invoice => {
      if (startsWithMatches.includes(invoice) || containsNameMatches.includes(invoice)) {
        return false;
      }

      return invoice.cartItems?.some(item => {
        if (!item.product?.Code) return false;
        const productCode = item.product.Code.toLowerCase();

        if (rawQuery.includes('-')) {
          const baseQuery = rawQuery.split('-')[0];
          return productCode === baseQuery;
        }

        return productCode.includes(rawQuery);
      });
    });

    // Trả về theo độ ưu tiên
    return [
      ...startsWithMatches,
      ...containsNameMatches,
      ...codeMatches
    ];
  }
}