-- =============================================================
-- PageLab — schéma Supabase (multi-tenant)
-- À coller dans Supabase > SQL Editor > New query > Run.
-- Idempotent autant que possible : réexécutable sans tout casser.
-- =============================================================

-- Extensions utiles -------------------------------------------------
create extension if not exists "pgcrypto";  -- gen_random_uuid()

-- =============================================================
-- 1. ACCOUNTS — 1 ligne par artisan (1:1 avec l'utilisateur Auth)
-- =============================================================
create table if not exists public.accounts (
  id                 uuid primary key references auth.users(id) on delete cascade,
  nom_entreprise     text,
  metier             text,            -- 'plombier', 'electricien'...
  telephone          text,
  ville              text,
  -- Relation 1 : VOTRE Stripe encaisse l'abonnement de l'artisan
  stripe_customer_id text,
  -- Relation 2 : SON Stripe à lui (Stripe Connect) encaisse ses clients
  stripe_connect_id  text,
  onboarding_status  text not null default 'nouveau',  -- nouveau | en_config | actif
  created_at         timestamptz not null default now()
);

-- =============================================================
-- 2. AGENTS — catalogue global des types d'agents (pas multi-tenant)
-- =============================================================
create table if not exists public.agents (
  code            text primary key,   -- 'relance', 'devis', 'avis'...
  nom             text not null,      -- 'Marc'
  titre           text not null,      -- 'Relance des impayés'
  description     text,
  prix_mensuel    int  not null default 0,  -- en centimes (2900 = 29 €)
  frais_install   int  not null default 4000,
  statut          text not null default 'disponible',  -- disponible | bientot
  config_default  jsonb not null default '{}'::jsonb,   -- gabarit de config copié à la commande
  actif_catalogue boolean not null default true,
  created_at      timestamptz not null default now()
);

-- =============================================================
-- 3. ACCOUNT_AGENTS — quel artisan a quel agent (config + activation)
--    C'est le cœur de la scalabilité : 1 config par artisan, pas 1 code.
-- =============================================================
create table if not exists public.account_agents (
  id                          uuid primary key default gen_random_uuid(),
  account_id                  uuid not null references public.accounts(id) on delete cascade,
  agent_code                  text not null references public.agents(code),
  active                      boolean not null default false,  -- piloté par le webhook Stripe
  config                      jsonb   not null default '{}'::jsonb,  -- tarifs, ton, délais...
  stripe_subscription_item_id text,
  created_at                  timestamptz not null default now(),
  unique (account_id, agent_code)
);

-- =============================================================
-- 4. CLIENTS — les clients de l'artisan
-- =============================================================
create table if not exists public.clients (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  nom        text,
  email      text,
  telephone  text,
  created_at timestamptz not null default now()
);

-- =============================================================
-- 5. FACTURES
-- =============================================================
create table if not exists public.factures (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts(id) on delete cascade,
  client_id    uuid references public.clients(id) on delete set null,
  numero       text,
  montant_cents int not null default 0,
  echeance     date,
  statut       text not null default 'impayee',  -- impayee | payee | annulee
  source       text not null default 'stripe',   -- stripe | manuel
  stripe_invoice_id text,                         -- id de la facture côté Stripe (Connect)
  created_at   timestamptz not null default now()
);

-- =============================================================
-- 6. AGENT_ACTIONS — actions préparées en attente de validation
--    (le human-in-the-loop : l'agent propose, l'artisan valide)
-- =============================================================
create table if not exists public.agent_actions (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts(id) on delete cascade,
  agent_code   text not null references public.agents(code),
  type         text not null,                       -- 'relance_sms', 'devis'...
  statut       text not null default 'en_attente',  -- en_attente | validee | envoyee | ignoree
  payload      jsonb not null default '{}'::jsonb,  -- message rédigé, cible, montant...
  facture_id   uuid references public.factures(id) on delete set null,
  created_at   timestamptz not null default now(),
  validated_at timestamptz
);

-- =============================================================
-- 7. AGENT_REQUESTS — demandes de mise en place d'un agent
-- =============================================================
create table if not exists public.agent_requests (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  agent_code text references public.agents(code),
  message    text,
  statut     text not null default 'recue',  -- recue | en_cours | installee
  created_at timestamptz not null default now()
);

-- Index pour les requêtes fréquentes
create index if not exists idx_account_agents_acct on public.account_agents(account_id);
create index if not exists idx_actions_acct_statut on public.agent_actions(account_id, statut);
create index if not exists idx_factures_acct_statut on public.factures(account_id, statut);

-- =============================================================
-- ROW LEVEL SECURITY
-- Règle d'or : un artisan ne voit QUE ses lignes (account_id = auth.uid()).
-- Le backend (Edge Function avec la service_role key) contourne RLS
-- pour insérer les actions préparées.
-- =============================================================
alter table public.accounts        enable row level security;
alter table public.agents          enable row level security;
alter table public.account_agents  enable row level security;
alter table public.clients         enable row level security;
alter table public.factures        enable row level security;
alter table public.agent_actions   enable row level security;
alter table public.agent_requests  enable row level security;

-- accounts : chacun son propre compte
drop policy if exists "own account" on public.accounts;
create policy "own account" on public.accounts
  for all using (id = auth.uid()) with check (id = auth.uid());

-- agents : catalogue en lecture pour tout utilisateur connecté
drop policy if exists "read catalog" on public.agents;
create policy "read catalog" on public.agents
  for select to authenticated using (true);

-- Helper : applique la même politique "mes lignes" à une table tenant
-- (écrit en clair table par table pour rester lisible)

drop policy if exists "own rows" on public.account_agents;
create policy "own rows" on public.account_agents
  for all using (account_id = auth.uid()) with check (account_id = auth.uid());

drop policy if exists "own rows" on public.clients;
create policy "own rows" on public.clients
  for all using (account_id = auth.uid()) with check (account_id = auth.uid());

drop policy if exists "own rows" on public.factures;
create policy "own rows" on public.factures
  for all using (account_id = auth.uid()) with check (account_id = auth.uid());

drop policy if exists "own rows" on public.agent_actions;
create policy "own rows" on public.agent_actions
  for all using (account_id = auth.uid()) with check (account_id = auth.uid());

drop policy if exists "own rows" on public.agent_requests;
create policy "own rows" on public.agent_requests
  for all using (account_id = auth.uid()) with check (account_id = auth.uid());

-- =============================================================
-- TRIGGER : créer un account automatiquement à l'inscription
-- =============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.accounts (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================
-- SEED : catalogue d'agents (prix en centimes)
-- Scope actuel : seul Marc est commandable ('disponible').
-- Devis et Avis sont affichés en 'bientot' (vitrine + roadmap).
-- =============================================================
insert into public.agents (code, nom, titre, description, prix_mensuel, frais_install, statut, config_default) values
  ('relance', 'Marc', 'Relance des impayés', 'Branché sur votre Stripe : repère les factures en retard et prépare les relances.', 2900, 4000, 'disponible',
    '{
       "source": "stripe",
       "ton": "courtois",
       "delais_jours": [7, 21, 45],
       "canal": "sms",
       "validation_obligatoire": true
     }'::jsonb),
  ('devis', 'Léo', 'Devis & factures', 'Rédige vos devis depuis une photo ou une note vocale.', 3900, 4000, 'bientot', '{}'::jsonb),
  ('avis',  'Emma','Avis Google',      'Demande un avis au bon moment, après chantier.',         1900, 4000, 'bientot', '{}'::jsonb)
on conflict (code) do update set
  nom = excluded.nom, titre = excluded.titre, description = excluded.description,
  prix_mensuel = excluded.prix_mensuel, frais_install = excluded.frais_install,
  statut = excluded.statut, config_default = excluded.config_default;

-- Nettoie d'éventuels agents hors scope d'une exécution précédente
delete from public.agents where code in ('treso', 'conformite');

-- Fin du schéma.
