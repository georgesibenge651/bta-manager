<?php
if (!defined('ABSPATH')) { exit; }
/** Pré-enregistrements et réceptions partielles. Le stock n'est modifié qu'à réception. */
final class FKC_Preorders_API {
    private static function t($n){ global $wpdb; return in_array($n,array('users','tenants','branches','members','permissions','branch_access','invitations','audit_logs','sessions'),true)?'bta_'.$n:$wpdb->prefix.'bta_'.$n; }
    private static function err($c,$m,$s=400){ return new WP_Error($c,$m,array('status'=>$s)); }
    private static function auth($r,$tenant,$permission){
        $h=$r->get_header('authorization'); if(!$h && isset($_SERVER['HTTP_AUTHORIZATION'])) $h=wp_unslash($_SERVER['HTTP_AUTHORIZATION']);
        if(!is_string($h)||!preg_match('/^Bearer\s+([a-fA-F0-9]{64})$/',$h,$m)) return self::err('bta_unauthenticated','Connexion requise.',401);
        global $wpdb; $hash=hash('sha256',$m[1]);
        $s=$wpdb->get_row($wpdb->prepare('SELECT s.user_id,u.status FROM '.self::t('sessions').' s JOIN '.self::t('users').' u ON u.id=s.user_id WHERE s.token_hash=%s AND s.expires_at>%s LIMIT 1',$hash,gmdate('Y-m-d H:i:s')),ARRAY_A);
        if(!$s||$s['status']!=='ACTIVE')return self::err('bta_unauthenticated','Session invalide ou expirée.',401);
        $mem=$wpdb->get_row($wpdb->prepare("SELECT id,role FROM ".self::t('members')." WHERE tenant_id=%d AND user_id=%d AND status='ACTIVE' LIMIT 1",$tenant,$s['user_id']),ARRAY_A);
        if(!$mem)return self::err('bta_forbidden','Accès refusé.',403);
        $map=array('OWNER'=>array('stock.read','stock.manage'),'ADMIN'=>array('stock.read','stock.manage'),'MANAGER'=>array('stock.read','stock.manage'),'CASHIER'=>array('stock.read'));
        if(!in_array($permission,$map[$mem['role']]??array(),true))return self::err('bta_forbidden','Permission insuffisante.',403);
        return array('user_id'=>(int)$s['user_id']);
    }
    public static function boot(){add_action('rest_api_init',array(__CLASS__,'routes'));}
    public static function routes(){
        register_rest_route('bta/v1','/tenants/(?P<tenant_id>\d+)/preorders',array(
            array('methods'=>WP_REST_Server::READABLE,'callback'=>array(__CLASS__,'listing'),'permission_callback'=>'__return_true'),
            array('methods'=>WP_REST_Server::CREATABLE,'callback'=>array(__CLASS__,'create'),'permission_callback'=>'__return_true')
        ));
        register_rest_route('bta/v1','/tenants/(?P<tenant_id>\d+)/preorders/(?P<preorder_id>\d+)/receive',array('methods'=>WP_REST_Server::CREATABLE,'callback'=>array(__CLASS__,'receive'),'permission_callback'=>'__return_true'));
    }
    public static function listing($r){
        $tenant=(int)$r['tenant_id'];$a=self::auth($r,$tenant,'stock.read');if(is_wp_error($a))return $a;
        global $wpdb;$t=self::t('preorders');$page=max(1,(int)$r->get_param('page'));$limit=min(100,max(1,(int)($r->get_param('per_page')?:25)));
        $branch=absint($r->get_param('branch_id'));$where='tenant_id=%d';$args=array($tenant);if($branch){$where.=' AND branch_id=%d';$args[]=$branch;}
        $list_args=array_merge($args,array($limit,($page-1)*$limit));$rows=$wpdb->get_results($wpdb->prepare("SELECT id,branch_id,supplier_id,reference,title,status,currency,estimated_total,amount_paid,tracking_number,origin,destination,expected_at,created_at FROM {$t} WHERE {$where} ORDER BY id DESC LIMIT %d OFFSET %d",$list_args),ARRAY_A);
        $total=(int)$wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$t} WHERE {$where}",$args));
        return rest_ensure_response(array('success'=>true,'preorders'=>$rows,'pagination'=>array('page'=>$page,'per_page'=>$limit,'total'=>$total,'pages'=>(int)ceil($total/$limit))));
    }
    public static function create($r){
        $tenant=(int)$r['tenant_id'];$a=self::auth($r,$tenant,'stock.manage');if(is_wp_error($a))return $a;
        $branch=absint($r->get_param('branch_id'));$title=sanitize_text_field((string)$r->get_param('title'));$reference=sanitize_text_field((string)$r->get_param('reference'));
        $currency=strtoupper(sanitize_text_field((string)($r->get_param('currency')?:'USD')));$rate=(float)($r->get_param('exchange_rate')?:1);$items=$r->get_param('items');
        if(!$branch||strlen($title)<2||strlen($reference)<2||!in_array($currency,array('USD','CDF'),true)||$rate<=0||!is_array($items)||!count($items))return self::err('bta_invalid_preorder','Référence, titre, établissement, devise, taux et articles sont requis.');
        global $wpdb;$branches=self::t('branches');if(!$wpdb->get_var($wpdb->prepare("SELECT id FROM {$branches} WHERE id=%d AND tenant_id=%d AND status='ACTIVE'",$branch,$tenant)))return self::err('bta_invalid_branch','Établissement introuvable.',404);
        $supplier=absint($r->get_param('supplier_id'));if($supplier&&!$wpdb->get_var($wpdb->prepare('SELECT id FROM '.self::t('suppliers').' WHERE id=%d AND tenant_id=%d',$supplier,$tenant)))return self::err('bta_invalid_supplier','Fournisseur introuvable.',404);
        $subtotal=0;$clean=array();foreach($items as $it){$desc=sanitize_text_field((string)($it['description']??''));$qty=(float)($it['quantity']??0);$cost=(float)($it['unit_cost']??0);$pid=absint($it['product_id']??0);if($desc===''||$qty<=0||$cost<0)return self::err('bta_invalid_item','Chaque article doit avoir une description, une quantité positive et un coût valide.');if($pid&&!$wpdb->get_var($wpdb->prepare('SELECT id FROM '.self::t('products').' WHERE id=%d AND tenant_id=%d',$pid,$tenant)))return self::err('bta_invalid_product','Produit introuvable.',404);$subtotal+=$qty*$cost;$clean[]=array('product_id'=>$pid?:null,'description'=>$desc,'quantity'=>$qty,'cost'=>$cost);}
        $fees=max(0,(float)$r->get_param('estimated_fees'));$now=gmdate('Y-m-d H:i:s');$wpdb->query('START TRANSACTION');
        $ok=$wpdb->insert(self::t('preorders'),array('tenant_id'=>$tenant,'branch_id'=>$branch,'supplier_id'=>$supplier?:null,'reference'=>$reference,'title'=>$title,'status'=>'DRAFT','currency'=>$currency,'exchange_rate'=>$rate,'estimated_subtotal'=>$subtotal,'estimated_fees'=>$fees,'estimated_total'=>$subtotal+$fees,'amount_paid'=>max(0,(float)$r->get_param('amount_paid')),'tracking_number'=>sanitize_text_field((string)$r->get_param('tracking_number')),'origin'=>sanitize_text_field((string)$r->get_param('origin')),'destination'=>sanitize_text_field((string)$r->get_param('destination')),'expected_at'=>$r->get_param('expected_at')?sanitize_text_field((string)$r->get_param('expected_at')):null,'notes'=>sanitize_textarea_field((string)$r->get_param('notes')),'created_by'=>$a['user_id'],'created_at'=>$now,'updated_at'=>$now));
        if(!$ok){$wpdb->query('ROLLBACK');return self::err('bta_preorder_create_failed',$wpdb->last_error?:'Création impossible.',409);} $id=(int)$wpdb->insert_id;
        foreach($clean as $it){$ok=$wpdb->insert(self::t('preorder_items'),array('tenant_id'=>$tenant,'preorder_id'=>$id,'product_id'=>$it['product_id'],'description'=>$it['description'],'quantity_ordered'=>$it['quantity'],'quantity_shipped'=>0,'quantity_received'=>0,'unit_cost'=>$it['cost'],'currency'=>$currency,'created_at'=>$now,'updated_at'=>$now));if(!$ok){$wpdb->query('ROLLBACK');return self::err('bta_preorder_item_failed','Enregistrement des articles impossible.',500);}}
        $wpdb->query('COMMIT');return new WP_REST_Response(array('success'=>true,'preorder'=>array('id'=>$id,'reference'=>$reference,'status'=>'DRAFT','estimated_subtotal'=>$subtotal,'estimated_fees'=>$fees,'estimated_total'=>$subtotal+$fees,'stock_affected'=>false)),201);
    }
    public static function receive($r){
        $tenant=(int)$r['tenant_id'];$a=self::auth($r,$tenant,'stock.manage');if(is_wp_error($a))return $a;$id=(int)$r['preorder_id'];$items=$r->get_param('items');if(!is_array($items)||!count($items))return self::err('bta_invalid_receipt','Liste des quantités reçues requise.');
        global $wpdb;$p=self::t('preorders');$pre=$wpdb->get_row($wpdb->prepare("SELECT * FROM {$p} WHERE id=%d AND tenant_id=%d FOR UPDATE",$id,$tenant),ARRAY_A);if(!$pre)return self::err('bta_preorder_not_found','Pré-enregistrement introuvable.',404);
        $now=gmdate('Y-m-d H:i:s');$wpdb->query('START TRANSACTION');$received=0;
        foreach($items as $it){$item_id=absint($it['item_id']??0);$qty=(float)($it['quantity']??0);if(!$item_id||$qty<=0){$wpdb->query('ROLLBACK');return self::err('bta_invalid_receipt_item','Article ou quantité reçue invalide.');}
            $line=$wpdb->get_row($wpdb->prepare('SELECT * FROM '.self::t('preorder_items').' WHERE id=%d AND preorder_id=%d AND tenant_id=%d',$item_id,$id,$tenant),ARRAY_A);if(!$line||$qty>((float)$line['quantity_ordered']-(float)$line['quantity_received'])){$wpdb->query('ROLLBACK');return self::err('bta_receipt_exceeds_order','Quantité reçue supérieure au reliquat.');}
            if(empty($line['product_id'])){$wpdb->query('ROLLBACK');return self::err('bta_product_required','Associez un produit avant de réceptionner cet article.');}
            $wpdb->update(self::t('preorder_items'),array('quantity_received'=>(float)$line['quantity_received']+$qty,'updated_at'=>$now),array('id'=>$item_id,'tenant_id'=>$tenant));
            $stock=self::t('stock');$existing=$wpdb->get_var($wpdb->prepare("SELECT id FROM {$stock} WHERE tenant_id=%d AND branch_id=%d AND product_id=%d",$tenant,$pre['branch_id'],$line['product_id']));
            if($existing)$wpdb->query($wpdb->prepare("UPDATE {$stock} SET quantity=quantity+%f,updated_at=%s WHERE id=%d",$qty,$now,$existing));else $wpdb->insert($stock,array('tenant_id'=>$tenant,'branch_id'=>$pre['branch_id'],'product_id'=>$line['product_id'],'quantity'=>$qty,'updated_at'=>$now));
            $wpdb->insert(self::t('stock_movements'),array('tenant_id'=>$tenant,'branch_id'=>$pre['branch_id'],'product_id'=>$line['product_id'],'movement_type'=>'PREORDER_RECEIPT','quantity'=>$qty,'reference_type'=>'preorder','reference_id'=>$id,'notes'=>'Réception du pré-enregistrement '.$pre['reference'],'created_by'=>$a['user_id'],'created_at'=>$now));$received+=$qty;
        }
        $left=(int)$wpdb->get_var($wpdb->prepare('SELECT COUNT(*) FROM '.self::t('preorder_items').' WHERE preorder_id=%d AND tenant_id=%d AND quantity_received<quantity_ordered',$id,$tenant));$status=$left?'PARTIALLY_RECEIVED':'RECEIVED';$wpdb->update($p,array('status'=>$status,'received_by'=>$a['user_id'],'updated_at'=>$now),array('id'=>$id,'tenant_id'=>$tenant));$wpdb->query('COMMIT');
        return rest_ensure_response(array('success'=>true,'preorder_id'=>$id,'status'=>$status,'quantity_received_now'=>$received,'stock_updated'=>true));
    }
}
