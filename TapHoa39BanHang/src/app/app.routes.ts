import { Routes } from '@angular/router';
import { MainPageComponent } from './components/main-page/main-page.component';
import { LoginPageComponent } from './components/login-page/login-page.component';
import { EditProductPageRefactoredComponent } from './components/edit-product-page/edit-product-page-refactored.component';

export const routes: Routes = [
    { path: 'login', component: LoginPageComponent },
    { path: 'home', component: MainPageComponent },
    { path: 'edit-product-page', component: EditProductPageRefactoredComponent },
    { path: '', redirectTo: '/home', pathMatch: 'full' }
];