import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { AppComponent } from './app.component';
import { MatTableModule } from '@angular/material/table';
import { MatCardModule } from '@angular/material/card';
import { MatToolbarModule } from '@angular/material/toolbar';
import { FormsModule } from '@angular/forms';

import { environment } from '../environments/environment';
import { ProductService } from './services/product.service';
import { AngularFontAwesomeModule } from 'angular-font-awesome';
import { InvoiceDetailComponent } from './components/invoice-detail/invoice-detail.component';
import { CommonModule } from '@angular/common';
import { MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { ConfirmPopupComponent } from './components/confirm-popup/confirm-popup.component';
import { InvoicesPageComponent } from './components/invoices-page/invoices-page.component';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { NgChartsModule } from 'ng2-charts';

@NgModule({
  providers: [
    CommonModule,
    AngularFontAwesomeModule,
    ProductService,
    MatDialogModule,
    MatDatepickerModule,
    MatNativeDateModule,
    { provide: MAT_DIALOG_DATA, useValue: {} },
    provideRouter(routes),
    BrowserModule,
    BrowserAnimationsModule,
    MatCardModule,
    MatToolbarModule,
    MatButtonModule,
    AppComponent,
    MatDialogModule,
    FormsModule,
    MatTableModule,
    NgChartsModule
  ],
  imports: [
    InvoicesPageComponent,
    ConfirmPopupComponent,
    InvoiceDetailComponent,
    BrowserAnimationsModule,
    MatButtonModule,
    BrowserModule,
    BrowserAnimationsModule,
    MatCardModule,
    MatToolbarModule,
    MatButtonModule,
    AppComponent,
    MatDialogModule,
    FormsModule,
    MatTableModule,
  ],
  bootstrap: []
})
export class AppModule { }
