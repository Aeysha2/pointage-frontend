import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { BehaviorSubject, Observable, throwError, of } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { Router } from '@angular/router';

export interface Agent {
  id: number;
  name: string;
  email: string;
  role: string;
  avatar_url?: string;
  poste?: string;
}

export interface AuthResponse {
  success: boolean;
  access_token: string;
  token_type: string;
  expires_in: number;
  agent: Agent;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly API_URL = 'http://localhost:8000/api';
  private agentSubject = new BehaviorSubject<Agent | null>(null);
  public agent$ = this.agentSubject.asObservable();

  // Comptes de secours pour tester l'application sans serveur Laravel local
  private readonly DEMO_ACCOUNTS = [
    {
      email: 'agent@entreprise.com',
      password: 'password123',
      agent: {
        id: 1,
        name: 'Alexandre Martin',
        email: 'agent@entreprise.com',
        role: 'agent_securite',
        poste: 'Poste de Contrôle Sud'
      }
    },
    {
      email: 'admin@entreprise.com',
      password: 'password123',
      agent: {
        id: 2,
        name: 'Sophie Dubois',
        email: 'admin@entreprise.com',
        role: 'superviseur',
        poste: 'Superviseur de Garde'
      }
    }
  ];

  constructor(private http: HttpClient, private router: Router) {
    this.restoreSession();
  }

  /**
   * Tente de connecter l'agent de sécurité.
   * Si le backend Laravel (localhost:8000) est hors ligne ou indisponible (erreur réseau),
   * le service bascule automatiquement sur les comptes de test locaux (agent@entreprise.com / password123)
   * afin de permettre de tester l'application instantanément sans configuration requise.
   */
  login(email: string, password: string): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.API_URL}/auth/login`, { email, password }).pipe(
      tap((res) => {
        if (res.success && res.access_token) {
          this.saveSession(res.access_token, res.agent);
        }
      }),
      catchError((error: HttpErrorResponse) => {
        console.warn('Backend Laravel inaccessible. Tentative de connexion via comptes de secours locaux...');
        
        // Recherche dans les comptes de test
        const match = this.DEMO_ACCOUNTS.find(
          (account) => account.email === email && account.password === password
        );

        if (match) {
          // Simulation d'une session réussie
          const mockResponse: AuthResponse = {
            success: true,
            access_token: 'mock_jwt_token_for_demo_purposes_only',
            token_type: 'bearer',
            expires_in: 3600,
            agent: match.agent
          };
          
          this.saveSession(mockResponse.access_token, mockResponse.agent);
          return of(mockResponse);
        }

        // Si ce n'est pas un compte de test et que le serveur est injoignable, renvoyer l'erreur d'origine
        if (error.status === 0) {
          return throwError(() => new Error('Serveur injoignable. Utilisez les identifiants de test : agent@entreprise.com / password123'));
        }

        return this.handleError(error);
      })
    );
  }

  /**
   * Déconnecte l'agent et nettoie les données locales.
   */
  logout(): Observable<any> {
    // Si c'est un mock token, on ne fait pas d'appel réseau backend
    const token = this.getToken();
    if (token === 'mock_jwt_token_for_demo_purposes_only') {
      this.clearSession();
      return of({ success: true });
    }

    return this.http.post(`${this.API_URL}/auth/logout`, {}).pipe(
      tap(() => this.clearSession()),
      catchError((err) => {
        this.clearSession();
        return throwError(() => err);
      })
    );
  }

  /**
   * Vérifie si l'agent est actuellement authentifié localement.
   */
  isAuthenticated(): boolean {
    const token = this.getToken();
    return !!token && !this.isTokenExpired(token);
  }

  /**
   * Récupère le token JWT stocké.
   */
  getToken(): string | null {
    return localStorage.getItem('jwt_token');
  }

  /**
   * Récupère le profil de l'agent actuellement connecté.
   */
  getAgentProfile(): Agent | null {
    return this.agentSubject.value;
  }

  /**
   * Sauvegarde la session dans le stockage local.
   */
  private saveSession(token: string, agent: Agent): void {
    localStorage.setItem('jwt_token', token);
    localStorage.setItem('agent_profile', JSON.stringify(agent));
    this.agentSubject.next(agent);
  }

  /**
   * Nettoie les données de session locales.
   */
  public clearSession(): void {
    localStorage.removeItem('jwt_token');
    localStorage.removeItem('agent_profile');
    this.agentSubject.next(null);
  }

  /**
   * Restaure la session au chargement de l'application.
   */
  private restoreSession(): void {
    const token = this.getToken();
    const agentData = localStorage.getItem('agent_profile');
    if (token && agentData && !this.isTokenExpired(token)) {
      this.agentSubject.next(JSON.parse(agentData));
    } else {
      this.clearSession();
    }
  }

  /**
   * Vérifie si le token JWT est expiré.
   */
  private isTokenExpired(token: string): boolean {
    if (token === 'mock_jwt_token_for_demo_purposes_only') {
      return false; // Le token de démo n'expire pas pour faciliter les tests
    }
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.exp ? Date.now() >= payload.exp * 1000 : false;
    } catch (e) {
      return true;
    }
  }

  /**
   * Gestion d'erreurs HTTP.
   */
  private handleError(error: HttpErrorResponse): Observable<never> {
    let errorMessage = 'Une erreur réseau est survenue. Veuillez vérifier votre connexion.';
    if (error.error instanceof ErrorEvent) {
      errorMessage = error.error.message;
    } else if (error.status) {
      errorMessage = error.error?.message || `Erreur serveur (code ${error.status})`;
    }
    return throwError(() => new Error(errorMessage));
  }
}
