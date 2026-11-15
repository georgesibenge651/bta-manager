<?php
if (!defined('ABSPATH')) { exit; }
/** Transferts inter-établissements, inventaires et alertes de stock. */
final class FKC_Stock_Ops_API {
 private static function t($n){global $wpdb;return in_array($n,array('users','tenants','branches','members','permissions','branch_access','invitations','audit_logs','sessions'),true)?'bta_'.$n:$wpdb->prefix.'bta_'.$n;}
 private static function err($c,$m,$s=400){return new WP_Error($c,$m,array('status'=>$s));}
 private static function auth($r,$tenant,$perm){
  $h=$r->get_header('authorization'); if(!$h&&isset($_SERVER['HTTP_AUTHORIZATION']))$h=wp_unslash($_SERVER['HTTP_AUTHORIZATION']);
  if(!is_string($h)||!preg_match('/^Bearer\s+([a-fA-F0-9]{64})$/',$h,$m))return self::err('bta_unauthenticated','Connexion requise.',401);
  global $wpdb; $s=$wpdb->get_row($wpdb->prepare('SELECT s.user_id,u.status FROM '.self::t('sessions').' s JOIN '.self::t('users').' u ON u.id=s.user_id WHERE s.token_hash=%s AND s.expires_at>%s LIMIT 1',hash('sha256',$m[1]),gmdate('Y-m-d H:i:s')),ARRAY_A);
  if(!$s||$s['status']!=='ACTIVE')return self::err('bta_unauthenticated','Session invalide ou expirée.',401);
  $mem=$wpdb->get_row($wpdb->prepare("SELECT role FROM ".self::t('members')." WHERE tenant_id=%d AND user_id=%d AND status='ACTIVE' LIMIT 1",$tenant,$s['user_id']),ARRAY_A); if(!$mem)return self::err('bta_forbidden','Accès refusé.',403);
  $map=array('OWNER'=>array('stock.read','stock.manage'),'ADMIN'=>array('stock.read','stock.manage'),'MANAGER'=>array('stock.read','stock.manage'),'CASHIER'=>array('stock.read'));
  if(!in_array($perm,$map[$mem['role']]??array(),true))return self::err('bta_forbidden','Permission insuffisante.',403); return array('user_id'=>(int)$s['user_id']);
 }
 public static function boot(){add_action('rest_api_init',array(__CLASS__,'routes'));}
 public static function routes(){
  register_rest_route('bta/v1','/tenants/(?P<tenant_id>\d+)/stock/reconcile',array('methods'=>'POST','callback'=>array(__CLASS__,'reconcile'),'permission_callback'=>'__return_true'));
  register_rest_route('bta/v1','/tenants/(?P<tenant_id>\d+)/stock/conflicts/resolve',array('methods'=>'POST','callback'=>array(__CLASS__,'resolve_conflict'),'permission_callback'=>'__return_true'));
  register_rest_route('bta/v1','/tenants/(?P<tenant_id>\d+)/stock/conflicts/history',array('methods'=>'GET','callback'=>array(__CLASS__,'conflict_history'),'permission_callback'=>'__return_true'));
  register_rest_route('bta/v1','/tenants/(?P<tenant_id>\d+)/stock/alerts',array('methods'=>'GET','callback'=>array(__CLASS__,'alerts'),'permission_callback'=>'__return_true'));
  register_rest_route('bta/v1','/tenants/(?P<tenant_id>\d+)/stock/adjustments',array('methods'=>'POST','callback'=>array(__CLASS__,'adjust'),'permission_callback'=>'__return_true'));
  register_rest_route('bta/v1','/tenants/(?P<tenant_id>\d+)/stock/transfers',array(array('methods'=>'GET','callback'=>array(__CLASS__,'transfers'),'permission_callback'=>'__return_true'),array('methods'=>'POST','callback'=>array(__CLASS__,'transfer'),'permission_callback'=>'__return_true')));
 }
 private static function branch_ok($tenant,$branch){global $wpdb;return (bool)$wpdb->get_var($wpdb->prepare("SELECT id FROM ".self::t('branches')." WHERE id=%d AND tenant_id=%d AND status='ACTIVE'",$branch,$tenant));}
 /** Compare les quantités locales avec le stock serveur sans modifier les données. */
 public static function reconcile($r){
  $t=(int)$r['tenant_id'];$a=self::auth($r,$t,'stock.read');if(is_wp_error($a))return $a;
  $items=$r->get_param('items');if(!is_array($items)||!count($items)||count($items)>100)return self::err('bta_invalid_reconciliation','Fournissez entre 1 et 100 articles à comparer.');
  global $wpdb;$results=array();$conflicts=0;
  foreach($items as $index=>$it){
   $b=absint($it['branch_id']??0);$p=absint($it['product_id']??0);$expected=$it['expected_quantity']??null;
   if(!$b||!$p||$expected===null||!is_numeric($expected)||(float)$expected<0)return self::err('bta_invalid_reconciliation_item','Chaque article doit contenir branch_id, product_id et expected_quantity valide.');
   if(!self::branch_ok($t,$b))return self::err('bta_invalid_branch','Établissement introuvable.',404);
   $product=$wpdb->get_row($wpdb->prepare('SELECT id,sku,name,unit FROM '.self::t('products')." WHERE id=%d AND tenant_id=%d AND status='ACTIVE'",$p,$t),ARRAY_A);
   if(!$product)return self::err('bta_product_not_found','Produit introuvable.',404);
   $stock=$wpdb->get_row($wpdb->prepare('SELECT quantity,updated_at FROM '.self::t('stock').' WHERE tenant_id=%d AND branch_id=%d AND product_id=%d LIMIT 1',$t,$b,$p),ARRAY_A);
   $current=$stock?(float)$stock['quantity']:0.0;$expected=(float)$expected;$match=abs($current-$expected)<=0.00005;
   if(!$match)$conflicts++;
   $results[]=array('index'=>(int)$index,'branch_id'=>$b,'product_id'=>$p,'sku'=>$product['sku'],'name'=>$product['name'],'unit'=>$product['unit'],'expected_quantity'=>$expected,'current_quantity'=>$current,'current_updated_at'=>$stock['updated_at']??null,'status'=>$match?'MATCH':'CONFLICT','suggested_action'=>$match?'NONE':'REVIEW');
  }
  return array('success'=>true,'read_only'=>true,'total'=>count($results),'conflicts'=>$conflicts,'matches'=>count($results)-$conflicts,'items'=>$results);
 }
 /** Historique paginé des résolutions de conflits de stock. */
 public static function conflict_history($r){
  $t=(int)$r['tenant_id'];$a=self::auth($r,$t,'stock.manage');if(is_wp_error($a))return $a;
  $page=max(1,absint($r->get_param('page')));$per=min(100,max(1,absint($r->get_param('per_page')?:25)));
  $branch=absint($r->get_param('branch_id'));$product=absint($r->get_param('product_id'));
  global $wpdb;$table=self::t('stock_conflict_resolutions');
  $where='tenant_id=%d';$args=array($t);
  if($branch){$where.=' AND branch_id=%d';$args[]=$branch;}
  if($product){$where.=' AND product_id=%d';$args[]=$product;}
  $total=(int)$wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$table} WHERE {$where}",$args));
  $offset=($page-1)*$per;
  $rows=$wpdb->get_results($wpdb->prepare("SELECT id,branch_id,product_id,decision,quantity_before,quantity_delta,quantity_after,reason,resolved_by,created_at FROM {$table} WHERE {$where} ORDER BY id DESC LIMIT %d OFFSET %d",array_merge($args,array($per,$offset))),ARRAY_A);
  return array('success'=>true,'page'=>$page,'per_page'=>$per,'total'=>$total,'total_pages'=>(int)ceil($total/$per),'filters'=>array('branch_id'=>$branch?:null,'product_id'=>$product?:null),'resolutions'=>$rows?:array());
 }
 /** Résout explicitement un conflit, avec contrôle optimiste et historique. */
 public static function resolve_conflict($r){
  $t=(int)$r['tenant_id'];$a=self::auth($r,$t,'stock.manage');if(is_wp_error($a))return $a;
  $b=absint($r->get_param('branch_id'));$p=absint($r->get_param('product_id'));
  $expected=$r->get_param('expected_quantity');$decision=sanitize_key((string)$r->get_param('decision'));
  $delta=$r->get_param('quantity_delta');$reason=sanitize_textarea_field((string)$r->get_param('reason'));
  if(!$b||!$p||!is_numeric($expected)||(float)$expected<0||!in_array($decision,array('keep_server','apply_adjustment'),true))return self::err('bta_invalid_conflict_resolution','Paramètres de résolution invalides.');
  if($decision==='apply_adjustment'&&(!is_numeric($delta)||(float)$delta==0||$reason===''))return self::err('bta_invalid_conflict_adjustment','Un écart non nul et un motif sont obligatoires.');
  if(!self::branch_ok($t,$b))return self::err('bta_invalid_branch','Établissement introuvable.',404);
  global $wpdb;
  $product_exists=$wpdb->get_var($wpdb->prepare("SELECT id FROM ".self::t('products')." WHERE id=%d AND tenant_id=%d AND status='ACTIVE' LIMIT 1",$p,$t));
  if(!$product_exists)return self::err('bta_product_not_found','Produit actif introuvable dans cette entreprise.',404);
  $stock=self::t('stock');$wpdb->query('START TRANSACTION');
  $row=$wpdb->get_row($wpdb->prepare("SELECT quantity,updated_at FROM {$stock} WHERE tenant_id=%d AND branch_id=%d AND product_id=%d FOR UPDATE",$t,$b,$p),ARRAY_A);
  $before=$row?(float)$row['quantity']:0.0;
  if(abs($before-(float)$expected)>0.00005){$wpdb->query('ROLLBACK');return new WP_REST_Response(array('success'=>false,'code'=>'bta_stock_conflict_changed','message'=>'Le stock a encore changé. Rechargez la réconciliation avant de décider.','current_quantity'=>$before,'current_updated_at'=>$row['updated_at']??null),409);}
  $change=$decision==='apply_adjustment'?(float)$delta:0.0;$after=$before+$change;
  if($after<0){$wpdb->query('ROLLBACK');return self::err('bta_insufficient_stock','Cette correction rendrait le stock négatif.',409);}
  $now=gmdate('Y-m-d H:i:s');
  if($change!=0){
   if($row)$ok=$wpdb->update($stock,array('quantity'=>$after,'updated_at'=>$now),array('tenant_id'=>$t,'branch_id'=>$b,'product_id'=>$p));
   else $ok=$wpdb->insert($stock,array('tenant_id'=>$t,'branch_id'=>$b,'product_id'=>$p,'quantity'=>$after,'updated_at'=>$now));
   if($ok===false){$wpdb->query('ROLLBACK');return self::err('bta_stock_adjust_failed','Mise à jour du stock impossible.',500);}
   $ok=$wpdb->insert(self::t('stock_movements'),array('tenant_id'=>$t,'branch_id'=>$b,'product_id'=>$p,'movement_type'=>'ADJUSTMENT','quantity'=>$change,'reference_type'=>'STOCK_CONFLICT','reference_id'=>0,'notes'=>$reason,'created_by'=>$a['user_id'],'created_at'=>$now));
   if(!$ok){$wpdb->query('ROLLBACK');return self::err('bta_stock_movement_failed','Journal de stock non enregistré.',500);}
  }
  $ok=$wpdb->insert(self::t('stock_conflict_resolutions'),array('tenant_id'=>$t,'branch_id'=>$b,'product_id'=>$p,'decision'=>$decision,'quantity_before'=>$before,'quantity_delta'=>$change,'quantity_after'=>$after,'reason'=>$reason?:null,'resolved_by'=>$a['user_id'],'created_at'=>$now));
  if(!$ok){$wpdb->query('ROLLBACK');return self::err('bta_conflict_history_failed','Historique de résolution non enregistré.',500);}
  $id=(int)$wpdb->insert_id;$wpdb->query('COMMIT');
  return new WP_REST_Response(array('success'=>true,'resolution_id'=>$id,'decision'=>$decision,'branch_id'=>$b,'product_id'=>$p,'quantity_before'=>$before,'quantity_delta'=>$change,'quantity_after'=>$after,'resolved_at'=>$now),201);
 }
 public static function alerts($r){$t=(int)$r['tenant_id'];$a=self::auth($r,$t,'stock.read');if(is_wp_error($a))return $a;$branch=absint($r->get_param('branch_id'));global $wpdb;$sql="SELECT st.branch_id,st.product_id,p.sku,p.name,p.unit,st.quantity,p.min_stock,(p.min_stock-st.quantity) AS shortage FROM ".self::t('stock')." st JOIN ".self::t('products')." p ON p.id=st.product_id AND p.tenant_id=st.tenant_id WHERE st.tenant_id=%d AND p.track_stock=1 AND st.quantity<=p.min_stock";$args=array($t);if($branch){$sql.=' AND st.branch_id=%d';$args[]=$branch;}$sql.=' ORDER BY st.branch_id,p.name LIMIT 500';$rows=$wpdb->get_results($wpdb->prepare($sql,$args),ARRAY_A);return array('success'=>true,'count'=>count($rows),'alerts'=>$rows);}
 public static function adjust($r){$t=(int)$r['tenant_id'];$a=self::auth($r,$t,'stock.manage');if(is_wp_error($a))return $a;$b=absint($r->get_param('branch_id'));$p=absint($r->get_param('product_id'));$delta=$r->get_param('quantity_delta');$reason=sanitize_textarea_field((string)$r->get_param('reason'));if(!$b||!$p||!is_numeric($delta)||(float)$delta==0||$reason==='')return self::err('bta_invalid_adjustment','Établissement, produit, écart non nul et motif obligatoires.');if(!self::branch_ok($t,$b))return self::err('bta_invalid_branch','Établissement introuvable.',404);global $wpdb;if(!$wpdb->get_var($wpdb->prepare('SELECT id FROM '.self::t('products')." WHERE id=%d AND tenant_id=%d AND status='ACTIVE'",$p,$t)))return self::err('bta_product_not_found','Produit introuvable.',404);$wpdb->query('START TRANSACTION');$table=self::t('stock');$row=$wpdb->get_row($wpdb->prepare("SELECT quantity,updated_at FROM {$table} WHERE tenant_id=%d AND branch_id=%d AND product_id=%d FOR UPDATE",$t,$b,$p),ARRAY_A);$before=$row?(float)$row['quantity']:0;$expected=$r->get_param('expected_quantity');if($expected!==null&&(!is_numeric($expected)||(float)$expected<0)){$wpdb->query('ROLLBACK');return self::err('bta_invalid_expected_stock','expected_quantity doit être un nombre positif ou nul.');}if($expected!==null&&abs($before-(float)$expected)>0.00005){$wpdb->query('ROLLBACK');return new WP_REST_Response(array('success'=>false,'code'=>'bta_stock_conflict','message'=>'Le stock a changé depuis la dernière synchronisation. Réconciliation requise.','branch_id'=>$b,'product_id'=>$p,'expected_quantity'=>(float)$expected,'current_quantity'=>$before,'current_updated_at'=>$row['updated_at']??null),409);}$after=$before+(float)$delta;if($after<0){$wpdb->query('ROLLBACK');return self::err('bta_insufficient_stock','L’ajustement rendrait le stock négatif.',409);}if($row){$ok=$wpdb->update($table,array('quantity'=>$after,'updated_at'=>gmdate('Y-m-d H:i:s')),array('tenant_id'=>$t,'branch_id'=>$b,'product_id'=>$p));}else{$ok=$wpdb->insert($table,array('tenant_id'=>$t,'branch_id'=>$b,'product_id'=>$p,'quantity'=>$after,'updated_at'=>gmdate('Y-m-d H:i:s')));}if($ok===false){$wpdb->query('ROLLBACK');return self::err('bta_stock_adjust_failed','Mise à jour du stock impossible.',500);}$ok=$wpdb->insert(self::t('stock_movements'),array('tenant_id'=>$t,'branch_id'=>$b,'product_id'=>$p,'movement_type'=>'ADJUSTMENT','quantity'=>(float)$delta,'reference_type'=>'INVENTORY_ADJUSTMENT','reference_id'=>0,'notes'=>$reason,'created_by'=>$a['user_id'],'created_at'=>gmdate('Y-m-d H:i:s')));if(!$ok){$wpdb->query('ROLLBACK');return self::err('bta_stock_movement_failed','Journal de stock non enregistré.',500);}$wpdb->query('COMMIT');return new WP_REST_Response(array('success'=>true,'branch_id'=>$b,'product_id'=>$p,'quantity_before'=>$before,'quantity_delta'=>(float)$delta,'quantity_after'=>$after),201);}
 public static function transfer($r){$t=(int)$r['tenant_id'];$a=self::auth($r,$t,'stock.manage');if(is_wp_error($a))return $a;$from=absint($r->get_param('from_branch_id'));$to=absint($r->get_param('to_branch_id'));$items=$r->get_param('items');if(!$from||!$to||$from===$to||!is_array($items)||!count($items)||!self::branch_ok($t,$from)||!self::branch_ok($t,$to))return self::err('bta_invalid_transfer','Établissements ou articles invalides.');global $wpdb;$wpdb->query('START TRANSACTION');$now=gmdate('Y-m-d H:i:s');foreach($items as $it){$p=absint($it['product_id']??0);$q=$it['quantity']??null;if(!$p||!is_numeric($q)||(float)$q<=0||!$wpdb->get_var($wpdb->prepare('SELECT id FROM '.self::t('products')." WHERE id=%d AND tenant_id=%d AND status='ACTIVE'",$p,$t))){$wpdb->query('ROLLBACK');return self::err('bta_invalid_transfer_item','Article ou quantité invalide.');}$st=$wpdb->get_row($wpdb->prepare('SELECT quantity FROM '.self::t('stock').' WHERE tenant_id=%d AND branch_id=%d AND product_id=%d FOR UPDATE',$t,$from,$p),ARRAY_A);if(!$st||(float)$st['quantity']<(float)$q){$wpdb->query('ROLLBACK');return self::err('bta_insufficient_stock','Stock insuffisant pour le transfert.',409);}}
 $wpdb->insert(self::t('stock_transfers'),array('tenant_id'=>$t,'from_branch_id'=>$from,'to_branch_id'=>$to,'status'=>'COMPLETED','created_by'=>$a['user_id'],'created_at'=>$now));$id=(int)$wpdb->insert_id;if(!$id){$wpdb->query('ROLLBACK');return self::err('bta_transfer_failed','Transfert impossible.',500);}foreach($items as $it){$p=absint($it['product_id']);$q=(float)$it['quantity'];$wpdb->query($wpdb->prepare('UPDATE '.self::t('stock').' SET quantity=quantity-%f,updated_at=%s WHERE tenant_id=%d AND branch_id=%d AND product_id=%d',$q,$now,$t,$from,$p));$dest=$wpdb->get_var($wpdb->prepare('SELECT id FROM '.self::t('stock').' WHERE tenant_id=%d AND branch_id=%d AND product_id=%d',$t,$to,$p));if($dest)$ok=$wpdb->query($wpdb->prepare('UPDATE '.self::t('stock').' SET quantity=quantity+%f,updated_at=%s WHERE id=%d',$q,$now,$dest));else $ok=$wpdb->insert(self::t('stock'),array('tenant_id'=>$t,'branch_id'=>$to,'product_id'=>$p,'quantity'=>$q,'updated_at'=>$now));if($ok===false){$wpdb->query('ROLLBACK');return self::err('bta_transfer_failed','Mise à jour du stock impossible.',500);}foreach(array(array($from,-$q,'TRANSFER_OUT'),array($to,$q,'TRANSFER_IN')) as $mv){$ok=$wpdb->insert(self::t('stock_movements'),array('tenant_id'=>$t,'branch_id'=>$mv[0],'product_id'=>$p,'movement_type'=>$mv[2],'quantity'=>$mv[1],'reference_type'=>'STOCK_TRANSFER','reference_id'=>$id,'notes'=>'Transfert inter-établissements #'.$id,'created_by'=>$a['user_id'],'created_at'=>$now));if(!$ok){$wpdb->query('ROLLBACK');return self::err('bta_transfer_failed','Journal de transfert impossible.',500);}}}
 $wpdb->query('COMMIT');return new WP_REST_Response(array('success'=>true,'transfer_id'=>$id,'status'=>'COMPLETED'),201);}
 public static function transfers($r){$t=(int)$r['tenant_id'];$a=self::auth($r,$t,'stock.read');if(is_wp_error($a))return $a;global $wpdb;$branch=absint($r->get_param('branch_id'));$sql='SELECT * FROM '.self::t('stock_transfers').' WHERE tenant_id=%d';$args=array($t);if($branch){$sql.=' AND (from_branch_id=%d OR to_branch_id=%d)';$args[]=$branch;$args[]=$branch;}$sql.=' ORDER BY id DESC LIMIT 100';$rows=$wpdb->get_results($wpdb->prepare($sql,$args),ARRAY_A);return array('success'=>true,'transfers'=>$rows);}
}
