<?php
if (!defined('ABSPATH')) { exit; }

final class FKC_Core {
    private static $instance = null;
    private $permissions = array(
        'sales.read'=>'Consulter les ventes','sales.create'=>'Créer des ventes','sales.cancel'=>'Annuler des ventes',
        'stock.read'=>'Consulter le stock','stock.manage'=>'Gérer le stock','purchases.read'=>'Consulter les achats',
        'purchases.create'=>'Créer des achats','debts.read'=>'Consulter les dettes','debts.pay'=>'Enregistrer les paiements de dettes',
        'expenses.read'=>'Consulter les dépenses','expenses.create'=>'Créer des dépenses','customers.read'=>'Consulter les clients',
        'customers.manage'=>'Gérer les clients','suppliers.read'=>'Consulter les fournisseurs','suppliers.manage'=>'Gérer les fournisseurs',
        'cashbox.manage'=>'Gérer la caisse','reports.read'=>'Consulter les rapports','audit.read'=>'Consulter le journal d’audit',
        'branch.settings'=>'Gérer les paramètres d’établissement','members.manage'=>'Gérer les membres'
    );
    private $role_defaults = array(
        'OWNER' => array('sales.read','sales.create','sales.cancel','stock.read','stock.manage','purchases.read','purchases.create','debts.read','debts.pay','expenses.read','expenses.create','customers.read','customers.manage','suppliers.read','suppliers.manage','cashbox.manage','reports.read','audit.read','branch.settings','members.manage'),
        'ADMIN' => array('sales.read','sales.create','sales.cancel','stock.read','stock.manage','purchases.read','purchases.create','debts.read','debts.pay','expenses.read','expenses.create','customers.read','customers.manage','suppliers.read','suppliers.manage','cashbox.manage','reports.read','audit.read','branch.settings','members.manage'),
        'MANAGER' => array('sales.read','sales.create','sales.cancel','stock.read','stock.manage','purchases.read','purchases.create','debts.read','debts.pay','expenses.read','expenses.create','customers.read','customers.manage','suppliers.read','suppliers.manage','cashbox.manage','reports.read'),
        'CASHIER' => array('sales.read','sales.create','stock.read','customers.read','debts.read','debts.pay','cashbox.manage')
    );
    private $role_rank = array('OWNER'=>4,'ADMIN'=>3,'MANAGER'=>2,'CASHIER'=>1);
    public static function instance() { if (self::$instance === null) self::$instance = new self(); return self::$instance; }
    private function __construct() {
        add_action('admin_menu', array($this,'admin_menu'));
        add_action('admin_post_fkc_create_first_owner', array($this,'handle_first_owner'));
        add_action('admin_post_fkc_reset_owner_password', array($this,'handle_reset_owner_password'));
        add_action('rest_api_init', array($this,'register_routes'));
        add_action('init', array($this,'ensure_sessions_table'), 1);
        add_filter('allowed_http_origins', array($this,'allowed_origins'));
    }
    private function table($suffix) { return 'bta_' . $suffix; }
    private function required_tables() { return array('users','tenants','branches','members','permissions','branch_access','invitations','audit_logs'); }
    private function table_status() {
        global $wpdb; $out=array();
        foreach ($this->required_tables() as $suffix) { $name=$this->table($suffix); $found=$wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s',$wpdb->esc_like($name))); $out[$name]=($found===$name); }
        return $out;
    }
    private function tables_ready() { return !in_array(false,$this->table_status(),true); }
    private function owner_exists() { global $wpdb; return (bool)$wpdb->get_var("SELECT id FROM {$this->table('users')} LIMIT 1"); }
    public function ensure_sessions_table() {
        global $wpdb;
        if (!$this->tables_ready()) return;
        $table=$this->table('sessions'); $charset=$wpdb->get_charset_collate();
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $sql="CREATE TABLE {$table} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id BIGINT UNSIGNED NOT NULL,
            token_hash CHAR(64) NOT NULL,
            expires_at DATETIME NOT NULL,
            last_used_at DATETIME NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            ip_address VARCHAR(45) NULL,
            user_agent VARCHAR(255) NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY token_hash (token_hash),
            KEY user_id (user_id),
            KEY expires_at (expires_at)
        ) {$charset};";
        dbDelta($sql);
    }
    public function allowed_origins($origins) {
        $safe=array('capacitor://localhost','http://localhost','https://localhost','http://127.0.0.1','https://fondationkenda.com','https://www.fondationkenda.com');
        return array_values(array_unique(array_merge($origins,$safe)));
    }
    public function admin_menu() {
        add_menu_page('Fondation Kenda Core','Fondation Kenda Core','manage_options','fondation-kenda-core',array($this,'render_admin_page'),'dashicons-shield-alt',58);
        add_submenu_page('fondation-kenda-core','Tableau de bord du stock','Tableau de bord stock','manage_options','fkc-stock-dashboard',array($this,'render_stock_dashboard_page'));
        add_submenu_page('fondation-kenda-core','Historique des conflits de stock','Conflits de stock','manage_options','fkc-stock-conflicts',array($this,'render_stock_conflicts_page'));
    }
    public function render_admin_page() {
        if (!current_user_can('manage_options')) wp_die('Accès non autorisé.');
        $tables=$this->table_status(); $ready=$this->tables_ready(); $owner=$ready?$this->owner_exists():false;
        $notice=isset($_GET['fkc_notice'])?sanitize_key(wp_unslash($_GET['fkc_notice'])):'';
        ?>
        <div class="wrap"><h1>Fondation Kenda Core</h1><p>Version <?php echo esc_html(FKC_VERSION); ?> — backend BTA Manager.</p>
        <?php if($notice==='created'): ?><div class="notice notice-success"><p>Premier propriétaire BTA créé. Initialisation verrouillée.</p></div><?php elseif($notice==='error'): ?><div class="notice notice-error"><p>La création a échoué. Vérifiez les champs et les journaux serveur.</p></div><?php elseif($notice==='password_reset'): ?><div class="notice notice-success"><p>Le mot de passe du propriétaire a été réinitialisé. Toutes les anciennes sessions BTA ont été révoquées.</p></div><?php elseif($notice==='password_error'): ?><div class="notice notice-error"><p>Réinitialisation impossible. Vérifiez les champs et réessayez.</p></div><?php endif; ?>
        <h2>État de la base de données</h2><table class="widefat striped" style="max-width:760px"><thead><tr><th>Table</th><th>État</th></tr></thead><tbody>
        <?php foreach($tables as $name=>$exists): ?><tr><td><code><?php echo esc_html($name); ?></code></td><td><?php echo $exists?'<span style="color:green">Présente</span>':'<span style="color:#b32d2e">Absente</span>'; ?></td></tr><?php endforeach; ?>
        <tr><td><code>bta_sessions</code></td><td><?php echo $this->sessions_table_exists()?'<span style="color:green">Présente</span>':'<span style="color:#b32d2e">En attente</span>'; ?></td></tr>
        </tbody></table><h2>Initialisation du premier propriétaire BTA</h2>
        <?php if(!$ready): ?><p>Les tables BTA doivent être présentes.</p><?php elseif($owner): ?>
        <p><strong>Initialisation terminée.</strong> Un compte BTA existe déjà.</p>
        <h2>Réinitialiser le mot de passe du propriétaire</h2>
        <p>Cette opération modifie uniquement le mot de passe du compte OWNER. Les anciennes sessions BTA seront révoquées. Les données, entreprises et membres ne seront pas supprimés.</p>
        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
        <input type="hidden" name="action" value="fkc_reset_owner_password"><?php wp_nonce_field('fkc_reset_owner_password','fkc_reset_nonce'); ?>
        <table class="form-table">
        <tr><th><label for="fkc_new_password">Nouveau mot de passe</label></th><td><input required minlength="12" maxlength="4096" type="password" autocomplete="new-password" class="regular-text" id="fkc_new_password" name="new_password"><p class="description">12 caractères minimum. Ne le partagez jamais dans une conversation ou une commande.</p></td></tr>
        <tr><th><label for="fkc_new_password_confirm">Confirmer le mot de passe</label></th><td><input required minlength="12" maxlength="4096" type="password" autocomplete="new-password" class="regular-text" id="fkc_new_password_confirm" name="new_password_confirm"></td></tr>
        </table><?php submit_button('Réinitialiser le mot de passe OWNER','primary','submit',true,array('onclick'=>"return confirm('Confirmer la réinitialisation et la révocation des sessions BTA ?');")); ?>
        </form>
        <?php else: ?>
        <p>Crée le premier compte OWNER et l'entreprise principale. Réservé aux administrateurs WordPress.</p>
        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>"><input type="hidden" name="action" value="fkc_create_first_owner"><?php wp_nonce_field('fkc_create_first_owner','fkc_nonce'); ?>
        <table class="form-table">
        <tr><th><label for="fkc_full_name">Nom complet</label></th><td><input required minlength="2" maxlength="150" class="regular-text" id="fkc_full_name" name="full_name"></td></tr>
        <tr><th><label for="fkc_email">Adresse e-mail</label></th><td><input required type="email" maxlength="190" class="regular-text" id="fkc_email" name="email"></td></tr>
        <tr><th><label for="fkc_password">Mot de passe</label></th><td><input required minlength="12" type="password" class="regular-text" id="fkc_password" name="password"></td></tr>
        <tr><th><label for="fkc_password_confirm">Confirmer</label></th><td><input required minlength="12" type="password" class="regular-text" id="fkc_password_confirm" name="password_confirm"></td></tr>
        <tr><th><label for="fkc_company">Entreprise</label></th><td><input required minlength="2" maxlength="100" class="regular-text" id="fkc_company" name="company_name"></td></tr>
        <tr><th><label for="fkc_branch">Établissement principal</label></th><td><input required minlength="2" maxlength="100" class="regular-text" id="fkc_branch" name="branch_name" value="Établissement principal"></td></tr>
        </table><?php submit_button('Créer le premier propriétaire BTA'); ?></form><?php endif; ?>
        <h2>API BTA</h2><p><a href="<?php echo esc_url(rest_url('bta/v1/health')); ?>" target="_blank" rel="noopener">Vérifier le service</a></p></div><?php
    }
    public function render_stock_dashboard_page() {
        if (!current_user_can('manage_options')) wp_die('Accès non autorisé.');
        global $wpdb;
        $prefix=$wpdb->prefix.'bta_';
        $tables=array('products','stock','stock_movements','stock_transfers');
        $missing=array();
        foreach($tables as $name){$full=$prefix.$name;if($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s',$wpdb->esc_like($full)))!==$full){$missing[]=$full;}}
        $core_branches=$this->table('branches');
        if($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s',$wpdb->esc_like($core_branches)))!==$core_branches){$missing[]=$core_branches;}
        if($missing){echo '<div class="wrap"><h1>Tableau de bord du stock</h1><div class="notice notice-warning"><p>Tables nécessaires introuvables : <code>'.esc_html(implode(', ',$missing)).'</code>. Aucune donnée n’a été modifiée.</p></div></div>';return;}
        $tenant=absint($_GET['tenant_id']??0);$branch=absint($_GET['branch_id']??0);$where='p.status=\'ACTIVE\' AND p.track_stock=1';$args=array();
        if($tenant){$where.=' AND p.tenant_id=%d';$args[]=$tenant;}
        $join=' LEFT JOIN '.$prefix.'stock s ON s.product_id=p.id AND s.tenant_id=p.tenant_id';
        if($branch){$join.=$wpdb->prepare(' AND s.branch_id=%d',$branch);}
        $base=" FROM {$prefix}products p {$join} WHERE {$where}";
        $sql="SELECT COUNT(DISTINCT p.id) products,COALESCE(SUM(COALESCE(s.quantity,0)),0) units,SUM(CASE WHEN COALESCE(s.quantity,0)<=p.min_stock THEN 1 ELSE 0 END) low_count".$base;
        $stats=$args?$wpdb->get_row($wpdb->prepare($sql,$args),ARRAY_A):$wpdb->get_row($sql,ARRAY_A);
        $low_sql="SELECT p.id,p.tenant_id,p.name,p.sku,p.min_stock,COALESCE(SUM(s.quantity),0) quantity FROM {$prefix}products p LEFT JOIN {$prefix}stock s ON s.product_id=p.id AND s.tenant_id=p.tenant_id".($branch?$wpdb->prepare(' AND s.branch_id=%d',$branch):'')." WHERE {$where} GROUP BY p.id HAVING quantity<=p.min_stock ORDER BY (p.min_stock-quantity) DESC LIMIT 50";
        $low=$args?$wpdb->get_results($wpdb->prepare($low_sql,$args),ARRAY_A):$wpdb->get_results($low_sql,ARRAY_A);
        $branches=$wpdb->get_results('SELECT id,tenant_id,name FROM '.$core_branches.($tenant?$wpdb->prepare(' WHERE tenant_id=%d',$tenant):'').' ORDER BY tenant_id,id LIMIT 200',ARRAY_A);
        $movement_where=array();$movement_args=array();
        if($tenant){$movement_where[]='tenant_id=%d';$movement_args[]=$tenant;}
        if($branch){$movement_where[]='branch_id=%d';$movement_args[]=$branch;}
        $movement_sql='SELECT movement_type,COUNT(*) total,COALESCE(SUM(quantity),0) quantity FROM '.$prefix.'stock_movements'.($movement_where?' WHERE '.implode(' AND ',$movement_where):'').' GROUP BY movement_type ORDER BY total DESC LIMIT 12';
        $movements=$movement_args?$wpdb->get_results($wpdb->prepare($movement_sql,$movement_args),ARRAY_A):$wpdb->get_results($movement_sql,ARRAY_A);
        $hot_sql='SELECT p.id,p.name,p.sku,COUNT(m.id) movement_count,COALESCE(SUM(ABS(m.quantity)),0) moved_units,MAX(m.created_at) last_movement FROM '.$prefix.'stock_movements m INNER JOIN '.$prefix.'products p ON p.id=m.product_id AND p.tenant_id=m.tenant_id WHERE m.created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)'.($tenant?' AND m.tenant_id=%d':'').($branch?' AND m.branch_id=%d':'').' GROUP BY p.id,p.name,p.sku ORDER BY movement_count DESC,moved_units DESC LIMIT 10';
        $hot_args=array();if($tenant)$hot_args[]=$tenant;if($branch)$hot_args[]=$branch;
        $hot_products=$hot_args?$wpdb->get_results($wpdb->prepare($hot_sql,$hot_args),ARRAY_A):$wpdb->get_results($hot_sql,ARRAY_A);
        $branch_sql='SELECT b.id,b.name,b.tenant_id,COUNT(DISTINCT p.id) product_count,COALESCE(SUM(s.quantity),0) units,COALESCE(SUM(CASE WHEN s.quantity<=p.min_stock THEN 1 ELSE 0 END),0) low_count FROM '.$core_branches.' b LEFT JOIN '.$prefix.'stock s ON s.branch_id=b.id AND s.tenant_id=b.tenant_id LEFT JOIN '.$prefix.'products p ON p.id=s.product_id AND p.tenant_id=s.tenant_id AND p.status=\'ACTIVE\' AND p.track_stock=1'.($tenant?' WHERE b.tenant_id=%d':'').($branch?($tenant?' AND':' WHERE').' b.id=%d':'').' GROUP BY b.id,b.name,b.tenant_id ORDER BY low_count DESC,units ASC LIMIT 50';
        $branch_args=array();if($tenant)$branch_args[]=$tenant;if($branch)$branch_args[]=$branch;
        $branch_stats=$branch_args?$wpdb->get_results($wpdb->prepare($branch_sql,$branch_args),ARRAY_A):$wpdb->get_results($branch_sql,ARRAY_A);
        $dormant_sql='SELECT p.id,p.tenant_id,p.name,p.sku,COALESCE(SUM(s.quantity),0) quantity,MAX(m.created_at) last_movement FROM '.$prefix.'products p LEFT JOIN '.$prefix.'stock s ON s.product_id=p.id AND s.tenant_id=p.tenant_id'.($branch?$wpdb->prepare(' AND s.branch_id=%d',$branch):'').' LEFT JOIN '.$prefix.'stock_movements m ON m.product_id=p.id AND m.tenant_id=p.tenant_id'.($branch?$wpdb->prepare(' AND m.branch_id=%d',$branch):'').' WHERE p.status=\'ACTIVE\' AND p.track_stock=1'.($tenant?' AND p.tenant_id=%d':'').' GROUP BY p.id,p.tenant_id,p.name,p.sku HAVING quantity>0 AND (last_movement IS NULL OR last_movement < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 60 DAY)) ORDER BY last_movement ASC LIMIT 50';
        $dormant_products=$tenant?$wpdb->get_results($wpdb->prepare($dormant_sql,$tenant),ARRAY_A):$wpdb->get_results($dormant_sql,ARRAY_A);
        $transfer_sql='SELECT id,tenant_id,from_branch_id,to_branch_id,status,created_at FROM '.$prefix.'stock_transfers'.($tenant?' WHERE tenant_id=%d':'').' ORDER BY id DESC LIMIT 10';
        $transfers=$tenant?$wpdb->get_results($wpdb->prepare($transfer_sql,$tenant),ARRAY_A):$wpdb->get_results($transfer_sql,ARRAY_A);
        echo '<div class="wrap"><h1>Tableau de bord du stock</h1><p>Vue consolidée en lecture seule des articles suivis, des seuils minimums, des mouvements et des transferts.</p>';
        echo '<form method="get"><input type="hidden" name="page" value="fkc-stock-dashboard"><label>Entreprise ID <input type="number" min="1" name="tenant_id" value="'.esc_attr($tenant).'" style="width:90px"></label> <label>Établissement ID <select name="branch_id"><option value="0">Tous</option>';foreach((array)$branches as $b){echo '<option value="'.esc_attr($b['id']).'" '.selected($branch,(int)$b['id'],false).'>'.esc_html($b['name'].' (#'.$b['id'].', entreprise '.$b['tenant_id'].')').'</option>';}echo '</select></label> ';submit_button('Actualiser','secondary','',false);echo '</form>';
        echo '<div style="display:flex;gap:16px;flex-wrap:wrap;margin:18px 0"><div class="card"><h2>'.esc_html(number_format_i18n((int)($stats['products']??0))).'</h2><p>Articles suivis</p></div><div class="card"><h2>'.esc_html(number_format_i18n((float)($stats['units']??0),2)).'</h2><p>Unités en stock</p></div><div class="card"><h2 style="color:#b32d2e">'.esc_html(number_format_i18n((int)($stats['low_count']??0))).'</h2><p>Articles au seuil minimum ou en dessous</p></div></div>';
        echo '<h2>Alertes de stock bas</h2><table class="widefat striped"><thead><tr><th>Article</th><th>Entreprise</th><th>SKU</th><th>Quantité</th><th>Seuil minimum</th></tr></thead><tbody>';if(!$low)echo '<tr><td colspan="5">Aucune alerte pour les filtres sélectionnés.</td></tr>';foreach((array)$low as $r)echo '<tr><td>'.esc_html($r['name']).'</td><td>'.esc_html($r['tenant_id']).'</td><td>'.esc_html($r['sku']).'</td><td>'.esc_html($r['quantity']).'</td><td>'.esc_html($r['min_stock']).'</td></tr>';echo '</tbody></table>';
        echo '<h2>Vue par établissement</h2><table class="widefat striped"><thead><tr><th>Établissement</th><th>Entreprise</th><th>Articles</th><th>Unités</th><th>Alertes</th></tr></thead><tbody>';if(!$branch_stats)echo '<tr><td colspan="5">Aucun établissement trouvé.</td></tr>';foreach((array)$branch_stats as $r)echo '<tr><td>'.esc_html($r['name'].' (#'.$r['id'].')').'</td><td>'.esc_html($r['tenant_id']).'</td><td>'.esc_html($r['product_count']).'</td><td>'.esc_html($r['units']).'</td><td>'.esc_html($r['low_count']).'</td></tr>';echo '</tbody></table>';
        echo '<h2>Produits les plus mouvementés (30 derniers jours)</h2><table class="widefat striped"><thead><tr><th>Produit</th><th>SKU</th><th>Mouvements</th><th>Unités déplacées</th><th>Dernier mouvement</th></tr></thead><tbody>';if(!$hot_products)echo '<tr><td colspan="5">Aucun mouvement sur les 30 derniers jours.</td></tr>';foreach((array)$hot_products as $r)echo '<tr><td>'.esc_html($r['name'].' (#'.$r['id'].')').'</td><td>'.esc_html($r['sku']).'</td><td>'.esc_html($r['movement_count']).'</td><td>'.esc_html($r['moved_units']).'</td><td>'.esc_html($r['last_movement']).'</td></tr>';echo '</tbody></table>';
        echo '<h2>Produits dormants (aucun mouvement depuis 60 jours)</h2><table class="widefat striped"><thead><tr><th>Produit</th><th>Entreprise</th><th>SKU</th><th>Stock disponible</th><th>Dernier mouvement</th></tr></thead><tbody>';if(!$dormant_products)echo '<tr><td colspan="5">Aucun produit dormant avec stock disponible.</td></tr>';foreach((array)$dormant_products as $r)echo '<tr><td>'.esc_html($r['name'].' (#'.$r['id'].')').'</td><td>'.esc_html($r['tenant_id']).'</td><td>'.esc_html($r['sku']).'</td><td>'.esc_html($r['quantity']).'</td><td>'.esc_html($r['last_movement']?:'Jamais mouvementé').'</td></tr>';echo '</tbody></table>';
        echo '<h2>Mouvements récents par type</h2><table class="widefat striped"><thead><tr><th>Type</th><th>Nombre</th><th>Quantité nette</th></tr></thead><tbody>';if(!$movements)echo '<tr><td colspan="3">Aucun mouvement.</td></tr>';foreach((array)$movements as $r)echo '<tr><td>'.esc_html($r['movement_type']).'</td><td>'.esc_html($r['total']).'</td><td>'.esc_html($r['quantity']).'</td></tr>';echo '</tbody></table>';
        echo '<h2>Derniers transferts</h2><table class="widefat striped"><thead><tr><th>ID</th><th>Entreprise</th><th>Départ</th><th>Arrivée</th><th>Statut</th><th>Date UTC</th></tr></thead><tbody>';if(!$transfers)echo '<tr><td colspan="6">Aucun transfert enregistré.</td></tr>';foreach((array)$transfers as $r)echo '<tr><td>'.esc_html($r['id']).'</td><td>'.esc_html($r['tenant_id']).'</td><td>'.esc_html($r['from_branch_id']).'</td><td>'.esc_html($r['to_branch_id']).'</td><td>'.esc_html($r['status']).'</td><td>'.esc_html($r['created_at']).'</td></tr>';echo '</tbody></table></div>';
    }

    public function render_stock_conflicts_page() {
        if (!current_user_can('manage_options')) wp_die('Accès non autorisé.');
        global $wpdb;
        $table=$wpdb->prefix.'bta_stock_conflict_resolutions';
        $exists=$wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s',$wpdb->esc_like($table)));
        echo '<div class="wrap"><h1>Historique des conflits de stock</h1><p>Consultation des décisions de rapprochement enregistrées dans BTA Manager. Cette page est en lecture seule.</p>';
        if ($exists!==$table) { echo '<div class="notice notice-info"><p>Aucun historique disponible : la table de résolution n’est pas encore créée.</p></div></div>'; return; }
        $page=max(1,absint($_GET['paged']??1)); $per=25; $tenant=absint($_GET['tenant_id']??0); $branch=absint($_GET['branch_id']??0); $product=absint($_GET['product_id']??0);
        $where='WHERE 1=1'; $args=array();
        if($tenant){$where.=' AND r.tenant_id=%d';$args[]=$tenant;}
        if($branch){$where.=' AND r.branch_id=%d';$args[]=$branch;}
        if($product){$where.=' AND r.product_id=%d';$args[]=$product;}
        $total_sql="SELECT COUNT(*) FROM {$table} r {$where}";
        $total=(int)($args?$wpdb->get_var($wpdb->prepare($total_sql,$args)):$wpdb->get_var($total_sql));
        $branches_table=$this->table('branches'); $users_table=$this->table('users');
        $sql="SELECT r.*,p.name AS product_name,p.sku,b.name AS branch_name,u.full_name AS resolver_name FROM {$table} r LEFT JOIN {$wpdb->prefix}bta_products p ON p.id=r.product_id LEFT JOIN {$branches_table} b ON b.id=r.branch_id LEFT JOIN {$users_table} u ON u.id=r.resolved_by {$where} ORDER BY r.id DESC LIMIT %d OFFSET %d";
        $rows=$wpdb->get_results($wpdb->prepare($sql,array_merge($args,array($per,($page-1)*$per))),ARRAY_A);
        echo '<form method="get" style="margin:16px 0"><input type="hidden" name="page" value="fkc-stock-conflicts"><label>Entreprise ID <input type="number" min="1" name="tenant_id" value="'.esc_attr($tenant).'" style="width:90px"></label> <label>Établissement ID <input type="number" min="1" name="branch_id" value="'.esc_attr($branch).'" style="width:90px"></label> <label>Produit ID <input type="number" min="1" name="product_id" value="'.esc_attr($product).'" style="width:90px"></label> '; submit_button('Filtrer','secondary','',false); echo ' <a class="button" href="'.esc_url(admin_url('admin.php?page=fkc-stock-conflicts')).'">Réinitialiser</a></form>';
        echo '<p>'.esc_html(number_format_i18n($total)).' résolution(s) enregistrée(s).</p><table class="widefat striped"><thead><tr><th>Date UTC</th><th>Entreprise</th><th>Établissement</th><th>Produit</th><th>Décision</th><th>Avant</th><th>Écart</th><th>Après</th><th>Utilisateur</th><th>Motif</th></tr></thead><tbody>';
        if(!$rows) echo '<tr><td colspan="10">Aucune résolution trouvée.</td></tr>';
        foreach((array)$rows as $row){$decision=$row['decision']==='keep_server'?'Stock serveur conservé':'Correction appliquée';echo '<tr><td>'.esc_html($row['created_at']).'</td><td>'.esc_html($row['tenant_id']).'</td><td>'.esc_html(($row['branch_name']?:'—').' (#'.$row['branch_id'].')').'</td><td>'.esc_html(($row['product_name']?:'Produit').' (#'.$row['product_id'].')'.($row['sku']?' · '.$row['sku']:'')).'</td><td>'.esc_html($decision).'</td><td>'.esc_html($row['quantity_before']).'</td><td>'.esc_html($row['quantity_delta']).'</td><td>'.esc_html($row['quantity_after']).'</td><td>'.esc_html($row['resolver_name']?:('#'.$row['resolved_by'])).'</td><td>'.esc_html($row['reason']?:'—').'</td></tr>';}
        echo '</tbody></table>';
        $pages=(int)ceil($total/$per); if($pages>1){$base=add_query_arg(array('page'=>'fkc-stock-conflicts','tenant_id'=>$tenant,'branch_id'=>$branch,'product_id'=>$product,'paged'=>'%#%'),admin_url('admin.php'));echo '<div style="margin-top:16px">'.wp_kses_post(paginate_links(array('base'=>$base,'format'=>'','current'=>$page,'total'=>$pages))).'</div>';}
        echo '</div>';
    }

    private function sessions_table_exists() { global $wpdb; $t=$this->table('sessions'); return $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s',$wpdb->esc_like($t)))===$t; }
    public function handle_first_owner() {
        if(!current_user_can('manage_options')) wp_die('Accès non autorisé.',403);
        check_admin_referer('fkc_create_first_owner','fkc_nonce');
        if(!$this->tables_ready()||$this->owner_exists()) $this->redirect_admin('error');
        $full=sanitize_text_field(wp_unslash($_POST['full_name']??'')); $email=strtolower(sanitize_email(wp_unslash($_POST['email']??'')));
        $pass=(string)wp_unslash($_POST['password']??''); $confirm=(string)wp_unslash($_POST['password_confirm']??'');
        $company=sanitize_text_field(wp_unslash($_POST['company_name']??'')); $branch=sanitize_text_field(wp_unslash($_POST['branch_name']??''));
        if(strlen($full)<2||strlen($full)>150||!is_email($email)||strlen($pass)<12||$pass!==$confirm||strlen($company)<2||strlen($branch)<2) $this->redirect_admin('error');
        global $wpdb; $u=$this->table('users'); $t=$this->table('tenants'); $b=$this->table('branches'); $m=$this->table('members'); $p=$this->table('permissions');
        $lock='fkc_owner_'.md5(DB_NAME); if((int)$wpdb->get_var($wpdb->prepare('SELECT GET_LOCK(%s,10)',$lock))!==1) $this->redirect_admin('error');
        $wpdb->query('START TRANSACTION');
        try {
            if($wpdb->get_var("SELECT id FROM {$u} LIMIT 1")) throw new RuntimeException('Owner exists');
            $hash=password_hash($pass,PASSWORD_DEFAULT); if(!$hash) throw new RuntimeException('Password hash failed');
            if(!$wpdb->insert($u,array('full_name'=>$full,'email'=>$email,'password_hash'=>$hash,'status'=>'ACTIVE'),array('%s','%s','%s','%s'))) throw new RuntimeException('User insert failed');
            $uid=(int)$wpdb->insert_id; $slug=sanitize_title($company); if(!$slug)$slug='entreprise'; $base=substr($slug,0,170); $n=1;
            while($wpdb->get_var($wpdb->prepare("SELECT id FROM {$t} WHERE slug=%s",$slug))) $slug=substr($base,0,185).'-'.$n++;
            if(!$wpdb->insert($t,array('name'=>$company,'slug'=>$slug,'status'=>'ACTIVE','created_by'=>$uid),array('%s','%s','%s','%d'))) throw new RuntimeException('Tenant insert failed');
            $tid=(int)$wpdb->insert_id;
            if(!$wpdb->insert($b,array('tenant_id'=>$tid,'name'=>$branch,'code'=>'MAIN','status'=>'ACTIVE'),array('%d','%s','%s','%s'))) throw new RuntimeException('Branch insert failed');
            if(!$wpdb->insert($m,array('tenant_id'=>$tid,'user_id'=>$uid,'role'=>'OWNER','status'=>'ACTIVE'),array('%d','%d','%s','%s'))) throw new RuntimeException('Membership insert failed');
            foreach($this->permissions as $key=>$desc) if($wpdb->query($wpdb->prepare("INSERT IGNORE INTO {$p} (permission_key,description) VALUES (%s,%s)",$key,$desc))===false) throw new RuntimeException('Permission seed failed');
            $wpdb->query('COMMIT'); $wpdb->get_var($wpdb->prepare('SELECT RELEASE_LOCK(%s)',$lock)); $this->redirect_admin('created');
        } catch(Throwable $e) { $wpdb->query('ROLLBACK'); $wpdb->get_var($wpdb->prepare('SELECT RELEASE_LOCK(%s)',$lock)); error_log('[FKC] Owner initialization failed: '.$e->getMessage().' '.$wpdb->last_error); $this->redirect_admin('error'); }
    }

    public function handle_reset_owner_password() {
        if (!current_user_can('manage_options')) wp_die('Accès non autorisé.',403);
        check_admin_referer('fkc_reset_owner_password','fkc_reset_nonce');
        if (!$this->tables_ready() || !$this->owner_exists()) $this->redirect_admin('password_error');

        $pass = (string) wp_unslash($_POST['new_password'] ?? '');
        $confirm = (string) wp_unslash($_POST['new_password_confirm'] ?? '');
        if (strlen($pass) < 12 || strlen($pass) > 4096 || !hash_equals($pass, $confirm)) {
            $this->redirect_admin('password_error');
        }

        global $wpdb;
        $users = $this->table('users');
        $owner = $wpdb->get_row("SELECT id FROM {$users} ORDER BY id ASC LIMIT 1", ARRAY_A);
        if (!$owner) $this->redirect_admin('password_error');

        $hash = password_hash($pass, PASSWORD_DEFAULT);
        if (!$hash) $this->redirect_admin('password_error');

        $updated = $wpdb->update(
            $users,
            array('password_hash' => $hash),
            array('id' => (int) $owner['id']),
            array('%s'),
            array('%d')
        );
        if ($updated === false) {
            error_log('[FKC] Owner password reset failed: ' . $wpdb->last_error);
            $this->redirect_admin('password_error');
        }

        if ($this->sessions_table_exists()) {
            $wpdb->delete($this->table('sessions'), array('user_id' => (int) $owner['id']), array('%d'));
        }
        $this->redirect_admin('password_reset');
    }

    private function redirect_admin($notice) { wp_safe_redirect(add_query_arg(array('page'=>'fondation-kenda-core','fkc_notice'=>$notice),admin_url('admin.php'))); exit; }

    public function register_routes() {
        register_rest_route('bta/v1','/health',array('methods'=>WP_REST_Server::READABLE,'callback'=>array($this,'health_endpoint'),'permission_callback'=>'__return_true'));
        register_rest_route('bta/v1','/auth/login',array('methods'=>WP_REST_Server::CREATABLE,'callback'=>array($this,'login_endpoint'),'permission_callback'=>'__return_true'));
        register_rest_route('bta/v1','/auth/register-invited',array('methods'=>WP_REST_Server::CREATABLE,'callback'=>array($this,'register_invited_endpoint'),'permission_callback'=>'__return_true'));
        register_rest_route('bta/v1','/auth/register-owner',array('methods'=>WP_REST_Server::CREATABLE,'callback'=>array($this,'register_owner_endpoint'),'permission_callback'=>'__return_true'));
        register_rest_route('bta/v1','/auth/me',array('methods'=>WP_REST_Server::READABLE,'callback'=>array($this,'me_endpoint'),'permission_callback'=>array($this,'require_session')));
        register_rest_route('bta/v1','/auth/logout',array('methods'=>WP_REST_Server::CREATABLE,'callback'=>array($this,'logout_endpoint'),'permission_callback'=>array($this,'require_session')));

        // API métier v0.4.0 — toutes les routes ci-dessous exigent une session BTA valide.
        register_rest_route('bta/v1','/tenants',array(
            array('methods'=>WP_REST_Server::READABLE,'callback'=>array($this,'tenants_list_endpoint'),'permission_callback'=>array($this,'require_session')),
            array('methods'=>WP_REST_Server::CREATABLE,'callback'=>array($this,'tenant_create_endpoint'),'permission_callback'=>array($this,'require_session')),
        ));
        register_rest_route('bta/v1','/tenants/(?P<tenant_id>\d+)',array('methods'=>WP_REST_Server::READABLE,'callback'=>array($this,'tenant_get_endpoint'),'permission_callback'=>array($this,'require_session')));
        register_rest_route('bta/v1','/tenants/(?P<tenant_id>\d+)/branches',array(
            array('methods'=>WP_REST_Server::READABLE,'callback'=>array($this,'branches_list_endpoint'),'permission_callback'=>array($this,'require_session')),
            array('methods'=>WP_REST_Server::CREATABLE,'callback'=>array($this,'branch_create_endpoint'),'permission_callback'=>array($this,'require_session')),
        ));
        register_rest_route('bta/v1','/tenants/(?P<tenant_id>\d+)/members',array('methods'=>WP_REST_Server::READABLE,'callback'=>array($this,'members_list_endpoint'),'permission_callback'=>array($this,'require_session')));
        register_rest_route('bta/v1','/tenants/(?P<tenant_id>\d+)/permissions',array('methods'=>WP_REST_Server::READABLE,'callback'=>array($this,'permissions_list_endpoint'),'permission_callback'=>array($this,'require_session')));
        register_rest_route('bta/v1','/tenants/(?P<tenant_id>\d+)/audit',array('methods'=>WP_REST_Server::READABLE,'callback'=>array($this,'audit_list_endpoint'),'permission_callback'=>array($this,'require_session')));
        register_rest_route('bta/v1','/tenants/(?P<tenant_id>\d+)/invitations',array(
            array('methods'=>WP_REST_Server::READABLE,'callback'=>array($this,'invitations_list_endpoint'),'permission_callback'=>array($this,'require_session')),
            array('methods'=>WP_REST_Server::CREATABLE,'callback'=>array($this,'invitation_create_endpoint'),'permission_callback'=>array($this,'require_session')),
        ));
        register_rest_route('bta/v1','/invitations/accept',array('methods'=>WP_REST_Server::CREATABLE,'callback'=>array($this,'invitation_accept_endpoint'),'permission_callback'=>array($this,'require_session')));
        register_rest_route('bta/v1','/invitations/(?P<invitation_id>\d+)/revoke',array('methods'=>WP_REST_Server::CREATABLE,'callback'=>array($this,'invitation_revoke_endpoint'),'permission_callback'=>array($this,'require_session')));
    }
    public function health_endpoint() {
        global $wpdb; $tables=$this->table_status(); $ready=!in_array(false,$tables,true);
        return rest_ensure_response(array('success'=>true,'service'=>'BTA Manager API','plugin'=>'Fondation Kenda Core','version'=>FKC_VERSION,'status'=>$ready?'online':'degraded','database'=>array('connected'=>!empty($wpdb->dbh),'tables_ready'=>$ready,'tables'=>$tables,'first_owner_initialized'=>$ready?$this->owner_exists():false,'sessions_table_ready'=>$this->sessions_table_exists())));
    }
    private function bearer_token($request) {
        $header=$request->get_header('authorization');
        if(!$header && isset($_SERVER['HTTP_AUTHORIZATION'])) $header=sanitize_text_field(wp_unslash($_SERVER['HTTP_AUTHORIZATION']));
        if(!$header && function_exists('getallheaders')) { $headers=getallheaders(); if(isset($headers['Authorization']))$header=$headers['Authorization']; }
        return (is_string($header)&&preg_match('/Bearer\s+([A-Fa-f0-9]{64})/',$header,$m))?$m[1]:'';
    }
    private function session_record($request) {
        global $wpdb; if(!$this->sessions_table_exists()) return null;
        $token=$this->bearer_token($request); if(!$token)return null;
        $hash=hash('sha256',$token); $sessions=$this->table('sessions'); $users=$this->table('users');
        $row=$wpdb->get_row($wpdb->prepare("SELECT s.id AS session_id,s.user_id,s.expires_at,u.full_name,u.email,u.status FROM {$sessions} s INNER JOIN {$users} u ON u.id=s.user_id WHERE s.token_hash=%s LIMIT 1",$hash),ARRAY_A);
        if(!$row || $row['status']!=='ACTIVE' || strtotime($row['expires_at'].' UTC')<=time()) { if($row)$wpdb->delete($sessions,array('id'=>(int)$row['session_id']),array('%d')); return null; }
        $wpdb->update($sessions,array('last_used_at'=>gmdate('Y-m-d H:i:s')),array('id'=>(int)$row['session_id']),array('%s'),array('%d'));
        return $row;
    }
    public function require_session($request) {
        $row=$this->session_record($request);
        if(!$row) return new WP_Error('bta_unauthenticated','Connexion requise ou session expirée.',array('status'=>401));
        return true;
    }
    private function client_ip() { return isset($_SERVER['REMOTE_ADDR'])?substr(sanitize_text_field(wp_unslash($_SERVER['REMOTE_ADDR'])),0,45):'unknown'; }
    private function login_rate_key($email) { return 'fkc_login_'.hash('sha256',$this->client_ip().'|'.strtolower($email)); }
    public function login_endpoint($request) {
        global $wpdb;
        if(!$this->tables_ready()||!$this->sessions_table_exists()) return new WP_Error('bta_unavailable','Service temporairement indisponible.',array('status'=>503));
        $email=strtolower(trim((string)$request->get_param('email'))); $password=(string)$request->get_param('password');
        if(!is_email($email)||strlen($email)>190||$password===''||strlen($password)>4096) return new WP_Error('bta_invalid_credentials','Adresse e-mail ou mot de passe incorrect.',array('status'=>401));
        $key=$this->login_rate_key($email); $attempts=(int)get_transient($key);
        if($attempts>=8) return new WP_Error('bta_rate_limited','Trop de tentatives. Réessayez dans 15 minutes.',array('status'=>429));
        $users=$this->table('users'); $user=$wpdb->get_row($wpdb->prepare("SELECT id,full_name,email,password_hash,status FROM {$users} WHERE email=%s LIMIT 1",$email),ARRAY_A);
        if(!$user||$user['status']!=='ACTIVE'||!password_verify($password,$user['password_hash'])) {
            set_transient($key,$attempts+1,15*MINUTE_IN_SECONDS);
            return new WP_Error('bta_invalid_credentials','Adresse e-mail ou mot de passe incorrect.',array('status'=>401));
        }
        delete_transient($key);
        if(password_needs_rehash($user['password_hash'],PASSWORD_DEFAULT)) $wpdb->update($users,array('password_hash'=>password_hash($password,PASSWORD_DEFAULT)),array('id'=>(int)$user['id']),array('%s'),array('%d'));
        $token=bin2hex(random_bytes(32)); $hash=hash('sha256',$token); $expires=time()+7*DAY_IN_SECONDS;
        $sessions=$this->table('sessions');
        $ok=$wpdb->insert($sessions,array('user_id'=>(int)$user['id'],'token_hash'=>$hash,'expires_at'=>gmdate('Y-m-d H:i:s',$expires),'ip_address'=>$this->client_ip(),'user_agent'=>isset($_SERVER['HTTP_USER_AGENT'])?substr(sanitize_text_field(wp_unslash($_SERVER['HTTP_USER_AGENT'])),0,255):''),array('%d','%s','%s','%s','%s'));
        if(!$ok) return new WP_Error('bta_session_error','Impossible de créer la session.',array('status'=>500));
        return rest_ensure_response(array('success'=>true,'token'=>$token,'token_type'=>'Bearer','expires_at'=>gmdate('c',$expires),'user'=>array('id'=>(int)$user['id'],'name'=>$user['full_name'],'email'=>$user['email'],'status'=>$user['status'])));
    }
    public function me_endpoint($request) {
        $session=$this->session_record($request); if(!$session)return new WP_Error('bta_unauthenticated','Session expirée.',array('status'=>401));
        global $wpdb; $members=$this->table('members'); $tenants=$this->table('tenants');
        $rows=$wpdb->get_results($wpdb->prepare("SELECT m.tenant_id,m.role,m.status,t.name FROM {$members} m INNER JOIN {$tenants} t ON t.id=m.tenant_id WHERE m.user_id=%d AND m.status='ACTIVE' AND t.status='ACTIVE' ORDER BY m.id ASC",(int)$session['user_id']),ARRAY_A);
        $companies=array(); foreach($rows as $r)$companies[]=array('tenantId'=>(int)$r['tenant_id'],'name'=>$r['name'],'role'=>$r['role'],'active'=>true);
        return rest_ensure_response(array('success'=>true,'user'=>array('id'=>(int)$session['user_id'],'name'=>$session['full_name'],'email'=>$session['email'],'status'=>$session['status']),'memberships'=>$companies,'session_expires_at'=>gmdate('c',strtotime($session['expires_at'].' UTC'))));
    }
    public function logout_endpoint($request) {
        global $wpdb; $token=$this->bearer_token($request); if($token)$wpdb->delete($this->table('sessions'),array('token_hash'=>hash('sha256',$token)),array('%s'));
        return rest_ensure_response(array('success'=>true,'message'=>'Session fermée.'));
    }

    /** Retourne l'utilisateur lié au Bearer Token de la requête. */
    private function current_session($request) { return $this->session_record($request); }

    private function api_error($code, $message, $status=400) {
        return new WP_Error($code, $message, array('status'=>$status));
    }

    private function tenant_membership($tenant_id, $user_id) {
        global $wpdb; $members=$this->table('members');
        return $wpdb->get_row($wpdb->prepare(
            "SELECT id,tenant_id,user_id,role,status FROM {$members} WHERE tenant_id=%d AND user_id=%d AND status='ACTIVE' LIMIT 1",
            (int)$tenant_id,(int)$user_id
        ), ARRAY_A);
    }

    private function tenant_access($request, $tenant_id, $allowed_roles=array()) {
        $session=$this->current_session($request);
        if (!$session) return $this->api_error('bta_unauthenticated','Connexion requise ou session expirée.',401);
        global $wpdb; $tenants=$this->table('tenants');
        $tenant=$wpdb->get_row($wpdb->prepare("SELECT id,name,slug,status,created_by,created_at FROM {$tenants} WHERE id=%d LIMIT 1",(int)$tenant_id),ARRAY_A);
        if (!$tenant || $tenant['status']!=='ACTIVE') return $this->api_error('bta_tenant_not_found','Entreprise introuvable ou inactive.',404);
        $membership=$this->tenant_membership($tenant_id,(int)$session['user_id']);
        if (!$membership) return $this->api_error('bta_forbidden','Vous ne faites pas partie de cette entreprise.',403);
        if ($allowed_roles && !in_array($membership['role'],$allowed_roles,true)) return $this->api_error('bta_forbidden','Votre rôle ne permet pas cette opération.',403);
        return array('session'=>$session,'tenant'=>$tenant,'membership'=>$membership);
    }

    private function write_audit($tenant_id, $user_id, $action, $entity_type='', $entity_id=null, $details=array()) {
        global $wpdb; $table=$this->table('audit_logs');
        $wpdb->insert($table,array(
            'tenant_id'=>(int)$tenant_id,'user_id'=>(int)$user_id,'action'=>substr(sanitize_key($action),0,100),
            'entity_type'=>substr(sanitize_key($entity_type),0,100),'entity_id'=>$entity_id ? (int)$entity_id : null,
            'details'=>wp_json_encode($details),'ip_address'=>$this->client_ip()
        ),array('%d','%d','%s','%s','%d','%s','%s'));
    }

    public function tenants_list_endpoint($request) {
        global $wpdb; $session=$this->current_session($request); if(!$session)return $this->api_error('bta_unauthenticated','Connexion requise.',401);
        $m=$this->table('members'); $t=$this->table('tenants');
        $rows=$wpdb->get_results($wpdb->prepare(
            "SELECT t.id,t.name,t.slug,t.status,t.created_at,m.role FROM {$t} t INNER JOIN {$m} m ON m.tenant_id=t.id WHERE m.user_id=%d AND m.status='ACTIVE' AND t.status='ACTIVE' ORDER BY t.id ASC",
            (int)$session['user_id']),ARRAY_A);
        return rest_ensure_response(array('success'=>true,'tenants'=>$rows));
    }

    public function tenant_get_endpoint($request) {
        $tenant_id=(int)$request['tenant_id']; $access=$this->tenant_access($request,$tenant_id); if(is_wp_error($access))return $access;
        return rest_ensure_response(array('success'=>true,'tenant'=>$access['tenant'],'membership'=>array('role'=>$access['membership']['role'])));
    }

    public function tenant_create_endpoint($request) {
        global $wpdb; $session=$this->current_session($request); if(!$session)return $this->api_error('bta_unauthenticated','Connexion requise.',401);
        $name=sanitize_text_field((string)$request->get_param('name'));
        $branch=sanitize_text_field((string)($request->get_param('main_branch_name') ?: 'Établissement principal'));
        if(strlen($name)<2 || strlen($name)>190 || strlen($branch)<2 || strlen($branch)>150)return $this->api_error('bta_invalid_input','Nom d’entreprise ou d’établissement invalide.');
        $tenants=$this->table('tenants'); $branches=$this->table('branches'); $members=$this->table('members');
        $slug=sanitize_title($name); if(!$slug)$slug='entreprise'; $base=substr($slug,0,170); $n=1;
        while($wpdb->get_var($wpdb->prepare("SELECT id FROM {$tenants} WHERE slug=%s",$slug)))$slug=substr($base,0,180).'-'.$n++;
        $wpdb->query('START TRANSACTION');
        try {
            if(!$wpdb->insert($tenants,array('name'=>$name,'slug'=>$slug,'status'=>'ACTIVE','created_by'=>(int)$session['user_id']),array('%s','%s','%s','%d')))throw new RuntimeException('tenant_insert');
            $tenant_id=(int)$wpdb->insert_id;
            if(!$wpdb->insert($branches,array('tenant_id'=>$tenant_id,'name'=>$branch,'code'=>'MAIN','status'=>'ACTIVE'),array('%d','%s','%s','%s')))throw new RuntimeException('branch_insert');
            $branch_id=(int)$wpdb->insert_id;
            if(!$wpdb->insert($members,array('tenant_id'=>$tenant_id,'user_id'=>(int)$session['user_id'],'role'=>'OWNER','status'=>'ACTIVE'),array('%d','%d','%s','%s')))throw new RuntimeException('membership_insert');
            $wpdb->query('COMMIT');
            $this->write_audit($tenant_id,(int)$session['user_id'],'tenant.created','tenant',$tenant_id,array('name'=>$name,'main_branch_id'=>$branch_id));
            return new WP_REST_Response(array('success'=>true,'tenant'=>array('id'=>$tenant_id,'name'=>$name,'slug'=>$slug),'main_branch'=>array('id'=>$branch_id,'name'=>$branch)),201);
        } catch(Throwable $e) { $wpdb->query('ROLLBACK'); error_log('[FKC] Tenant creation failed: '.$e->getMessage().' '.$wpdb->last_error); return $this->api_error('bta_tenant_create_failed','Impossible de créer l’entreprise.',500); }
    }

    public function branches_list_endpoint($request) {
        $tenant_id=(int)$request['tenant_id']; $access=$this->tenant_access($request,$tenant_id); if(is_wp_error($access))return $access;
        global $wpdb; $b=$this->table('branches');
        $rows=$wpdb->get_results($wpdb->prepare("SELECT id,tenant_id,name,code,status,created_at FROM {$b} WHERE tenant_id=%d ORDER BY id ASC",$tenant_id),ARRAY_A);
        return rest_ensure_response(array('success'=>true,'branches'=>$rows));
    }

    public function branch_create_endpoint($request) {
        $tenant_id=(int)$request['tenant_id']; $access=$this->tenant_access($request,$tenant_id,array('OWNER','ADMIN')); if(is_wp_error($access))return $access;
        $name=sanitize_text_field((string)$request->get_param('name')); $code=strtoupper(sanitize_text_field((string)$request->get_param('code')));
        if(strlen($name)<2||strlen($name)>150||strlen($code)<2||strlen($code)>50)return $this->api_error('bta_invalid_input','Nom ou code d’établissement invalide.');
        global $wpdb; $b=$this->table('branches');
        $exists=$wpdb->get_var($wpdb->prepare("SELECT id FROM {$b} WHERE tenant_id=%d AND code=%s LIMIT 1",$tenant_id,$code));
        if($exists)return $this->api_error('bta_branch_code_exists','Ce code existe déjà dans cette entreprise.',409);
        if(!$wpdb->insert($b,array('tenant_id'=>$tenant_id,'name'=>$name,'code'=>$code,'status'=>'ACTIVE'),array('%d','%s','%s','%s')))return $this->api_error('bta_branch_create_failed','Impossible de créer l’établissement.',500);
        $id=(int)$wpdb->insert_id; $this->write_audit($tenant_id,(int)$access['session']['user_id'],'branch.created','branch',$id,array('name'=>$name,'code'=>$code));
        return new WP_REST_Response(array('success'=>true,'branch'=>array('id'=>$id,'tenant_id'=>$tenant_id,'name'=>$name,'code'=>$code,'status'=>'ACTIVE')),201);
    }

    public function members_list_endpoint($request) {
        $tenant_id=(int)$request['tenant_id']; $access=$this->tenant_access($request,$tenant_id); if(is_wp_error($access))return $access;
        global $wpdb; $m=$this->table('members'); $u=$this->table('users');
        $rows=$wpdb->get_results($wpdb->prepare("SELECT m.id AS membership_id,m.user_id,u.full_name,u.email,m.role,m.status,m.created_at FROM {$m} m INNER JOIN {$u} u ON u.id=m.user_id WHERE m.tenant_id=%d ORDER BY m.id ASC",$tenant_id),ARRAY_A);
        return rest_ensure_response(array('success'=>true,'members'=>$rows));
    }

    public function permissions_list_endpoint($request) {
        $tenant_id=(int)$request['tenant_id']; $access=$this->tenant_access($request,$tenant_id); if(is_wp_error($access))return $access;
        global $wpdb; $p=$this->table('permissions'); $rows=$wpdb->get_results("SELECT id,permission_key,description FROM {$p} ORDER BY permission_key ASC",ARRAY_A);
        return rest_ensure_response(array('success'=>true,'permissions'=>$rows,'role_defaults'=>$this->role_defaults));
    }

    public static function can_invite_role($actor,$target) {
        return in_array($target,$actor==='OWNER'?array('ADMIN','MANAGER','CASHIER'):($actor==='ADMIN'?array('MANAGER','CASHIER'):array()),true);
    }
    private function invitation_scope_valid($inv,$tenant_id) {
        if(!in_array($inv['role'],array('ADMIN','MANAGER','CASHIER'),true))return false;
        global $wpdb;$tenant=$wpdb->get_row($wpdb->prepare('SELECT status FROM '.$this->table('tenants').' WHERE id=%d',$tenant_id),ARRAY_A);if(!$tenant||$tenant['status']!=='ACTIVE')return false;
        $issuer=$this->tenant_membership($tenant_id,(int)$inv['invited_by']);
        if(!$issuer||!self::can_invite_role($issuer['role'],$inv['role']))return false;
        $branches=json_decode($inv['branches'],true);
        if(!is_array($branches)||!count($branches))return false;
        foreach($branches as $branch){
            if(!$wpdb->get_var($wpdb->prepare("SELECT id FROM ".$this->table('branches')." WHERE id=%d AND tenant_id=%d AND status='ACTIVE'",absint($branch),$tenant_id)))return false;
            if($issuer['role']!=='OWNER'){
                $raw=$wpdb->get_var($wpdb->prepare('SELECT permissions FROM '.$this->table('branch_access').' WHERE member_id=%d AND branch_id=%d',$issuer['id'],absint($branch)));
                $grants=json_decode((string)$raw,true);
                if(!is_array($grants)||!in_array('members.manage',$grants,true)||array_diff($this->role_defaults[$inv['role']],$grants))return false;
            }
        }
        return true;
    }

    public function invitations_list_endpoint($request) {
        $tenant_id=(int)$request['tenant_id']; $access=$this->tenant_access($request,$tenant_id,array('OWNER','ADMIN'));
        if(is_wp_error($access))return $access;
        global $wpdb; $i=$this->table('invitations');
        $rows=$wpdb->get_results($wpdb->prepare("SELECT id,tenant_id,invited_by,role,branches,status,expires_at,accepted_by,accepted_at,created_at FROM {$i} WHERE tenant_id=%d ORDER BY id DESC LIMIT 100",$tenant_id),ARRAY_A);
        foreach($rows as &$row){$row['branches']=json_decode($row['branches'],true) ?: array();} unset($row);
        if($access['membership']['role']!=='OWNER')$rows=array_values(array_filter($rows,function($row)use($request,$tenant_id){foreach($row['branches'] as $branch){if(is_wp_error(FKC_Branch_Access::allowed($request,$tenant_id,absint($branch),'members.manage')))return false;}return count($row['branches'])>0;}));
        return rest_ensure_response(array('success'=>true,'invitations'=>$rows));
    }

    public function invitation_create_endpoint($request) {
        $tenant_id=(int)$request['tenant_id']; $access=$this->tenant_access($request,$tenant_id,array('OWNER','ADMIN')); if(is_wp_error($access))return $access;
        $role=strtoupper((string)($request->get_param('role') ?: 'MANAGER'));
        if (!self::can_invite_role($access['membership']['role'],$role)) return $this->api_error('bta_invitation_role_forbidden','Ce rôle ne peut pas être attribué par votre compte.',403);
        $branch_ids=$request->get_param('branches'); if(!is_array($branch_ids)||!count($branch_ids))return $this->api_error('bta_invalid_input','Sélectionnez au moins un établissement.');
        $branch_ids=array_values(array_unique(array_filter(array_map('absint',$branch_ids)))); if(!$branch_ids)return $this->api_error('bta_invalid_input','Liste d’établissements invalide.');
        global $wpdb; $b=$this->table('branches');
        foreach($branch_ids as $branch_id){$found=$wpdb->get_var($wpdb->prepare("SELECT id FROM {$b} WHERE id=%d AND tenant_id=%d AND status='ACTIVE'",$branch_id,$tenant_id));if(!$found)return $this->api_error('bta_branch_invalid','Un établissement sélectionné est invalide.',404);}
        if ($access['membership']['role']!=='OWNER') foreach($branch_ids as $branch_id){
            $check=FKC_Branch_Access::allowed($request,$tenant_id,$branch_id,'members.manage');if(is_wp_error($check))return $check;
            $grants=$wpdb->get_var($wpdb->prepare('SELECT permissions FROM '.$this->table('branch_access').' WHERE member_id=%d AND branch_id=%d',$access['membership']['id'],$branch_id));
            $grants=json_decode((string)$grants,true);
            if(!is_array($grants)||array_diff($this->role_defaults[$role],$grants))return $this->api_error('bta_invitation_escalation','Vous ne pouvez pas déléguer des permissions que vous ne possédez pas.',403);
        }
        $token=bin2hex(random_bytes(32)); $hash=hash('sha256',$token); $expires=gmdate('Y-m-d H:i:s',time()+7*DAY_IN_SECONDS); $i=$this->table('invitations');
        $ok=$wpdb->insert($i,array('tenant_id'=>$tenant_id,'invited_by'=>(int)$access['session']['user_id'],'token_hash'=>$hash,'role'=>$role,'branches'=>wp_json_encode($branch_ids),'status'=>'PENDING','expires_at'=>$expires),array('%d','%d','%s','%s','%s','%s','%s'));
        if(!$ok)return $this->api_error('bta_invitation_create_failed','Impossible de créer l’invitation.',500);
        $id=(int)$wpdb->insert_id; $this->write_audit($tenant_id,(int)$access['session']['user_id'],'invitation.created','invitation',$id,array('role'=>$role,'branches'=>$branch_ids));
        return new WP_REST_Response(array('success'=>true,'invitation'=>array('id'=>$id,'tenant_id'=>$tenant_id,'role'=>$role,'branches'=>$branch_ids,'expires_at'=>gmdate('c',strtotime($expires.' UTC'))),'code'=>$tenant_id.'.'.$token),201);
    }

    public function invitation_revoke_endpoint($request) {
        $invitation_id=(int)$request['invitation_id']; global $wpdb; $i=$this->table('invitations');
        $inv=$wpdb->get_row($wpdb->prepare("SELECT id,tenant_id,status,role,expires_at,branches FROM {$i} WHERE id=%d",$invitation_id),ARRAY_A);
        if(!$inv)return $this->api_error('bta_invitation_not_found','Invitation introuvable.',404);
        $access=$this->tenant_access($request,(int)$inv['tenant_id'],array('OWNER','ADMIN')); if(is_wp_error($access))return $access;
        foreach(json_decode($inv['branches'],true) ?: array() as $branch){$check=FKC_Branch_Access::allowed($request,(int)$inv['tenant_id'],absint($branch),'members.manage');if(is_wp_error($check))return $check;}
        if(!self::can_invite_role($access['membership']['role'],$inv['role']))return $this->api_error('bta_invitation_role_forbidden','Révocation non autorisée pour ce rôle.',403);
        if($inv['status']!=='PENDING'||strtotime($inv['expires_at'].' UTC')<=time())return $this->api_error('bta_invitation_not_pending','Cette invitation ne peut plus être révoquée.',409);
        $updated=$wpdb->query($wpdb->prepare("UPDATE {$i} SET status='REVOKED' WHERE id=%d AND tenant_id=%d AND status='PENDING' AND expires_at>%s",$invitation_id,(int)$inv['tenant_id'],gmdate('Y-m-d H:i:s')));
        if($updated!==1)return $this->api_error('bta_invitation_changed','Invitation déjà traitée ou révocation impossible.',409);
        $this->write_audit((int)$inv['tenant_id'],(int)$access['session']['user_id'],'invitation.revoked','invitation',$invitation_id);
        return rest_ensure_response(array('success'=>true,'message'=>'Invitation révoquée.'));
    }

    /** Inscription autonome : crée un utilisateur, son entreprise, sa branche et une session OWNER. */
    public function register_owner_endpoint($request) {
        global $wpdb;
        if (!$this->tables_ready() || !$this->sessions_table_exists()) return $this->api_error('bta_unavailable','Service temporairement indisponible.',503);
        $name=sanitize_text_field((string)$request->get_param('full_name'));
        $email=strtolower(trim(sanitize_email((string)$request->get_param('email'))));
        $password=(string)$request->get_param('password');
        $company=sanitize_text_field((string)$request->get_param('company_name'));
        $branch=sanitize_text_field((string)($request->get_param('branch_name') ?: 'Établissement principal'));
        if(strlen($name)<2||strlen($name)>150||!is_email($email)||strlen($email)>190||strlen($password)<12||strlen($password)>4096||strlen($company)<2||strlen($company)>190||strlen($branch)<2||strlen($branch)>150)
            return $this->api_error('bta_invalid_registration','Vérifiez le nom, l’adresse e-mail, l’entreprise et le mot de passe (12 caractères minimum).');
        $rate_key='fkc_owner_register_'.hash('sha256',$this->client_ip());
        $attempts=(int)get_transient($rate_key);
        if($attempts>=5)return $this->api_error('bta_rate_limited','Trop de créations depuis cette connexion. Réessayez dans 15 minutes.',429);
        $users=$this->table('users'); $tenants=$this->table('tenants'); $branches=$this->table('branches');
        $members=$this->table('members'); $branch_access=$this->table('branch_access'); $permissions=$this->table('permissions'); $sessions=$this->table('sessions');
        $lock='fkc_signup_'.substr(hash('sha256',$email),0,32);
        if((int)$wpdb->get_var($wpdb->prepare('SELECT GET_LOCK(%s,10)',$lock))!==1)return $this->api_error('bta_registration_busy','Inscription momentanément occupée. Réessayez.',429);
        $wpdb->query('START TRANSACTION');
        try {
            if($wpdb->get_var($wpdb->prepare("SELECT id FROM {$users} WHERE email=%s LIMIT 1 FOR UPDATE",$email)))throw new DomainException('email_exists');
            $password_hash=password_hash($password,PASSWORD_DEFAULT);
            if(!$password_hash)throw new RuntimeException('password_hash');
            if(!$wpdb->insert($users,array('full_name'=>$name,'email'=>$email,'password_hash'=>$password_hash,'status'=>'ACTIVE'),array('%s','%s','%s','%s')))throw new RuntimeException('user_insert');
            $user_id=(int)$wpdb->insert_id;
            $slug=sanitize_title($company); if(!$slug)$slug='entreprise'; $base=substr($slug,0,170); $n=1;
            while($wpdb->get_var($wpdb->prepare("SELECT id FROM {$tenants} WHERE slug=%s",$slug)))$slug=substr($base,0,180).'-'.$n++;
            if(!$wpdb->insert($tenants,array('name'=>$company,'slug'=>$slug,'status'=>'ACTIVE','created_by'=>$user_id),array('%s','%s','%s','%d')))throw new RuntimeException('tenant_insert');
            $tenant_id=(int)$wpdb->insert_id;
            if(!$wpdb->insert($branches,array('tenant_id'=>$tenant_id,'name'=>$branch,'code'=>'MAIN','status'=>'ACTIVE'),array('%d','%s','%s','%s')))throw new RuntimeException('branch_insert');
            $branch_id=(int)$wpdb->insert_id;
            if(!$wpdb->insert($members,array('tenant_id'=>$tenant_id,'user_id'=>$user_id,'role'=>'OWNER','status'=>'ACTIVE'),array('%d','%d','%s','%s')))throw new RuntimeException('member_insert');
            $member_id=(int)$wpdb->insert_id;
            foreach($this->permissions as $key=>$description){if($wpdb->query($wpdb->prepare("INSERT IGNORE INTO {$permissions} (permission_key,description) VALUES (%s,%s)",$key,$description))===false)throw new RuntimeException('permission_seed');}
            if(!$wpdb->insert($branch_access,array('member_id'=>$member_id,'branch_id'=>$branch_id,'permissions'=>wp_json_encode($this->role_defaults['OWNER'])),array('%d','%d','%s')))throw new RuntimeException('branch_access_insert');
            $token=bin2hex(random_bytes(32)); $expires=time()+7*DAY_IN_SECONDS;
            if(!$wpdb->insert($sessions,array('user_id'=>$user_id,'token_hash'=>hash('sha256',$token),'expires_at'=>gmdate('Y-m-d H:i:s',$expires),'ip_address'=>$this->client_ip(),'user_agent'=>isset($_SERVER['HTTP_USER_AGENT'])?substr(sanitize_text_field(wp_unslash($_SERVER['HTTP_USER_AGENT'])),0,255):''),array('%d','%s','%s','%s','%s')))throw new RuntimeException('session_insert');
            $wpdb->query('COMMIT'); delete_transient($rate_key);
            $this->write_audit($tenant_id,$user_id,'tenant.created','tenant',$tenant_id,array('name'=>$company,'main_branch_id'=>$branch_id,'self_service'=>true));
            return new WP_REST_Response(array('success'=>true,'token'=>$token,'token_type'=>'Bearer','expires_at'=>gmdate('c',$expires),'user'=>array('id'=>$user_id,'name'=>$name,'email'=>$email,'status'=>'ACTIVE'),'tenantId'=>$tenant_id,'branchId'=>$branch_id),201);
        } catch(DomainException $e) {
            $wpdb->query('ROLLBACK'); set_transient($rate_key,$attempts+1,15*MINUTE_IN_SECONDS);
            return $this->api_error('bta_email_exists','Cette adresse e-mail possède déjà un compte. Connectez-vous plutôt.',409);
        } catch(Throwable $e) {
            $wpdb->query('ROLLBACK'); set_transient($rate_key,$attempts+1,15*MINUTE_IN_SECONDS);
            error_log('[FKC] Owner self-registration failed: '.$e->getMessage().' '.$wpdb->last_error);
            return $this->api_error('bta_registration_failed','Impossible de créer le compte et l’entreprise. Réessayez.',500);
        } finally { $wpdb->get_var($wpdb->prepare('SELECT RELEASE_LOCK(%s)',$lock)); }
    }

    /** Inscription publique réservée aux personnes possédant un code d'invitation valide. */
    public function register_invited_endpoint($request) {
        global $wpdb;
        if (!$this->tables_ready() || !$this->sessions_table_exists()) return $this->api_error('bta_unavailable','Service temporairement indisponible.',503);

        $name = sanitize_text_field((string)$request->get_param('full_name'));
        $email = strtolower(trim(sanitize_email((string)$request->get_param('email'))));
        $password = (string)$request->get_param('password');
        $code = trim((string)$request->get_param('code'));
        if (strlen($name)<2 || strlen($name)>150 || !is_email($email) || strlen($email)>190 || strlen($password)<12 || strlen($password)>4096) {
            return $this->api_error('bta_invalid_registration','Nom, adresse e-mail ou mot de passe invalide. Le mot de passe doit contenir au moins 12 caractères.');
        }
        $dot = strpos($code,'.');
        if ($dot===false) return $this->api_error('bta_invitation_invalid','Code d’invitation invalide.');
        $tenant_id = (int)substr($code,0,$dot); $raw_token = substr($code,$dot+1);
        if ($tenant_id<1 || !preg_match('/^[a-f0-9]{64}$/i',$raw_token)) return $this->api_error('bta_invitation_invalid','Code d’invitation invalide.');

        // Limitation des créations de comptes depuis une même adresse IP.
        $rate_key = 'fkc_register_' . hash('sha256',$this->client_ip());
        $attempts = (int)get_transient($rate_key);
        if ($attempts>=5) return $this->api_error('bta_rate_limited','Trop de tentatives. Réessayez dans 15 minutes.',429);

        $users=$this->table('users'); $invitations=$this->table('invitations');
        $inv=$wpdb->get_row($wpdb->prepare("SELECT * FROM {$invitations} WHERE tenant_id=%d AND token_hash=%s LIMIT 1",$tenant_id,hash('sha256',$raw_token)),ARRAY_A);
        if (!$inv || $inv['status']!=='PENDING' || strtotime($inv['expires_at'].' UTC')<=time()) {
            set_transient($rate_key,$attempts+1,15*MINUTE_IN_SECONDS);
            return $this->api_error('bta_invitation_expired','Invitation invalide, expirée ou déjà utilisée.',410);
        }
        if (!$this->invitation_scope_valid($inv,$tenant_id))return $this->api_error('bta_invitation_invalid','Rôle ou accès de cette invitation devenu invalide.',403);
        if ($wpdb->get_var($wpdb->prepare("SELECT id FROM {$users} WHERE email=%s LIMIT 1",$email))) {
            return $this->api_error('bta_email_exists','Cette adresse possède déjà un compte. Connectez-vous avec ce compte puis acceptez l’invitation.',409);
        }
        $branch_ids=json_decode($inv['branches'],true);
        if (!is_array($branch_ids) || !$branch_ids) return $this->api_error('bta_invitation_invalid','Les établissements de cette invitation sont invalides.',409);
        $branches=$this->table('branches');
        foreach ($branch_ids as $branch_id) {
            $branch_id=absint($branch_id);
            if (!$branch_id || !$wpdb->get_var($wpdb->prepare("SELECT id FROM {$branches} WHERE id=%d AND tenant_id=%d AND status='ACTIVE'",$branch_id,$tenant_id))) return $this->api_error('bta_invitation_invalid','Un établissement de cette invitation est invalide.',409);
        }
        $hash=password_hash($password,PASSWORD_DEFAULT);
        if (!$hash) return $this->api_error('bta_registration_failed','Impossible de sécuriser le mot de passe.',500);

        $members=$this->table('members'); $branch_access=$this->table('branch_access'); $sessions=$this->table('sessions');
        $wpdb->query('START TRANSACTION');
        try {
            $locked=$wpdb->get_row($wpdb->prepare("SELECT status,expires_at FROM ".$this->table('invitations')." WHERE id=%d FOR UPDATE",(int)$inv['id']),ARRAY_A);
            if(!$locked||$locked['status']!=='PENDING'||strtotime($locked['expires_at'].' UTC')<=time())throw new RuntimeException('invitation_changed');
            if (!$wpdb->insert($users,array('full_name'=>$name,'email'=>$email,'password_hash'=>$hash,'status'=>'ACTIVE'),array('%s','%s','%s','%s'))) throw new RuntimeException('user_insert');
            $user_id=(int)$wpdb->insert_id;
            if (!$wpdb->insert($members,array('tenant_id'=>$tenant_id,'user_id'=>$user_id,'role'=>$inv['role'],'status'=>'ACTIVE'),array('%d','%d','%s','%s'))) throw new RuntimeException('member_insert');
            $member_id=(int)$wpdb->insert_id;
            foreach ($branch_ids as $branch_id) {
                $permissions=$this->role_defaults[$inv['role']]??array();
                if (!$wpdb->insert($branch_access,array('member_id'=>$member_id,'branch_id'=>absint($branch_id),'permissions'=>wp_json_encode($permissions)),array('%d','%d','%s'))) throw new RuntimeException('branch_access_insert');
            }
            $updated=$wpdb->update($invitations,array('status'=>'ACCEPTED','accepted_by'=>$user_id,'accepted_at'=>gmdate('Y-m-d H:i:s')),array('id'=>(int)$inv['id'],'status'=>'PENDING'),array('%s','%d','%s'),array('%d','%s'));
            if ($updated!==1) throw new RuntimeException('invitation_race');
            $token=bin2hex(random_bytes(32)); $expires=time()+7*DAY_IN_SECONDS;
            if (!$wpdb->insert($sessions,array('user_id'=>$user_id,'token_hash'=>hash('sha256',$token),'expires_at'=>gmdate('Y-m-d H:i:s',$expires),'ip_address'=>$this->client_ip(),'user_agent'=>isset($_SERVER['HTTP_USER_AGENT'])?substr(sanitize_text_field(wp_unslash($_SERVER['HTTP_USER_AGENT'])),0,255):''),array('%d','%s','%s','%s','%s'))) throw new RuntimeException('session_insert');
            $wpdb->query('COMMIT');
            delete_transient($rate_key);
            $this->write_audit($tenant_id,$user_id,'invitation.accepted','invitation',(int)$inv['id'],array('membership_id'=>$member_id,'registration'=>true));
            return new WP_REST_Response(array('success'=>true,'message'=>'Compte créé et invitation acceptée.','token'=>$token,'token_type'=>'Bearer','expires_at'=>gmdate('c',$expires),'user'=>array('id'=>$user_id,'name'=>$name,'email'=>$email,'status'=>'ACTIVE'),'tenantId'=>$tenant_id,'role'=>$inv['role'],'membership_id'=>$member_id),201);
        } catch (Throwable $e) {
            $wpdb->query('ROLLBACK');
            error_log('[FKC] Invited registration failed: '.$e->getMessage().' '.$wpdb->last_error);
            return $this->api_error('bta_registration_failed','Impossible de créer le compte ou d’accepter l’invitation.',500);
        }
    }

    public function invitation_accept_endpoint($request) {
        global $wpdb; $session=$this->current_session($request); if(!$session)return $this->api_error('bta_unauthenticated','Connexion requise.',401);
        $code=trim((string)$request->get_param('code')); $dot=strpos($code,'.');
        if($dot===false)return $this->api_error('bta_invitation_invalid','Code d’invitation invalide.');
        $tenant_id=(int)substr($code,0,$dot); $token=substr($code,$dot+1);
        if($tenant_id<1||!preg_match('/^[a-f0-9]{64}$/i',$token))return $this->api_error('bta_invitation_invalid','Code d’invitation invalide.');
        $i=$this->table('invitations'); $inv=$wpdb->get_row($wpdb->prepare("SELECT * FROM {$i} WHERE tenant_id=%d AND token_hash=%s LIMIT 1",$tenant_id,hash('sha256',$token)),ARRAY_A);
        if(!$inv||$inv['status']!=='PENDING'||strtotime($inv['expires_at'].' UTC')<=time())return $this->api_error('bta_invitation_expired','Invitation invalide, expirée ou déjà utilisée.',410);
        if(!$this->invitation_scope_valid($inv,$tenant_id))return $this->api_error('bta_invitation_invalid','Rôle ou accès de cette invitation devenu invalide.',403);
        if($this->tenant_membership($tenant_id,(int)$session['user_id']))return $this->api_error('bta_membership_exists','Vous êtes déjà membre de cette entreprise.',409);
        $branch_ids=json_decode($inv['branches'],true); if(!is_array($branch_ids)||!$branch_ids)return $this->api_error('bta_invitation_invalid','Les établissements de cette invitation sont invalides.',409);
        $members=$this->table('members'); $access_table=$this->table('branch_access');
        $wpdb->query('START TRANSACTION');
        try {
            $locked=$wpdb->get_row($wpdb->prepare("SELECT status,expires_at FROM ".$this->table('invitations')." WHERE id=%d FOR UPDATE",(int)$inv['id']),ARRAY_A);
            if(!$locked||$locked['status']!=='PENDING'||strtotime($locked['expires_at'].' UTC')<=time())throw new RuntimeException('invitation_changed');
            if(!$wpdb->insert($members,array('tenant_id'=>$tenant_id,'user_id'=>(int)$session['user_id'],'role'=>$inv['role'],'status'=>'ACTIVE'),array('%d','%d','%s','%s')))throw new RuntimeException('member_insert');
            $member_id=(int)$wpdb->insert_id;
            foreach($branch_ids as $branch_id){$branch_id=absint($branch_id);if(!$branch_id)continue;if(!$wpdb->insert($access_table,array('member_id'=>$member_id,'branch_id'=>$branch_id,'permissions'=>wp_json_encode($this->role_defaults[$inv['role']]??array())),array('%d','%d','%s')))throw new RuntimeException('branch_access_insert');}
            $updated=$wpdb->update($i,array('status'=>'ACCEPTED','accepted_by'=>(int)$session['user_id'],'accepted_at'=>gmdate('Y-m-d H:i:s')),array('id'=>(int)$inv['id'],'status'=>'PENDING'),array('%s','%d','%s'),array('%d','%s'));
            if($updated!==1)throw new RuntimeException('invitation_race');
            $wpdb->query('COMMIT');
            $this->write_audit($tenant_id,(int)$session['user_id'],'invitation.accepted','invitation',(int)$inv['id'],array('membership_id'=>$member_id));
            return rest_ensure_response(array('success'=>true,'tenantId'=>$tenant_id,'role'=>$inv['role'],'membership_id'=>$member_id));
        } catch(Throwable $e){$wpdb->query('ROLLBACK');error_log('[FKC] Invitation acceptance failed: '.$e->getMessage().' '.$wpdb->last_error);return $this->api_error('bta_invitation_accept_failed','Impossible d’accepter cette invitation.',500);}
    }

    public function audit_list_endpoint($request) {
        $tenant_id=(int)$request['tenant_id']; $access=$this->tenant_access($request,$tenant_id);
        if(is_wp_error($access))return $access;
        if(!in_array($access['membership']['role'],array('OWNER','ADMIN'),true) && !in_array('audit.read',$this->role_defaults[$access['membership']['role']]??array(),true))return $this->api_error('bta_forbidden','Accès au journal refusé.',403);
        global $wpdb; $a=$this->table('audit_logs'); $limit=min(100,max(1,absint($request->get_param('limit')?:50)));
        $rows=$wpdb->get_results($wpdb->prepare("SELECT id,tenant_id,user_id,action,entity_type,entity_id,details,ip_address,created_at FROM {$a} WHERE tenant_id=%d ORDER BY id DESC LIMIT %d",$tenant_id,$limit),ARRAY_A);
        foreach($rows as &$row){$row['details']=json_decode($row['details'],true) ?: array();} unset($row);
        return rest_ensure_response(array('success'=>true,'logs'=>$rows));
    }

}
