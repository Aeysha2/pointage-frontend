import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { VisiteService } from '../../core/services/visite.service';
import { AuthService } from '../../core/services/auth.service';
import { Visite } from '../../core/models/visite.model';

@Component({
  selector: 'app-historique',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './historique.component.html',
  styleUrls: ['./historique.component.scss']
})
export class HistoriqueComponent implements OnInit {
  // Liste complète des visites récupérée de l'API
  allVisites: Visite[] = [];
  // Liste des visites filtrée à afficher
  filteredVisites: Visite[] = [];
  // Liste paginée pour la page courante
  paginatedVisites: Visite[] = [];

  // Critères de filtrage
  filterDate = '';
  filterStatut = 'tous'; // 'tous' | 'en_cours' | 'termine'
  filterDirection = '';

  // États de pagination
  currentPage = 1;
  pageSize = 10;
  totalPages = 1;

  constructor(
    private visiteService: VisiteService,
    private authService: AuthService,
    private router: Router
  ) {}

  ngOnInit(): void {
    if (!this.authService.isAuthenticated()) {
      this.router.navigate(['/login']);
      return;
    }
    this.loadHistorique();
  }

  /**
   * Récupère l'historique complet des visites depuis l'API Laravel / Firestore.
   */
  loadHistorique(): void {
    this.visiteService.getHistorique().subscribe({
      next: (visites) => {
        // Classer par date et heure d'entrée décroissante (plus récent d'abord)
        this.allVisites = visites.sort((a, b) => 
          new Date(b.heure_entree).getTime() - new Date(a.heure_entree).getTime()
        );
        this.applyFilters();
      },
      error: (err) => {
        console.error('Erreur lors du chargement de l\'historique:', err);
      }
    });
  }

  /**
   * Filtre la liste des visites selon les critères saisis par l'agent de sécurité.
   */
  applyFilters(): void {
    this.filteredVisites = this.allVisites.filter(visite => {
      // 1. Filtre par date exacte
      if (this.filterDate && visite.date !== this.filterDate) {
        return false;
      }

      // 2. Filtre par statut (en_cours, termine ou tous)
      if (this.filterStatut !== 'tous' && visite.statut !== this.filterStatut) {
        return false;
      }

      // 3. Filtre textuel par direction
      if (this.filterDirection.trim() !== '') {
        const query = this.filterDirection.toLowerCase();
        const directionMatch = visite.direction?.toLowerCase().includes(query);
        const serviceMatch = visite.service?.toLowerCase().includes(query);
        if (!directionMatch && !serviceMatch) {
          return false;
        }
      }

      return true;
    });

    // Recalculer le nombre de pages et réinitialiser à la page 1
    this.currentPage = 1;
    this.calculatePagination();
  }

  /**
   * Calcule les paramètres de pagination et extrait les éléments de la page active.
   */
  calculatePagination(): void {
    this.totalPages = Math.ceil(this.filteredVisites.length / this.pageSize) || 1;
    
    // Protection d'index de page
    if (this.currentPage > this.totalPages) {
      this.currentPage = this.totalPages;
    }

    const startIndex = (this.currentPage - 1) * this.pageSize;
    const endIndex = startIndex + this.pageSize;
    this.paginatedVisites = this.filteredVisites.slice(startIndex, endIndex);
  }

  /**
   * Change de page active
   */
  goToPage(page: number): void {
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage = page;
      this.calculatePagination();
    }
  }

  /**
   * Réinitialise l'ensemble des filtres appliqués
   */
  resetFilters(): void {
    this.filterDate = '';
    this.filterStatut = 'tous';
    this.filterDirection = '';
    this.applyFilters();
  }

  /**
   * Exporte les données actuellement filtrées au format CSV pour tableur (Excel).
   * Encode correctement les caractères spéciaux et propose le fichier en téléchargement direct.
   */
  exportToCsv(): void {
    if (this.filteredVisites.length === 0) {
      alert('Aucune donnée à exporter.');
      return;
    }

    // En-têtes des colonnes CSV de luxe enrichis
    const headers = [
      'CNI', 'Prénom', 'Nom', 'Statut Visiteur', 'But Visite', 
      'Direction', 'Service', 'Division', 'Date', 'Heure Entrée', 
      'Heure Sortie', 'Durée (min)', 'ID Agent',
      'GPS Entrée Lat', 'GPS Entrée Lng', 'GPS Sortie Lat', 'GPS Sortie Lng'
    ];

    // Construction du contenu des lignes
    const csvRows = this.filteredVisites.map(v => {
      return [
        `"${v.numero_cni}"`,
        `"${(v.prenom_visiteur || '').replace(/"/g, '""')}"`,
        `"${v.nom_visiteur.replace(/"/g, '""')}"`,
        `"${(v.statut_visiteur || 'Visiteur').replace(/"/g, '""')}"`,
        `"${(v.but_visite || '').replace(/"/g, '""')}"`,
        `"${v.direction.replace(/"/g, '""')}"`,
        `"${v.service.replace(/"/g, '""')}"`,
        `"${(v.division || '').replace(/"/g, '""')}"`,
        `"${v.date}"`,
        `"${v.heure_entree}"`,
        `"${v.heure_sortie || ''}"`,
        v.duree_totale !== null ? v.duree_totale : '',
        `"${v.id_agent}"`,
        v.gps_entree.lat,
        v.gps_entree.lng,
        v.gps_sortie ? v.gps_sortie.lat : '',
        v.gps_sortie ? v.gps_sortie.lng : ''
      ].join(';'); // Séparateur point-virgule pour compatibilité Excel FR
    });

    // Assemblage final avec BOM UTF-8 pour le support des accents sous Excel
    const csvContent = '\uFEFF' + [headers.join(';'), ...csvRows].join('\n');
    
    // Création du blob de téléchargement
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    // Déclenchement du téléchargement navigateur
    const link = document.createElement('a');
    link.setAttribute('href', url);
    
    const formattedDate = new Date().toISOString().split('T')[0];
    link.setAttribute('download', `historique_pointages_${formattedDate}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  /**
   * Action de déconnexion
   */
  onLogout(): void {
    this.authService.logout().subscribe({
      next: () => this.router.navigate(['/login']),
      error: () => this.router.navigate(['/login'])
    });
  }
}
