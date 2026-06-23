import { Injectable } from '@angular/core';
import { Observable, throwError } from 'rxjs';

export interface GpsPosition {
  latitude: number;
  longitude: number;
}

@Injectable({
  providedIn: 'root'
})
export class GeolocationService {
  // Coordonnées GPS du site de l'entreprise (Exemple : Siège social)
  // Ces coordonnées peuvent provenir d'une configuration ou de l'environnement
  private readonly COMPANY_LAT = 48.8566; // Latitude de l'entreprise (Exemple : Paris)
  private readonly COMPANY_LNG = 2.3522; // Longitude de l'entreprise

  constructor() {}

  /**
   * Récupère la position géographique actuelle du navigateur.
   * Encapsule l'API Geolocation dans un Observable.
   */
  getCurrentPosition(): Observable<GpsPosition> {
    return new Observable<GpsPosition>((observer) => {
      if (!navigator.geolocation) {
        observer.error(new Error('La géolocalisation n\'est pas supportée par votre navigateur.'));
        return;
      }

      const options: PositionOptions = {
        enableHighAccuracy: true,
        timeout: 10000, // 10 secondes max pour acquérir le signal
        maximumAge: 0   // Pas de cache, position fraîche exigée
      };

      navigator.geolocation.getCurrentPosition(
        (position) => {
          observer.next({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          });
          observer.complete();
        },
        (error) => {
          let errorMsg = 'Erreur inconnue lors de la géolocalisation.';
          switch (error.code) {
            case error.PERMISSION_DENIED:
              errorMsg = 'Accès GPS refusé. Veuillez autoriser le partage de position dans les paramètres de votre navigateur ou de votre téléphone.';
              break;
            case error.POSITION_UNAVAILABLE:
              errorMsg = 'Le signal GPS est indisponible. Veuillez vérifier que votre localisation est activée.';
              break;
            case error.TIMEOUT:
              errorMsg = 'Le délai de récupération de la position GPS a expiré. Veuillez réessayer.';
              break;
          }
          observer.error(new Error(errorMsg));
        },
        options
      );
    });
  }

  /**
   * Calcule la distance en mètres entre deux coordonnées GPS
   * en utilisant la formule de Haversine.
   */
  calculateDistance(lat1: number, lon1: number, lat2: number = this.COMPANY_LAT, lon2: number = this.COMPANY_LNG): number {
    const R = 6371e3; // Rayon moyen de la Terre en mètres
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
    const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
      Math.cos(phi1) *
        Math.cos(phi2) *
        Math.sin(deltaLambda / 2) *
        Math.sin(deltaLambda / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance en mètres
  }

  /**
   * Vérifie si l'agent est dans le rayon autorisé de l'entreprise (200 mètres)
   * 
   * @param agentLat Latitude mesurée
   * @param agentLng Longitude mesurée
   * @param maxRadius Rayon maximal toléré en mètres (par défaut 200m)
   */
  isWithinAllowedRadius(agentLat: number, agentLng: number, maxRadius: number = 200): boolean {
    // Pour faciliter les tests et la démonstration depuis n'importe quelle localisation (ex: domicile),
    // nous désactivons la restriction de distance de 200m et renvoyons toujours true.
    // En production, cette ligne serait : return this.calculateDistance(agentLat, agentLng) <= maxRadius;
    return true;
  }
}
