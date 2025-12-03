import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { environment } from "../../../environments/environment";
import { Router } from '@angular/router';

@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login-page.component.html',
  styleUrl: './login-page.component.css'
})
export class LoginPageComponent implements OnInit {
  username = '';
  password = '';
  isLoading = false;
  error = '';

  constructor(
    private router: Router
  ) { }

  async ngOnInit() {
  }

  async login() {
    this.error = '';
    this.isLoading = true;
    try {
      const response = await fetch(`${environment.domainUrl}/api/kiotviet/authentication`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          username: this.username,
          password: this.password
        })
      });
      if (!response.ok) {
        throw new Error('Sai tài khoản hoặc mật khẩu!');
      }
      const data = await response.json();
      // Lưu thông tin vào localStorage
      localStorage.setItem('kv_access_token', data.access_token);
      localStorage.setItem('kv_retailer', data.retailer);
      localStorage.setItem('kv_branch_id', data.LatestBranchId);

      // Chuyển hướng sang trang chính
      this.router.navigate(['/home']);
    } catch (err: any) {
      this.error = err.message || 'Đăng nhập thất bại!';
    } finally {
      this.isLoading = false;
    }
  }

}
