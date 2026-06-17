# PageLab V2 — build complet. Ce qu'il te reste à faire.

## ⚙️ À FAIRE AVANT/APRÈS PUSH (rapide)
1. **Push tout** (voir commandes plus bas)
2. **Lancer `db-migration-v2.sql`** dans Supabase (colonnes session + onboarding + stripe)
3. **Stripe** : crée le prix 19€ → copie le `price_...` → ajoute la variable Netlify `STRIPE_PRICE_ID`
   Vérifie aussi `STRIPE_SECRET_KEY` dans Netlify.
4. **Icônes PWA** : ajoute `logo-192.png` et `logo-512.png` dans `/public` (sinon PWA sans icône, pas bloquant)

## ✅ CE QUI EST CODÉ ET BRANCHÉ (réel via tes API)
- **Connexion** : code 6 chiffres + "rester connecté 90j" qui tient vraiment.
- **Marc** : lit tes VRAIES factures Stripe (à récupérer / récupéré / retards). → marc-data.js
- **Lucas** : VRAIE trésorerie Stripe (entrées du mois, solde, graphique 6 mois) + onglet Stock. → lucas-data.js
- **Léo** : génère un VRAI devis chiffré depuis une description (IA). → leo-generate.js
- **Emma** : envoie une VRAIE demande d'avis par email au client + génère le lien Google. → emma-review.js
  (Google Business non branché en lecture directe, comme convenu — l'envoi, lui, est réel.)
- **Baptiste** : chat branché sur baptiste-chat.js avec contexte réel (format {session, messages}).
- **Paiement** : stripe-checkout.js (abonnement + essai 14j) + bouton "Passer en illimité".
- **Honnêteté** : si une intégration n'est pas connectée, l'agent affiche un état vide (zéro fausse donnée).

## ✅ SEO
- sitemap.xml (toutes les pages) + robots.txt
- schema.org (SoftwareApplication + FAQPage) sur la landing → rich snippets Google
- meta + Open Graph sur les pages clés

## ✅ LANDING
- Compteurs de stats animés, fade-up au scroll, hover cartes
- Section FAQ (5 objections artisans)
- Tout en dark violet, mobile-first

## ✅ BLOG
- Page blog + 1 article complet rédigé (impayés) avec lien interne vers l'inscription
- (Les autres articles : titres prêts, à rédiger quand tu veux)

## 🔜 PLUS TARD (pas bloquant pour vendre)
- Webhook Stripe : vérifier qu'il met à jour subscription_status après paiement (metadata.userId)
- Synchro Google Business pour Emma (lecture des avis en direct)
- Suivi de stock automatique depuis les achats
- Rédiger les 2 autres articles de blog
