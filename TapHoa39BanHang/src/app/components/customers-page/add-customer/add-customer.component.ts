import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { KiotvietService } from '../../../services/kiotviet.service';
import { CommonModule } from '@angular/common';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatRadioModule } from '@angular/material/radio';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { CustomerService } from '../../../services/customer.service';
@Component({
  selector: 'app-add-customer',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatRadioModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatIconModule,
    MatSnackBarModule,
  ],
  templateUrl: './add-customer.component.html',
  styleUrl: './add-customer.component.css'
})
export class AddCustomerComponent {
  customerForm: FormGroup;
  isSaving = false;

  constructor(
    private fb: FormBuilder,
    public dialogRef: MatDialogRef<AddCustomerComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any,
    private kiotvietService: KiotvietService,
    private snackBar: MatSnackBar,
    private customerService: CustomerService
  ) {
    this.customerForm = this.fb.group({
      code: [{ value: 'Mã mặc định', disabled: true }],
      name: ['', Validators.required],
      phone: [''],
      dob: [null],
      gender: [null],
      address: [''],
      area: [''],
      ward: [''],
      type: ['personal', Validators.required],
      taxCode: [''],
      idCard: [''],
      email: ['', Validators.email],
      facebook: [''],
      group: [''],
      notes: ['']
    });
  }

  async onSave(): Promise<void> {
    if (this.customerForm.invalid) {
      this.snackBar.open('Vui lòng điền đầy đủ thông tin bắt buộc: Tên, SDT', 'Đóng', { duration: 3000 });
      return;
    }

    this.isSaving = true;
    const formValue = this.customerForm.getRawValue();

    const payload = {
      name: formValue.name,
      phone: formValue.phone,
      birthDate: formValue.dob,
      address: formValue.address,
      email: formValue.email,
      type: formValue.type === 'personal' ? 0 : 1,
      gender: formValue.gender,
      taxCode: formValue.taxCode,
      notes: formValue.notes,
      organization: formValue.type === 'company' ? formValue.name : ''
    };

    try {
      // Đảm bảo khách hàng được tạo trong Firebase trước để socket phát realtime ngay.
      const createdCustomer = await this.customerService.addCustomerTofireBase(payload);

      try {
        await this.kiotvietService.addCustomer(payload);
      } catch (kiotvietError) {
        console.error('Không thể đồng bộ khách hàng lên KiotViet:', kiotvietError);
        this.snackBar.open('Đã thêm khách hàng nhưng không thể đồng bộ KiotViet.', 'Đóng', { duration: 5000 });
        this.dialogRef.close(createdCustomer ?? payload);
        return;
      }

      this.snackBar.open('Thêm khách hàng thành công!', 'Đóng', { duration: 3000 });
      this.dialogRef.close(createdCustomer ?? payload);
    } catch (error) {
      console.error('Error adding customer', error);
      this.snackBar.open('Có lỗi xảy ra, không thể thêm khách hàng.', 'Đóng', { duration: 3000 });
    } finally {
      this.isSaving = false;
    }
  }

  onCancel(): void {
    this.dialogRef.close();
  }
}
