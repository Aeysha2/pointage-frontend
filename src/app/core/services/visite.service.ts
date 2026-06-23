import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError, Subject, from, of } from 'rxjs';
import { catchError, map, switchMap, timeout } from 'rxjs/operators';
import { Visite } from '../models/visite.model';
import { FirebaseService } from './firebase.service';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';
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
  private readonly LOCAL_STORAGE_KEY = 'local_visites';

  constructor(
    private http: HttpClient,
    private firebaseService: FirebaseService,
    private authService: AuthService
  ) {
    this.initLocalStorage();
  }

  /**
   * Vérifie si les clés Firebase configurées dans l'environnement sont les clés fictives par défaut.
   * Si c'est le cas, l'application bascule automatiquement sur le mode hors-ligne sans tenter d'appels bloquants.
   */
  private isDemoKeys(): boolean {
    return !environment.firebase || environment.firebase.apiKey === 'VOTRE_API_KEY_FIREBASE';
  }

  /**
   * Initialise le cache local s'il n'existe pas encore.
   */
  private initLocalStorage(): void {
    if (!localStorage.getItem(this.LOCAL_STORAGE_KEY)) {
      const mockInitiales: Visite[] = [
        {
          id: 'visite_demo_1',
          id_visiteur: 'VIS-9921',
          nom_visiteur: 'Jean Dupont',
          date: new Date().toISOString().split('T')[0],
          heure_entree: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
          heure_sortie: null,
          duree_totale: null,
          direction: 'Direction Générale',
          service: 'Ressources Humaines',
          gps_entree: { lat: 14.7167, lng: -17.4677 }, // Dakar, Sénégal
          gps_sortie: null,
          statut: 'en_cours',
          id_agent: '1'
        }
      ];
      localStorage.setItem(this.LOCAL_STORAGE_KEY, JSON.stringify(mockInitiales));
    }
  }

  /**
   * Génère les en-têtes HTTP.
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
   * Ajout de timeouts RxJS de 2.5 secondes pour éviter le gel de la promesse Firestore.
   */
  createVisite(visite: Visite): Observable<Visite> {
    return this.http.post<any>(this.API_URL, visite, { headers: this.getHeaders() }).pipe(
      timeout(2500), // Si Laravel met plus de 2.5s à répondre, déclencher le catchError
      catchError((error) => {
        console.warn('Backend Laravel injoignable ou trop lent. Passage au niveau de secours...');

        // Si nous utilisons des clés de démonstration, bypass immédiat sans interroger Firestore
        if (this.isDemoKeys()) {
          console.log('[Mode Démo] Clés Firebase par défaut détectées. Sauvegarde locale directe.');
          return this.saveToLocalStorage(visite);
        }

        const db = this.firebaseService.getFirestore();
        if (!db) {
          return this.saveToLocalStorage(visite);
        }

        const visitesCollection = collection(db, 'visites');
        return from(addDoc(visitesCollection, visite)).pipe(
          timeout(2500), // Timeout sur Firestore en cas de droit refusé ou attente de connexion
          map((docRef) => ({ ...visite, id: docRef.id })),
          catchError((fsError) => {
            console.warn('Firestore inaccessible ou accès refusé. Sauvegarde en mémoire locale (LocalStorage)...');
            return this.saveToLocalStorage(visite);
          })
        );
      })
    );
  }

  /**
   * Clôture la visite d'un visiteur à la sortie.
   */
  closeVisite(idVisiteur: string, gpsSortie: { lat: number, lng: number }): Observable<any> {
    const payload = { gps_sortie: gpsSortie };
    
    return this.http.put<any>(`${this.API_URL}/${idVisiteur}/close`, payload, { headers: this.getHeaders() }).pipe(
      timeout(2500),
      catchError((error) => {
        console.warn('Backend Laravel injoignable ou trop lent. Passage à la clôture Firestore...');

        if (this.isDemoKeys()) {
          console.log('[Mode Démo] Clôture locale directe dans le LocalStorage.');
          return this.closeInLocalStorage(idVisiteur, gpsSortie);
        }

        const db = this.firebaseService.getFirestore();
        if (!db) {
          return this.closeInLocalStorage(idVisiteur, gpsSortie);
        }

        const visitesCollection = collection(db, 'visites');
        const q = query(visitesCollection, where('id_visiteur', '==', idVisiteur), where('statut', '==', 'en_cours'));

        return from(getDocs(q)).pipe(
          timeout(2500),
          switchMap((snapshot) => {
            if (snapshot.empty) {
              return this.closeInLocalStorage(idVisiteur, gpsSortie);
            }
            
            const docSnap = snapshot.docs[0];
            const docData = docSnap.data();
            const start = new Date(docData['heure_entree']).getTime();
            const now = Date.now();
            let dureeTotale = Math.round((now - start) / (60 * 1000));
            if (dureeTotale <= 0) dureeTotale = 1;

            const updatePromise = updateDoc(docSnap.ref, {
              heure_sortie: new Date().toISOString(),
              duree_totale: dureeTotale,
              gps_sortie: gpsSortie,
              statut: 'termine'
            });

            return from(updatePromise).pipe(
              timeout(2500),
              map(() => true),
              catchError(() => this.closeInLocalStorage(idVisiteur, gpsSortie))
            );
          }),
          catchError(() => this.closeInLocalStorage(idVisiteur, gpsSortie))
        );
      })
    );
  }

  /**
   * Écoute en temps réel les visites actives ("en_cours") pour l'agent connecté.
   */
  streamVisiteEnCours(agentId: string): Observable<Visite[]> {
    const visitesSubject = new Subject<Visite[]>();
    const db = this.firebaseService.getFirestore();
    
    const getLocalActiveVisites = (): Visite[] => {
      const localData = localStorage.getItem(this.LOCAL_STORAGE_KEY);
      if (localData) {
        const parsed: Visite[] = JSON.parse(localData);
        return parsed.filter(v => v.statut === 'en_cours' && v.id_agent === agentId);
      }
      return [];
    };

    // Si clés de démo ou Firestore non connecté, on utilise le mode hors-ligne direct
    if (!db || this.isDemoKeys()) {
      console.log('[Mode Démo] Utilisation exclusive du stockage LocalStorage.');
      setTimeout(() => {
        visitesSubject.next(getLocalActiveVisites());
      }, 100);
      return visitesSubject.asObservable();
    }

    const visitesCollection = collection(db, 'visites');
    const q = query(
      visitesCollection, 
      where('statut', '==', 'en_cours'),
      where('id_agent', '==', agentId)
    );

    const unsubscribe: Unsubscribe = onSnapshot(q, (snapshot) => {
      const dbVisites: Visite[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        dbVisites.push({
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

      const localVisites = getLocalActiveVisites();
      const fusion = [...dbVisites, ...localVisites];
      
      const unique = fusion.filter((v, index, self) =>
        index === self.findIndex((t) => t.id_visiteur === v.id_visiteur)
      );

      visitesSubject.next(unique);
    }, (error) => {
      console.warn('Flux Firestore interrompu ou bloqué. Utilisation exclusive du LocalStorage.');
      visitesSubject.next(getLocalActiveVisites());
    });

    return visitesSubject.asObservable();
  }

  /**
   * Récupère l'historique complet.
   */
  getHistorique(): Observable<Visite[]> {
    const getLocalFinishedVisites = (): Visite[] => {
      const localData = localStorage.getItem(this.LOCAL_STORAGE_KEY);
      return localData ? JSON.parse(localData).filter((v: Visite) => v.statut === 'termine') : [];
    };

    return this.http.get<any>(`${this.API_URL}/historique`, { headers: this.getHeaders() }).pipe(
      timeout(2500),
      catchError(() => {
        console.warn('Laravel hors ligne, bascule de l\'historique vers Firebase ou LocalStorage...');
        
        if (this.isDemoKeys()) {
          return of(getLocalFinishedVisites());
        }

        const db = this.firebaseService.getFirestore();
        if (!db) {
          return of(getLocalFinishedVisites());
        }

        const visitesCollection = collection(db, 'visites');
        const q = query(visitesCollection, where('statut', '==', 'termine'));

        return from(getDocs(q)).pipe(
          timeout(2500),
          map((snapshot) => {
            const dbVisites: Visite[] = [];
            snapshot.forEach((doc) => {
              const data = doc.data();
              dbVisites.push({
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
            
            const fusion = [...dbVisites, ...getLocalFinishedVisites()];
            return fusion.filter((v, index, self) =>
              index === self.findIndex((t) => t.id_visiteur === v.id_visiteur)
            );
          }),
          catchError(() => of(getLocalFinishedVisites()))
        );
      })
    );
  }

  private saveToLocalStorage(visite: Visite): Observable<Visite> {
    try {
      const localData = localStorage.getItem(this.LOCAL_STORAGE_KEY);
      const visites: Visite[] = localData ? JSON.parse(localData) : [];
      
      const nouvelleVisite = {
        ...visite,
        id: `local_${Date.now()}`
      };

      visites.push(nouvelleVisite);
      localStorage.setItem(this.LOCAL_STORAGE_KEY, JSON.stringify(visites));
      
      console.log('[LocalStorage] Enregistrement réussi :', nouvelleVisite);
      return of(nouvelleVisite);
    } catch (e) {
      return throwError(() => new Error('Échec du stockage local.'));
    }
  }

  private closeInLocalStorage(idVisiteur: string, gpsSortie: { lat: number, lng: number }): Observable<boolean> {
    try {
      const localData = localStorage.getItem(this.LOCAL_STORAGE_KEY);
      if (!localData) return of(false);

      const visites: Visite[] = JSON.parse(localData);
      const index = visites.findIndex(v => v.id_visiteur === idVisiteur && v.statut === 'en_cours');

      if (index !== -1) {
        const visite = visites[index];
        const start = new Date(visite.heure_entree).getTime();
        const now = Date.now();
        let dureeTotale = Math.round((now - start) / (60 * 1000));
        if (dureeTotale <= 0) dureeTotale = 1;

        visites[index] = {
          ...visite,
          heure_sortie: new Date().toISOString(),
          duree_totale: dureeTotale,
          gps_sortie: gpsSortie,
          statut: 'termine'
        };

        localStorage.setItem(this.LOCAL_STORAGE_KEY, JSON.stringify(visites));
        console.log('[LocalStorage] Clôture réussie de la visite :', visites[index]);
        return of(true);
      }
      return of(false);
    } catch (e) {
      return of(false);
    }
  }

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
