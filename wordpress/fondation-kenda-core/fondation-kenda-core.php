<?php
/**
 * Plugin Name: Fondation Kenda Core
 * Description: Socle central de Fondation Kenda et API sécurisée de BTA Manager.
 * Version: 0.5.34
 * Author: Fondation Kenda
 * Requires PHP: 7.4
 * Text Domain: fondation-kenda-core
 */
if (!defined('ABSPATH')) { exit; }
define('FKC_VERSION', '0.5.34');
define('FKC_PLUGIN_FILE', __FILE__);
define('FKC_PLUGIN_DIR', plugin_dir_path(__FILE__));
require_once FKC_PLUGIN_DIR . 'includes/class-fkc-core.php';
require_once FKC_PLUGIN_DIR . 'includes/class-fkc-commercial.php';
require_once FKC_PLUGIN_DIR . 'includes/class-fkc-commercial-api.php';
require_once FKC_PLUGIN_DIR . 'includes/class-fkc-product-images-api.php';
require_once FKC_PLUGIN_DIR . 'includes/class-fkc-history-api.php';
require_once FKC_PLUGIN_DIR . 'includes/class-fkc-preorders-api.php';
require_once FKC_PLUGIN_DIR . 'includes/class-fkc-purchases-api.php';
require_once FKC_PLUGIN_DIR . 'includes/class-fkc-sales-api.php';
require_once FKC_PLUGIN_DIR . 'includes/class-fkc-finance-api.php';
require_once FKC_PLUGIN_DIR . 'includes/class-fkc-refunds-api.php';
require_once FKC_PLUGIN_DIR . 'includes/class-fkc-stock-ops-api.php';
require_once FKC_PLUGIN_DIR . 'includes/class-fkc-sync-api.php';
require_once FKC_PLUGIN_DIR . 'includes/class-fkc-sync-push-api.php';
require_once FKC_PLUGIN_DIR . 'includes/class-fkc-branch-access.php';
require_once FKC_PLUGIN_DIR . 'includes/class-fkc-sync-adapters.php';
add_action('plugins_loaded', static function () {
    FKC_Core::instance();
    FKC_Commercial::boot();
    FKC_Commercial_API::boot();
    FKC_Product_Images_API::boot();
    FKC_History_API::boot();
    FKC_Preorders_API::boot();
    FKC_Purchases_API::boot();
    FKC_Sales_API::boot();
    FKC_Finance_API::boot();
    FKC_Refunds_API::boot();
    FKC_Stock_Ops_API::boot();
    FKC_Sync_API::boot();
    FKC_Sync_Push_API::boot();
    FKC_Branch_Access::boot();
});

/* 0.5.33 : les réponses de l'API BTA contiennent des données privées (session, stock, ventes) : jamais de mise en cache. */
add_filter('rest_post_dispatch', function ($result, $server, $request) {
    if (is_object($result) && method_exists($result, 'header') && strpos($request->get_route(), '/bta/v1') === 0) {
        $result->header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0, private');
        $result->header('Pragma', 'no-cache');
    }
    return $result;
}, 10, 3);
