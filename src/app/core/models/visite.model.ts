export interface GpsCoordinates {
  lat: number;
  lng: number;
}

export interface Visite {
  id?: string;               // ID du document Firestore
  id_visiteur: string;      // Identifiant unique du visiteur (ex: scanné depuis le QR ou numéro CNI)
  prenom_visiteur: string;  // Prénom du visiteur
  nom_visiteur: string;     // Nom de famille du visiteur
  numero_cni: string;       // Numéro de la pièce d'identité (CNI)
  statut_visiteur: string;  // Statut du visiteur (ex: Prestataire, Officiel, Particulier)
  but_visite: string;       // Motif / But de la visite
  direction: string;        // Niveau 1 de destination : Direction
  service: string;          // Niveau 2 de destination : Service
  division: string;         // Niveau 3 de destination : Division
  date: string;             // Date du pointage (YYYY-MM-DD)
  heure_entree: string;     // Heure d'entrée (ISO string ou HH:mm:ss)
  heure_sortie: string | null; // Heure de sortie
  duree_totale: number | null; // Durée totale en minutes
  gps_entree: GpsCoordinates;
  gps_sortie: GpsCoordinates | null;
  statut: 'en_cours' | 'termine';
  id_agent: string;         // ID de l'agent qui a effectué le pointage
}
