import { Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { Observable } from 'rxjs';
import { AuthService } from '../services/auth.service';

@Injectable({
  providedIn: 'root'
})
export class AuthGuard implements CanActivate {
  
  constructor(private authService: AuthService, private router: Router) {}

  /**
   * Vérifie si l'utilisateur est connecté avant d'autoriser l'accès à la route
   */
  canActivate(): boolean | UrlTree | Observable<boolean | UrlTree> | Promise<boolean | UrlTree> {
    if (this.authService.isAuthenticated()) {
      return true;
    }
    
    // Si non connecté, redirection vers la page de login
    return this.router.createUrlTree(['/login']);
  }
}
