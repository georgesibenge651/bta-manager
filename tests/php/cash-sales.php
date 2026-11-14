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
foreach(['branch-access','sales-api','finance-api','sync-adapters','sync-push-api'] as $name)require $base.'class-fkc-'.$name.'.php';
class CashDB extends FakeDB {
 public $cash=[],$stock=20,$snapshot=null;
 function get_row($sql,$mode){
  if(str_contains($sql,'bta_cash_sessions')){
   foreach($this->cash as $s){
    if($s['status']!=='OPEN')continue;
    if(preg_match('/currency=\x27([^\x27]+)\x27/',$sql,$m)&&$s['currency']!==$m[1])continue;
    if(preg_match('/WHERE id=(\d+)/',$sql,$m)&&(int)$s['id']!==(int)$m[1])continue;
    return $s;
   }return null;
  }
  if(str_contains($sql,'bta_stock'))return ['id'=>1,'quantity'=>$this->stock];
  return parent::get_row($sql,$mode);
 }
 function get_var($sql){
  if(str_contains($sql,'bta_cash_sessions')){foreach($this->cash as $s)if($s['status']==='OPEN')return $s['id'];return null;}
  if(str_contains($sql,'bta_cash_movements')){
   preg_match('/cash_session_id=(\d+)/',$sql,$m);$sum=0;
   foreach($this->writes as [$t,$d])if(str_ends_with($t,'cash_movements')&&$d['cash_session_id']==$m[1])$sum+=$d['amount'];return $sum;
  }return parent::get_var($sql);
 }
 function insert($table,$data,...$args){$ok=parent::insert($table,$data,...$args);if(str_ends_with($table,'cash_sessions'))$this->cash[$this->insert_id]=['id'=>$this->insert_id]+$data;return $ok;}
 function update($table,$data,$where,...$args){if(str_ends_with($table,'cash_sessions')){$id=$where['id'];$this->cash[$id]=array_merge($this->cash[$id],$data);}return parent::update($table,$data,$where,...$args);}
 function query($sql){
  if($sql==='START TRANSACTION')$this->snapshot=[$this->writes,$this->stock];
  if($sql==='ROLLBACK')[$this->writes,$this->stock]=$this->snapshot;
  if(preg_match('/SET quantity=quantity-([0-9.]+)/',$sql,$m))$this->stock-=(float)$m[1];
  return 1;
 }
}
function req($params){$r=new WP_REST_Request('POST','/bta/v1/tenants/7/sync/push');$r->set_header('Authorization','Bearer '.str_repeat('a',64));foreach(['tenant_id'=>7,'branch_id'=>4]+$params as $k=>$v)$r->set_param($k,$v);return $r;}
function saleRequest($currency,$uuid){$amount=$currency==='CDF'?2800:1;return req(['type'=>'sale_create','operation_id'=>$uuid,'payload'=>['branch_id'=>4,'reference'=>'SALE-'.$uuid,'currency'=>$currency,'exchange_rate'=>2800,'items'=>[['product_id'=>44,'quantity'=>1,'unit_price'=>$amount]],'discount'=>0,'paid'=>$amount,'payment_method'=>'CASH']]);}
$wpdb=new CashDB();$wpdb->grants=['sales.create','cashbox.manage'];
foreach(['CDF','USD'] as $i=>$currency){
 $id=sprintf('12345678-1234-4234-a234-%012d',200+$i);
 $r=saleRequest($currency,$id);$out=FKC_Sync_Push_API::push($r);
 check(is_wp_error($out)&&$out->code==='bta_open_cash_required','Missing cash not rejected');
 check($wpdb->stock==20-$i,'Rejected sale reduced stock');
 $opening=FKC_Finance_API::open_session(req(['currency'=>$currency,'opening_amount'=>10]));
 check($opening instanceof WP_REST_Response,'Opening failed: '.$currency);$sessionId=$opening->data['session_id'];
 check($wpdb->cash[$sessionId]['currency']===$currency,'Opening currency lost');
 check(is_wp_error(FKC_Finance_API::open_session(req(['currency'=>$currency,'opening_amount'=>10]))),'Duplicate opening accepted');
 $wrong=FKC_Sync_Push_API::push(saleRequest($currency==='USD'?'CDF':'USD',sprintf('12345678-1234-4234-a234-%012d',300+$i)));
 check(is_wp_error($wrong)&&$wrong->code==='bta_open_cash_required','Wrong currency cash accepted');
 check($wpdb->stock==20-$i,'Currency rejection reduced stock');
 $retry=saleRequest($currency,sprintf('12345678-1234-4234-a234-%012d',400+$i));
 $ok=FKC_Sync_Push_API::push($retry);check($ok instanceof WP_REST_Response,'Retry after opening failed');
 check($wpdb->stock==19-$i,'Sale stock incorrect');
 $writes=count($wpdb->writes);$again=FKC_Sync_Push_API::push($retry);
 check($again->data['duplicate']===true&&count($wpdb->writes)===$writes&&$wpdb->stock==19-$i,'Replay duplicated sale or stock debit');
 $movements=array_values(array_filter($wpdb->writes,fn($w)=>str_ends_with($w[0],'cash_movements')&&$w[1]['movement_type']==='SALE_IN'&&$w[1]['cash_session_id']===$sessionId));
 check(count($movements)===1&&$movements[0][1]['currency']===$currency,'Sale associated with wrong cash');
 $closed=FKC_Finance_API::close_session(req(['session_id'=>$sessionId,'closing_amount'=>$currency==='CDF'?2810:11]));
 check(is_array($closed)&&$closed['status']==='CLOSED'&&$closed['difference']==0,'Closing failed');
}
$wpdb->role='VIEWER';$n=count($wpdb->writes);
check(is_wp_error(FKC_Finance_API::open_session(req(['currency'=>'USD','opening_amount'=>0]))),'Role bypass');
check(count($wpdb->writes)===$n,'Denied opening wrote data');
echo "PASS: CDF/USD opening, closing, currency association, rejection rollback, retry and replay without double stock debit, role denial (real Core handlers, simulated DB).\n";
