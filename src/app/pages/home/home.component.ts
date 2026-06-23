import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { Subscription, interval, Observable, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { AuthService, Agent } from '../../core/services/auth.service';
import { VisiteService } from '../../core/services/visite.service';
import { Visite } from '../../core/models/visite.model';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss']
})
export class HomeComponent implements OnInit, OnDestroy {
  agent: Agent | null = null;
  visitesEnCours: Visite[] = [];
  
  // Tableau contenant les durées calculées en temps réel pour chaque visite
  visitesDurees: { [key: string]: string } = {};

  private subscriptions: Subscription = new Subscription();

  constructor(
    private authService: AuthService,
    private visiteService: VisiteService,
    private router: Router
  ) {}

  ngOnInit(): void {
    // 1. Récupérer le profil de l'agent connecté
    this.agent = this.authService.getAgentProfile();

    // Si pas d'agent connecté en cache, redirection vers login (sécurité additionnelle)
    if (!this.agent) {
      this.authService.clearSession();
      return;
    }

    // 2. Souscription en temps réel aux visites en cours créées par cet agent
    const agentId = this.agent.id.toString();
    const visitesSub = this.visiteService.streamVisiteEnCours(agentId).subscribe({
      next: (visites) => {
        this.visitesEnCours = visites;
        this.updateDurees();
      },
      error: (err) => {
        console.error('Erreur de souscription Firestore:', err);
      }
    });
    this.subscriptions.add(visitesSub);

    // 3. Minuteur RxJS : recalculer les durées toutes les secondes
    const timerSub = interval(1000).subscribe(() => {
      this.updateDurees();
    });
    this.subscriptions.add(timerSub);
  }

  ngOnDestroy(): void {
    // Libération propre des abonnements pour éviter les fuites de mémoire
    this.subscriptions.unsubscribe();
  }

  /**
   * Met à jour les durées de toutes les visites actives affichées à l'écran.
   */
  private updateDurees(): void {
    this.visitesEnCours.forEach((visite) => {
      if (visite.id) {
        this.visitesDurees[visite.id] = this.calculateElapsed(visite.heure_entree);
      }
    });
  }

  /**
   * Calcule le temps écoulé en format HH:mm:ss à partir d'une date ISO de début.
   * 
   * @param heureEntree Date ISO de début.
   */
  private calculateElapsed(heureEntree: string): string {
    const start = new Date(heureEntree).getTime();
    const now = Date.now();
    const diffMs = now - start;

    if (diffMs < 0) return '00:00:00';

    const diffSecs = Math.floor(diffMs / 1000);
    const hours = Math.floor(diffSecs / 3600);
    const minutes = Math.floor((diffSecs % 3600) / 60);
    const seconds = diffSecs % 60;

    const pad = (num: number) => num.toString().padStart(2, '0');

    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }

  /**
   * Redirige l'agent vers le flux d'entrée
   */
  navigateToEntree(): void {
    this.router.navigate(['/scan-entree']);
  }

  /**
   * Redirige l'agent vers le flux de sortie
   */
  navigateToSortie(): void {
    this.router.navigate(['/scan-sortie']);
  }

  /**
   * Gère la déconnexion de l'agent
   */
  onLogout(): void {
    this.authService.logout().subscribe({
      next: () => this.router.navigate(['/login']),
      error: () => this.router.navigate(['/login'])
    });
  }
}
