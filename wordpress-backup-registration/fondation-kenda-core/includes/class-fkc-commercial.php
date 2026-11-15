<?php
if (!defined('ABSPATH')) { exit; }

/**
 * Schéma commercial BTA Manager.
 * Les tables sont isolées par tenant_id et branch_id. Aucun stock n'est créé
 * lors d'un pré-enregistrement : seuls les mouvements validés alimentent le stock.
 */
final class FKC_Commercial {
    const SCHEMA_VERSION = '1.0.3';

    public static function boot() {
        add_action('init', array(__CLASS__, 'maybe_upgrade'), 2);
        add_action('rest_api_init', array(__CLASS__, 'register_routes'));
    }

    public static function maybe_upgrade() {
        if (get_option('fkc_commercial_schema_version') === self::SCHEMA_VERSION) return;
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $c = $wpdb->get_charset_collate();
        $p = $wpdb->prefix . 'bta_';
        $sql = array();
        $sql[] = "CREATE TABLE {$p}categories (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, tenant_id BIGINT UNSIGNED NOT NULL,
            parent_id BIGINT UNSIGNED NULL, name VARCHAR(150) NOT NULL, description TEXT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE', created_by BIGINT UNSIGNED NOT NULL,
            created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,
            PRIMARY KEY  (id), KEY tenant_parent (tenant_id,parent_id), KEY tenant_status (tenant_id,status)
        ) {$c};";
        $sql[] = "CREATE TABLE {$p}products (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, tenant_id BIGINT UNSIGNED NOT NULL,
            category_id BIGINT UNSIGNED NULL, sku VARCHAR(100) NOT NULL, barcode VARCHAR(100) NULL,
            name VARCHAR(190) NOT NULL, description LONGTEXT NULL, unit VARCHAR(40) NOT NULL DEFAULT 'piece',
            purchase_price DECIMAL(18,4) NOT NULL DEFAULT 0, sale_price DECIMAL(18,4) NOT NULL DEFAULT 0,
            currency CHAR(3) NOT NULL DEFAULT 'USD', image_url TEXT NULL, track_stock TINYINT(1) NOT NULL DEFAULT 1,
            min_stock DECIMAL(18,4) NOT NULL DEFAULT 0, status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
            created_by BIGINT UNSIGNED NOT NULL, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,
            PRIMARY KEY  (id), UNIQUE KEY tenant_sku (tenant_id,sku), KEY tenant_barcode (tenant_id,barcode),
            KEY tenant_name (tenant_id,name), KEY tenant_category (tenant_id,category_id)
        ) {$c};";
        $sql[] = "CREATE TABLE {$p}suppliers (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, tenant_id BIGINT UNSIGNED NOT NULL,
            name VARCHAR(190) NOT NULL, phone VARCHAR(60) NULL, email VARCHAR(190) NULL,
            address TEXT NULL, notes LONGTEXT NULL, status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
            created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,
            PRIMARY KEY  (id), KEY tenant_name (tenant_id,name), KEY tenant_status (tenant_id,status)
        ) {$c};";
        $sql[] = "CREATE TABLE {$p}customers (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, tenant_id BIGINT UNSIGNED NOT NULL,
            name VARCHAR(190) NOT NULL, phone VARCHAR(60) NULL, email VARCHAR(190) NULL,
            address TEXT NULL, notes LONGTEXT NULL, credit_limit DECIMAL(18,4) NOT NULL DEFAULT 0,
            status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE', created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,
            PRIMARY KEY  (id), KEY tenant_name (tenant_id,name), KEY tenant_phone (tenant_id,phone)
        ) {$c};";
        $sql[] = "CREATE TABLE {$p}preorders (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, tenant_id BIGINT UNSIGNED NOT NULL,
            branch_id BIGINT UNSIGNED NOT NULL, supplier_id BIGINT UNSIGNED NULL,
            reference VARCHAR(100) NOT NULL, title VARCHAR(190) NOT NULL, status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
            currency CHAR(3) NOT NULL DEFAULT 'USD', exchange_rate DECIMAL(18,6) NOT NULL DEFAULT 1,
            estimated_subtotal DECIMAL(18,4) NOT NULL DEFAULT 0, estimated_fees DECIMAL(18,4) NOT NULL DEFAULT 0,
            estimated_total DECIMAL(18,4) NOT NULL DEFAULT 0, amount_paid DECIMAL(18,4) NOT NULL DEFAULT 0,
            tracking_number VARCHAR(150) NULL, origin VARCHAR(190) NULL, destination VARCHAR(190) NULL,
            ordered_at DATETIME NULL, shipped_at DATETIME NULL, expected_at DATETIME NULL, notes LONGTEXT NULL,
            created_by BIGINT UNSIGNED NOT NULL, received_by BIGINT UNSIGNED NULL,
            created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,
            PRIMARY KEY  (id), UNIQUE KEY tenant_reference (tenant_id,reference),
            KEY tenant_branch_status (tenant_id,branch_id,status), KEY tenant_expected (tenant_id,expected_at)
        ) {$c};";
        $sql[] = "CREATE TABLE {$p}preorder_items (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, tenant_id BIGINT UNSIGNED NOT NULL,
            preorder_id BIGINT UNSIGNED NOT NULL, product_id BIGINT UNSIGNED NULL,
            description VARCHAR(255) NOT NULL, quantity_ordered DECIMAL(18,4) NOT NULL,
            quantity_shipped DECIMAL(18,4) NOT NULL DEFAULT 0, quantity_received DECIMAL(18,4) NOT NULL DEFAULT 0,
            unit_cost DECIMAL(18,4) NOT NULL DEFAULT 0, currency CHAR(3) NOT NULL DEFAULT 'USD',
            created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,
            PRIMARY KEY  (id), KEY tenant_preorder (tenant_id,preorder_id), KEY tenant_product (tenant_id,product_id)
        ) {$c};";
        $sql[] = "CREATE TABLE {$p}purchases (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, tenant_id BIGINT UNSIGNED NOT NULL,
            branch_id BIGINT UNSIGNED NOT NULL, supplier_id BIGINT UNSIGNED NULL, preorder_id BIGINT UNSIGNED NULL,
            reference VARCHAR(100) NOT NULL, status VARCHAR(30) NOT NULL DEFAULT 'RECEIVED',
            currency CHAR(3) NOT NULL DEFAULT 'USD', exchange_rate DECIMAL(18,6) NOT NULL DEFAULT 1,
            subtotal DECIMAL(18,4) NOT NULL DEFAULT 0, fees DECIMAL(18,4) NOT NULL DEFAULT 0,
            total DECIMAL(18,4) NOT NULL DEFAULT 0, paid DECIMAL(18,4) NOT NULL DEFAULT 0,
            notes LONGTEXT NULL, created_by BIGINT UNSIGNED NOT NULL, created_at DATETIME NOT NULL,
            PRIMARY KEY  (id), UNIQUE KEY tenant_reference (tenant_id,reference), KEY tenant_date (tenant_id,created_at)
        ) {$c};";
        $sql[] = "CREATE TABLE {$p}purchase_items (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, tenant_id BIGINT UNSIGNED NOT NULL,
            purchase_id BIGINT UNSIGNED NOT NULL, product_id BIGINT UNSIGNED NOT NULL,
            quantity DECIMAL(18,4) NOT NULL, unit_cost DECIMAL(18,4) NOT NULL,
            line_total DECIMAL(18,4) NOT NULL, created_at DATETIME NOT NULL,
            PRIMARY KEY  (id), KEY tenant_purchase (tenant_id,purchase_id), KEY tenant_product (tenant_id,product_id)
        ) {$c};";
        $sql[] = "CREATE TABLE {$p}stock (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, tenant_id BIGINT UNSIGNED NOT NULL,
            branch_id BIGINT UNSIGNED NOT NULL, product_id BIGINT UNSIGNED NOT NULL,
            quantity DECIMAL(18,4) NOT NULL DEFAULT 0, updated_at DATETIME NOT NULL,
            PRIMARY KEY  (id), UNIQUE KEY tenant_branch_product (tenant_id,branch_id,product_id),
            KEY tenant_product (tenant_id,product_id)
        ) {$c};";
        $sql[] = "CREATE TABLE {$p}stock_transfers (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, tenant_id BIGINT UNSIGNED NOT NULL,
            from_branch_id BIGINT UNSIGNED NOT NULL, to_branch_id BIGINT UNSIGNED NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'COMPLETED', created_by BIGINT UNSIGNED NOT NULL,
            created_at DATETIME NOT NULL, PRIMARY KEY (id), KEY tenant_date (tenant_id,created_at)
        ) {$c};";
        $sql[] = "CREATE TABLE {$p}stock_movements (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, tenant_id BIGINT UNSIGNED NOT NULL,
            branch_id BIGINT UNSIGNED NOT NULL, product_id BIGINT UNSIGNED NOT NULL,
            movement_type VARCHAR(30) NOT NULL, quantity DECIMAL(18,4) NOT NULL,
            reference_type VARCHAR(40) NULL, reference_id BIGINT UNSIGNED NULL,
            notes TEXT NULL, created_by BIGINT UNSIGNED NOT NULL, created_at DATETIME NOT NULL,
            PRIMARY KEY  (id), KEY tenant_branch_date (tenant_id,branch_id,created_at),
            KEY tenant_product_date (tenant_id,product_id,created_at), KEY reference_lookup (reference_type,reference_id)
        ) {$c};";
        $sql[] = "CREATE TABLE {$p}sales (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, tenant_id BIGINT UNSIGNED NOT NULL,
            branch_id BIGINT UNSIGNED NOT NULL, customer_id BIGINT UNSIGNED NULL,
            reference VARCHAR(100) NOT NULL, status VARCHAR(30) NOT NULL DEFAULT 'COMPLETED',
            currency CHAR(3) NOT NULL DEFAULT 'USD', exchange_rate DECIMAL(18,6) NOT NULL DEFAULT 1,
            subtotal DECIMAL(18,4) NOT NULL DEFAULT 0, discount DECIMAL(18,4) NOT NULL DEFAULT 0,
            total DECIMAL(18,4) NOT NULL DEFAULT 0, paid DECIMAL(18,4) NOT NULL DEFAULT 0,
            balance DECIMAL(18,4) NOT NULL DEFAULT 0, notes TEXT NULL, created_by BIGINT UNSIGNED NOT NULL,
            created_at DATETIME NOT NULL, cancelled_at DATETIME NULL, cancelled_by BIGINT UNSIGNED NULL,
            PRIMARY KEY  (id), UNIQUE KEY tenant_reference (tenant_id,reference), KEY tenant_branch_date (tenant_id,branch_id,created_at),
            KEY tenant_customer (tenant_id,customer_id)
        ) {$c};";
        $sql[] = "CREATE TABLE {$p}sale_items (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, tenant_id BIGINT UNSIGNED NOT NULL,
            sale_id BIGINT UNSIGNED NOT NULL, product_id BIGINT UNSIGNED NOT NULL,
            quantity DECIMAL(18,4) NOT NULL, unit_price DECIMAL(18,4) NOT NULL,
            unit_cost DECIMAL(18,4) NOT NULL DEFAULT 0, line_total DECIMAL(18,4) NOT NULL,
            PRIMARY KEY  (id), KEY tenant_sale (tenant_id,sale_id), KEY tenant_product (tenant_id,product_id)
        ) {$c};";
        $sql[] = "CREATE TABLE {$p}payments (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, tenant_id BIGINT UNSIGNED NOT NULL,
            branch_id BIGINT UNSIGNED NOT NULL, entity_type VARCHAR(30) NOT NULL, entity_id BIGINT UNSIGNED NOT NULL,
            payment_type VARCHAR(30) NOT NULL, amount DECIMAL(18,4) NOT NULL, currency CHAR(3) NOT NULL,
            exchange_rate DECIMAL(18,6) NOT NULL DEFAULT 1, method VARCHAR(30) NOT NULL,
            reference VARCHAR(120) NULL, notes TEXT NULL, created_by BIGINT UNSIGNED NOT NULL, created_at DATETIME NOT NULL,
            PRIMARY KEY  (id), KEY tenant_entity (tenant_id,entity_type,entity_id), KEY tenant_date (tenant_id,created_at)
        ) {$c};";
        $sql[] = "CREATE TABLE {$p}debts (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, tenant_id BIGINT UNSIGNED NOT NULL,
            branch_id BIGINT UNSIGNED NOT NULL, customer_id BIGINT UNSIGNED NOT NULL,
            sale_id BIGINT UNSIGNED NULL, original_amount DECIMAL(18,4) NOT NULL,
            paid_amount DECIMAL(18,4) NOT NULL DEFAULT 0, balance DECIMAL(18,4) NOT NULL,
            currency CHAR(3) NOT NULL DEFAULT 'USD', status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
            due_at DATETIME NULL, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,
            PRIMARY KEY  (id), KEY tenant_customer_status (tenant_id,customer_id,status), KEY tenant_branch (tenant_id,branch_id)
        ) {$c};";
        $sql[] = "CREATE TABLE {$p}expenses (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, tenant_id BIGINT UNSIGNED NOT NULL,
            branch_id BIGINT UNSIGNED NOT NULL, category VARCHAR(100) NOT NULL, description TEXT NULL,
            amount DECIMAL(18,4) NOT NULL, currency CHAR(3) NOT NULL, exchange_rate DECIMAL(18,6) NOT NULL DEFAULT 1,
            payment_method VARCHAR(30) NULL, receipt_url TEXT NULL, created_by BIGINT UNSIGNED NOT NULL,
            created_at DATETIME NOT NULL, PRIMARY KEY  (id), KEY tenant_branch_date (tenant_id,branch_id,created_at)
        ) {$c};";
        $sql[] = "CREATE TABLE {$p}cash_sessions (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, tenant_id BIGINT UNSIGNED NOT NULL,
            branch_id BIGINT UNSIGNED NOT NULL, user_id BIGINT UNSIGNED NOT NULL,
            opening_amount DECIMAL(18,4) NOT NULL DEFAULT 0, closing_amount DECIMAL(18,4) NULL,
            currency CHAR(3) NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
            opened_at DATETIME NOT NULL, closed_at DATETIME NULL,
            PRIMARY KEY  (id), KEY tenant_branch_status (tenant_id,branch_id,status)
        ) {$c};";
        $sql[] = "CREATE TABLE {$p}cash_movements (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, tenant_id BIGINT UNSIGNED NOT NULL,
            cash_session_id BIGINT UNSIGNED NOT NULL, movement_type VARCHAR(30) NOT NULL,
            amount DECIMAL(18,4) NOT NULL, currency CHAR(3) NOT NULL, description TEXT NULL,
            reference_type VARCHAR(40) NULL, reference_id BIGINT UNSIGNED NULL,
            created_by BIGINT UNSIGNED NOT NULL, created_at DATETIME NOT NULL,
            PRIMARY KEY  (id), KEY tenant_session (tenant_id,cash_session_id), KEY tenant_date (tenant_id,created_at)
        ) {$c};";
        $sql[] = "CREATE TABLE {$p}exchange_rates (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, tenant_id BIGINT UNSIGNED NOT NULL,
            from_currency CHAR(3) NOT NULL, to_currency CHAR(3) NOT NULL,
            rate DECIMAL(18,6) NOT NULL, effective_at DATETIME NOT NULL,
            created_by BIGINT UNSIGNED NOT NULL, created_at DATETIME NOT NULL,
            PRIMARY KEY  (id), KEY tenant_pair_date (tenant_id,from_currency,to_currency,effective_at)
        ) {$c};";
        $sql[] = "CREATE TABLE {$p}sale_refunds (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, tenant_id BIGINT UNSIGNED NOT NULL,
            branch_id BIGINT UNSIGNED NOT NULL, sale_id BIGINT UNSIGNED NOT NULL,
            amount DECIMAL(18,4) NOT NULL, currency CHAR(3) NOT NULL,
            method VARCHAR(30) NOT NULL, reference VARCHAR(120) NULL, notes TEXT NULL,
            created_by BIGINT UNSIGNED NOT NULL, created_at DATETIME NOT NULL,
            PRIMARY KEY (id), KEY tenant_sale (tenant_id,sale_id), KEY tenant_date (tenant_id,created_at)
        ) {$c};";
        $sql[] = "CREATE TABLE {$p}stock_conflict_resolutions (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, tenant_id BIGINT UNSIGNED NOT NULL,
            branch_id BIGINT UNSIGNED NOT NULL, product_id BIGINT UNSIGNED NOT NULL,
            decision VARCHAR(30) NOT NULL, quantity_before DECIMAL(18,4) NOT NULL,
            quantity_delta DECIMAL(18,4) NOT NULL DEFAULT 0, quantity_after DECIMAL(18,4) NOT NULL,
            reason TEXT NULL, resolved_by BIGINT UNSIGNED NOT NULL, created_at DATETIME NOT NULL,
            PRIMARY KEY (id), KEY tenant_product_date (tenant_id,product_id,created_at),
            KEY tenant_branch_date (tenant_id,branch_id,created_at)
        ) {$c};";
        foreach ($sql as $statement) dbDelta($statement);
        update_option('fkc_commercial_schema_version', self::SCHEMA_VERSION, false);
        update_option('fkc_commercial_schema_updated_at', current_time('mysql', true), false);
    }

    public static function register_routes() {
        register_rest_route('bta/v1', '/commercial/schema', array(
            'methods' => WP_REST_Server::READABLE,
            'callback' => array(__CLASS__, 'schema_status'),
            'permission_callback' => '__return_true'
        ));
    }

    public static function schema_status() {
        global $wpdb;
        $names = array('categories','products','suppliers','customers','preorders','preorder_items','purchases','purchase_items','stock','stock_transfers','stock_movements','sales','sale_items','payments','debts','expenses','cash_sessions','cash_movements','exchange_rates','sale_refunds','stock_conflict_resolutions');
        $status = array();
        foreach ($names as $name) {
            $table = $wpdb->prefix . 'bta_' . $name;
            $status[$table] = ($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $wpdb->esc_like($table))) === $table);
        }
        return rest_ensure_response(array('success' => !in_array(false, $status, true), 'schema_version' => self::SCHEMA_VERSION, 'tables' => $status));
    }
}
