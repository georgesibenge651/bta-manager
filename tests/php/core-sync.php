<?php
// Real Core handlers against a deterministic WP/DB boundary; no production data.
define('ABSPATH', __DIR__); define('ARRAY_A', 'ARRAY_A');
class WP_Error { function __construct(public $code,public $message,public $data=[]){} function get_error_code(){return $this->code;} function get_error_message(){return $this->message;} function get_error_data(){return $this->data;} }
class WP_REST_Response { function __construct(public $data,public $status=200){} function get_data(){return $this->data;} }
class WP_REST_Request extends ArrayObject {
 private $headers=[];
 function __construct(private $method,private $route){parent::__construct();}
 function get_route(){return $this->route;} function get_method(){return $this->method;}
 function set_param($k,$v){$this[$k]=$v;} function get_param($k){return $this[$k]??null;}
 function set_header($k,$v){$this->headers[strtolower($k)]=$v;} function get_header($k){return $this->headers[strtolower($k)]??'';}
}
function is_wp_error($v){return $v instanceof WP_Error;}
function absint($v){return abs((int)$v);}
function sanitize_key($v){return strtolower(preg_replace('/[^a-zA-Z0-9_-]/','',$v));}
function sanitize_text_field($v){return trim(strip_tags($v));}
function sanitize_textarea_field($v){return trim(strip_tags($v));}
function sanitize_email($v){return $v;}
function esc_url_raw($v){return $v;}
function wp_json_encode($v){return json_encode($v);}
function wp_unslash($v){return $v;}
function rest_ensure_response($v){return new WP_REST_Response($v);}
function check($condition,$message){if(!$condition)throw new RuntimeException($message);}
class FakeDB {
 public $prefix='wp_test_',$insert_id=0,$last_error='',$role='MANAGER',$grants=['stock.manage','customers.manage'];
 public $operations=[],$writes=[],$stockQuantity=0;
 function prepare($sql,...$args){if(count($args)===1&&is_array($args[0]))$args=$args[0]; foreach($args as $v)$sql=preg_replace('/%[dsf]/',is_numeric($v)?(string)$v:"'".str_replace("'","''",$v)."'",$sql,1);return $sql;}
 function get_row($sql,$mode){
  if(str_contains($sql,'bta_sessions'))return ['user_id'=>9,'status'=>'ACTIVE'];
  if(str_contains($sql,'bta_members'))return str_contains($sql,'tenant_id=7 ')?['id'=>12,'role'=>$this->role]:null;
  if(str_contains($sql,'bta_branch_access'))return str_contains($sql,'branch_id=4 ')?['permissions'=>json_encode($this->grants)]:null;
  if(str_contains($sql,'bta_products'))return ['id'=>44,'status'=>'ACTIVE','tenant_id'=>7];
  if(str_contains($sql,'bta_sync_operations')){preg_match("/operation_id='([^']+)'/",$sql,$m);return $this->operations[$m[1]??'']??null;}
  throw new RuntimeException('Unexpected SQL: '.$sql);
 }
 function get_var($sql){
  if(str_contains($sql,'SUM(ABS(quantity))'))return $this->stockQuantity;
  if(str_contains($sql,'COUNT(*)'))return 150;
  if(str_contains($sql,'bta_branches'))return str_contains($sql,'tenant_id=7')&&str_contains($sql,'id=4 ')?4:null;
  if(str_contains($sql,'bta_debts'))return 5; // parent belongs to unauthorized branch
  return null;
 }
 function get_results($sql,$mode){preg_match('/LIMIT (\d+) OFFSET (\d+)/',$sql,$m);return array_map(fn($i)=>['id'=>$i,'name'=>'Row '.$i],range((int)$m[2]+1,min(150,(int)$m[2]+(int)$m[1])));}
 function insert($table,$data,...$args){$this->insert_id++;$this->writes[]=[$table,$data];if(str_ends_with($table,'sync_operations'))$this->operations[$data['operation_id']]=array_merge(['error_code'=>null,'error_message'=>null,'completed_at'=>null],$data);return 1;}
 function update($table,$data,$where,...$args){if(str_ends_with($table,'sync_operations')){$id=$where['operation_id'];$this->operations[$id]=array_merge($this->operations[$id],$data);}return 1;}
 function query($sql){return 1;}
}
$base=dirname(__DIR__,2).'/wordpress/fondation-kenda-core/includes/';
foreach(['branch-access','commercial-api','sales-api','sync-adapters','sync-push-api'] as $name)require $base.'class-fkc-'.$name.'.php';
$wpdb=new FakeDB();
function request($type,$id,$payload){$r=new WP_REST_Request('POST','/bta/v1/tenants/7/sync/push');$r->set_param('tenant_id',7);$r->set_header('Authorization','Bearer '.str_repeat('a',64));$r->set_param('operation_id',$id);$r->set_param('type',$type);$r->set_param('payload',$payload);return $r;}
foreach(['category','customer','product'] as $i=>$kind){
 $id=sprintf('12345678-1234-4234-a234-%012d',$i+1);
 $r=request($kind.'_create',$id,['branch_id'=>4,'name'=>'Audit item','sku'=>'AUDIT','initial_stock'=>3]);
 $out=FKC_Sync_Push_API::push($r);
 check($out instanceof WP_REST_Response,$kind.' creation failed');
 check($out->data['operation_id']===$id,$kind.' ACK missing UUID');
 check(isset($out->data[$kind]['id']),$kind.' ACK missing mapping');
 $stored=json_decode($wpdb->operations[$id]['response'],true);check($stored['operation_id']===$id,'Persisted ACK missing UUID');unset($stored['operation_id']);$wpdb->operations[$id]['response']=json_encode($stored);
 $n=count($wpdb->writes);$again=FKC_Sync_Push_API::push($r);
 check($again->data['duplicate']===true&&$again->data['operation_id']===$id,'Invalid duplicate ACK');
 check(count($wpdb->writes)===$n,'Replay caused duplicate writes');
 $status=new WP_REST_Request('GET','/bta/v1/tenants/7/sync/operations/'.$id);$status->set_param('tenant_id',7);$status->set_param('operation_id',$id);$status->set_header('Authorization','Bearer '.str_repeat('a',64));
 check(FKC_Sync_Push_API::status($status)['result']['operation_id']===$id,'Status missing UUID');
 $r->set_param('payload',['branch_id'=>4,'name'=>'Different']);
 check(is_wp_error(FKC_Sync_Push_API::push($r)),'Changed payload accepted');
}
$archive=request('product_archive','12345678-1234-4234-a234-000000000080',['branch_id'=>4,'product_id'=>44,'status'=>'ARCHIVED']);
$archived=FKC_Sync_Push_API::push($archive);check($archived instanceof WP_REST_Response&&$archived->data['product']['status']==='ARCHIVED','Product archive failed');
$wpdb->stockQuantity=2;$blocked=request('product_archive','12345678-1234-4234-a234-000000000081',['branch_id'=>4,'product_id'=>44,'status'=>'ARCHIVED']);
check(is_wp_error(FKC_Sync_Push_API::push($blocked)),'Stocked product archived');$wpdb->stockQuantity=0;
foreach($wpdb->writes as [$table,$data])check(($data['tenant_id']??7)===7,'Wrong tenant written');
$denied=request('category_create','12345678-1234-4234-a234-000000000099',['branch_id'=>4,'name'=>'Denied']);
$wpdb->role='CASHIER';$n=count($wpdb->writes);check(is_wp_error(FKC_Sync_Push_API::push($denied)),'Cashier created category');check(count($wpdb->writes)===$n,'Denied operation wrote data');
$wpdb->role='MANAGER';$wpdb->grants=[];check(is_wp_error(FKC_Sync_Push_API::push($denied)),'Missing branch grant accepted');
$wpdb->grants=['debts.pay'];$forged=request('debt_payment','12345678-1234-4234-a234-000000000098',['branch_id'=>4,'debt_id'=>33,'amount'=>1]);check(is_wp_error(FKC_Sync_Push_API::push($forged)),'Forged parent branch accepted');
$wpdb->role='MANAGER';$wpdb->grants=['customers.read'];
$list=new WP_REST_Request('GET','/bta/v1/tenants/7/customers');$list->set_header('Authorization','Bearer '.str_repeat('a',64));$list->set_param('tenant_id',7);$list->set_param('branch_id',4);$list->set_param('page',2);$list->set_param('per_page',100);
$page=FKC_Sales_API::customers($list);check(count($page['customers'])===50&&$page['customers'][0]['id']===101&&$page['pagination']['pages']===2,'Customer pagination truncated');
echo "PASS: 3 real creation handlers, tenant/branch context, stock initialization, replay/status UUID, payload conflict, role and branch denial, parent branch isolation.\n";
