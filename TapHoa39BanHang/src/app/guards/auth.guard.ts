import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { map, take } from 'rxjs/operators';

export const authGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.authState$.pipe(
    take(1),
    map(authState => {
      if (authState. isLoading) {
        // Wait for auth state to be determined
        return true;
      }
      
      if (authState.isAuthenticated) {
        return true;
      }
      
      // Not authenticated, redirect to login
      router.navigate(['/login'], { queryParams: { returnUrl: state. url } });
      return false;
    })
  );
};

export const loginGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.authState$.pipe(
    take(1),
    map(authState => {
      if (authState.isAuthenticated) {
        // Already logged in, redirect to home
        router.navigate(['/home']);
        return false;
      }
      return true;
    })
  );
};