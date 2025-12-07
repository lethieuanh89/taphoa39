import { ApplicationConfig, provideZoneChangeDetection, APP_INITIALIZER } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideNativeDateAdapter } from '@angular/material/core';
import { provideProtractorTestingSupport } from '@angular/platform-browser';
import { routes } from './app.routes';
import { ProductService } from './services/product.service';

import { initializeApp } from 'firebase/app';
import { provideFirebaseApp } from '@angular/fire/app';
import { provideAuth, getAuth } from '@angular/fire/auth';
import { environment } from '../environments/environment';
import { authInterceptor } from './interceptors/auth.interceptor';

function initSockets(ps: ProductService) {
  // Return a function so Angular waits for it (can be sync)
  return () => ps.initializeProductWebSocket();
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideFirebaseApp(() => initializeApp(environment.firebase)),
    provideAuth(() => getAuth()),
    provideNativeDateAdapter(),
    provideProtractorTestingSupport(),

    { provide: APP_INITIALIZER, useFactory: initSockets, deps: [ProductService], multi: true }
  ]
};