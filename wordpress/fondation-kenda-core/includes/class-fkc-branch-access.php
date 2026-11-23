<?php
if (!defined('ABSPATH')) { exit; }

/** Enforces per-branch grants before a commercial REST callback is allowed to run. */
final class FKC_Branch_Access {
    private static function core_table($name) { return 'bta_' . $name; }
    private static function t($name) { global $wpdb; return $wpdb->prefix . 'bta_' . $name; }
    private static function defaults() {
        return array(
            'OWNER'=>array('sales.read','sales.create','sales.cancel','stock.read','stock.manage','purchases.read','purchases.create','debts.read','debts.pay','expenses.read','expenses.create','customers.read','customers.manage','suppliers.read','suppliers.manage','cashbox.manage','reports.read','audit.read','branch.settings','members.manage'),
            'ADMIN'=>array('sales.read','sales.create','sales.cancel','stock.read','stock.manage','purchases.read','purchases.create','debts.read','debts.pay','expenses.read','expenses.create','customers.read','customers.manage','suppliers.read','suppliers.manage','cashbox.manage','reports.read','audit.read','branch.settings','members.manage'),
            // Exact match to BTA Manager's existing local MANAGER set (17 permissions).
            'MANAGER'=>array('sales.read','sales.create','sales.cancel','stock.read','stock.manage','purchases.read','purchases.create','debts.read','debts.pay','expenses.read','expenses.create','customers.read','customers.manage','suppliers.read','suppliers.manage','cashbox.manage','reports.read'),
            'CASHIER'=>array('sales.read','sales.create','stock.read','customers.read','debts.read','debts.pay','cashbox.manage'),
        );
    }
    private static function error($code,$message,$status=403) { return new WP_Error($code,$message,array('status'=>$status)); }
    private static function actor($request,$tenant) {
        $header=$request->get_header('authorization');
        if (!$header && isset($_SERVER['HTTP_AUTHORIZATION'])) $header=wp_unslash($_SERVER['HTTP_AUTHORIZATION']);
        if (!is_string($header)||!preg_match('/^Bearer\s+([a-fA-F0-9]{64})$/',$header,$m)) return self::error('bta_unauthenticated','Connexion requise.',401);
        global $wpdb;
        $session=$wpdb->get_row($wpdb->prepare('SELECT s.user_id,u.status FROM '.self::core_table('sessions').' s JOIN '.self::core_table('users').' u ON u.id=s.user_id WHERE s.token_hash=%s AND s.expires_at>%s LIMIT 1',hash('sha256',$m[1]),gmdate('Y-m-d H:i:s')),ARRAY_A);
        if (!$session||$session['status']!=='ACTIVE') return self::error('bta_unauthenticated','Session invalide ou expirée.',401);
        $member=$wpdb->get_row($wpdb->prepare("SELECT id,role FROM ".self::core_table('members')." WHERE tenant_id=%d AND user_id=%d AND status='ACTIVE' LIMIT 1",$tenant,$session['user_id']),ARRAY_A);
        if (!$member) return self::error('bta_forbidden','Adhésion active introuvable.');
        return array('user_id'=>(int)$session['user_id'],'member_id'=>(int)$member['id'],'role'=>$member['role']);
    }
    public static function allowed($request,$tenant,$branch,$permission) {
        $actor=self::actor($request,$tenant); if (is_wp_error($actor)) return $actor;
        global $wpdb;
        if (!$wpdb->get_var($wpdb->prepare("SELECT id FROM ".self::core_table('branches')." WHERE id=%d AND tenant_id=%d AND status='ACTIVE'",$branch,$tenant))) return self::error('bta_invalid_branch','Établissement introuvable.',404);
        if ($actor['role']==='OWNER') return true;
        if (!in_array($permission,self::defaults()[$actor['role']]??array(),true)) return self::error('bta_forbidden','Permission refusée par le rôle.');
        $row=$wpdb->get_row($wpdb->prepare('SELECT permissions FROM '.self::core_table('branch_access').' WHERE member_id=%d AND branch_id=%d LIMIT 1',$actor['member_id'],$branch),ARRAY_A);
        $grants=$row?json_decode($row['permissions'],true):null;
        if (!is_array($grants)||!in_array($permission,$grants,true)) return self::error('bta_branch_forbidden','Accès ou permission refusé pour cet établissement.');
        return true;
    }
    private static function route_permission($route,$method) {
        $path=preg_replace('#^/bta/v1/tenants/\d+/#','',$route);
        if (strpos($path,'sales')===0) return (strpos($path,'/cancel')!==false||strpos($path,'/refunds')!==false)?'sales.cancel':($method==='GET'?'sales.read':'sales.create');
        if (strpos($path,'purchases')===0) return $method==='GET'?'purchases.read':'purchases.create';
        if (strpos($path,'preorders')===0) return $method==='GET'?'stock.read':'stock.manage';
        if (strpos($path,'debts')===0) return strpos($path,'/payments')!==false?'debts.pay':'debts.read';
        if (strpos($path,'expenses')===0) return $method==='GET'?'expenses.read':'expenses.create';
        if (strpos($path,'cash/')===0) return 'cashbox.manage';
        if (strpos($path,'reports/')===0) return 'reports.read';
        if (strpos($path,'stock/transfers')===0) return $method==='GET'?'stock.read':'stock.manage';
        if (strpos($path,'stock/')===0) return strpos($path,'adjustments')!==false||strpos($path,'reconcile')!==false||strpos($path,'resolve')!==false?'stock.manage':'stock.read';
        if (strpos($path,'categories')===0||strpos($path,'products')===0) return $method==='GET'?'stock.read':'stock.manage';
        if (strpos($path,'customers')===0) return $method==='GET'?'customers.read':'customers.manage';
        if (strpos($path,'suppliers')===0) return $method==='GET'?'suppliers.read':'suppliers.manage';
        if (strpos($path,'sync/pull')===0) return 'stock.read';
        return null;
    }
    public static function guard($result,$server,$request) {
        if (is_wp_error($result)) return $result;
        $route=$request->get_route();
        if (!preg_match('#^/bta/v1/tenants/(\d+)/#',$route,$m)) return $result;
        $tenant=(int)$m[1];
        if (preg_match('#/sync/push$#',$route)) {
            $type=sanitize_key((string)$request->get_param('type')); $payload=$request->get_param('payload');
            if(!is_array($payload))return self::error('bta_invalid_sync_operation','Payload objet requis.',400);
            $permission_map=array('stock_adjustment'=>'stock.manage','category_create'=>'stock.manage','category_update'=>'stock.manage','product_create'=>'stock.manage','product_update'=>'stock.manage','product_archive'=>'stock.manage','sale_create'=>'sales.create','purchase_create'=>'purchases.create','expense_create'=>'expenses.create','customer_create'=>'customers.manage','customer_update'=>'customers.manage','supplier_create'=>'suppliers.manage','supplier_update'=>'suppliers.manage','debt_payment'=>'debts.pay','sale_refund'=>'sales.cancel');
            $permission=$permission_map[$type]??null;if(!$permission)return self::error('bta_invalid_sync_operation','Type d’opération inconnu.',400);
            $branch=absint($payload['branch_id']??0); global $wpdb;
            if($type==='debt_payment')$branch=(int)$wpdb->get_var($wpdb->prepare('SELECT branch_id FROM '.self::t('debts').' WHERE tenant_id=%d AND id=%d',$tenant,absint($payload['debt_id']??0)));
            if($type==='sale_refund')$branch=(int)$wpdb->get_var($wpdb->prepare('SELECT branch_id FROM '.self::t('sales').' WHERE tenant_id=%d AND id=%d',$tenant,absint($payload['sale_id']??0)));
            if(!$branch)return self::error('bta_branch_required','Établissement de l’opération introuvable.');
            $check=self::allowed($request,$tenant,$branch,$permission);return $check===true?$result:$check;
        }
        $permission=self::route_permission($route,$request->get_method()); if (!$permission) return $result;
        $branch=absint($request->get_param('branch_id'));
        global $wpdb;
        // Existing row-bound actions derive the branch from their immutable parent record.
        if (preg_match('#/sales/(\d+)/(?:cancel|refunds)#',$route,$id)) $branch=(int)$wpdb->get_var($wpdb->prepare('SELECT branch_id FROM '.self::t('sales').' WHERE tenant_id=%d AND id=%d',$tenant,(int)$id[1]));
        if (preg_match('#/purchases/(\d+)/payments#',$route,$id)) $branch=(int)$wpdb->get_var($wpdb->prepare('SELECT branch_id FROM '.self::t('purchases').' WHERE tenant_id=%d AND id=%d',$tenant,(int)$id[1]));
        if (preg_match('#/debts/(\d+)/payments#',$route,$id)) $branch=(int)$wpdb->get_var($wpdb->prepare('SELECT branch_id FROM '.self::t('debts').' WHERE tenant_id=%d AND id=%d',$tenant,(int)$id[1]));
        if (preg_match('#/preorders/(\d+)/receive#',$route,$id)) $branch=(int)$wpdb->get_var($wpdb->prepare('SELECT branch_id FROM '.self::t('preorders').' WHERE tenant_id=%d AND id=%d',$tenant,(int)$id[1]));
        if (preg_match('#/cash/sessions/(\d+)/(?:close|movements)#',$route,$id)) $branch=(int)$wpdb->get_var($wpdb->prepare('SELECT branch_id FROM '.self::t('cash_sessions').' WHERE tenant_id=%d AND id=%d',$tenant,(int)$id[1]));
        if (strpos($route,'/stock/transfers')!==false && $request->get_method()==='POST') {
            $from=absint($request->get_param('from_branch_id')); $to=absint($request->get_param('to_branch_id'));
            if (!$from||!$to) return self::error('bta_invalid_transfer','from_branch_id et to_branch_id requis.');
            foreach(array($from,$to) as $candidate){$check=self::allowed($request,$tenant,$candidate,'stock.manage');if($check!==true)return $check;}
            return $result;
        }
        if (!$branch) return self::error('bta_branch_required','branch_id requis pour vérifier les droits de cet établissement.');
        $check=self::allowed($request,$tenant,$branch,$permission);
        return $check===true?$result:$check;
    }
    public static function routes() {
        register_rest_route('bta/v1','/tenants/(?P<tenant_id>\d+)/branches/(?P<branch_id>\d+)/permissions/me',array('methods'=>'GET','callback'=>array(__CLASS__,'current_permissions'),'permission_callback'=>'__return_true'));
    }
    public static function current_permissions($request) {
        $tenant=absint($request['tenant_id']); $branch=absint($request['branch_id']);
        $actor=self::actor($request,$tenant); if(is_wp_error($actor))return $actor;
        global $wpdb;
        if(!$wpdb->get_var($wpdb->prepare("SELECT id FROM ".self::core_table('branches')." WHERE id=%d AND tenant_id=%d AND status='ACTIVE'",$branch,$tenant)))return self::error('bta_invalid_branch','Établissement introuvable.',404);
        if($actor['role']==='OWNER')return array('success'=>true,'tenant_id'=>$tenant,'branch_id'=>$branch,'role'=>'OWNER','permissions'=>self::defaults()['OWNER']);
        $row=$wpdb->get_row($wpdb->prepare('SELECT permissions FROM '.self::core_table('branch_access').' WHERE member_id=%d AND branch_id=%d LIMIT 1',$actor['member_id'],$branch),ARRAY_A);
        $grants=$row?json_decode($row['permissions'],true):array();
        $ceiling=self::defaults()[$actor['role']]??array();
        $effective=array_values(array_intersect($ceiling,is_array($grants)?$grants:array()));
        return array('success'=>true,'tenant_id'=>$tenant,'branch_id'=>$branch,'role'=>$actor['role'],'permissions'=>$effective);
    }
    public static function boot() { add_action('rest_api_init',array(__CLASS__,'routes')); add_filter('rest_pre_dispatch',array(__CLASS__,'guard'),10,3); }
}
