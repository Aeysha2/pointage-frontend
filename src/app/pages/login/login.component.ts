import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent implements OnInit {
  loginForm!: FormGroup;
  loading = false;
  errorMessage: string | null = null;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router
  ) {}

  ngOnInit(): void {
    // Si l'utilisateur est déjà connecté, redirection directe
    if (this.authService.isAuthenticated()) {
      this.router.navigate(['/home']);
      return;
    }

    // Initialisation du formulaire avec validations
    this.loginForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]]
    });
  }

  /**
   * Getter pratique pour accéder aux contrôles du formulaire dans le template HTML
   */
  get f() {
    return this.loginForm.controls;
  }

  /**
   * Traite la soumission du formulaire de connexion
   */
  onSubmit(): void {
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }

    this.loading = true;
    this.errorMessage = null;

    const { email, password } = this.loginForm.value;

    this.authService.login(email, password).subscribe({
      next: (response) => {
        this.loading = false;
        if (response.success) {
          // Connexion réussie, redirection vers l'accueil
          this.router.navigate(['/home']);
        } else {
          this.errorMessage = 'Identifiants invalides.';
        }
      },
      error: (error: Error) => {
        this.loading = false;
        // Gestion complète des erreurs (mauvais identifiants, réseau indisponible, etc.)
        this.errorMessage = error.message;
      }
    });
  }
}
