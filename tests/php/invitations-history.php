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
define('DAY_IN_SECONDS',86400);define('MINUTE_IN_SECONDS',60);
function is_email($v){return filter_var($v,FILTER_VALIDATE_EMAIL)!==false;}
function get_transient($k){return 0;}function set_transient(...$a){}function delete_transient(...$a){}
require dirname(__DIR__,2).'/wordpress/fondation-kenda-core/includes/class-fkc-core.php';
require dirname(__DIR__,2).'/wordpress/fondation-kenda-core/includes/class-fkc-branch-access.php';
require dirname(__DIR__,2).'/wordpress/fondation-kenda-core/includes/class-fkc-history-api.php';
class InviteDB {
 public $prefix='wp_',$insert_id=100,$last_error='',$tables=[],$historyQueries=[],$grants=[],$backup=[];
 function __construct(){
  $this->tables=['users'=>[1=>['id'=>1,'full_name'=>'Owner','email'=>'owner@example.test','status'=>'ACTIVE']], 'members'=>[12=>['id'=>12,'tenant_id'=>7,'user_id'=>1,'role'=>'OWNER','status'=>'ACTIVE']], 'invitations'=>[], 'sessions'=>[1=>['id'=>1,'user_id'=>1,'token_hash'=>hash('sha256',str_repeat('a',64)),'expires_at'=>'2099-01-01 00:00:00']]];
 }
 function esc_like($s){return $s;}
 function prepare($sql,...$args){if(count($args)===1&&is_array($args[0]))$args=$args[0];foreach($args as $v){$value=is_numeric($v)?(string)$v:"'".str_replace("'","''",$v)."'";$sql=preg_replace_callback('/%[dsf]/',fn()=>$value,$sql,1);}return $sql;}
 function match($s,$field){return preg_match('/(?:\b|\.)'.preg_quote($field,'/')."=(?:'([^']*)'|(\d+))/",$s,$m)?($m[1]!==''?$m[1]:$m[2]):null;}
 function get_row($sql,$mode){
  if(str_contains($sql,'bta_sessions')){foreach($this->tables['sessions'] as $r)if($r['token_hash']===$this->match($sql,'token_hash'))return ['session_id'=>$r['id']]+$r+$this->tables['users'][$r['user_id']];return null;}
  if(str_contains($sql,'bta_tenants'))return $this->match($sql,'id')==7?['id'=>7,'name'=>'Tenant','status'=>'ACTIVE']:null;
  if(str_contains($sql,'bta_members')){foreach($this->tables['members'] as $r)if($r['tenant_id']==$this->match($sql,'tenant_id')&&$r['user_id']==$this->match($sql,'user_id'))return $r;return null;}
  if(str_contains($sql,'bta_branch_access'))return ['permissions'=>json_encode($this->grants)];
  if(str_contains($sql,'bta_invitations')){foreach($this->tables['invitations'] as $r){$id=$this->match($sql,'id');$hash=$this->match($sql,'token_hash');$tenant=$this->match($sql,'tenant_id');if(($id===null||$r['id']==$id)&&($hash===null||$r['token_hash']===$hash)&&($tenant===null||$r['tenant_id']==$tenant))return $r;}return null;}
  if(str_contains($sql,'bta_users')){foreach($this->tables['users'] as $r)if($r['email']===$this->match($sql,'email'))return $r;return null;}
  throw new RuntimeException('Unexpected row query: '.$sql);
 }
 function get_var($sql){
  if(preg_match("/SHOW TABLES LIKE '([^']+)'/",$sql,$m))return $m[1];
  if(str_contains($sql,'bta_branches'))return $this->match($sql,'tenant_id')==7&&$this->match($sql,'id')==4?4:null;
  if(str_contains($sql,'bta_branch_access'))return json_encode($this->grants);
  if(str_contains($sql,'bta_users')){foreach($this->tables['users'] as $r)if($r['email']===$this->match($sql,'email'))return $r['id'];return null;}
  throw new RuntimeException('Unexpected scalar: '.$sql);
 }
 function insert($table,$data,...$a){$this->insert_id++;$name=substr($table,4);$this->tables[$name][$this->insert_id]=['id'=>$this->insert_id]+$data;return 1;}
 function update($table,$data,$where,...$a){$name=substr($table,4);$n=0;foreach($this->tables[$name]??[] as $id=>$r){foreach($where as $k=>$v)if(($r[$k]??null)!=$v)continue 2;$this->tables[$name][$id]=array_merge($r,$data);$n++;}return $n;}
 function query($sql){
  if($sql==='START TRANSACTION'){$this->backup=$this->tables;return 1;}
  if($sql==='ROLLBACK'){$this->tables=$this->backup;return 1;}
  if(str_starts_with($sql,'UPDATE bta_invitations')){return $this->update('bta_invitations',['status'=>'REVOKED'],['id'=>$this->match($sql,'id'),'tenant_id'=>$this->match($sql,'tenant_id'),'status'=>'PENDING']);}
  return 1;
 }
 function get_results($sql,$mode){
  $this->historyQueries[]=$sql;
  if(str_contains($sql,'wp_bta_')){check(str_contains($sql,'tenant_id=7')&&str_contains($sql,'branch_id=4'),'Unscoped history SQL');return [['id'=>1,'tenant_id'=>7,'branch_id'=>4,'created_by'=>1]];}
  if(str_contains($sql,'bta_members m')){return array_map(fn($r)=>$r+['name'=>'Tenant'],array_values(array_filter($this->tables['members'],fn($r)=>$r['user_id']==$this->match($sql,'user_id'))));}
  return [];
 }
}
$core=(new ReflectionClass(FKC_Core::class))->newInstanceWithoutConstructor();$wpdb=new InviteDB();
$defaults=(new ReflectionProperty(FKC_Core::class,'role_defaults'))->getValue($core);$wpdb->grants=$defaults['ADMIN'];
function rq($params=[],$token=null,$route='/bta/v1/tenants/7/invitations',$method='POST'){$r=new WP_REST_Request($method,$route);foreach(array_merge(['tenant_id'=>7],$params) as $k=>$v)$r->set_param($k,$v);$r->set_header('authorization','Bearer '.($token??str_repeat('a',64)));return $r;}
$codes=[];
foreach(['OWNER','ADMIN','MANAGER','CASHIER'] as $actor){
 $wpdb->tables['members'][12]['role']=$actor;
 foreach(['ADMIN','MANAGER','CASHIER','OWNER','SUPERADMIN'] as $target){
  $out=$core->invitation_create_endpoint(rq(['role'=>$target,'branches'=>[4]]));
  $allowed=$actor==='OWNER'?in_array($target,['ADMIN','MANAGER','CASHIER']):($actor==='ADMIN'&&in_array($target,['MANAGER','CASHIER']));
  check($allowed?($out instanceof WP_REST_Response):is_wp_error($out),'Wrong role decision: '.$actor.' -> '.$target);
  if($allowed){check($out->data['invitation']['role']===$target,'Role lost');$codes[$actor.'-'.$target]=$out->data;}
 }
}
$wpdb->tables['members'][12]['role']='OWNER';
check(is_wp_error($core->invitation_create_endpoint(rq(['role'=>'MANAGER','branches'=>[999]]))),'Foreign branch invitation accepted');
$wpdb->tables['members'][12]['role']='ADMIN';$wpdb->grants=['members.manage'];
check(is_wp_error($core->invitation_create_endpoint(rq(['role'=>'MANAGER','branches'=>[4]]))),'Permission escalation accepted');
$wpdb->tables['members'][12]['role']='OWNER';$wpdb->grants=$defaults['ADMIN'];
$blocked=$core->invitation_create_endpoint(rq(['role'=>'CASHIER','branches'=>[4]]));
$wpdb->tables['members'][12]['role']='ADMIN';$wpdb->grants=[];
check(is_wp_error($core->invitation_revoke_endpoint(rq(['invitation_id'=>$blocked->data['invitation']['id']]))),'Revoke branch permission bypass');
$wpdb->tables['members'][12]['role']='OWNER';$wpdb->grants=$defaults['ADMIN'];
$revoked=$codes['OWNER-CASHIER'];check(!is_wp_error($core->invitation_revoke_endpoint(rq(['invitation_id'=>$revoked['invitation']['id']]))),'Revoke failed');
check(is_wp_error($core->invitation_revoke_endpoint(rq(['invitation_id'=>$revoked['invitation']['id']]))),'Second revoke accepted');
check(is_wp_error($core->register_invited_endpoint(rq(['code'=>$revoked['code'],'full_name'=>'Revoked','email'=>'revoked@example.test','password'=>'Strong-password-4826']))),'Revoked invitation registered');
foreach(['ADMIN','MANAGER','CASHIER'] as $i=>$role){
 $created=$core->invitation_create_endpoint(rq(['role'=>$role,'branches'=>[4]]));$code=$created->data['code'];
 $registered=$core->register_invited_endpoint(rq(['code'=>$code,'full_name'=>'User '.$role,'email'=>strtolower($role).'@example.test','password'=>'Strong-password-4826','role'=>'OWNER']));
 check($registered instanceof WP_REST_Response&&$registered->data['role']===$role,'Registration role not enforced');
 $uid=$registered->data['user']['id'];$member=array_values(array_filter($wpdb->tables['members'],fn($r)=>$r['user_id']==$uid))[0];
 check($member['tenant_id']===7&&$member['role']===$role,'Wrong membership');
 $branchAccess=array_values(array_filter($wpdb->tables['branch_access'],fn($r)=>$r['member_id']==$member['id']))[0];
 check($branchAccess['branch_id']===4&&json_decode($branchAccess['permissions'],true)===$defaults[$role],'Wrong branch permissions');
 check(!is_wp_error($core->require_session(rq([],$registered->data['token']))),'Registration token invalid');
 $login=$core->login_endpoint(rq(['email'=>strtolower($role).'@example.test','password'=>'Strong-password-4826']));check(!is_wp_error($login),'Login failed');
 check($login->data['token']!==$registered->data['token'],'Sessions shared');
 $me=$core->me_endpoint(rq([],$login->data['token']));check($me->data['memberships'][0]['tenantId']===7&&$me->data['memberships'][0]['role']===$role,'Login context wrong');
 check(is_wp_error($core->register_invited_endpoint(rq(['code'=>$code,'full_name'=>'Reuse','email'=>'reuse'.$i.'@example.test','password'=>'Strong-password-4826']))),'Invitation reused');
}
$wpdb->tables['members'][12]['role']='OWNER';
$expired=$core->invitation_create_endpoint(rq(['role'=>'CASHIER','branches'=>[4]]));$eid=$expired->data['invitation']['id'];$wpdb->tables['invitations'][$eid]['expires_at']='2000-01-01 00:00:00';
check(is_wp_error($core->invitation_revoke_endpoint(rq(['invitation_id'=>$eid]))),'Expired invitation revoked');
check(is_wp_error($core->register_invited_endpoint(rq(['code'=>$expired->data['code'],'full_name'=>'Expired','email'=>'expired@example.test','password'=>'Strong-password-4826']))),'Expired invitation registered');
$existing=$core->invitation_create_endpoint(rq(['role'=>'CASHIER','branches'=>[4]]));
$wpdb->tables['users'][50]=['id'=>50,'full_name'=>'Existing','email'=>'existing@example.test','status'=>'ACTIVE'];
$wpdb->tables['sessions'][50]=['id'=>50,'user_id'=>50,'token_hash'=>hash('sha256',str_repeat('b',64)),'expires_at'=>'2099-01-01 00:00:00'];
$accepted=$core->invitation_accept_endpoint(rq(['code'=>$existing->data['code'],'role'=>'OWNER'],str_repeat('b',64)));
check(!is_wp_error($accepted)&&$accepted->data['role']==='CASHIER','Existing account acceptance role wrong');
check(is_wp_error($core->invitation_accept_endpoint(rq(['code'=>$existing->data['code']],str_repeat('b',64)))),'Invitation accepted twice');
foreach(['sales','debts','payments','refunds'] as $resource){$out=FKC_History_API::read(rq(['branch_id'=>4,'resource'=>$resource,'cursor'=>0]));check(!is_wp_error($out)&&count($out['items'])===1,'History missing');}
check(is_wp_error(FKC_History_API::read(rq(['branch_id'=>999,'resource'=>'sales']))),'History foreign branch accepted');
check(is_wp_error(FKC_History_API::read(rq(['tenant_id'=>8,'branch_id'=>4,'resource'=>'sales']))),'History foreign tenant accepted');
$wpdb->tables['members'][12]['role']='CASHIER';$wpdb->grants=['stock.read'];check(is_wp_error(FKC_History_API::read(rq(['branch_id'=>4,'resource'=>'sales']))),'History permission bypass');
echo "PASS: real Core handlers; 20 role decisions, branch/escalation denial, revoke, 3 registrations/logins and independent sessions, invitation reuse denied, scoped histories. DB/WordPress boundary simulated.\n";
