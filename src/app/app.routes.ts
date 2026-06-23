import { Routes } from '@angular/router';
import { AuthGuard } from './core/guards/auth.guard';
import { LoginComponent } from './pages/login/login.component';
import { HomeComponent } from './pages/home/home.component';
import { ScanEntreeComponent } from './pages/scan-entree/scan-entree.component';
import { ScanSortieComponent } from './pages/scan-sortie/scan-sortie.component';
import { HistoriqueComponent } from './pages/historique/historique.component';

export const routes: Routes = [
  {
    path: 'login',
    component: LoginComponent,
    title: 'Connexion - Pointage Visiteurs'
  },
  {
    path: 'home',
    component: HomeComponent,
    canActivate: [AuthGuard],
    title: 'Accueil - Pointage Visiteurs'
  },
  {
    path: 'scan-entree',
    component: ScanEntreeComponent,
    canActivate: [AuthGuard],
    title: 'Scanner Entrée - Pointage Visiteurs'
  },
  {
    path: 'scan-sortie',
    component: ScanSortieComponent,
    canActivate: [AuthGuard],
    title: 'Scanner Sortie - Pointage Visiteurs'
  },
  {
    path: 'historique',
    component: HistoriqueComponent,
    canActivate: [AuthGuard],
    title: 'Historique - Pointage Visiteurs'
  },
  {
    path: '',
    redirectTo: 'home',
    pathMatch: 'full'
  },
  {
    path: '**',
    redirectTo: 'home'
  }
];
