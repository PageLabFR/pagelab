/* ============================================================
   PageLab — helpers d'authentification (Supabase)
   Charger APRÈS le SDK supabase-js et après config.js :
     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
     <script src="config.js"></script>
     <script src="auth.js"></script>
   ============================================================ */
(function () {
  const cfg = window.PAGELAB_CONFIG || {};
  const configured =
    cfg.SUPABASE_URL &&
    !cfg.SUPABASE_URL.includes("VOTRE-PROJET") &&
    cfg.SUPABASE_ANON_KEY &&
    !cfg.SUPABASE_ANON_KEY.includes("VOTRE_CLE");

  window.PAGELAB_READY = configured;

  if (!configured) {
    console.warn("[PageLab] config.js non rempli — mets ton URL + clé anon Supabase.");
    return;
  }

  // Client unique partagé sur window.sb
  window.sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  // Redirige vers connexion.html si pas de session
  window.requireSession = async function (loginPage) {
    loginPage = loginPage || "connexion.html";
    const { data } = await window.sb.auth.getSession();
    if (!data.session) {
      location.replace(loginPage);
      return null;
    }
    return data.session;
  };

  // Déconnexion
  window.signOut = async function (toPage) {
    await window.sb.auth.signOut();
    location.replace(toPage || "connexion.html");
  };
})();
