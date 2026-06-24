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
  selectedAgentId = 'all';
  
  // Statistiques pour la vue Administrateur
  totalActiveVisitors = 0;
  activeGuardsCount = 2; // Par défaut en démo
  totalVisitsTodayCount = 0;
  
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

    // Si pas d'agent connecté en cache, redirection vers login
    if (!this.agent) {
      this.authService.clearSession();
      return;
    }

    // 2. Souscription en temps réel aux visites en cours (filtrées ou globales selon le rôle)
    const agentId = this.agent.id.toString();
    const visitesSub = this.visiteService.streamVisiteEnCours(agentId).subscribe({
      next: (visites) => {
        this.visitesEnCours = visites;
        this.updateDurees();
        if (this.agent?.role === 'admin') {
          this.updateAdminStats();
        }
      },
      error: (err) => {
        console.error('Erreur de souscription Firestore:', err);
      }
    });
    this.subscriptions.add(visitesSub);

    // 3. Minuteur : recalculer les durées toutes les secondes
    const timerSub = interval(1000).subscribe(() => {
      this.updateDurees();
    });
    this.subscriptions.add(timerSub);
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  /**
   * Calcule les statistiques d'administration globale
   */
  updateAdminStats(): void {
    this.totalActiveVisitors = this.visitesEnCours.length;
    
    // Compter les agents distincts ayant des visites actives
    const uniqueAgents = new Set(this.visitesEnCours.map(v => v.id_agent));
    this.activeGuardsCount = Math.max(uniqueAgents.size, 2); // Minimum 2 pour la démo

    // Compter le cumul des visites aujourd'hui (actives + terminées aujourd'hui)
    const todayStr = new Date().toISOString().split('T')[0];
    this.visiteService.getHistorique().subscribe({
      next: (historique) => {
        const finishedToday = historique.filter(v => v.date === todayStr).length;
        this.totalVisitsTodayCount = this.totalActiveVisitors + finishedToday;
      }
    });
  }

  /**
   * Filtre les visites affichées sur l'écran
   */
  getFilteredVisites(): Visite[] {
    if (this.selectedAgentId === 'all') {
      return this.visitesEnCours;
    }
    return this.visitesEnCours.filter(v => v.id_agent === this.selectedAgentId);
  }

  /**
   * Retourne le nom lisible de l'agent
   */
  getAgentName(idAgent: string): string {
    if (idAgent === '1') return 'Alexandre Martin (Police)';
    if (idAgent === '2') return 'Sophie Dubois (Admin)';
    return `Agent Police #${idAgent}`;
  }

  /**
   * Gère le changement de filtre agent
   */
  onAgentFilterChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    this.selectedAgentId = select.value;
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
