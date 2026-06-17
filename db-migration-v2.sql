-- ════════════════════════════════════════════════════════════
-- PageLab V2 — migration auth par code + onboarding
-- À lancer dans Supabase (SQL Editor) AVANT de tester la connexion.
-- ════════════════════════════════════════════════════════════

-- 1) Colonnes de session sur la table users (connexion par code 6 chiffres)
alter table public.users add column if not exists session_token   text;
alter table public.users add column if not exists session_expires timestamptz;

-- 2) Colonnes d'onboarding (si pas déjà présentes)
alter table public.users add column if not exists prenom text;
alter table public.users add column if not exists metier text;
alter table public.users add column if not exists ville  text;

-- 3) Index pour retrouver vite une session
create index if not exists idx_users_session_token on public.users (session_token);

-- 4) La table magic_links est réutilisée pour stocker les codes à 6 chiffres
--    (colonnes attendues : email text, token text, expires_at timestamptz, used bool, created_at timestamptz default now())
--    Si created_at n'existe pas :
alter table public.magic_links add column if not exists created_at timestamptz default now();

-- Vérif rapide
-- select column_name from information_schema.columns where table_name='users';

-- ════════════════════════════════════════════════════════════
-- AJOUT (paiement Stripe) — à lancer aussi
-- ════════════════════════════════════════════════════════════
alter table public.users add column if not exists stripe_customer_id text;
alter table public.users add column if not exists subscription_status text default 'trial';
