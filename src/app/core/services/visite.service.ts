import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError, Subject, from } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { Visite } from '../models/visite.model';
import { FirebaseService } from './firebase.service';
import { AuthService } from './auth.service';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  Unsubscribe, 
  DocumentData, 
  QuerySnapshot,
  addDoc,
  updateDoc,
  getDocs
} from 'firebase/firestore';

@Injectable({
  providedIn: 'root'
})
export class VisiteService {
  private readonly API_URL = 'http://localhost:8000/api/visites';

  constructor(
    private http: HttpClient,
    private firebaseService: FirebaseService,
    private authService: AuthService
  ) {}

  /**
   * Génère les en-têtes HTTP avec le JWT.
   */
  private getHeaders(): HttpHeaders {
    const token = this.authService.getToken();
    return new HttpHeaders({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    });
  }

  /**
   * Enregistre l'entrée d'un nouveau visiteur.
   * Si le serveur Laravel (localhost:8000) est injoignable (ex: sur mobile),
   * le service bascule automatiquement en mode "direct Firestore" pour enregistrer la visite.
   */
  createVisite(visite: Visite): Observable<Visite> {
    return this.http.post<any>(this.API_URL, visite, { headers: this.getHeaders() }).pipe(
      catchError((error: HttpErrorResponse) => {
        // Code 0 = Erreur réseau (serveur Laravel injoignable)
        if (error.status === 0) {
          console.warn('Backend Laravel inaccessible. Enregistrement direct dans Firestore (Mode autonome)...');
          
          const db = this.firebaseService.getFirestore();
          if (!db) {
            return throwError(() => new Error('Impossible d\'enregistrer le pointage : aucun serveur ni base Firestore disponible.'));
          }

          const visitesCollection = collection(db, 'visites');
          
          // Conversion de la promesse Firestore en Observable RxJS
          return from(addDoc(visitesCollection, visite)).pipe(
            map((docRef) => ({
              ...visite,
              id: docRef.id
            }))
          );
        }
        return this.handleError(error);
      })
    );
  }

  /**
   * Clôture la visite d'un visiteur.
   * Si le serveur Laravel est injoignable, clôture directement le document dans Firestore
   * et calcule la durée en minutes côté client.
   */
  closeVisite(idVisiteur: string, gpsSortie: { lat: number, lng: number }): Observable<any> {
    const payload = { gps_sortie: gpsSortie };
    
    return this.http.put<any>(`${this.API_URL}/${idVisiteur}/close`, payload, { headers: this.getHeaders() }).pipe(
      catchError((error: HttpErrorResponse) => {
        if (error.status === 0) {
          console.warn('Backend Laravel inaccessible. Clôture directe dans Firestore (Mode autonome)...');
          
          const db = this.firebaseService.getFirestore();
          if (!db) {
            return throwError(() => new Error('Base de données Firestore inaccessible.'));
          }

          const visitesCollection = collection(db, 'visites');
          // Recherche du document "en_cours" correspondant au visiteur
          const q = query(
            visitesCollection,
            where('id_visiteur', '==', idVisiteur),
            where('statut', '==', 'en_cours')
          );

          return from(getDocs(q)).pipe(
            switchMap((snapshot) => {
              if (snapshot.empty) {
                return throwError(() => new Error('Aucune visite en cours n\'a été trouvée pour ce visiteur.'));
              }
              
              const docSnap = snapshot.docs[0];
              const docData = docSnap.data();
              
              // Calcul de la durée écoulée en minutes
              const start = new Date(docData['heure_entree']).getTime();
              const now = Date.now();
              let dureeTotale = Math.round((now - start) / (60 * 1000));
              if (dureeTotale <= 0) dureeTotale = 1; // Arrondi à 1 min minimum

              // Mise à jour du statut dans Firestore
              const updatePromise = updateDoc(docSnap.ref, {
                heure_sortie: new Date().toISOString(),
                duree_totale: dureeTotale,
                gps_sortie: gpsSortie,
                statut: 'termine'
              });

              return from(updatePromise).pipe(
                map(() => true)
              );
            })
          );
        }
        return this.handleError(error);
      })
    );
  }

  /**
   * Écoute en temps réel les visites actives ("en_cours") pour l'agent connecté.
   */
  streamVisiteEnCours(agentId: string): Observable<Visite[]> {
    const visitesSubject = new Subject<Visite[]>();
    const db = this.firebaseService.getFirestore();
    
    if (!db) {
      console.warn('Base de données Firestore non disponible, retour d\'un flux vide.');
      return visitesSubject.asObservable();
    }

    const visitesCollection = collection(db, 'visites');
    const q = query(
      visitesCollection, 
      where('statut', '==', 'en_cours'),
      where('id_agent', '==', agentId)
    );

    const unsubscribe: Unsubscribe = onSnapshot(q, { includeMetadataChanges: true }, (snapshot: QuerySnapshot<DocumentData>) => {
      const visites: Visite[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        visites.push({
          id: doc.id,
          id_visiteur: data['id_visiteur'],
          nom_visiteur: data['nom_visiteur'],
          date: data['date'],
          heure_entree: data['heure_entree'],
          heure_sortie: data['heure_sortie'],
          duree_totale: data['duree_totale'],
          direction: data['direction'],
          service: data['service'],
          gps_entree: data['gps_entree'],
          gps_sortie: data['gps_sortie'],
          statut: data['statut'],
          id_agent: data['id_agent']
        });
      });

      const fromCache = snapshot.metadata.fromCache ? "CACHE" : "SERVEUR";
      console.log(`[Firestore] Données reçues du ${fromCache} (Nb: ${visites.length})`);

      visitesSubject.next(visites);
    }, (error) => {
      console.error('Erreur de flux Firestore temps réel :', error);
      visitesSubject.error(error);
    });

    return visitesSubject.asObservable();
  }

  /**
   * Récupère l'historique complet des visites fermées.
   * Si le serveur Laravel est injoignable, effectue une lecture directe sur Firestore.
   */
  getHistorique(): Observable<Visite[]> {
    return this.http.get<any>(`${this.API_URL}/historique`, { headers: this.getHeaders() }).pipe(
      catchError((error: HttpErrorResponse) => {
        if (error.status === 0) {
          console.warn('Backend Laravel inaccessible. Lecture directe de l\'historique sur Firestore...');
          
          const db = this.firebaseService.getFirestore();
          if (!db) {
            return throwError(() => new Error('Base de données Firestore inaccessible.'));
          }

          const visitesCollection = collection(db, 'visites');
          const q = query(visitesCollection, where('statut', '==', 'termine'));

          return from(getDocs(q)).pipe(
            map((snapshot) => {
              const visites: Visite[] = [];
              snapshot.forEach((doc) => {
                const data = doc.data();
                visites.push({
                  id: doc.id,
                  id_visiteur: data['id_visiteur'],
                  nom_visiteur: data['nom_visiteur'],
                  date: data['date'],
                  heure_entree: data['heure_entree'],
                  heure_sortie: data['heure_sortie'],
                  duree_totale: data['duree_totale'],
                  direction: data['direction'],
                  service: data['service'],
                  gps_entree: data['gps_entree'],
                  gps_sortie: data['gps_sortie'],
                  statut: data['statut'],
                  id_agent: data['id_agent']
                });
              });
              return visites;
            })
          );
        }
        return this.handleError(error);
      })
    );
  }

  /**
   * Centralisation des erreurs.
   */
  private handleError(error: HttpErrorResponse): Observable<never> {
    let errorMessage = 'Une erreur s\'est produite.';
    if (error.error instanceof ErrorEvent) {
      errorMessage = error.error.message;
    } else {
      errorMessage = error.error?.message || `Erreur serveur (Code ${error.status})`;
    }
    return throwError(() => new Error(errorMessage));
  }
}
