import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { Subscription, timeout } from 'rxjs';
import { GeolocationService } from '../../core/services/geolocation.service';
import { VisiteService } from '../../core/services/visite.service';
import { AuthService } from '../../core/services/auth.service';
import { Visite } from '../../core/models/visite.model';

@Component({
  selector: 'app-scan-sortie',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './scan-sortie.component.html',
  styleUrls: ['./scan-sortie.component.scss']
})
export class ScanSortieComponent implements OnInit, OnDestroy {
  // États de l'interface
  loading = false;
  gpsAcquiring = false;
  searchQuery = '';
  
  // Registre des visites actives chargées
  activeVisites: Visite[] = [];
  
  // Données de récapitulatif final
  visiteCloturee: Visite | null = null;

  // Messages utilisateur
  errorMessage: string | null = null;
  gpsPermissionError = false;

  private subscription: Subscription = new Subscription();

  constructor(
    private router: Router,
    private geolocationService: GeolocationService,
    private visiteService: VisiteService,
    private authService: AuthService
  ) {}

  ngOnInit(): void {
    if (!this.authService.isAuthenticated()) {
      this.router.navigate(['/login']);
      return;
    }

    const agent = this.authService.getAgentProfile();
    if (agent && agent.role === 'admin') {
      this.router.navigate(['/home']);
      return;
    }

    // Charger les visites actives en cours pour l'agent (ou globales si admin)
    const agentId = agent ? agent.id.toString() : '0';
    
    const sub = this.visiteService.streamVisiteEnCours(agentId).subscribe({
      next: (visites) => {
        this.activeVisites = visites;
      },
      error: (err) => {
        console.error('Erreur chargement visites actives:', err);
      }
    });
    this.subscription.add(sub);
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
  }

  /**
   * Filtre la liste des visites actives en cours selon la recherche textuelle
   */
  getFilteredActiveVisites(): Visite[] {
    const q = this.searchQuery.trim().toLowerCase();
    if (!q) {
      return this.activeVisites;
    }
    return this.activeVisites.filter(v => 
      (v.prenom_visiteur && v.prenom_visiteur.toLowerCase().includes(q)) ||
      (v.nom_visiteur && v.nom_visiteur.toLowerCase().includes(q)) ||
      (v.numero_cni && v.numero_cni.toLowerCase().includes(q))
    );
  }

  /**
   * Met à jour la chaîne de recherche textuelle
   */
  onSearchChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.searchQuery = input.value;
  }

  /**
   * Déclenche la validation de sortie pour un visiteur actif sélectionné
   */
  validerSortie(visite: Visite): void {
    if (!visite.id_visiteur) return;
    
    this.loading = true;
    this.errorMessage = null;
    this.gpsAcquiring = true;
    this.gpsPermissionError = false;

    // 1. Acquisition GPS et contrôle territorial (Sénégal)
    this.geolocationService.getCurrentPosition().pipe(
      timeout(5000)
    ).subscribe({
      next: (position) => {
        this.gpsAcquiring = false;

        const isInsideSenegal = this.geolocationService.isWithinAllowedRadius(position.latitude, position.longitude);

        if (!isInsideSenegal) {
          this.errorMessage = "Pointage de sortie impossible. Vous devez être localisé au Sénégal.";
          this.loading = false;
          return;
        }

        const gpsSortie = { lat: position.latitude, lng: position.longitude };

        // 2. Clôture de la visite (Backend Laravel / Firestore / LocalStorage)
        this.visiteService.closeVisite(visite.id_visiteur, gpsSortie).subscribe({
          next: (success) => {
            this.loading = false;
            
            if (success) {
              // Récupérer le récapitulatif dans l'historique
              this.visiteService.getHistorique().subscribe({
                next: (historique) => {
                  const match = historique.find(v => v.id_visiteur === visite.id_visiteur);
                  this.visiteCloturee = match || {
                    ...visite,
                    heure_sortie: new Date().toISOString(),
                    statut: 'termine',
                    duree_totale: 1, // Fallback par défaut si non trouvé
                    gps_sortie: gpsSortie
                  };
                }
              });
            } else {
              this.errorMessage = 'Erreur technique lors de la clôture de la visite.';
            }
          },
          error: (err) => {
            this.loading = false;
            this.errorMessage = `Impossible de joindre le serveur : ${err.message}`;
          }
        });
      },
      error: (err: any) => {
        this.gpsAcquiring = false;
        this.loading = false;
        this.gpsPermissionError = true;
        this.errorMessage = err.name === 'TimeoutError'
          ? "Le signal GPS n'a pas pu être obtenu à temps (5s). Veuillez réessayer."
          : `Erreur GPS : ${err.message}`;
      }
    });
  }

  /**
   * Clôture le flux et redirige l'agent vers l'accueil
   */
  finishFlow(): void {
    this.router.navigate(['/home']);
  }
}
