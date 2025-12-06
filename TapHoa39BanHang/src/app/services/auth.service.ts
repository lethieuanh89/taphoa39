import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { 
  Auth, 
  signInWithPhoneNumber, 
  RecaptchaVerifier, 
  ConfirmationResult, 
  signOut, 
  User, 
  onAuthStateChanged,
  ApplicationVerifier
} from '@angular/fire/auth';
import { BehaviorSubject } from 'rxjs';
import { environment } from '../../environments/environment';

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

export interface LoginResponse {
  success: boolean;
  user: {
    uid: string;
    phone_number: string;
  };
  refresh_token: string;
  kiotviet: {
    access_token: string;
    retailer: string;
    branch_id: string;
  };
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private auth = inject(Auth);
  private platformId = inject(PLATFORM_ID);
  
  private confirmationResult: ConfirmationResult | null = null;
  private recaptchaVerifier: RecaptchaVerifier | null = null;

  private authState = new BehaviorSubject<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true
  });

  public authState$ = this. authState.asObservable();

  // Storage keys
  private readonly REFRESH_TOKEN_KEY = 'taphoa39_refresh_token';
  private readonly KV_ACCESS_TOKEN_KEY = 'kv_access_token';
  private readonly KV_RETAILER_KEY = 'kv_retailer';
  private readonly KV_BRANCH_ID_KEY = 'kv_branch_id';

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.initAuthListener();
    }
  }

  private initAuthListener(): void {
    onAuthStateChanged(this.auth, async (user) => {
      if (user) {
        const hasRefreshToken = this.getRefreshToken();
        this.authState.next({
          user,
          isAuthenticated: !!hasRefreshToken,
          isLoading: false
        });
      } else {
        this. authState.next({
          user: null,
          isAuthenticated: false,
          isLoading: false
        });
      }
    });
  }

  /**
   * Initialize reCAPTCHA verifier for phone authentication
   * Updated for Firebase 11.x
   */
  initRecaptcha(containerId: string): void {
    if (! isPlatformBrowser(this.platformId)) {
      return;
    }

    // Clear existing verifier
    if (this.recaptchaVerifier) {
      try {
        this. recaptchaVerifier.clear();
      } catch (e) {
        // Ignore clear errors
      }
      this.recaptchaVerifier = null;
    }

    // Create new verifier - Firebase 11.x syntax
    this.recaptchaVerifier = new RecaptchaVerifier(this.auth, containerId, {
      size: 'invisible',
      callback: () => {
        console.log('reCAPTCHA verified');
      },
      'expired-callback': () => {
        console. log('reCAPTCHA expired');
        this.cleanupRecaptcha();
      }
    });

    // Render the reCAPTCHA
    this.recaptchaVerifier. render(). catch((error) => {
      console.error('reCAPTCHA render error:', error);
    });
  }

  /**
   * Check if phone number is allowed before sending OTP
   */
  async verifyPhoneAllowed(phoneNumber: string): Promise<boolean> {
    try {
      const response = await fetch(`${environment.domainUrl}/api/auth/verify-phone`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ phone_number: phoneNumber })
      });

      const data = await response. json();
      return data.allowed === true;
    } catch (error) {
      console.error('Error verifying phone:', error);
      return false;
    }
  }

  /**
   * Send OTP to phone number
   * Updated for Firebase 11.x
   */
  async sendOTP(phoneNumber: string): Promise<void> {
    if (!this.recaptchaVerifier) {
      throw new Error('reCAPTCHA not initialized');
    }

    // First check if phone is allowed
    const isAllowed = await this.verifyPhoneAllowed(phoneNumber);
    if (!isAllowed) {
      throw new Error('Số điện thoại không được phép đăng nhập');
    }

    try {
      this.confirmationResult = await signInWithPhoneNumber(
        this. auth,
        phoneNumber,
        this.recaptchaVerifier as ApplicationVerifier
      );
    } catch (error: any) {
      console.error('signInWithPhoneNumber error:', error);
      this.cleanupRecaptcha();
      throw error;
    }
  }

  /**
   * Verify OTP and complete login
   */
  async verifyOTP(otp: string): Promise<LoginResponse> {
    if (!this.confirmationResult) {
      throw new Error('No pending OTP verification');
    }

    // Verify OTP with Firebase
    const userCredential = await this. confirmationResult.confirm(otp);
    const user = userCredential.user;

    // Get Firebase ID token
    const idToken = await user.getIdToken();

    // Exchange Firebase token for app tokens
    const response = await fetch(`${environment.domainUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ id_token: idToken })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Login failed');
    }

    const loginData: LoginResponse = await response.json();

    // Store tokens securely
    this.storeTokens(loginData);

    // Update auth state
    this.authState.next({
      user,
      isAuthenticated: true,
      isLoading: false
    });

    return loginData;
  }

  /**
   * Store authentication tokens
   */
  private storeTokens(loginData: LoginResponse): void {
    if (! isPlatformBrowser(this.platformId)) return;
    
    localStorage.setItem(this.REFRESH_TOKEN_KEY, loginData.refresh_token);
    localStorage.setItem(this.KV_ACCESS_TOKEN_KEY, loginData.kiotviet.access_token);
    localStorage.setItem(this.KV_RETAILER_KEY, loginData.kiotviet.retailer);
    localStorage.setItem(this.KV_BRANCH_ID_KEY, loginData.kiotviet.branch_id);
  }

  /**
   * Get stored refresh token
   */
  getRefreshToken(): string | null {
    if (!isPlatformBrowser(this.platformId)) return null;
    return localStorage. getItem(this. REFRESH_TOKEN_KEY);
  }

  /**
   * Get KiotViet access token
   */
  getKiotVietToken(): string | null {
    if (!isPlatformBrowser(this.platformId)) return null;
    return localStorage.getItem(this.KV_ACCESS_TOKEN_KEY);
  }

  /**
   * Refresh KiotViet token using refresh token
   */
  async refreshKiotVietToken(): Promise<boolean> {
    const refreshToken = this. getRefreshToken();
    if (!refreshToken) {
      return false;
    }

    try {
      const response = await fetch(`${environment.domainUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ refresh_token: refreshToken })
      });

      if (!response. ok) {
        await this.logout();
        return false;
      }

      const data = await response. json();
      
      if (isPlatformBrowser(this.platformId)) {
        localStorage.setItem(this.KV_ACCESS_TOKEN_KEY, data.kiotviet.access_token);
        localStorage. setItem(this. KV_RETAILER_KEY, data.kiotviet.retailer);
        localStorage.setItem(this.KV_BRANCH_ID_KEY, data. kiotviet. branch_id);
      }

      return true;
    } catch (error) {
      console.error('Error refreshing token:', error);
      return false;
    }
  }

  /**
   * Get current Firebase ID token
   */
  async getIdToken(): Promise<string | null> {
    const user = this.auth.currentUser;
    if (! user) return null;
    return await user.getIdToken();
  }

  /**
   * Logout user
   */
  async logout(): Promise<void> {
    const refreshToken = this.getRefreshToken();

    // Revoke refresh token on backend
    if (refreshToken) {
      try {
        await fetch(`${environment.domainUrl}/api/auth/logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ refresh_token: refreshToken })
        });
      } catch (error) {
        console.error('Error revoking token:', error);
      }
    }

    // Clear local storage
    if (isPlatformBrowser(this.platformId)) {
      localStorage.removeItem(this.REFRESH_TOKEN_KEY);
      localStorage.removeItem(this.KV_ACCESS_TOKEN_KEY);
      localStorage.removeItem(this.KV_RETAILER_KEY);
      localStorage.removeItem(this.KV_BRANCH_ID_KEY);
    }

    // Sign out from Firebase
    await signOut(this. auth);

    // Update state
    this.authState.next({
      user: null,
      isAuthenticated: false,
      isLoading: false
    });
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    return this. authState.value. isAuthenticated;
  }

  /**
   * Cleanup reCAPTCHA
   */
  cleanupRecaptcha(): void {
    if (this.recaptchaVerifier) {
      try {
        this.recaptchaVerifier.clear();
      } catch (e) {
        // Ignore errors during cleanup
      }
      this.recaptchaVerifier = null;
    }
    this.confirmationResult = null;
  }
}