import { Component, OnInit, OnDestroy, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { Html5Qrcode } from 'html5-qrcode';
import { GeolocationService } from '../../core/services/geolocation.service';
import { VisiteService } from '../../core/services/visite.service';
import { AuthService } from '../../core/services/auth.service';
import { Visite } from '../../core/models/visite.model';
import { timeout } from 'rxjs';

@Component({
  selector: 'app-scan-sortie',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './scan-sortie.component.html',
  styleUrls: ['./scan-sortie.component.scss']
})
export class ScanSortieComponent implements OnInit, OnDestroy, AfterViewInit {
  private html5Qrcode!: Html5Qrcode;
  private readonly READER_ELEMENT_ID = 'qr-reader';

  // États de l'interface
  scannerActive = false;
  loading = false;
  gpsAcquiring = false;
  
  // Données de récapitulatif final
  visiteCloturee: Visite | null = null;

  // Messages utilisateur
  errorMessage: string | null = null;
  cameraPermissionError = false;
  gpsPermissionError = false;

  constructor(
    private router: Router,
    private geolocationService: GeolocationService,
    private visiteService: VisiteService,
    private authService: AuthService
  ) {}

  ngOnInit(): void {
    if (!this.authService.isAuthenticated()) {
      this.router.navigate(['/login']);
    }
  }

  ngAfterViewInit(): void {
    this.initScanner();
  }

  ngOnDestroy(): void {
    this.stopScanner();
  }

  /**
   * Initialise le lecteur de QR Code html5-qrcode
   */
  private initScanner(): void {
    try {
      this.html5Qrcode = new Html5Qrcode(this.READER_ELEMENT_ID);
      this.startScanner();
    } catch (e) {
      this.errorMessage = 'Erreur lors de l\'initialisation du scanner vidéo.';
    }
  }

  /**
   * Démarre la caméra et commence le scan
   */
  startScanner(): void {
    this.errorMessage = null;
    this.cameraPermissionError = false;
    this.scannerActive = true;
    this.visiteCloturee = null;

    this.html5Qrcode.start(
      { facingMode: 'environment' },
      {
        fps: 10,
        qrbox: (width, height) => {
          const size = Math.min(width, height) * 0.7;
          return { width: size, height: size };
        }
      },
      (decodedText) => {
        this.handleQrCodeSuccess(decodedText);
      },
      (error) => {
        // Ignorer les erreurs d'analyse continues
      }
    ).catch((err) => {
      this.scannerActive = false;
      this.cameraPermissionError = true;
      this.errorMessage = 'Accès à la caméra refusé. Veuillez autoriser l\'accès dans les paramètres du navigateur.';
    });
  }

  /**
   * Arrête le flux caméra
   */
  private stopScanner(): Promise<void> {
    if (this.html5Qrcode && this.html5Qrcode.isScanning) {
      this.scannerActive = false;
      return this.html5Qrcode.stop();
    }
    return Promise.resolve();
  }

  /**
   * Traite les données du QR code scanné à la sortie
   * 
   * @param qrContent Texte brut du QR Code
   */
  private handleQrCodeSuccess(qrContent: string): void {
    this.stopScanner().then(() => {
      this.loading = true;
      this.errorMessage = null;

      let idVisiteurScanne = '';

      // Tenter de parser si c'est un JSON, ou récupérer la chaîne brute
      try {
        const parsedData = JSON.parse(qrContent);
        idVisiteurScanne = parsedData.id_visiteur || parsedData.id || qrContent;
      } catch (e) {
        // Si le contenu n'est pas un JSON, on utilise la chaîne brute comme ID
        idVisiteurScanne = qrContent.trim();
      }

      if (!idVisiteurScanne) {
        this.errorMessage = 'QR Code invalide. Impossible d\'extraire l\'ID du visiteur.';
        this.loading = false;
        return;
      }

      // Étape GPS avant validation finale de sortie
      this.verifyGpsAndCloseVisite(idVisiteurScanne);
    });
  }

  /**
   * Simule un scan de QR Code pour les tests de sortie
   */
  simulateScan(): void {
    this.handleQrCodeSuccess('VIS-7742');
  }

  /**
   * Récupère la position géographique et clôture la visite
   * 
   * @param idVisiteur ID du visiteur scanné
   */
  private verifyGpsAndCloseVisite(idVisiteur: string): void {
    this.gpsAcquiring = true;
    this.gpsPermissionError = false;

    this.geolocationService.getCurrentPosition().pipe(
      timeout(5000)
    ).subscribe({
      next: (position) => {
        this.gpsAcquiring = false;

        // Calcul de la distance
        const distance = this.geolocationService.calculateDistance(position.latitude, position.longitude);
        const insideRadius = this.geolocationService.isWithinAllowedRadius(position.latitude, position.longitude);

        if (!insideRadius) {
          this.errorMessage = "Pointage de sortie impossible. Vous devez être localisé géographiquement au Sénégal pour valider ce pointage.";
          this.loading = false;
          return;
        }

        const gpsSortie = { lat: position.latitude, lng: position.longitude };

        // Requête HTTP de clôture de la visite vers le backend Laravel
        this.visiteService.closeVisite(idVisiteur, gpsSortie).subscribe({
          next: (success) => {
            this.loading = false;
            // Dans une vraie application avec API, closeVisite retournera l'objet Visite finalisé.
            // On gère le mock en créant les données pour l'affichage récapitulatif
            if (success) {
              // Dans notre visite.service mocké, nous mettons à jour la visite locale.
              // Simulons la récupération des données finales pour le récapitulatif
              this.visiteService.getHistorique().subscribe({
                next: (historique) => {
                  // Trouver la visite qu'on vient de clôturer dans l'historique
                  const match = historique.find(v => v.id_visiteur === idVisiteur);
                  this.visiteCloturee = match || null;
                }
              });
            } else {
              this.errorMessage = 'Aucune visite active en cours n\'a été trouvée pour ce visiteur.';
            }
          },
          error: (err) => {
            this.loading = false;
            this.errorMessage = `Erreur de communication : ${err.message}`;
          }
        });
      },
      error: (err: any) => {
        this.gpsAcquiring = false;
        this.loading = false;
        this.gpsPermissionError = true;
        this.errorMessage = err.name === 'TimeoutError'
          ? "L'acquisition GPS a expiré (5s). Veuillez autoriser la localisation ou réessayer."
          : err.message;
      }
    });
  }

  /**
   * Retourne à la page d'accueil
   */
  finishFlow(): void {
    this.router.navigate(['/home']);
  }

  /**
   * Réinitialise les états pour scanner à nouveau
   */
  retryScan(): void {
    this.errorMessage = null;
    this.visiteCloturee = null;
    this.cameraPermissionError = false;
    this.gpsPermissionError = false;
    this.startScanner();
  }
}
