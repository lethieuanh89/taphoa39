import { Routes } from '@angular/router';
import { EditProductPageComponent } from './components/edit-product-page/edit-product-page.component';
import { MainPageComponent } from './components/main-page/main-page.component';
import { LoginPageComponent } from './components/login-page/login-page.component';

export const routes: Routes = [
    { path: 'login', component: LoginPageComponent },
    { path: 'home', component: MainPageComponent },
    { path: 'edit-product-page', component: EditProductPageComponent },
    { path: '', redirectTo: '/home', pathMatch: 'full' }
];