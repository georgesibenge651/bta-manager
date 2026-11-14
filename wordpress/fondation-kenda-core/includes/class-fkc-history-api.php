<?php
if(!defined('ABSPATH')){exit;}
/** Read-only, branch-authorized financial history. No client writes or stock effects. */
final class FKC_History_API {
 public static function boot(){add_action('rest_api_init',array(__CLASS__,'routes'));}
 public static function routes(){register_rest_route('bta/v1','/tenants/(?P<tenant_id>\d+)/history/(?P<resource>sales|debts|payments|refunds)',array('methods'=>'GET','callback'=>array(__CLASS__,'read'),'permission_callback'=>'__return_true'));}
 public static function read($r){
  $tenant=absint($r['tenant_id']);$branch=absint($r->get_param('branch_id'));$resource=(string)$r['resource'];
  $map=array('sales'=>array('sales',array('sales.read')),'debts'=>array('debts',array('debts.read')),'payments'=>array('payments',array('sales.read','debts.read')),'refunds'=>array('sale_refunds',array('sales.read')));
  if(!isset($map[$resource])||!$tenant||!$branch)return new WP_Error('bta_history_scope','Ressource et établissement requis.',array('status'=>400));
  foreach($map[$resource][1] as $permission){$check=FKC_Branch_Access::allowed($r,$tenant,$branch,$permission);if(is_wp_error($check))return $check;}
  global $wpdb;$table=$wpdb->prefix.'bta_'.$map[$resource][0];$sales=$wpdb->prefix.'bta_sales';
  $cursor=max(0,(int)$r->get_param('cursor'));
  if($resource==='refunds')$sql="SELECT h.* FROM {$table} h INNER JOIN {$sales} s ON s.id=h.sale_id AND s.tenant_id=h.tenant_id WHERE h.tenant_id=%d AND s.branch_id=%d AND h.id>%d ORDER BY h.id ASC LIMIT 101";
  else $sql="SELECT h.* FROM {$table} h WHERE h.tenant_id=%d AND h.branch_id=%d AND h.id>%d".($resource==='payments'?" AND h.entity_type IN ('SALE','DEBT')":'')." ORDER BY h.id ASC LIMIT 101";
  if($resource==='sales')$sql="SELECT h.*,u.full_name AS author_name,c.name AS customer_name,(SELECT p.method FROM ".$wpdb->prefix."bta_payments p WHERE p.tenant_id=h.tenant_id AND p.entity_type='SALE' AND p.entity_id=h.id ORDER BY p.id ASC LIMIT 1) AS payment_method FROM {$table} h LEFT JOIN bta_users u ON u.id=h.created_by LEFT JOIN ".$wpdb->prefix."bta_customers c ON c.id=h.customer_id AND c.tenant_id=h.tenant_id WHERE h.tenant_id=%d AND h.branch_id=%d AND h.id>%d ORDER BY h.id ASC LIMIT 101";
  $rows=$wpdb->get_results($wpdb->prepare($sql,$tenant,$branch,$cursor),ARRAY_A);
  if(!is_array($rows)||$wpdb->last_error)return new WP_Error('bta_history_failed','Lecture des historiques impossible.',array('status'=>503));
  $more=count($rows)>100;$rows=array_slice($rows,0,100);
  if($resource==='sales'&&$rows){
   $ids=array_map(function($row){return (int)$row['id'];},$rows);
   $items=$wpdb->get_results($wpdb->prepare('SELECT i.*,p.name AS product_name,p.sku,p.currency AS product_currency,p.unit AS product_unit FROM '.$wpdb->prefix.'bta_sale_items i INNER JOIN '.$sales.' s ON s.id=i.sale_id AND s.tenant_id=i.tenant_id LEFT JOIN '.$wpdb->prefix.'bta_products p ON p.id=i.product_id AND p.tenant_id=i.tenant_id WHERE s.tenant_id=%d AND s.branch_id=%d AND i.sale_id IN ('.implode(',',$ids).') ORDER BY i.id ASC',$tenant,$branch),ARRAY_A);
   if(!is_array($items)||$wpdb->last_error)return new WP_Error('bta_history_items_failed','Lecture des articles impossible.',array('status'=>503));
   $bySale=array();foreach($items as $item)$bySale[(int)$item['sale_id']][]=$item;
   foreach($rows as &$row)$row['items']=$bySale[(int)$row['id']]??array();unset($row);
  }
  return array('success'=>true,'tenant_id'=>$tenant,'branch_id'=>$branch,'resource'=>$resource,'items'=>$rows,'has_more'=>$more,'next_cursor'=>$more?(int)$rows[count($rows)-1]['id']:null);
 }
}
