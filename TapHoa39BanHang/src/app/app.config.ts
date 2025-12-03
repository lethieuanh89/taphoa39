import { ApplicationConfig, provideZoneChangeDetection, APP_INITIALIZER } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideNativeDateAdapter } from '@angular/material/core';
import { provideProtractorTestingSupport } from '@angular/platform-browser';

import { routes } from './app.routes';
import { ProductService } from './services/product.service';

function initSockets(ps: ProductService) {
  // Return a function so Angular waits for it (can be sync)
  return () => ps.initializeProductWebSocket();
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }), 
    provideRouter(routes),
    provideHttpClient(),
    provideNativeDateAdapter(),
    provideProtractorTestingSupport(),
    { provide: APP_INITIALIZER, useFactory: initSockets, deps: [ProductService], multi: true }
  ]
};
