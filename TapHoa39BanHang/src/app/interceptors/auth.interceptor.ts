import { HttpInterceptorFn, HttpRequest, HttpHandlerFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { Router } from '@angular/router';

export const authInterceptor: HttpInterceptorFn = (req: HttpRequest<unknown>, next: HttpHandlerFn) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  // Skip auth endpoints
  const skipUrls = ['/api/auth/login', '/api/auth/verify-phone', '/api/auth/refresh'];
  if (skipUrls. some(url => req. url.includes(url))) {
    return next(req);
  }

  // Add KiotViet token if available
  const kvToken = authService. getKiotVietToken();
  let authReq = req;
  
  if (kvToken) {
    authReq = req.clone({
      setHeaders: {
        Authorization: kvToken
      }
    });
  }

  return next(authReq).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error. status === 401) {
        // Try to refresh token
        return from(authService.refreshKiotVietToken()).pipe(
          switchMap((success) => {
            if (success) {
              // Retry with new token
              const newToken = authService.getKiotVietToken();
              const retryReq = req.clone({
                setHeaders: {
                  Authorization: newToken || ''
                }
              });
              return next(retryReq);
            } else {
              // Refresh failed, redirect to login
              router. navigate(['/login']);
              return throwError(() => error);
            }
          })
        );
      }
      return throwError(() => error);
    })
  );
};