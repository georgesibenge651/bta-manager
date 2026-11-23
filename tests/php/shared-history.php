<?php
// Real history handler; deterministic authorization/DB boundary, no live WordPress.
define('ABSPATH',__DIR__);define('ARRAY_A','ARRAY_A');
class WP_Error {function __construct(public $code,public $message,public $data=[]) {}}
function is_wp_error($v){return $v instanceof WP_Error;}function absint($v){return abs((int)$v);}
function check($ok,$message){if(!$ok)throw new RuntimeException($message);}
class FKC_Branch_Access {static function allowed($r,$tenant,$branch,$permission){return $tenant===7&&$branch===4?true:new WP_Error('denied','Wrong branch');}}
class Request extends ArrayObject{function get_param($k){return $this[$k]??null;}}
class HistoryDB {
 public $prefix='wp_',$last_error='',$queries=0;
 function prepare($sql,...$args){foreach($args as $a)$sql=preg_replace('/%d/',(string)(int)$a,$sql,1);return $sql;}
 function get_results($sql,$mode){
  $this->queries++;check(str_contains($sql,'tenant_id=7')&&str_contains($sql,'branch_id=4'),'Missing scope');
  if(str_contains($sql,'wp_bta_sale_items'))return [['sale_id'=>91,'product_id'=>3,'product_name'=>'Article B','sku'=>'B3','quantity'=>2,'unit_price'=>25,'line_total'=>50,'unit_cost'=>10]];
  check(str_contains($sql,'bta_users')&&str_contains($sql,'author_name'),'Missing author join');
  return [['id'=>91,'tenant_id'=>7,'branch_id'=>4,'reference'=>'B-001','created_by'=>2,'author_name'=>'Employé B','created_at'=>'2026-11-14 12:00:00','total'=>50,'currency'=>'USD']];
 }
}
require dirname(__DIR__,2).'/wordpress/fondation-kenda-core/includes/class-fkc-history-api.php';
$wpdb=new HistoryDB();$r=new Request(['tenant_id'=>7,'branch_id'=>4,'resource'=>'sales']);
$out=FKC_History_API::read($r);check($out['items'][0]['items'][0]['quantity']===2,'Missing invoice lines');check($out['items'][0]['author_name']==='Employé B','Author missing');
$queries=$wpdb->queries;$r['tenant_id']=8;check(is_wp_error(FKC_History_API::read($r))&&$wpdb->queries===$queries,'Foreign tenant queried');
$r['tenant_id']=7;$r['branch_id']=5;check(is_wp_error(FKC_History_API::read($r))&&$wpdb->queries===$queries,'Foreign branch queried');
echo "PASS: scoped invoice lines, author, denied tenant/branch without database reads (simulated DB/auth).\n";
