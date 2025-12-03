import { Component, ViewEncapsulation, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { MatDialogRef, MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
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
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { InvoiceTab } from '../../models/invoice.model';
import { InvoiceService, ReportFilterPreferences } from '../../services/invoice.service';
import { NgChartsModule } from 'ng2-charts';
import { ChartConfiguration, ChartData, ChartType } from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { Chart } from 'chart.js';
Chart.register(ChartDataLabels);
import { TimeZoneService } from '../../services/time-zone.service';
import { FirebaseWebsocketService } from '../../services/firebase-websocket.service';
import { Product } from '../../models/product.model';
import { Subscription, firstValueFrom } from 'rxjs';
import { CustomerService } from '../../services/customer.service';
import { NotificationService } from '../../services/notification.service';
import { LogService } from '../../services/log.service';

type SummaryContext = 'daily' | 'monthly' | 'yearly';

interface SummaryReference {
  date?: string;
  year?: number;
  month?: number | null;
}

@Component({
  selector: 'app-report-page',
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
    MatButtonModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    NgChartsModule
  ],
  templateUrl: './report-page.component.html',
  styleUrl: './report-page.component.css'
})
export class ReportPageComponent implements OnInit, OnDestroy {
  private subscriptions = new Subscription();

  constructor(
    private invoiceService: InvoiceService,
    private timeZoneService: TimeZoneService,
    private customerService: CustomerService
    ,
    private websocketService: FirebaseWebsocketService,
    private snackBar: MatSnackBar
  ) {

  }
  hideFilters = false;
  selectedDate: Date | null = null;
  allInvoices: InvoiceTab[] = [];
  filteredInvoices: InvoiceTab[] = [];
  isLoading = false;
  isMonthlyChartLoading = false;
  totalRevenue = 0;
  totalCost = 0;
  totalProfit = 0;
  totalBuyer = 0;
  totalCustomers = 0;
  totalInvoices = 0;
  todayRevenue = 0;
  comparisonRevenue = 0;
  comparisonDelta = 0;
  comparisonPercentChange = 0;
  comparisonLabel = 'Đang tính toán...';
  comparisonLoading = false;
  private comparisonToken = 0;
  // Profit comparison state
  comparisonProfitLoading = false;
  private comparisonProfitToken = 0;
  comparisonProfit = 0;
  comparisonProfitDelta = 0;
  comparisonProfitPercentChange = 0;
  comparisonProfitLabel = 'Đang tính toán...';
  private filtersLoaded = false;

  private latestDailySummaries = new Map<string, any>();
  private latestMonthlySummaries = new Map<string, any>();
  private latestYearlySummaries = new Map<number, any>();
  private latestTopProducts = new Map<string, any[]>();
  private pendingDailyRevalidations = new Set<string>();
  private pendingMonthlyRevalidations = new Set<string>();
  private pendingYearlyRevalidations = new Set<number>();
  private pendingTopProductRevalidations = new Set<string>();

  // Biến cho dropdown năm
  selectedYear: number | null = null;
  availableYears: number[] = [];

  // Biến cho biểu đồ - Fixed types
  public barChartOptions: ChartConfiguration['options'] = {
    responsive: true,
    plugins: {
      legend: { display: true },
      title: { display: true, text: 'Top 20 sản phẩm bán chạy nhất' },
      tooltip: {
        callbacks: {
          label: (context) => {
            const idx = context.dataIndex;
            // Lấy số lượng từ mảng topProducts (dựa trên label)
            const quantity = this.barChartData.labels && this.barChartData.labels[idx]
              ? (typeof this.barChartData.labels[idx] === 'string' && this.getQuantityByLabel(this.barChartData.labels[idx] as string))
              : 0;
            return `${context.dataset.label}: ${context.formattedValue} VNĐ | SL: ${quantity}`;
          }
        }
      },
      datalabels: {
        anchor: 'end',
        align: 'top',
        formatter: () => '',
        font: { weight: 'bold', size: 12 },
        color: '#333'
      }
    },
    scales: {
      y: {
        beginAtZero: true,
        title: {
          display: true,
          text: 'Số tiền (VNĐ)'
        },
        stacked: true,
        ticks: {
          font: {
            size: 5
          },
          autoSkip: false,
          maxRotation: 0,
          minRotation: 0
        }
      },
      x: {
        title: {
          display: false,
          text: 'Sản phẩm'
        },
        stacked: true
      }
    }
  };

  public barChartType: ChartType = 'bar';

  public barChartData: ChartData<'bar'> = {
    labels: [],
    datasets: [
      {
        data: [],
        label: 'Vốn',
        backgroundColor: '#d6c14c',
        borderColor: '#d6c14c',
        borderWidth: 1
      },
      {
        data: [],
        label: 'Lợi nhuận',
        backgroundColor: '#00b63e',
        borderColor: '#00b63e',
        borderWidth: 1
      }
    ]
  };

  // Biến cho chart 12 tháng
  public monthlyChartOptions: ChartConfiguration['options'] = {
    responsive: true,
    plugins: {
      legend: { display: true },
      title: { display: true, text: 'Thống kê theo 12 tháng trong năm' },
      datalabels: { display: false }
    },
    scales: {
      y: {
        beginAtZero: true,
        title: {
          display: true,
          text: 'Số tiền (VNĐ)'
        },
        stacked: true
      },
      x: {
        title: {
          display: false,
          text: 'Tháng'
        },
        stacked: true
      }
    }
  };

  public monthlyChartType: ChartType = 'bar';

  public monthlyChartData: ChartData<'bar'> = {
    labels: ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12'],
    datasets: [
      {
        data: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        label: 'Vốn',
        backgroundColor: '#0070F4',
        borderColor: '#0070F4',
        borderWidth: 1
      },
      {
        data: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        label: 'Lợi nhuận',
        backgroundColor: '#00b63e',
        borderColor: '#00b63e',
        borderWidth: 1
      }
    ]
  };

  selectedMonth: number | null = null;
  selectedTopYear: number | null = null;
  months = [
    { value: 0, label: 'Cả năm' },
    { value: 1, label: 'Tháng 1' },
    { value: 2, label: 'Tháng 2' },
    { value: 3, label: 'Tháng 3' },
    { value: 4, label: 'Tháng 4' },
    { value: 5, label: 'Tháng 5' },
    { value: 6, label: 'Tháng 6' },
    { value: 7, label: 'Tháng 7' },
    { value: 8, label: 'Tháng 8' },
    { value: 9, label: 'Tháng 9' },
    { value: 10, label: 'Tháng 10' },
    { value: 11, label: 'Tháng 11' },
    { value: 12, label: 'Tháng 12' }
  ];

  showTopMonth(forceRefresh = false) {
    if (this.selectedTopYear === null || this.selectedMonth === null) {
      this.updateChartWithSummary([]);
      this.isLoading = false;
      return;
    }

    const year = this.selectedTopYear;
    const month = this.selectedMonth;

    if (month <= 0) {
      this.updateChartWithSummary([]);
      this.isLoading = false;
      return;
    }

    this.isLoading = true;
    this.ensureTopProductsChartLayout();

    const cacheKey = this.buildTopProductsKey({ year, month });

    if (!forceRefresh && this.latestTopProducts.has(cacheKey)) {
      this.updateTopProductsChart(this.latestTopProducts.get(cacheKey));
      return;
    }

    this.invoiceService.getTopSellProducts({ year, month }, forceRefresh).subscribe({
      next: (products?: any[]) => {
        const safeProducts = Array.isArray(products) ? products : [];
        this.latestTopProducts.set(cacheKey, safeProducts);
        this.updateTopProductsChart(safeProducts);
      },
      error: () => {
        this.updateChartWithSummary([]);
        this.isLoading = false;
      }
    });
  }

  showTopYear(forceRefresh = false) {
    if (this.selectedTopYear === null) {
      this.updateChartWithSummary([]);
      this.isLoading = false;
      return;
    }

    const year = this.selectedTopYear;

    this.isLoading = true;
    this.ensureTopProductsChartLayout();
    const cacheKey = this.buildTopProductsKey({ year });

    if (!forceRefresh && this.latestTopProducts.has(cacheKey)) {
      this.updateTopProductsChart(this.latestTopProducts.get(cacheKey));
      return;
    }

    this.invoiceService.getTopSellProducts({ year }, forceRefresh).subscribe({
      next: (products?: any[]) => {
        const safeProducts = Array.isArray(products) ? products : [];
        this.latestTopProducts.set(cacheKey, safeProducts);
        this.updateTopProductsChart(safeProducts);
      },
      error: () => {
        this.updateChartWithSummary([]);
        this.isLoading = false;
      }
    });
  }
  ngOnInit() {
    this.barChartType = 'bar';
    const baseOptions = this.barChartOptions ?? {};
    this.barChartOptions = {
      ...baseOptions,
      indexAxis: 'y',
      plugins: {
        ...(baseOptions.plugins ?? {}),
        title: { display: true, text: 'Top 20 sản phẩm bán chạy nhất' }
      },
      scales: {
        x: {
          beginAtZero: true,
          title: { display: true, text: 'Số tiền (VNĐ)' },
          stacked: false
        },
        y: {
          title: { display: false, text: 'Sản phẩm' },
          stacked: false
        }
      }
    };
    this.initializeAvailableYears();
    // Start websocket client (connect and listen for realtime events)
    this.websocketService.connect();
    this.setupRealtimeSubscriptions();
    this.setupCustomerSubscriptions();
    void this.loadCustomerCount();
    void this.bootstrapReportPage();
  }

  ngOnDestroy(): void {
    this.websocketService.disconnectAll();
    this.subscriptions.unsubscribe();
  }

  private setupRealtimeSubscriptions(): void {
    const createdSub = this.invoiceService.invoiceCreated$.subscribe(() => {
      this.refreshAllReports(true);
    });

    const updatedSub = this.invoiceService.invoiceUpdated$.subscribe(() => {
      this.refreshAllReports(true);
    });

    const deletedSub = this.invoiceService.invoiceDeleted$.subscribe(() => {
      this.refreshAllReports(true);
    });

    // Listen for websocket invoice events so other clients' changes show immediately
    const wsInvoiceSub = this.websocketService.invoiceCreated$().subscribe((payload) => {
      try {
        const msg = (payload && payload.title) ? `Có hóa đơn mới: ${payload.title}` : 'Có hóa đơn mới';
        this.snackBar.open(msg, 'Đóng', { duration: 5000 });
      } catch {
        this.snackBar.open('Có hóa đơn mới', 'Đóng', { duration: 5000 });
      }
      this.refreshAllReports(true);
    });

    const syncCompletedSub = this.invoiceService.syncCompleted$.subscribe(() => {
      this.refreshAllReports(true);
    });

    // Generic notify subscription: show lightweight notice when backend signals data change
    const notifySub = this.websocketService.notify$().subscribe(() => {
      try {
        this.snackBar.open('Dữ liệu đã cập nhật, hãy đồng bộ', 'Đóng', { duration: 6000 });
      } catch {
        // ignore snackbar errors
      }
    });

    this.subscriptions.add(wsInvoiceSub);
    this.subscriptions.add(createdSub);
    this.subscriptions.add(updatedSub);
    this.subscriptions.add(deletedSub);
    this.subscriptions.add(syncCompletedSub);
    this.subscriptions.add(notifySub);

    const dailySummaryRealtimeSub = this.invoiceService.dailySummary$.subscribe(({ date, summary }) => {
      this.latestDailySummaries.set(this.buildDailySummaryKey(date), summary ?? {});
      if (!this.selectedDate) {
        return;
      }
      const currentDate = this.timeZoneService.formatDateToVietnamString(this.selectedDate);
      if (date === currentDate) {
        this.applySummaryTotals(summary, 'daily', { date });
      }
    });

    const monthlySummaryRealtimeSub = this.invoiceService.monthlySummary$.subscribe(({ year, month, summary }) => {
      this.latestMonthlySummaries.set(this.buildMonthlySummaryKey(year, month), summary ?? {});
      if (
        this.selectedTopYear !== null &&
        this.selectedMonth !== null &&
        this.selectedMonth > 0 &&
        this.selectedTopYear === year &&
        this.selectedMonth === month
      ) {
        this.applySummaryTotals(summary, 'monthly', { year, month });
      }
      if (this.selectedYear !== null && this.selectedYear === year) {
        this.updateMonthlyChartColumn(month, summary);
      }
    });

    const yearlySummaryRealtimeSub = this.invoiceService.yearlySummary$.subscribe(({ year, summary }) => {
      this.latestYearlySummaries.set(year, summary ?? {});
      if (this.selectedTopYear !== null && this.selectedMonth === 0 && this.selectedTopYear === year) {
        this.applySummaryTotals(summary, 'yearly', { year });
      }
    });

    const topProductsRealtimeSub = this.invoiceService.topProducts$.subscribe(({ filters, products }) => {
      const selectedDateStr = this.selectedDate
        ? this.timeZoneService.formatDateToVietnamString(this.selectedDate)
        : null;

      const filterDateValue = filters['date'];
      const filterYearValue = filters['year'];
      const filterMonthValue = filters['month'];

      const filterDate: string | null = typeof filterDateValue === 'string' ? filterDateValue : null;
      const filterYear: number | null = typeof filterYearValue === 'number' && !Number.isNaN(filterYearValue)
        ? filterYearValue
        : null;
      let filterMonth: number | null = typeof filterMonthValue === 'number' && !Number.isNaN(filterMonthValue)
        ? filterMonthValue
        : null;
      if (filterMonth === 0) {
        filterMonth = null;
      }

      const cacheKey = this.buildTopProductsKey({ date: filterDate, year: filterYear, month: filterMonth });
      this.latestTopProducts.set(cacheKey, Array.isArray(products) ? products : []);

      if (filterDate && selectedDateStr && filterDate === selectedDateStr) {
        this.ensureTopProductsChartLayout();
        this.updateTopProductsChart(products);
        return;
      }

      if (
        filterYear !== null &&
        filterMonth !== null &&
        this.selectedTopYear === filterYear &&
        this.selectedMonth !== null &&
        this.selectedMonth === filterMonth
      ) {
        this.ensureTopProductsChartLayout();
        this.updateTopProductsChart(products);
        return;
      }

      if (
        filterYear !== null &&
        filterMonth === null &&
        this.selectedTopYear === filterYear &&
        this.selectedMonth === 0
      ) {
        this.ensureTopProductsChartLayout();
        this.updateTopProductsChart(products);
      }
    });

    this.subscriptions.add(dailySummaryRealtimeSub);
    this.subscriptions.add(monthlySummaryRealtimeSub);
    this.subscriptions.add(yearlySummaryRealtimeSub);
    this.subscriptions.add(topProductsRealtimeSub);
  }

  private setupCustomerSubscriptions(): void {
    const customerUpdatesSub = this.customerService.customersUpdated$.subscribe(() => {
      void this.loadCustomerCount();
    });
    this.subscriptions.add(customerUpdatesSub);
  }

  private async bootstrapReportPage(): Promise<void> {
    try {
      const savedFilters = await this.invoiceService.loadReportFilters();
      if (savedFilters) {
        this.applySavedFilters(savedFilters);
      }
      this.applyTodayAsDefaultDate();
    } catch (error) {
      console.error('Không thể tải bộ lọc báo cáo đã lưu:', error);
    } finally {
      this.ensureDefaultFilters();
      await this.hydrateCachedDataForCurrentFilters();
      this.filtersLoaded = true;
      this.persistFilters();
      // Reset month/year filters on bootstrap so reopening report page starts
      // with default (today) instead of re-triggering previous month/year API calls.
      this.selectedTopYear = null;
      this.selectedMonth = null;
      this.selectedYear = null;
      this.fetchInvoicesByDate();
      if (this.selectedYear !== null) {
        this.isMonthlyChartLoading = true;
        void this.updateMonthlyChart();
      }
    }
  }

  private applyTodayAsDefaultDate(): void {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    this.selectedDate = new Date(today);
  }

  private applySavedFilters(preferences: ReportFilterPreferences): void {
    if (preferences.lastDailyDate) {
      this.selectedDate = this.timeZoneService.createVietnamDate(preferences.lastDailyDate);
    }

    if (typeof preferences.lastTopYear === 'number') {
      this.selectedTopYear = preferences.lastTopYear;
    } else {
      this.selectedTopYear = null;
    }

    if (typeof preferences.lastTopMonth === 'number') {
      this.selectedMonth = preferences.lastTopMonth;
    } else {
      this.selectedMonth = null;
    }

    if (typeof preferences.lastMonthlyYear === 'number') {
      this.selectedYear = preferences.lastMonthlyYear;
    } else {
      this.selectedYear = null;
    }
  }

  private ensureDefaultFilters(): void {
    const now = new Date();
    if (!this.selectedDate) {
      this.selectedDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    }
  }

  private persistFilters(): void {
    if (!this.filtersLoaded) {
      return;
    }

    const payload: Partial<ReportFilterPreferences> = {
      lastDailyDate: this.selectedDate
        ? this.timeZoneService.formatDateToVietnamString(this.selectedDate)
        : null,
      lastTopYear: this.selectedTopYear ?? null,
      lastTopMonth: this.selectedMonth ?? null,
      lastMonthlyYear: this.selectedYear ?? null
    };

    void this.invoiceService.saveReportFilters(payload);
  }

  private async hydrateCachedDataForCurrentFilters(): Promise<void> {
    try {
      if (this.selectedDate) {
        const dateKey = this.timeZoneService.formatDateToVietnamString(this.selectedDate);
        const cachedDaily = await this.invoiceService.getCachedReportData<any>('daily-summary', { date: dateKey });
        if (cachedDaily) {
          this.latestDailySummaries.set(this.buildDailySummaryKey(dateKey), cachedDaily);
          this.applySummaryTotals(cachedDaily, 'daily', { date: dateKey });
        }

        const cachedDailyTop = await this.invoiceService.getCachedReportData<any[]>('top-products', { date: dateKey });
        if (cachedDailyTop) {
          this.latestTopProducts.set(this.buildTopProductsKey({ date: dateKey }), cachedDailyTop);
          this.updateTopProductsChart(cachedDailyTop);
        }
      }

      const normalizedYear = typeof this.selectedTopYear === 'number' && this.selectedTopYear > 0
        ? this.selectedTopYear
        : null;
      const normalizedMonth = typeof this.selectedMonth === 'number' && this.selectedMonth > 0
        ? this.selectedMonth
        : null;
      if (normalizedYear) {
        const params: Record<string, string> = { year: normalizedYear.toString() };
        if (normalizedMonth) {
          params['month'] = normalizedMonth.toString().padStart(2, '0');
        }

        const cachedTop = await this.invoiceService.getCachedReportData<any[]>('top-products', params);
        if (cachedTop) {
          this.latestTopProducts.set(
            this.buildTopProductsKey({ year: normalizedYear, month: normalizedMonth ?? null }),
            cachedTop
          );
          this.updateTopProductsChart(cachedTop);
        }

        if (normalizedMonth) {
          const monthlyCacheParams = {
            year: normalizedYear.toString(),
            month: normalizedMonth.toString().padStart(2, '0')
          };
          const cachedMonthlySummary = await this.invoiceService.getCachedReportData<any>('monthly-summary', monthlyCacheParams);
          if (cachedMonthlySummary) {
            const summaryKey = this.buildMonthlySummaryKey(normalizedYear, normalizedMonth);
            this.latestMonthlySummaries.set(summaryKey, cachedMonthlySummary);
          }
        } else {
          const yearlyCacheParams = { year: normalizedYear.toString() };
          const cachedYearlySummary = await this.invoiceService.getCachedReportData<any>('yearly-summary', yearlyCacheParams);
          if (cachedYearlySummary) {
            this.latestYearlySummaries.set(normalizedYear, cachedYearlySummary);
          }
          // Also attempt to hydrate per-month cached summaries from IndexedDB so that
          // reopening the report page or switching months reads from IDB rather than
          // triggering network requests. We only read cached entries here; we do
          // not call the API — API calls should be triggered only by an explicit
          // refresh action (forceRefresh=true).
          for (let m = 1; m <= 12; m++) {
            const monthParam = String(m).padStart(2, '0');
            try {
              const cached = await this.invoiceService.getCachedReportData<any>('monthly-summary', { year: normalizedYear.toString(), month: monthParam });
              if (cached) {
                const k = this.buildMonthlySummaryKey(normalizedYear, m);
                this.latestMonthlySummaries.set(k, cached);
              }
            } catch (e) {
              // ignore per-month cache read errors — non-fatal
            }
          }
        }
      }
    } catch (error) {
      console.warn('Không thể hydrate dữ liệu cache cho báo cáo:', error);
    }
  }

  private initializeAvailableYears() {
    const currentYear = new Date().getFullYear();
    const startYear = 2020;
    this.availableYears = [];
    for (let year = startYear; year <= currentYear; year++) {
      this.availableYears.push(year);
    }
  }

  onYearChange() {
    if (this.selectedYear !== null) {
      this.isMonthlyChartLoading = true;
      this.updateMonthlyChart();
    } else {
      // Reset monthly chart data when no year is selected
      this.monthlyChartData = {
        labels: ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12'],
        datasets: [
          {
            data: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            label: 'Vốn',
            backgroundColor: '#0070F4',
            borderColor: '#0070F4',
            borderWidth: 1
          },
          {
            data: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            label: 'Lợi nhuận',
            backgroundColor: '#00b63e',
            borderColor: '#00b63e',
            borderWidth: 1
          }
        ]
      };
    }
    this.persistFilters();
  }

  fetchInvoicesByDate(forceRefresh = false) {
    this.isLoading = true;
    this.ensureTopProductsChartLayout();
    if (!this.selectedDate) {
      this.totalRevenue = 0;
      this.totalCost = 0;
      this.totalProfit = 0;
      this.totalBuyer = 0;
      this.updateChartWithSummary([]);
      this.isLoading = false;
      return;
    }
    const date = this.timeZoneService.formatDateToVietnamString(this.selectedDate);

    const dailyKey = this.buildDailySummaryKey(date);
    const topKey = this.buildTopProductsKey({ date });

    const hasCachedSummary = !forceRefresh && this.latestDailySummaries.has(dailyKey);
    const hasCachedTop = !forceRefresh && this.latestTopProducts.has(topKey);

    if (hasCachedSummary) {
      this.applySummaryTotals(this.latestDailySummaries.get(dailyKey), 'daily', { date });
      if (!forceRefresh) {
        this.revalidateDailySummary(date);
      }
    }

    if (hasCachedTop) {
      this.updateTopProductsChart(this.latestTopProducts.get(topKey));
      if (!forceRefresh) {
        this.revalidateTopProducts({ date });
      }
    }

    const shouldFetchSummary = forceRefresh || !hasCachedSummary;
    const shouldFetchTop = forceRefresh || !hasCachedTop;

    if (!shouldFetchSummary && !shouldFetchTop) {
      this.isLoading = false;
      return;
    }

    if (shouldFetchSummary) {
      this.invoiceService.getDailySummary(date, forceRefresh).subscribe({
        next: (summary: any) => {
          this.latestDailySummaries.set(dailyKey, summary ?? {});
          this.applySummaryTotals(summary, 'daily', { date });
        },
        error: () => {
          this.latestDailySummaries.delete(dailyKey);
          this.applySummaryTotals(null, 'daily', { date });
        }
      });
    }

    if (shouldFetchTop) {
      this.invoiceService.getTopSellProducts({ date }, forceRefresh).subscribe({
        next: (products?: any[]) => {
          const safeProducts = Array.isArray(products) ? products : [];
          this.latestTopProducts.set(topKey, safeProducts);
          this.updateTopProductsChart(safeProducts);
        },
        error: () => {
          this.latestTopProducts.delete(topKey);
          this.updateChartWithSummary([]);
          this.isLoading = false;
        }
      });
    }
  }

  updateChartWithSummary(products: { productName: string, totalRevenue: number, totalCost: number, totalProfit: number, totalQuantity: number }[]) {
    this.barChartData = {
      labels: products.map(product => product.productName),
      datasets: [
        {
          data: products.map(product => product.totalCost),
          label: 'Vốn',
          backgroundColor: '#d6c14c',
          borderColor: '#d6c14c',
          borderWidth: 1
        },
        {
          data: products.map(product => product.totalProfit),
          label: 'Lợi nhuận',
          backgroundColor: '#00b63e',
          borderColor: '#00b63e',
          borderWidth: 1
        },
        {
          data: products.map(product => product.totalQuantity),
          label: 'Số lượng',
          backgroundColor: '#f4b400',
          borderColor: '#f4b400',
          borderWidth: 1
        }
      ]
    };
  }

  calculateSummary() {
    const invoices = this.filteredInvoices;
    this.totalRevenue = invoices.reduce((sum, inv) => sum + (inv.totalPrice || 0), 0);
    this.totalCost = invoices.reduce((sum, inv) => sum + (inv.totalCost || 0), 0);
    this.totalProfit = this.totalRevenue - this.totalCost;
  }

  private async loadCustomerCount(): Promise<void> {
    try {
      this.totalCustomers = await this.customerService.getCustomerCountFromIndexedDB();
    } catch (error) {
      console.warn('Không thể lấy tổng số khách hàng từ IndexedDB:', error);
      this.totalCustomers = 0;
    }
  }

  onDateChange(event: any) {
    if (event.value) {
      this.selectedDate = new Date(event.value);
      this.selectedDate.setHours(0, 0, 0, 0);
    } else {
      this.selectedDate = null;
    }
    this.persistFilters();
    if (this.selectedDate) {
      this.fetchInvoicesByDate();
    }
  }

  applyFilters() {
    if (!this.selectedDate) {
      this.filteredInvoices = [...this.allInvoices];
    } else {
      this.filteredInvoices = this.allInvoices.filter(invoice => {
        return this.checkDateFilter(invoice);
      });
    }
    this.calculateSummary();
  }

  clearFilters() {
    this.selectedDate = null;
    this.allInvoices = [];
    this.filteredInvoices = [];
    this.selectedMonth = null;
    this.selectedTopYear = null;
    this.selectedYear = null;

    this.calculateSummary();
    this.isLoading = false;
    this.persistFilters();
  }

  private checkDateFilter(invoice: InvoiceTab): boolean {
    if (!this.selectedDate) return true;
    if (!invoice.createdDate) return false;
    try {
      const invoiceDate = this.timeZoneService.parseApiDate(invoice.createdDate);
      if (isNaN(invoiceDate.getTime())) return false;
      const invoiceDateStr = this.timeZoneService.formatDateToVietnamString(invoiceDate);
      const selectedDateStr = this.timeZoneService.formatDateToVietnamString(this.selectedDate);
      return invoiceDateStr === selectedDateStr;
    } catch (error) {
      console.error('Error parsing date:', error);
      return false;
    }
  }


  async updateMonthlyChart(forceRefresh = false): Promise<void> {
    if (this.selectedYear === null) {
      this.isMonthlyChartLoading = false;
      return;
    }

    const selectedYear = this.selectedYear;
    const monthlyData = { cost: new Array(12).fill(0), profit: new Array(12).fill(0), revenue: new Array(12).fill(0) };
    const fetchPromises: Promise<void>[] = [];

    for (let month = 1; month <= 12; month++) {
      const key = this.buildMonthlySummaryKey(selectedYear, month);

      if (!forceRefresh && this.latestMonthlySummaries.has(key)) {
        const s = this.latestMonthlySummaries.get(key) ?? {};
        monthlyData.cost[month - 1] = s?.cost || 0;
        monthlyData.profit[month - 1] = s?.profit || 0;
        monthlyData.revenue[month - 1] = s?.revenue || 0;
        continue;
      }

      ((m) => {
        const p = firstValueFrom(this.invoiceService.getMonthlySummary(selectedYear, m, forceRefresh)).then((summary: any) => {
          monthlyData.cost[m - 1] = summary?.cost || 0;
          monthlyData.profit[m - 1] = summary?.profit || 0;
          monthlyData.revenue[m - 1] = summary?.revenue || 0;
          const k = this.buildMonthlySummaryKey(selectedYear, m);
          if (summary) {
            this.latestMonthlySummaries.set(k, summary ?? {});
          } else {
            this.latestMonthlySummaries.delete(k);
          }
        }).catch(() => {
          monthlyData.cost[m - 1] = 0;
          monthlyData.profit[m - 1] = 0;
          monthlyData.revenue[m - 1] = 0;
          const k = this.buildMonthlySummaryKey(selectedYear, m);
          this.latestMonthlySummaries.delete(k);
        });
        fetchPromises.push(p);
      })(month);
    }

    try {
      await Promise.all(fetchPromises);
    } catch (err) {
      console.error('Error fetching monthly summaries:', err);
    } finally {
      this.monthlyChartData = {
        labels: ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12'],
        datasets: [
          {
            data: monthlyData.cost,
            label: 'Vốn',
            backgroundColor: '#0070F4',
            borderColor: '#0070F4',
            borderWidth: 1
          },
          {
            data: monthlyData.profit,
            label: 'Lợi nhuận',
            backgroundColor: '#00b63e',
            borderColor: '#00b63e',
            borderWidth: 1
          }
        ]
      };
      this.isMonthlyChartLoading = false;
    }
  }

  refreshAllReports(forceRefresh = false): void {
    this.fetchInvoicesByDate(forceRefresh);
    if (this.selectedTopYear !== null && this.selectedMonth !== null) {
      this.onTopMonthOrYearChange(forceRefresh);
    }
    if (this.selectedYear !== null) {
      this.isMonthlyChartLoading = true;
      void this.updateMonthlyChart(forceRefresh);
    }
  }

  async onTopMonthOrYearChange(forceRefresh = false) {
    this.persistFilters();

    if (this.selectedTopYear === null) {
      this.updateChartWithSummary([]);
      this.isLoading = false;
      return;
    }

    const year = this.selectedTopYear;
    const monthSelection = this.selectedMonth;

    if (monthSelection === null) {
      this.updateChartWithSummary([]);
      this.isLoading = false;
      return;
    }

    this.isLoading = true;
    this.ensureTopProductsChartLayout();

    if (monthSelection > 0) {
      const normalizedMonth = monthSelection;
      const summaryKey = this.buildMonthlySummaryKey(year, normalizedMonth);
      const topKey = this.buildTopProductsKey({ year, month: normalizedMonth });

      let cachedSummary = !forceRefresh ? this.latestMonthlySummaries.get(summaryKey) : undefined;
      // If not present in the in-memory map, attempt to read from ReportsCache (IndexedDB)
      if (!cachedSummary && !forceRefresh) {
        try {
          const monthlyCacheParams = { year: String(year), month: String(normalizedMonth).padStart(2, '0') };
          const cachedMonthlySummary = await this.invoiceService.getCachedReportData<any>('monthly-summary', monthlyCacheParams);
          if (cachedMonthlySummary) {
            this.latestMonthlySummaries.set(summaryKey, cachedMonthlySummary);
            cachedSummary = cachedMonthlySummary;
          }
        } catch (e) {
          // ignore cache read errors
        }
      }
      const cachedTop = !forceRefresh ? this.latestTopProducts.get(topKey) : undefined;

      if (cachedSummary) {
        this.applySummaryTotals(cachedSummary, 'monthly', { year, month: normalizedMonth });
      }
      if (cachedTop) {
        this.updateTopProductsChart(cachedTop);
      }

      const needsSummaryFetch = forceRefresh || !cachedSummary;
      const needsTopFetch = forceRefresh || !cachedTop;

      if (needsSummaryFetch) {
        this.invoiceService.getMonthlySummary(year, normalizedMonth, forceRefresh).subscribe({
          next: (summary: any) => {
            this.latestMonthlySummaries.set(summaryKey, summary ?? {});
            this.applySummaryTotals(summary, 'monthly', { year, month: normalizedMonth });
          },
          error: () => {
            this.latestMonthlySummaries.delete(summaryKey);
            this.applySummaryTotals(null, 'monthly', { year, month: normalizedMonth });
          }
        });
      }

      if (needsTopFetch) {
        this.invoiceService.getTopSellProducts({ year, month: normalizedMonth }, forceRefresh).subscribe({
          next: (products?: any[]) => {
            const safeProducts = Array.isArray(products) ? products : [];
            this.latestTopProducts.set(topKey, safeProducts);
            this.updateTopProductsChart(safeProducts);
          },
          error: () => {
            this.latestTopProducts.delete(topKey);
            this.updateChartWithSummary([]);
            this.isLoading = false;
          }
        });
      }

      if (!needsSummaryFetch && !needsTopFetch) {
        this.isLoading = false;
      }

      return;
    }

    if (monthSelection === 0) {
      const summaryKey = year;
      const topKey = this.buildTopProductsKey({ year });

      let cachedSummary = !forceRefresh ? this.latestYearlySummaries.get(summaryKey) : undefined;
      if (!cachedSummary && !forceRefresh) {
        try {
          const yearlyCacheParams = { year: String(year) };
          const cachedYearlySummary = await this.invoiceService.getCachedReportData<any>('yearly-summary', yearlyCacheParams);
          if (cachedYearlySummary) {
            this.latestYearlySummaries.set(summaryKey, cachedYearlySummary);
            cachedSummary = cachedYearlySummary;
          }
        } catch (e) {
          // ignore
        }
      }
      const cachedTop = !forceRefresh ? this.latestTopProducts.get(topKey) : undefined;

      if (cachedSummary) {
        this.applySummaryTotals(cachedSummary, 'yearly', { year });
      }
      if (cachedTop) {
        this.updateTopProductsChart(cachedTop);
      }

      const needsSummaryFetch = forceRefresh || !cachedSummary;
      const needsTopFetch = forceRefresh || !cachedTop;

      if (needsSummaryFetch) {
        this.invoiceService.getYearlySummary(year, forceRefresh).subscribe({
          next: (summary: any) => {
            this.latestYearlySummaries.set(summaryKey, summary ?? {});
            this.applySummaryTotals(summary, 'yearly', { year });
          },
          error: () => {
            this.latestYearlySummaries.delete(summaryKey);
            this.applySummaryTotals(null, 'yearly', { year });
          }
        });
      }

      if (needsTopFetch) {
        this.invoiceService.getTopSellProducts({ year }, forceRefresh).subscribe({
          next: (products?: any[]) => {
            const safeProducts = Array.isArray(products) ? products : [];
            this.latestTopProducts.set(topKey, safeProducts);
            this.updateTopProductsChart(safeProducts);
          },
          error: () => {
            this.latestTopProducts.delete(topKey);
            this.updateChartWithSummary([]);
            this.isLoading = false;
          }
        });
      }

      if (!needsSummaryFetch && !needsTopFetch) {
        this.isLoading = false;
      }

      return;
    }

    this.updateChartWithSummary([]);
    this.isLoading = false;
  }

  private getQuantityByLabel(label: string): number {
  if (!label || typeof label !== 'string') return 0;
  const idx = this._topProducts.findIndex(p => p.productName === label);
  if (idx < 0) return 0;
  return this._topProducts[idx].totalQuantity ?? 0;
}

  private ensureTopProductsChartLayout(): void {
    this.barChartType = 'bar';
    const baseOptions = this.barChartOptions ?? {};
    this.barChartOptions = {
      ...baseOptions,
      indexAxis: 'y',
      plugins: {
        ...(baseOptions.plugins ?? {}),
        title: { display: true, text: 'Top 20 sản phẩm bán chạy nhất' }
      },
      scales: {
        x: {
          beginAtZero: true,
          title: { display: true, text: 'Số tiền (VNĐ)' },
          stacked: false
        },
        y: {
          title: { display: false, text: 'Sản phẩm' },
          stacked: false
        }
      }
    };
  }

  private updateTopProductsChart(products: any[] | undefined): void {
    const items = Array.isArray(products) ? products : [];
    const sorted = [...items]
      .map(item => ({
        ...item,
        totalProfit: Number(item?.totalProfit ?? 0)
      }))
      .sort((a, b) => (b.totalProfit || 0) - (a.totalProfit || 0))
      .slice(0, 20);

    this._topProducts = sorted;
    this.barChartData = {
      labels: sorted.map(p => p.productName),
      datasets: [
        {
          data: sorted.map(p => Number(p?.totalProfit ?? 0)),
          label: 'Lợi nhuận',
          backgroundColor: '#0070F4',
          borderColor: '#0070F4',
          borderWidth: 1
        }
      ]
    };
    this.isLoading = false;
  }

  private pickNumberField(source: any, keys: string[]): number | null {
    if (!source || typeof source !== 'object') {
      return null;
    }

    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        const rawValue = source[key];
        if (rawValue === null || rawValue === undefined || rawValue === '') {
          continue;
        }
        const parsed = Number(rawValue);
        if (!Number.isNaN(parsed)) {
          return parsed;
        }
      }
    }

    return null;
  }

  private applySummaryTotals(summary: any, context: SummaryContext, reference?: SummaryReference): void {
    const data = summary ?? {};

    const revenue = this.pickNumberField(data, ['revenue', 'totalRevenue', 'total_revenue', 'grossRevenue']) ?? 0;
    const cost = this.pickNumberField(data, ['cost', 'totalCost', 'total_cost']) ?? 0;
    const profit = this.pickNumberField(data, ['profit', 'totalProfit', 'total_profit']);
    const buyers = this.pickNumberField(data, ['buyer_quantity', 'customer_quantity', 'customer_count', 'buyers', 'buyer_count']);
    const invoices = this.pickNumberField(data, ['invoice_quantity', 'invoice_count', 'invoiceQuantity', 'totalInvoices', 'total_invoices']);
    const todayRevenueValue = this.pickNumberField(data, ['todayRevenue', 'today_revenue', 'currentRevenue']);

    this.totalRevenue = revenue;
    this.totalCost = cost;
    this.totalProfit = profit ?? (revenue - cost);
    this.totalBuyer = buyers ?? 0;
    this.totalInvoices = invoices ?? 0;
    this.todayRevenue = todayRevenueValue ?? revenue;
    void this.updateComparisonValues(context, reference);
    void this.updateProfitComparisonValues(context, reference);
  }

  private async updateComparisonValues(context: SummaryContext, reference?: SummaryReference): Promise<void> {
    const token = ++this.comparisonToken;
    this.comparisonLoading = true;

    try {
      const baseline = await this.resolveComparisonBaseline(context, reference);
      if (token !== this.comparisonToken) {
        return;
      }

      if (baseline) {
        this.comparisonRevenue = baseline.revenue;
        this.comparisonLabel = baseline.label;
      } else {
        this.comparisonRevenue = 0;
        this.comparisonLabel = 'Chưa có dữ liệu so sánh';
      }

      this.comparisonDelta = this.totalRevenue - this.comparisonRevenue;
      if (this.comparisonRevenue === 0) {
        this.comparisonPercentChange = this.totalRevenue > 0 ? 100 : 0;
      } else {
        this.comparisonPercentChange = Math.round((this.comparisonDelta / this.comparisonRevenue) * 100);
      }
    } catch (error) {
      if (token !== this.comparisonToken) {
        return;
      }
      console.warn('Không thể tải dữ liệu so sánh:', error);
      this.comparisonRevenue = 0;
      this.comparisonDelta = this.totalRevenue;
      this.comparisonPercentChange = this.totalRevenue ? 100 : 0;
      this.comparisonLabel = 'Không thể so sánh';
    } finally {
      if (token === this.comparisonToken) {
        this.comparisonLoading = false;
      }
    }
  }

  private async updateProfitComparisonValues(context: SummaryContext, reference?: SummaryReference): Promise<void> {
    const token = ++this.comparisonProfitToken;
    this.comparisonProfitLoading = true;

    try {
      const baseline = await this.resolveProfitComparisonBaseline(context, reference);
      if (token !== this.comparisonProfitToken) {
        return;
      }

      if (baseline) {
        this.comparisonProfit = baseline.profit;
        this.comparisonProfitLabel = baseline.label;
      } else {
        this.comparisonProfit = 0;
        this.comparisonProfitLabel = 'Chưa có dữ liệu so sánh';
      }

      this.comparisonProfitDelta = this.totalProfit - this.comparisonProfit;
      if (this.comparisonProfit === 0) {
        this.comparisonProfitPercentChange = this.totalProfit > 0 ? 100 : 0;
      } else {
        this.comparisonProfitPercentChange = Math.round((this.comparisonProfitDelta / this.comparisonProfit) * 100);
      }
    } catch (error) {
      if (token !== this.comparisonProfitToken) {
        return;
      }
      console.warn('Không thể tải dữ liệu so sánh lợi nhuận:', error);
      this.comparisonProfit = 0;
      this.comparisonProfitDelta = this.totalProfit;
      this.comparisonProfitPercentChange = this.totalProfit ? 100 : 0;
      this.comparisonProfitLabel = 'Không thể so sánh';
    } finally {
      if (token === this.comparisonProfitToken) {
        this.comparisonProfitLoading = false;
      }
    }
  }

  private async resolveComparisonBaseline(
    context: SummaryContext,
    reference?: SummaryReference
  ): Promise<{ revenue: number; label: string } | null> {
    if (context === 'daily' && reference?.date) {
      const previousDate = this.getPreviousDateString(reference.date);
      if (!previousDate) {
        return null;
      }
      const summary = await this.getDailySummaryFromCacheOrApi(previousDate);
      const revenue = this.pickNumberField(summary ?? {}, ['revenue', 'totalRevenue', 'total_revenue', 'grossRevenue']) ?? 0;
      return {
        revenue,
        label: `So với ${this.formatComparisonDate(previousDate)}`
      };
    }

    if (context === 'monthly' && reference?.year && reference?.month) {
      const previous = this.getPreviousMonth(reference.year, reference.month);
      if (!previous) {
        return null;
      }
      const summary = await this.getMonthlySummaryFromCacheOrApi(previous.year, previous.month);
      const revenue = this.pickNumberField(summary ?? {}, ['revenue', 'totalRevenue', 'total_revenue', 'grossRevenue']) ?? 0;
      return {
        revenue,
        label: `So với ${this.formatComparisonMonth(previous.month, previous.year)}`
      };
    }

    if (context === 'yearly' && reference?.year) {
      const previousYear = reference.year - 1;
      if (previousYear < 2000) {
        return null;
      }
      const summary = await this.getYearlySummaryFromCacheOrApi(previousYear);
      const revenue = this.pickNumberField(summary ?? {}, ['revenue', 'totalRevenue', 'total_revenue', 'grossRevenue']) ?? 0;
      return {
        revenue,
        label: `So với năm ${previousYear}`
      };
    }

    return null;
  }

  private async resolveProfitComparisonBaseline(
    context: SummaryContext,
    reference?: SummaryReference
  ): Promise<{ profit: number; label: string } | null> {
    if (context === 'daily' && reference?.date) {
      const previousDate = this.getPreviousDateString(reference.date);
      if (!previousDate) {
        return null;
      }
      const summary = await this.getDailySummaryFromCacheOrApi(previousDate);
      const profit = this.pickNumberField(summary ?? {}, ['profit', 'totalProfit', 'total_profit', 'netProfit']) ?? 0;
      return {
        profit,
        label: `So với ${this.formatComparisonDate(previousDate)}`
      };
    }

    if (context === 'monthly' && reference?.year && reference?.month) {
      const previous = this.getPreviousMonth(reference.year, reference.month);
      if (!previous) {
        return null;
      }
      const summary = await this.getMonthlySummaryFromCacheOrApi(previous.year, previous.month);
      const profit = this.pickNumberField(summary ?? {}, ['profit', 'totalProfit', 'total_profit', 'netProfit']) ?? 0;
      return {
        profit,
        label: `So với ${this.formatComparisonMonth(previous.month, previous.year)}`
      };
    }

    if (context === 'yearly' && reference?.year) {
      const previousYear = reference.year - 1;
      if (previousYear < 2000) {
        return null;
      }
      const summary = await this.getYearlySummaryFromCacheOrApi(previousYear);
      const profit = this.pickNumberField(summary ?? {}, ['profit', 'totalProfit', 'total_profit', 'netProfit']) ?? 0;
      return {
        profit,
        label: `So với năm ${previousYear}`
      };
    }

    return null;
  }

  private async getDailySummaryFromCacheOrApi(date: string): Promise<any | null> {
    const key = this.buildDailySummaryKey(date);
    if (this.latestDailySummaries.has(key)) {
      return this.latestDailySummaries.get(key);
    }
    try {
      return await firstValueFrom(this.invoiceService.getDailySummary(date, false));
    } catch {
      return null;
    }
  }

  private async getMonthlySummaryFromCacheOrApi(year: number, month: number): Promise<any | null> {
    const key = this.buildMonthlySummaryKey(year, month);
    if (this.latestMonthlySummaries.has(key)) {
      return this.latestMonthlySummaries.get(key);
    }
    try {
      return await firstValueFrom(this.invoiceService.getMonthlySummary(year, month, false));
    } catch {
      return null;
    }
  }

  private async getYearlySummaryFromCacheOrApi(year: number): Promise<any | null> {
    if (this.latestYearlySummaries.has(year)) {
      return this.latestYearlySummaries.get(year);
    }
    try {
      return await firstValueFrom(this.invoiceService.getYearlySummary(year, false));
    } catch {
      return null;
    }
  }

  private getPreviousDateString(dateString: string): string | null {
    if (!dateString) {
      return null;
    }
    const baseDate = new Date(`${dateString}T00:00:00`);
    if (Number.isNaN(baseDate.getTime())) {
      return null;
    }
    baseDate.setDate(baseDate.getDate() - 1);
    return this.timeZoneService.formatDateToVietnamString(baseDate);
  }

  private getPreviousMonth(year: number, month: number): { year: number; month: number } | null {
    if (!Number.isFinite(year) || !Number.isFinite(month)) {
      return null;
    }
    if (month === 1) {
      return { year: year - 1, month: 12 };
    }
    return { year, month: month - 1 };
  }

  private formatComparisonDate(dateString: string): string {
    const date = new Date(`${dateString}T00:00:00`);
    if (Number.isNaN(date.getTime())) {
      return dateString;
    }
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${day}/${month}`;
  }

  private formatComparisonMonth(month: number, year: number): string {
    return `Tháng ${month}/${year}`;
  }

  private updateMonthlyChartColumn(month: number, summary: any): void {
    const index = Number(month) - 1;
    if (!Number.isFinite(index) || index < 0 || index > 11) {
      return;
    }

    const costData = [...(this.monthlyChartData.datasets?.[0]?.data as number[] ?? new Array(12).fill(0))];
    const profitData = [...(this.monthlyChartData.datasets?.[1]?.data as number[] ?? new Array(12).fill(0))];

    costData[index] = Number(summary?.cost ?? 0);
    profitData[index] = Number(summary?.profit ?? 0);

    this.monthlyChartData = {
      labels: this.monthlyChartData.labels,
      datasets: [
        {
          ...(this.monthlyChartData.datasets?.[0] ?? {}),
          data: costData
        },
        {
          ...(this.monthlyChartData.datasets?.[1] ?? {}),
          data: profitData
        }
      ]
    };
    this.isMonthlyChartLoading = false;
  }

  private _topProducts: any[] = [];

  get comparisonPercentDisplay(): number {
    return Math.min(100, Math.abs(this.comparisonPercentChange));
  }

  get isComparisonPositive(): boolean {
    return this.comparisonDelta >= 0;
  }

  get isProfitComparisonPositive(): boolean {
    return this.comparisonProfitDelta >= 0;
  }

  get comparisonGaugeStyle(): Record<string, string> {
    const pct = this.comparisonPercentDisplay;
    const color = this.isComparisonPositive ? '#22c55e' : '#ef4444';
    return {
      background: `conic-gradient(${color} 0 ${pct}%, #eef1f7 ${pct}% 100%)`
    };
  }

  get comparisonStatusText(): string {
    return this.isComparisonPositive ? 'Tăng trưởng' : 'Sụt giảm';
  }

  get profitComparisonStatusText(): string {
    return this.isProfitComparisonPositive ? 'Tăng trưởng' : 'Sụt giảm';
  }

  get profitComparisonGaugeStyle(): Record<string, string> {
    const pct = Math.min(100, Math.abs(this.comparisonProfitPercentChange));
    const color = this.isProfitComparisonPositive ? '#22c55e' : '#ef4444';
    return {
      background: `conic-gradient(${color} 0 ${pct}%, #eef1f7 ${pct}% 100%)`
    };
  }

  private buildDailySummaryKey(date: string): string {
    return date;
  }

  private buildMonthlySummaryKey(year: number, month: number): string {
    const normalizedMonth = Number(month);
    const paddedMonth = Number.isFinite(normalizedMonth)
      ? normalizedMonth.toString().padStart(2, '0')
      : '00';
    return `${year}-${paddedMonth}`;
  }

  private buildTopProductsKey(filters: { date?: string | null; year?: number | null; month?: number | null }): string {
    if (filters.date) {
      return `date:${String(filters.date)}`;
    }

    const entries: Array<[string, string]> = [];
    if (filters.year != null && !Number.isNaN(filters.year)) {
      entries.push(['year', String(filters.year)]);
    }
    if (filters.month != null && !Number.isNaN(filters.month)) {
      entries.push(['month', String(filters.month)]);
    }

    if (!entries.length) {
      return 'all';
    }

    return entries
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}:${value}`)
      .join('|');
  }

  private revalidateDailySummary(date: string): void {
    const key = this.buildDailySummaryKey(date);
    if (this.pendingDailyRevalidations.has(key)) {
      return;
    }

    this.pendingDailyRevalidations.add(key);
    const sub = this.invoiceService.getDailySummary(date, true).subscribe({
      next: (summary: any) => {
        this.latestDailySummaries.set(key, summary ?? {});
        if (this.selectedDate) {
          const currentDate = this.timeZoneService.formatDateToVietnamString(this.selectedDate);
          if (currentDate === date) {
            this.applySummaryTotals(summary, 'daily', { date });
          }
        }
      },
      error: () => {
        this.pendingDailyRevalidations.delete(key);
      },
      complete: () => {
        this.pendingDailyRevalidations.delete(key);
      }
    });
    this.subscriptions.add(sub);
  }

  private revalidateMonthlySummary(year: number, month: number): void {
    const key = this.buildMonthlySummaryKey(year, month);
    if (this.pendingMonthlyRevalidations.has(key)) {
      return;
    }

    this.pendingMonthlyRevalidations.add(key);
    const sub = this.invoiceService.getMonthlySummary(year, month, true).subscribe({
      next: (summary: any) => {
        this.latestMonthlySummaries.set(key, summary ?? {});
        if (this.selectedTopYear === year && this.selectedMonth !== null && this.selectedMonth === month) {
          this.applySummaryTotals(summary, 'monthly', { year, month });
        }
        if (this.selectedYear === year) {
          this.updateMonthlyChartColumn(month, summary);
        }
      },
      error: () => {
        this.pendingMonthlyRevalidations.delete(key);
      },
      complete: () => {
        this.pendingMonthlyRevalidations.delete(key);
      }
    });
    this.subscriptions.add(sub);
  }

  private revalidateYearlySummary(year: number): void {
    if (this.pendingYearlyRevalidations.has(year)) {
      return;
    }

    this.pendingYearlyRevalidations.add(year);
    const sub = this.invoiceService.getYearlySummary(year, true).subscribe({
      next: (summary: any) => {
        this.latestYearlySummaries.set(year, summary ?? {});
        if (this.selectedTopYear === year && this.selectedMonth === 0) {
          this.applySummaryTotals(summary, 'yearly', { year });
        }
      },
      error: () => {
        this.pendingYearlyRevalidations.delete(year);
      },
      complete: () => {
        this.pendingYearlyRevalidations.delete(year);
      }
    });
    this.subscriptions.add(sub);
  }

  private revalidateTopProducts(filters: { date?: string; year?: number; month?: number | null }): void {
    const cacheKey = this.buildTopProductsKey(filters);
    if (this.pendingTopProductRevalidations.has(cacheKey)) {
      return;
    }

    this.pendingTopProductRevalidations.add(cacheKey);
    const sub = this.invoiceService.getTopSellProducts({
      date: filters.date,
      year: filters.year,
      month: filters.month ?? undefined
    }, true).subscribe({
      next: (products?: any[]) => {
        const safeProducts = Array.isArray(products) ? products : [];
        this.latestTopProducts.set(cacheKey, safeProducts);

        const selectedDateStr = this.selectedDate
          ? this.timeZoneService.formatDateToVietnamString(this.selectedDate)
          : null;

        if (filters.date && selectedDateStr === filters.date) {
          this.updateTopProductsChart(safeProducts);
        } else if (
          typeof filters.year === 'number' &&
          typeof filters.month === 'number' &&
          filters.month > 0 &&
          this.selectedTopYear === filters.year &&
          this.selectedMonth !== null &&
          this.selectedMonth === filters.month
        ) {
          this.updateTopProductsChart(safeProducts);
        } else if (
          typeof filters.year === 'number' &&
          (!filters.month || filters.month === 0) &&
          this.selectedTopYear === filters.year &&
          this.selectedMonth === 0
        ) {
          this.updateTopProductsChart(safeProducts);
        }
      },
      error: () => {
        this.pendingTopProductRevalidations.delete(cacheKey);
      },
      complete: () => {
        this.pendingTopProductRevalidations.delete(cacheKey);
      }
    });
    this.subscriptions.add(sub);
  }
}