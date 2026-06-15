# PageLab V2 — Guide de déploiement

## 📦 Contenu
Refonte complète orientée artisans du bâtiment : landing, app (connexion + dashboard hybride + 4 agents), pages légales, blog, conformité 2026.

## ✅ AVANT DE PUSH — checklist

### 1. Compléter l'adresse légale
Dans `mentions-legales.html`, remplace le dernier `[À COMPLÉTER : adresse du siège]` par ton adresse.

### 2. Lancer le SQL dans Supabase
Ouvre le SQL Editor de Supabase et exécute `db-migration-v2.sql`.
(Ajoute les colonnes session + onboarding. Sans ça, la connexion ne marche pas.)

### 3. Icônes PWA (optionnel mais propre)
Ajoute `logo-192.png` et `logo-512.png` dans `/public/` (sinon le manifest ignore les icônes, pas bloquant).

### 4. Variables d'environnement Netlify (déjà en place normalement)
Vérifie que tu as bien : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, ANTHROPIC_API_KEY, ENCRYPTION_KEY.

## 🗂 Où mettre les fichiers
- Les `.html`, `.css`, `.json` → à la racine du repo (remplacent les anciens)
- Les fichiers de `functions/` → dans `netlify/functions/` (AJOUTENT aux tiens, n'écrasent rien d'important : auth-send-code, auth-verify-code, dashboard-data, contact sont nouveaux)
- ⚠️ Garde tes fonctions agents existantes (agent-marc, baptiste-chat, actions-approve, etc.) : la V2 s'appuie dessus.

## 🔗 Comment tout s'enchaîne
1. Visiteur → `index.html` (landing) → clique "Tester" → `connexion.html`
2. `connexion.html` → code 6 chiffres (auth-send-code + auth-verify-code) → stocke `pl_session`
3. Redirige vers `dashboard.html` (onboarding au 1er passage) 
4. Dashboard charge les vraies données via `dashboard-data.js`
5. Le gros bouton "Valider" liste les vraies `pending_actions` et les exécute via `actions-approve.js`
6. Le chat Baptiste tape dans `baptiste-chat.js`

## 🧪 Tester l'UI sans backend
Ouvre `dashboard.html?demo=1` : affiche l'interface avec les données d'exemple, sans connexion.

## 🔜 Reste à faire (prochaine étape)
Les ateliers d'agents (Marc/Léo/Lucas/Emma) affichent des données d'EXEMPLE.
Prochaine session : brancher chaque atelier sur les vraies données Supabase
(factures réelles de l'artisan, vrais devis, etc.) — agent par agent, en commençant par Marc.
