export interface GpsCoordinates {
  lat: number;
  lng: number;
}

export interface Visite {
  id?: string;               // ID du document Firestore
  id_visiteur: string;      // Identifiant unique du visiteur (ex: scanné depuis le QR)
  nom_visiteur: string;     // Nom complet du visiteur
  date: string;             // Date du pointage (YYYY-MM-DD)
  heure_entree: string;     // Heure d'entrée (ISO string ou HH:mm:ss)
  heure_sortie: string | null; // Heure de sortie
  duree_totale: number | null; // Durée totale en minutes
  direction: string;        // Direction / Service visité
  service: string;          // Service visité
  gps_entree: GpsCoordinates;
  gps_sortie: GpsCoordinates | null;
  statut: 'en_cours' | 'termine';
  id_agent: string;         // ID de l'agent qui a effectué le pointage
}
