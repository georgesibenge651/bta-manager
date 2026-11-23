<?php
if (!defined('ABSPATH')) { exit; }
/** Lecture incrémentale pour synchronisation hors ligne. Aucun endpoint ne modifie les données. */
final class FKC_Sync_API {
    private static function table($name) { global $wpdb; return in_array($name,array('users','tenants','branches','members','permissions','branch_access','invitations','audit_logs','sessions'),true) ? 'bta_' . $name : $wpdb->prefix . 'bta_' . $name; }
    private static function error($code,$message,$status=400) { return new WP_Error($code,$message,array('status'=>$status)); }
    private static function auth($request,$tenant) {
        $header=$request->get_header('authorization');
        if (!$header && isset($_SERVER['HTTP_AUTHORIZATION'])) $header=wp_unslash($_SERVER['HTTP_AUTHORIZATION']);
        if (!is_string($header) || !preg_match('/^Bearer\s+([a-fA-F0-9]{64})$/',$header,$m)) return self::error('bta_unauthenticated','Connexion requise.',401);
        global $wpdb;
        $session=$wpdb->get_row($wpdb->prepare('SELECT s.user_id,u.status FROM '.self::table('sessions').' s JOIN '.self::table('users').' u ON u.id=s.user_id WHERE s.token_hash=%s AND s.expires_at>%s LIMIT 1',hash('sha256',$m[1]),gmdate('Y-m-d H:i:s')),ARRAY_A);
        if (!$session || $session['status']!=='ACTIVE') return self::error('bta_unauthenticated','Session invalide ou expirée.',401);
        $member=$wpdb->get_row($wpdb->prepare("SELECT role FROM ".self::table('members')." WHERE tenant_id=%d AND user_id=%d AND status='ACTIVE' LIMIT 1",$tenant,$session['user_id']),ARRAY_A);
        if (!$member) return self::error('bta_forbidden','Accès refusé.',403);
        $allowed=array('OWNER','ADMIN','MANAGER','CASHIER');
        if (!in_array($member['role'],$allowed,true)) return self::error('bta_forbidden','Permission insuffisante.',403);
        return array('user_id'=>(int)$session['user_id'],'role'=>$member['role']);
    }
    public static function boot() { add_action('rest_api_init',array(__CLASS__,'routes')); }
    public static function routes() {
        register_rest_route('bta/v1','/tenants/(?P<tenant_id>\d+)/sync/pull',array('methods'=>'GET','callback'=>array(__CLASS__,'pull'),'permission_callback'=>'__return_true'));
    }
    public static function pull($request) {
        $tenant=absint($request['tenant_id']); $auth=self::auth($request,$tenant); if (is_wp_error($auth)) return $auth;
        $resource=sanitize_key((string)$request->get_param('resource'));
        $allowed=array('products','categories','stock','stock_movements');
        if (!in_array($resource,$allowed,true)) return self::error('bta_invalid_sync_resource','Ressource invalide. Ressources : products, categories, stock, stock_movements.');
        $limit=absint($request->get_param('limit')); if (!$limit) $limit=100; $limit=min(250,max(1,$limit));
        $branch=absint($request->get_param('branch_id'));
        $cursor=array('at'=>'1970-01-01 00:00:00','id'=>0);
        $raw=(string)$request->get_param('cursor');
        if ($raw!=='') {
            $decoded=json_decode(base64_decode(strtr($raw,'-_','+/')),true);
            if (!is_array($decoded)||empty($decoded['at'])||!isset($decoded['id'])||!preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/',$decoded['at'])||(int)$decoded['id']<0) return self::error('bta_invalid_sync_cursor','Curseur de synchronisation invalide.');
            $cursor=array('at'=>$decoded['at'],'id'=>(int)$decoded['id']);
        } elseif ($request->get_param('since')) {
            $since=strtotime((string)$request->get_param('since'));
            if ($since===false) return self::error('bta_invalid_sync_since','Date since invalide. Utilisez une date ISO 8601.');
            $cursor['at']=gmdate('Y-m-d H:i:s',$since);
        }
        global $wpdb;
        $tables=array(
            'products'=>array('products','updated_at','id','tenant_id=%d'),
            'categories'=>array('categories','updated_at','id','tenant_id=%d'),
            'stock'=>array('stock','updated_at','id','tenant_id=%d'),
            'stock_movements'=>array('stock_movements','created_at','id','tenant_id=%d')
        );
        list($table,$datecol,$idcol,$scope)=$tables[$resource];
        $where="{$scope} AND ({$datecol}>%s OR ({$datecol}=%s AND {$idcol}>%d))";
        $args=array($tenant,$cursor['at'],$cursor['at'],$cursor['id']);
        if ($branch && in_array($resource,array('stock','stock_movements'),true)) { $where.=' AND branch_id=%d'; $args[]=$branch; }
        $sql='SELECT * FROM '.self::table($table).' WHERE '.$where.' ORDER BY '.$datecol.' ASC, '.$idcol.' ASC LIMIT '.($limit+1);
        $rows=$wpdb->get_results($wpdb->prepare($sql,$args),ARRAY_A);
        if ($rows===null) return self::error('bta_sync_query_failed','Lecture de synchronisation impossible.',500);
        $has_more=count($rows)>$limit; if ($has_more) array_pop($rows);
        $next=$cursor;
        if ($rows) { $last=end($rows); $next=array('at'=>$last[$datecol],'id'=>(int)$last[$idcol]); }
        $next_token=$has_more?rtrim(strtr(base64_encode(wp_json_encode($next)),'+/','-_'),'='):null;
        return array('success'=>true,'resource'=>$resource,'items'=>$rows,'count'=>count($rows),'has_more'=>$has_more,'next_cursor'=>$next_token,'server_time'=>gmdate('c'));
    }
}
