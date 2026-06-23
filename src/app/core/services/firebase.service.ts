import { Injectable } from '@angular/core';
import { initializeApp, getApp, getApps, FirebaseApp } from 'firebase/app';
import { Firestore, getFirestore, enableIndexedDbPersistence } from 'firebase/firestore';
import { Auth, getAuth } from 'firebase/auth';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class FirebaseService {
  private firebaseApp!: FirebaseApp;
  private firestoreInstance!: Firestore;
  private authInstance!: Auth;

  constructor() {
    this.initFirebase();
  }

  /**
   * Initialise l'application Firebase et configure la persistence Firestore locale
   * pour le mode hors-ligne (Cas Limite : pas d'internet -> cache local + sync).
   */
  public initFirebase(): void {
    try {
      // 1. Initialisation de l'application Firebase (évite les doubles initialisations)
      if (getApps().length === 0) {
        this.firebaseApp = initializeApp(environment.firebase);
      } else {
        this.firebaseApp = getApp();
      }

      // 2. Initialisation des services Firebase
      this.firestoreInstance = getFirestore(this.firebaseApp);
      this.authInstance = getAuth(this.firebaseApp);

      // 3. Activation de la persistance hors-ligne Firestore dans le navigateur (IndexedDB)
      enableIndexedDbPersistence(this.firestoreInstance).catch((err) => {
        if (err.code === 'failed-precondition') {
          // Plusieurs onglets ouverts simultanément, la persistance ne peut être activée que sur un onglet.
          console.warn('La persistance Firestore a échoué : plusieurs onglets ouverts.');
        } else if (err.code === 'unimplemented') {
          // Le navigateur actuel ne supporte pas IndexedDB
          console.warn('La persistance Firestore n\'est pas supportée par ce navigateur.');
        }
      });

    } catch (error) {
      console.error('Erreur critique lors de l\'initialisation de Firebase :', error);
    }
  }

  /**
   * Retourne l'instance de Cloud Firestore
   */
  public getFirestore(): Firestore {
    return this.firestoreInstance;
  }

  /**
   * Retourne l'instance de Firebase Authentication
   */
  public getAuth(): Auth {
    return this.authInstance;
  }
}
