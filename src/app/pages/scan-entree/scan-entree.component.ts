import { Component, OnInit, OnDestroy, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Html5Qrcode } from 'html5-qrcode';
import { GeolocationService } from '../../core/services/geolocation.service';
import { VisiteService } from '../../core/services/visite.service';
import { AuthService } from '../../core/services/auth.service';
import { Visite } from '../../core/models/visite.model';
import { timeout } from 'rxjs';

@Component({
  selector: 'app-scan-entree',
  standalone: true,
  imports: [CommonModule, RouterModule, ReactiveFormsModule],
  templateUrl: './scan-entree.component.html',
  styleUrls: ['./scan-entree.component.scss']
})
export class ScanEntreeComponent implements OnInit, OnDestroy, AfterViewInit {
  private html5Qrcode!: Html5Qrcode;
  private readonly READER_ELEMENT_ID = 'cni-reader';
  
  // États de l'interface
  scannerActive = false;
  loading = false;
  gpsAcquiring = false;
  ocrSuccessAnimation = false;
  
  // Messages utilisateur
  errorMessage: string | null = null;
  cameraPermissionError = false;
  gpsPermissionError = false;
  successMessage: string | null = null;

  // Formulaire d'entrée
  entreeForm!: FormGroup;

  // Modèle des statuts de visiteurs
  statutsVisiteurs = [
    { value: 'Particulier', label: 'Particulier / RDV' },
    { value: 'Prestataire', label: 'Prestataire de Service' },
    { value: 'Officiel', label: 'Visiteur Officiel / Délégation' },
    { value: 'Journaliste', label: 'Journaliste / Médias' },
    { value: 'Autre', label: 'Autre' }
  ];

  // Structure des destinations sur 3 niveaux
  destinations = [
    {
      direction: 'Direction des Ressources Humaines (DRH)',
      services: [
        {
          name: 'Gestion des Carrières',
          divisions: ['Évaluation & Promotion', 'Retraites & Affaires Sociales', 'Mouvements de Personnel']
        },
        {
          name: 'Recrutement & Intégration',
          divisions: ['Cadres et Assimilés', 'Personnel d\'Appui', 'Stagiaires & Alternances']
        }
      ]
    },
    {
      direction: 'Direction des Systèmes d\'Information (DSI)',
      services: [
        {
          name: 'Études et Développements',
          divisions: ['Pôle Web/Mobile', 'Pôle ERP', 'Assurance Qualité / Testing']
        },
        {
          name: 'Infrastructures & Réseaux',
          divisions: ['Sécurité Réseau', 'Support Technique', 'Systèmes Cloud']
        }
      ]
    },
    {
      direction: 'Direction des Moyens Généraux (DMG)',
      services: [
        {
          name: 'Logistique & Transports',
          divisions: ['Gestion du Parc Auto', 'Planification des Chauffeurs']
        },
        {
          name: 'Maintenance des Bâtiments',
          divisions: ['Fluides et Énergies', 'Second Œuvre & Rénovation', 'Espaces Verts']
        }
      ]
    }
  ];

  availableServices: any[] = [];
  availableDivisions: string[] = [];

  constructor(
    private fb: FormBuilder,
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

    // Initialisation du formulaire
    this.entreeForm = this.fb.group({
      prenom_visiteur: ['', Validators.required],
      nom_visiteur: ['', Validators.required],
      numero_cni: ['', [Validators.required, Validators.pattern('^[0-9a-zA-Z\\s-]{6,15}$')]],
      statut_visiteur: ['', Validators.required],
      but_visite: ['', Validators.required],
      direction: ['', Validators.required],
      service: [{ value: '', disabled: true }, Validators.required],
      division: [{ value: '', disabled: true }, Validators.required]
    });
  }

  ngAfterViewInit(): void {
    // Initialisation différée si l'agent active le scanner caméra
  }

  ngOnDestroy(): void {
    this.stopScanner();
  }

  get f() {
    return this.entreeForm.controls;
  }

  /**
   * Se déclenche lors du changement de Direction (Niveau 1)
   */
  onDirectionChange(): void {
    const dirVal = this.entreeForm.get('direction')?.value;
    if (dirVal) {
      const match = this.destinations.find(d => d.direction === dirVal);
      this.availableServices = match ? match.services : [];
      this.entreeForm.get('service')?.enable();
    } else {
      this.availableServices = [];
      this.entreeForm.get('service')?.disable();
    }
    
    // Reset les sous-niveaux
    this.entreeForm.get('service')?.setValue('');
    this.entreeForm.get('division')?.setValue('');
    this.entreeForm.get('division')?.disable();
    this.availableDivisions = [];
  }

  /**
   * Se déclenche lors du changement de Service (Niveau 2)
   */
  onServiceChange(): void {
    const srvVal = this.entreeForm.get('service')?.value;
    if (srvVal) {
      const match = this.availableServices.find(s => s.name === srvVal);
      this.availableDivisions = match ? match.divisions : [];
      this.entreeForm.get('division')?.enable();
    } else {
      this.availableDivisions = [];
      this.entreeForm.get('division')?.disable();
    }
    
    this.entreeForm.get('division')?.setValue('');
  }

  /**
   * Active la caméra pour scanner la pièce d'identité CNI
   */
  activerScannerCNI(): void {
    this.errorMessage = null;
    this.cameraPermissionError = false;
    this.scannerActive = true;

    // Laisser un court délai pour que le conteneur DOM soit injecté
    setTimeout(() => {
      try {
        this.html5Qrcode = new Html5Qrcode(this.READER_ELEMENT_ID);
        this.html5Qrcode.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: (width, height) => {
              // Cadre rectangulaire de type carte d'identité
              return { width: width * 0.85, height: height * 0.45 };
            }
          },
          (decodedText) => {
            // Dans ce module, on peut scanner soit un QR imprimé sur la carte, soit simuler l'OCR
            this.handleOcrSuccess(decodedText);
          },
          (error) => {
            // Analyse continue
          }
        ).catch((err) => {
          this.scannerActive = false;
          this.cameraPermissionError = true;
          this.errorMessage = 'Accès à la caméra refusé. Veuillez activer les permissions.';
        });
      } catch (e) {
        this.errorMessage = 'Impossible d\'initialiser le capteur vidéo.';
        this.scannerActive = false;
      }
    }, 100);
  }

  /**
   * Désactive le scanner caméra
   */
  annulerScanner(): void {
    this.stopScanner().then(() => {
      this.scannerActive = false;
    });
  }

  private stopScanner(): Promise<void> {
    if (this.html5Qrcode && this.html5Qrcode.isScanning) {
      return this.html5Qrcode.stop();
    }
    return Promise.resolve();
  }

  /**
   * Simule la capture instantanée de l'OCR de la pièce d'identité CNI
   */
  simulerCaptureCNI(): void {
    // Simuler des données sénégalaises typiques
    const prenomFictif = ['Moustapha', 'Awa', 'Ousmane', 'Mariama', 'Cheikh', 'Binetou'][Math.floor(Math.random() * 6)];
    const nomFictif = ['Diagne', 'Sall', 'Sow', 'Fall', 'Diallo', 'Gaye'][Math.floor(Math.random() * 6)];
    const numCniFictif = '1' + Math.floor(100000000 + Math.random() * 900000000).toString();

    this.stopScanner().then(() => {
      this.scannerActive = false;
      
      // Injection automatique ("Boum !")
      this.entreeForm.patchValue({
        prenom_visiteur: prenomFictif,
        nom_visiteur: nomFictif,
        numero_cni: numCniFictif
      });

      // Lancement de l'animation visuelle de remplissage "Boum !"
      this.ocrSuccessAnimation = true;
      setTimeout(() => {
        this.ocrSuccessAnimation = false;
      }, 1800);
    });
  }

  /**
   * Extraction des données CNI (si format texte décodé)
   */
  private handleOcrSuccess(text: string): void {
    // Si c'est un format de badge QR pré-configuré, on extrait les champs
    try {
      const data = JSON.parse(text);
      this.stopScanner().then(() => {
        this.scannerActive = false;
        this.entreeForm.patchValue({
          prenom_visiteur: data.prenom || data.prenom_visiteur || '',
          nom_visiteur: data.nom || data.nom_visiteur || '',
          numero_cni: data.cni || data.numero_cni || text
        });

        this.ocrSuccessAnimation = true;
        setTimeout(() => this.ocrSuccessAnimation = false, 1800);
      });
    } catch (e) {
      // Si c'est du texte simple (ex: numéro CNI seul), on remplit le numéro de CNI
      this.stopScanner().then(() => {
        this.scannerActive = false;
        this.entreeForm.patchValue({
          numero_cni: text.trim()
        });
        this.ocrSuccessAnimation = true;
        setTimeout(() => this.ocrSuccessAnimation = false, 1800);
      });
    }
  }

  /**
   * Valide le formulaire et enregistre le pointage d'entrée
   */
  onSubmit(): void {
    if (this.entreeForm.invalid) {
      this.entreeForm.markAllAsTouched();
      return;
    }

    this.loading = true;
    this.errorMessage = null;
    this.gpsAcquiring = true;

    // Étape 1 : Obtenir la géolocalisation et valider la présence géographique au Sénégal
    this.geolocationService.getCurrentPosition().pipe(
      timeout(6000)
    ).subscribe({
      next: (position) => {
        this.gpsAcquiring = false;
        
        const isInsideSenegal = this.geolocationService.isWithinAllowedRadius(position.latitude, position.longitude);

        if (!isInsideSenegal) {
          this.errorMessage = "Pointage impossible. Vous devez être géolocalisé au Sénégal pour enregistrer une visite.";
          this.loading = false;
          return;
        }

        // Étape 2 : Constituer l'objet Visite
        const agent = this.authService.getAgentProfile();
        const rawForm = this.entreeForm.getRawValue();

        const nouvelleVisite: Visite = {
          id_visiteur: rawForm.numero_cni, // Utiliser la CNI comme identifiant de visiteur
          prenom_visiteur: rawForm.prenom_visiteur,
          nom_visiteur: rawForm.nom_visiteur,
          numero_cni: rawForm.numero_cni,
          statut_visiteur: rawForm.statut_visiteur,
          but_visite: rawForm.but_visite,
          direction: rawForm.direction,
          service: rawForm.service,
          division: rawForm.division,
          date: new Date().toISOString().split('T')[0],
          heure_entree: new Date().toISOString(), // Horodatage automatique
          heure_sortie: null,
          duree_totale: null,
          gps_entree: { lat: position.latitude, lng: position.longitude },
          gps_sortie: null,
          statut: 'en_cours',
          id_agent: agent ? agent.id.toString() : '1'
        };

        // Étape 3 : Envoyer au backend/Firestore
        this.visiteService.createVisite(nouvelleVisite).subscribe({
          next: (visiteCreated) => {
            this.loading = false;
            this.successMessage = `L'entrée de ${visiteCreated.prenom_visiteur} ${visiteCreated.nom_visiteur} a été enregistrée avec succès.`;
            
            // Redirection après 2.2s vers l'accueil
            setTimeout(() => {
              this.router.navigate(['/home']);
            }, 2200);
          },
          error: (err) => {
            this.loading = false;
            this.errorMessage = `Impossible d'enregistrer la visite sur le serveur : ${err.message}`;
          }
        });
      },
      error: (err) => {
        this.gpsAcquiring = false;
        this.loading = false;
        this.gpsPermissionError = true;
        this.errorMessage = err.name === 'TimeoutError'
          ? "Le délai d'acquisition de la position GPS a expiré (6s). Veuillez actualiser ou activer votre GPS."
          : `Erreur d'acquisition de localisation : ${err.message}`;
      }
    });
  }
}
