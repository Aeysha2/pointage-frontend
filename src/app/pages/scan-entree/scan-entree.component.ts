import { Component, OnInit, OnDestroy, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { Html5Qrcode } from 'html5-qrcode';
import { GeolocationService } from '../../core/services/geolocation.service';
import { VisiteService } from '../../core/services/visite.service';
import { AuthService } from '../../core/services/auth.service';
import { Visite } from '../../core/models/visite.model';

@Component({
  selector: 'app-scan-entree',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './scan-entree.component.html',
  styleUrls: ['./scan-entree.component.scss']
})
export class ScanEntreeComponent implements OnInit, OnDestroy, AfterViewInit {
  private html5Qrcode!: Html5Qrcode;
  private readonly READER_ELEMENT_ID = 'qr-reader';
  
  // États de l'interface
  scannerActive = false;
  loading = false;
  gpsAcquiring = false;
  
  // Messages utilisateur
  errorMessage: string | null = null;
  cameraPermissionError = false;
  gpsPermissionError = false;
  successMessage: string | null = null;

  constructor(
    private router: Router,
    private geolocationService: GeolocationService,
    private visiteService: VisiteService,
    private authService: AuthService
  ) {}

  ngOnInit(): void {
    // Vérification de sécurité rapide
    if (!this.authService.isAuthenticated()) {
      this.router.navigate(['/login']);
    }
  }

  ngAfterViewInit(): void {
    // L'élément DOM est disponible, on peut initialiser le lecteur QR
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
   * Démarre la capture de flux vidéo et la détection du QR Code
   */
  startScanner(): void {
    this.errorMessage = null;
    this.cameraPermissionError = false;
    this.scannerActive = true;

    this.html5Qrcode.start(
      { facingMode: 'environment' }, // Caméra arrière
      {
        fps: 10,
        qrbox: (width, height) => {
          // Cadre de scan dynamique et proportionnel
          const size = Math.min(width, height) * 0.7;
          return { width: size, height: size };
        }
      },
      (decodedText) => {
        // En cas de scan réussi
        this.handleQrCodeSuccess(decodedText);
      },
      (error) => {
        // Erreurs d'analyse continue (ignorées pour éviter de polluer les logs)
      }
    ).catch((err) => {
      this.scannerActive = false;
      this.cameraPermissionError = true;
      this.errorMessage = 'Accès à la caméra refusé. Veuillez autoriser l\'accès dans les paramètres du navigateur.';
    });
  }

  /**
   * Arrête la caméra et le scanner
   */
  private stopScanner(): Promise<void> {
    if (this.html5Qrcode && this.html5Qrcode.isScanning) {
      this.scannerActive = false;
      return this.html5Qrcode.stop();
    }
    return Promise.resolve();
  }

  /**
   * Traite les données du QR code scanné
   * 
   * @param qrContent Texte brut extrait du QR Code
   */
  private handleQrCodeSuccess(qrContent: string): void {
    // Arrêter le scanner immédiatement pour éviter les scans multiples
    this.stopScanner().then(() => {
      this.loading = true;
      this.errorMessage = null;
      
      let parsedData: any;
      try {
        parsedData = JSON.parse(qrContent);
      } catch (e) {
        this.errorMessage = 'QR Code invalide. Il doit être au format JSON.';
        this.loading = false;
        return;
      }

      // Validation minimale des données JSON requises
      if (!parsedData.id_visiteur || !parsedData.nom_visiteur || !parsedData.service) {
        this.errorMessage = 'Le QR Code ne contient pas les informations requises (id_visiteur, nom_visiteur, service).';
        this.loading = false;
        return;
      }

      // Validation du GPS
      this.verifyGpsAndCreateVisite(parsedData);
    });
  }

  /**
   * Simule un scan de QR Code de test pour les environnements de dev
   */
  simulateScan(): void {
    const mockQrData = JSON.stringify({
      id_visiteur: 'VIS-7742',
      nom_visiteur: 'Marc Lambert',
      service: 'Recherche & Développement',
      direction: 'R&D'
    });
    this.handleQrCodeSuccess(mockQrData);
  }

  /**
   * Récupère la géolocalisation et valide la distance
   * avant d'enregistrer la visite.
   * 
   * @param visitorData Données validées du visiteur
   */
  private verifyGpsAndCreateVisite(visitorData: any): void {
    this.gpsAcquiring = true;
    this.gpsPermissionError = false;

    this.geolocationService.getCurrentPosition().subscribe({
      next: (position) => {
        this.gpsAcquiring = false;
        
        // Calcul de la distance
        const distance = this.geolocationService.calculateDistance(position.latitude, position.longitude);
        const insideRadius = this.geolocationService.isWithinAllowedRadius(position.latitude, position.longitude);

        if (!insideRadius) {
          // Échec du GPS : Trop éloigné
          this.errorMessage = `Pointage impossible. Vous êtes trop éloigné du site de l'entreprise (${Math.round(distance)}m mesurés, max 200m).`;
          this.loading = false;
          return;
        }

        // Création de l'objet Visite conforme
        const agent = this.authService.getAgentProfile();
        const nouvelleVisite: Visite = {
          id_visiteur: visitorData.id_visiteur,
          nom_visiteur: visitorData.nom_visiteur,
          service: visitorData.service,
          direction: visitorData.direction || 'Non spécifié',
          date: new Date().toISOString().split('T')[0],
          heure_entree: new Date().toISOString(),
          heure_sortie: null,
          duree_totale: null,
          gps_entree: { lat: position.latitude, lng: position.longitude },
          gps_sortie: null,
          statut: 'en_cours',
          id_agent: agent ? agent.id.toString() : '0'
        };

        // Soumission au serveur
        this.visiteService.createVisite(nouvelleVisite).subscribe({
          next: (visiteEnregistree) => {
            this.loading = false;
            this.successMessage = `Entrée enregistrée avec succès pour ${visiteEnregistree.nom_visiteur}.`;
            
            // Redirection après 2 secondes vers la page d'accueil
            setTimeout(() => {
              this.router.navigate(['/home']);
            }, 2000);
          },
          error: (err) => {
            this.loading = false;
            this.errorMessage = `Erreur de communication avec le serveur : ${err.message}`;
          }
        });
      },
      error: (err: Error) => {
        this.gpsAcquiring = false;
        this.loading = false;
        this.gpsPermissionError = true;
        this.errorMessage = err.message;
      }
    });
  }

  /**
   * Permet à l'agent de relancer le scanner après une erreur
   */
  retryScan(): void {
    this.errorMessage = null;
    this.successMessage = null;
    this.cameraPermissionError = false;
    this.gpsPermissionError = false;
    this.startScanner();
  }
}
