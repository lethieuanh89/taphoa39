import { Routes } from '@angular/router';
import { EditProductPageComponent } from './components/edit-product-page/edit-product-page.component';
import { MainPageComponent } from './components/main-page/main-page.component';
import { authGuard, loginGuard } from './guards/auth.guard';

export const routes: Routes = [
    {
        path: 'login',
        loadComponent: () => import('./components/login-page/login-page.component')
            .then(m => m.LoginPageComponent),
        canActivate: [loginGuard]
    },
    {
        path: 'home',
        loadComponent: () => import('./components/main-page/main-page.component')
            .then(m => m.MainPageComponent),
        canActivate: [authGuard]
    },
    { path: 'edit-product-page', component: EditProductPageComponent },
    { path: '', redirectTo: '/home', pathMatch: 'full' }
];