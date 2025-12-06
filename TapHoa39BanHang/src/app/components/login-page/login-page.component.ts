import { Component, OnInit, OnDestroy, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

type LoginStep = 'phone' | 'otp';

@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login-page.component.html',
  styleUrl: './login-page.component.css'
})
export class LoginPageComponent implements OnInit, AfterViewInit, OnDestroy {
  // Form fields
  phoneNumber = '+84';
  otpCode = '';
  
  // UI state
  currentStep: LoginStep = 'phone';
  isLoading = false;
  error = '';
  successMessage = '';
  
  // Countdown for resend
  resendCountdown = 0;
  private resendTimer: any;

  constructor(
    private router: Router,
    private authService: AuthService
  ) {}

  ngOnInit(): void {
    // Check if already authenticated
    if (this.authService.isAuthenticated()) {
      this.router. navigate(['/home']);
    }
  }

  ngAfterViewInit(): void {
    // Initialize reCAPTCHA after view is ready
    setTimeout(() => {
      this.authService.initRecaptcha('recaptcha-container');
    }, 100);
  }

  ngOnDestroy(): void {
    this.authService.cleanupRecaptcha();
    if (this.resendTimer) {
      clearInterval(this.resendTimer);
    }
  }

  /**
   * Format phone number for display
   */
  formatPhoneNumber(phone: string): string {
    // Remove all non-digit characters except +
    return phone. replace(/[^\d+]/g, '');
  }

  /**
   * Validate Vietnamese phone number
   */
  isValidPhoneNumber(): boolean {
    const phone = this.formatPhoneNumber(this. phoneNumber);
    // Vietnamese phone: +84 followed by 9-10 digits
    const regex = /^\+84[0-9]{9,10}$/;
    return regex.test(phone);
  }

  /**
   * Send OTP to phone number
   */
  async sendOTP(): Promise<void> {
    if (!this.isValidPhoneNumber()) {
      this.error = 'Số điện thoại không hợp lệ';
      return;
    }

    this.error = '';
    this.isLoading = true;

    try {
      const formattedPhone = this. formatPhoneNumber(this.phoneNumber);
      await this.authService. sendOTP(formattedPhone);
      
      this.currentStep = 'otp';
      this.successMessage = `Mã OTP đã được gửi đến ${this.phoneNumber}`;
      this.startResendCountdown();
    } catch (err: any) {
      console.error('Send OTP error:', err);
      this. handleAuthError(err);
      // Reinitialize reCAPTCHA on error
      setTimeout(() => {
        this.authService. initRecaptcha('recaptcha-container');
      }, 100);
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Verify OTP and complete login
   */
  async verifyOTP(): Promise<void> {
    if (this.otpCode.length !== 6) {
      this.error = 'Mã OTP phải có 6 chữ số';
      return;
    }

    this.error = '';
    this.isLoading = true;

    try {
      await this.authService. verifyOTP(this.otpCode);
      this.router.navigate(['/home']);
    } catch (err: any) {
      console. error('Verify OTP error:', err);
      this.handleAuthError(err);
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Resend OTP
   */
  async resendOTP(): Promise<void> {
    if (this.resendCountdown > 0) return;
    
    // Reinitialize reCAPTCHA
    this.authService.initRecaptcha('recaptcha-container');
    
    // Wait a bit for reCAPTCHA to initialize
    setTimeout(() => {
      this.sendOTP();
    }, 500);
  }

  /**
   * Go back to phone input step
   */
  backToPhone(): void {
    this.currentStep = 'phone';
    this.otpCode = '';
    this.error = '';
    this.successMessage = '';
    
    // Reinitialize reCAPTCHA
    setTimeout(() => {
      this.authService. initRecaptcha('recaptcha-container');
    }, 100);
  }

  /**
   * Start countdown for resend button
   */
  private startResendCountdown(): void {
    this.resendCountdown = 60;
    
    if (this.resendTimer) {
      clearInterval(this. resendTimer);
    }
    
    this.resendTimer = setInterval(() => {
      this.resendCountdown--;
      if (this.resendCountdown <= 0) {
        clearInterval(this.resendTimer);
      }
    }, 1000);
  }

  /**
   * Handle authentication errors
   */
  private handleAuthError(err: any): void {
    const errorCode = err.code || '';
    
    switch (errorCode) {
      case 'auth/invalid-phone-number':
        this.error = 'Số điện thoại không hợp lệ';
        break;
      case 'auth/too-many-requests':
        this. error = 'Quá nhiều yêu cầu.  Vui lòng thử lại sau';
        break;
      case 'auth/invalid-verification-code':
        this.error = 'Mã OTP không đúng';
        break;
      case 'auth/code-expired':
        this.error = 'Mã OTP đã hết hạn.  Vui lòng gửi lại';
        break;
      case 'auth/quota-exceeded':
        this.error = 'Đã vượt quá giới hạn SMS.  Vui lòng thử lại sau';
        break;
      default:
        this.error = err.message || 'Đã có lỗi xảy ra.  Vui lòng thử lại';
    }
  }

  /**
   * Only allow numeric input for OTP
   */
  onOtpInput(event: any): void {
    const input = event.target.value;
    this.otpCode = input. replace(/[^0-9]/g, ''). substring(0, 6);
  }
}