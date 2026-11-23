<?php
if (!defined('ABSPATH')) { exit; }
/** API commerciale BTA : accès tenant, catégories et produits. */
final class FKC_Commercial_API {
    private static function t($name) { global $wpdb; return in_array($name,array('users','tenants','branches','members','permissions','branch_access','invitations','audit_logs','sessions'),true) ? 'bta_' . $name : $wpdb->prefix . 'bta_' . $name; }
    public static function boot() { add_action('rest_api_init', array(__CLASS__, 'routes')); }
    private static function error($code,$message,$status=400) { return new WP_Error($code,$message,array('status'=>$status)); }
    private static function access($request,$tenant,$permission) {
        global $wpdb;
        $h=$request->get_header('authorization');
        if (!$h && isset($_SERVER['HTTP_AUTHORIZATION'])) $h=wp_unslash($_SERVER['HTTP_AUTHORIZATION']);
        if (!is_string($h) || !preg_match('/^Bearer\s+([a-fA-F0-9]{64})$/',$h,$m)) return self::error('bta_unauthenticated','Connexion requise.',401);
        $token=hash('sha256',$m[1]); $sessions=self::t('sessions'); $users=self::t('users');
        $s=$wpdb->get_row($wpdb->prepare("SELECT s.user_id,u.status FROM {$sessions} s JOIN {$users} u ON u.id=s.user_id WHERE s.token_hash=%s AND s.expires_at>%s LIMIT 1",$token,gmdate('Y-m-d H:i:s')),ARRAY_A);
        if (!$s || $s['status']!=='ACTIVE') return self::error('bta_unauthenticated','Session invalide ou expirée.',401);
        $members=self::t('members'); $member=$wpdb->get_row($wpdb->prepare("SELECT id,role FROM {$members} WHERE tenant_id=%d AND user_id=%d AND status='ACTIVE' LIMIT 1",$tenant,$s['user_id']),ARRAY_A);
        if (!$member) return self::error('bta_forbidden','Accès à cette entreprise refusé.',403);
        $defaults=array(
          'OWNER'=>array('stock.manage','stock.read'),
          'ADMIN'=>array('stock.manage','stock.read'),
          'MANAGER'=>array('stock.manage','stock.read'),
          'CASHIER'=>array('stock.read')
        );
        if (!in_array($permission,$defaults[$member['role']]??array(),true)) return self::error('bta_forbidden','Permission insuffisante.',403);
        $wpdb->update($sessions,array('last_used_at'=>gmdate('Y-m-d H:i:s')),array('token_hash'=>$token),array('%s'),array('%s'));
        return array('user_id'=>(int)$s['user_id'],'member'=>$member);
    }
    public static function routes() {
        register_rest_route('bta/v1','/tenants/(?P<tenant_id>\d+)/categories',array(
          array('methods'=>WP_REST_Server::READABLE,'callback'=>array(__CLASS__,'categories_list'),'permission_callback'=>'__return_true'),
          array('methods'=>WP_REST_Server::CREATABLE,'callback'=>array(__CLASS__,'categories_create'),'permission_callback'=>'__return_true')
        ));
        register_rest_route('bta/v1','/tenants/(?P<tenant_id>\d+)/products',array(
          array('methods'=>WP_REST_Server::READABLE,'callback'=>array(__CLASS__,'products_list'),'permission_callback'=>'__return_true'),
          array('methods'=>WP_REST_Server::CREATABLE,'callback'=>array(__CLASS__,'products_create'),'permission_callback'=>'__return_true')
        ));
        register_rest_route('bta/v1','/tenants/(?P<tenant_id>\d+)/products/(?P<product_id>\d+)',array('methods'=>WP_REST_Server::EDITABLE,'callback'=>array(__CLASS__,'products_update'),'permission_callback'=>'__return_true'));
    }
    public static function categories_list($r) {
        $tenant=(int)$r['tenant_id']; $a=self::access($r,$tenant,'stock.read'); if(is_wp_error($a))return $a;
        global $wpdb; $table=self::t('categories'); $page=max(1,(int)$r->get_param('page')); $limit=min(100,max(1,(int)($r->get_param('per_page')?:25))); $q=sanitize_text_field((string)$r->get_param('search')); $where='tenant_id=%d'; $args=array($tenant);
        if($q!==''){$where.=' AND name LIKE %s';$args[]='%'.$wpdb->esc_like($q).'%';}
        $total=(int)$wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$table} WHERE {$where}",...$args));
        $rows=$wpdb->get_results($wpdb->prepare("SELECT id,parent_id,name,description,status,created_at,updated_at FROM {$table} WHERE {$where} ORDER BY name ASC LIMIT %d OFFSET %d",array_merge($args,array($limit,($page-1)*$limit))),ARRAY_A);
        return rest_ensure_response(array('success'=>true,'categories'=>$rows,'pagination'=>array('page'=>$page,'per_page'=>$limit,'total'=>$total,'pages'=>(int)ceil($total/$limit))));
    }
    public static function categories_create($r) {
        $tenant=(int)$r['tenant_id']; $a=self::access($r,$tenant,'stock.manage'); if(is_wp_error($a))return $a;
        $name=sanitize_text_field((string)$r->get_param('name')); if(strlen($name)<2||strlen($name)>150)return self::error('bta_invalid_category','Le nom de catégorie doit contenir entre 2 et 150 caractères.');
        global $wpdb; $t=self::t('categories'); $now=gmdate('Y-m-d H:i:s'); $parent=absint($r->get_param('parent_id'));
        if($parent && !$wpdb->get_var($wpdb->prepare("SELECT id FROM {$t} WHERE id=%d AND tenant_id=%d",$parent,$tenant)))return self::error('bta_invalid_parent','Catégorie parente introuvable.',404);
        $ok=$wpdb->insert($t,array('tenant_id'=>$tenant,'parent_id'=>$parent?:null,'name'=>$name,'description'=>sanitize_textarea_field((string)$r->get_param('description')),'status'=>'ACTIVE','created_by'=>$a['user_id'],'created_at'=>$now,'updated_at'=>$now),array('%d','%d','%s','%s','%s','%d','%s','%s'));
        if(!$ok)return self::error('bta_category_create_failed','Création impossible.',500);
        return new WP_REST_Response(array('success'=>true,'category'=>array('id'=>(int)$wpdb->insert_id,'name'=>$name,'parent_id'=>$parent?:null,'status'=>'ACTIVE')),201);
    }
    public static function products_list($r) {
        $tenant=(int)$r['tenant_id']; $a=self::access($r,$tenant,'stock.read'); if(is_wp_error($a))return $a;
        global $wpdb; $t=self::t('products'); $page=max(1,(int)$r->get_param('page')); $limit=min(100,max(1,(int)($r->get_param('per_page')?:25))); $q=sanitize_text_field((string)$r->get_param('search')); $where="tenant_id=%d AND status='ACTIVE'"; $args=array($tenant);
        if($q!==''){$like='%'.$wpdb->esc_like($q).'%';$where.=' AND (name LIKE %s OR sku LIKE %s OR barcode LIKE %s)';array_push($args,$like,$like,$like);}
        if($r->get_param('category_id')){$where.=' AND category_id=%d';$args[]=absint($r->get_param('category_id'));}
        $total=(int)$wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$t} WHERE {$where}",...$args));
        $rows=$wpdb->get_results($wpdb->prepare("SELECT id,category_id,sku,barcode,name,description,unit,purchase_price,sale_price,currency,image_url,track_stock,min_stock,status,created_at,updated_at FROM {$t} WHERE {$where} ORDER BY name ASC LIMIT %d OFFSET %d",array_merge($args,array($limit,($page-1)*$limit))),ARRAY_A);
        return rest_ensure_response(array('success'=>true,'products'=>$rows,'pagination'=>array('page'=>$page,'per_page'=>$limit,'total'=>$total,'pages'=>(int)ceil($total/$limit))));
    }
    public static function products_create($r) {
        $tenant=(int)$r['tenant_id']; $a=self::access($r,$tenant,'stock.manage'); if(is_wp_error($a))return $a;
        $sku=sanitize_text_field((string)$r->get_param('sku')); $name=sanitize_text_field((string)$r->get_param('name')); $currency=strtoupper(sanitize_text_field((string)($r->get_param('currency')?:'USD')));
        if(strlen($sku)<1||strlen($sku)>100||strlen($name)<2||strlen($name)>190||!in_array($currency,array('USD','CDF'),true))return self::error('bta_invalid_product','SKU, nom ou devise invalide.');
        $purchase=max(0,(float)$r->get_param('purchase_price')); $sale=max(0,(float)$r->get_param('sale_price')); $category=absint($r->get_param('category_id'));
        global $wpdb; $t=self::t('products');
        if($category && !$wpdb->get_var($wpdb->prepare('SELECT id FROM '.self::t('categories').' WHERE id=%d AND tenant_id=%d',$category,$tenant)))return self::error('bta_invalid_category','Catégorie introuvable.',404);
        $now=gmdate('Y-m-d H:i:s'); $data=array('tenant_id'=>$tenant,'category_id'=>$category?:null,'sku'=>$sku,'barcode'=>sanitize_text_field((string)$r->get_param('barcode')),'name'=>$name,'description'=>sanitize_textarea_field((string)$r->get_param('description')),'unit'=>sanitize_key((string)($r->get_param('unit')?:'piece')),'purchase_price'=>$purchase,'sale_price'=>$sale,'currency'=>$currency,'image_url'=>esc_url_raw((string)$r->get_param('image_url')),'track_stock'=>$r->get_param('track_stock')===false?0:1,'min_stock'=>max(0,(float)$r->get_param('min_stock')),'status'=>'ACTIVE','created_by'=>$a['user_id'],'created_at'=>$now,'updated_at'=>$now);
        $branch=absint($r->get_param('branch_id'));$initial=max(0,(float)$r->get_param('initial_stock'));
        if($initial>0&&!$branch)return self::error('bta_branch_required','branch_id requis pour initialiser le stock.');
        if($branch&&!$wpdb->get_var($wpdb->prepare("SELECT id FROM ".self::t('branches')." WHERE id=%d AND tenant_id=%d AND status='ACTIVE'",$branch,$tenant)))return self::error('bta_invalid_branch','Établissement introuvable.',404);
        $wpdb->query('START TRANSACTION');
        if(!$wpdb->insert($t,$data)){$wpdb->query('ROLLBACK');return self::error('bta_product_create_failed',$wpdb->last_error?:'Création impossible.',409);}
        $product_id=(int)$wpdb->insert_id;
        if($initial>0&&$data['track_stock']){
            $stock_ok=$wpdb->insert(self::t('stock'),array('tenant_id'=>$tenant,'branch_id'=>$branch,'product_id'=>$product_id,'quantity'=>$initial,'updated_at'=>$now));
            $move_ok=$stock_ok?$wpdb->insert(self::t('stock_movements'),array('tenant_id'=>$tenant,'branch_id'=>$branch,'product_id'=>$product_id,'movement_type'=>'ADJUSTMENT','quantity'=>$initial,'reference_type'=>'INITIAL_STOCK','reference_id'=>0,'notes'=>'Stock initial produit','created_by'=>$a['user_id'],'created_at'=>$now)):false;
            if(!$stock_ok||!$move_ok){$wpdb->query('ROLLBACK');return self::error('bta_product_stock_create_failed','Produit ou stock initial non enregistré.',500);}
        }
        $wpdb->query('COMMIT');
        return new WP_REST_Response(array('success'=>true,'product'=>array('id'=>$product_id,'sku'=>$sku,'name'=>$name,'currency'=>$currency,'status'=>'ACTIVE','branch_id'=>$branch?:null,'current_stock'=>$initial)),201);
    }
    public static function products_update($r) {
        $tenant=(int)$r['tenant_id']; $a=self::access($r,$tenant,'stock.manage'); if(is_wp_error($a))return $a;
        global $wpdb; $t=self::t('products'); $id=(int)$r['product_id']; $old=$wpdb->get_row($wpdb->prepare("SELECT * FROM {$t} WHERE id=%d AND tenant_id=%d",$id,$tenant),ARRAY_A); if(!$old)return self::error('bta_product_not_found','Produit introuvable.',404);
        $allowed=array('name','sku','barcode','description','unit','purchase_price','sale_price','currency','image_url','min_stock','track_stock','category_id','status'); $data=array();
        foreach($allowed as $key){$v=$r->get_param($key);if($v===null)continue;if(in_array($key,array('name','sku','barcode','unit','currency'),true))$v=sanitize_text_field((string)$v);if(in_array($key,array('purchase_price','sale_price','min_stock'),true))$v=max(0,(float)$v);if($key==='currency')$v=strtoupper($v);if($key==='currency'&&!in_array($v,array('USD','CDF'),true))return self::error('bta_invalid_currency','Devise non prise en charge.');if($key==='track_stock')$v=$v?1:0;if($key==='category_id')$v=absint($v)?:null;if($key==='image_url')$v=esc_url_raw((string)$v);if($key==='description')$v=sanitize_textarea_field((string)$v);$data[$key]=$v;}
        if(isset($data['category_id'])&&$data['category_id']&&!$wpdb->get_var($wpdb->prepare('SELECT id FROM '.self::t('categories').' WHERE id=%d AND tenant_id=%d',$data['category_id'],$tenant)))return self::error('bta_invalid_category','Catégorie introuvable.',404);
        if(isset($data['status'])) {
            if(!in_array($data['status'],array('ACTIVE','ARCHIVED'),true))return self::error('bta_invalid_product_status','Statut produit invalide.');
            if($data['status']==='ARCHIVED' && (float)$wpdb->get_var($wpdb->prepare('SELECT COALESCE(SUM(ABS(quantity)),0) FROM '.self::t('stock').' WHERE tenant_id=%d AND product_id=%d',$tenant,$id))>0)return self::error('bta_product_stock_remaining','Stock restant dans un établissement; archivage refusé.',409);
        }
        if(!$data)return self::error('bta_no_changes','Aucune modification fournie.');$data['updated_at']=gmdate('Y-m-d H:i:s');if($wpdb->update($t,$data,array('id'=>$id,'tenant_id'=>$tenant))===false)return self::error('bta_product_update_failed','Modification impossible.',500);
        return rest_ensure_response(array('success'=>true,'product'=>array_merge($old,$data,array('id'=>$id))));
    }
}
