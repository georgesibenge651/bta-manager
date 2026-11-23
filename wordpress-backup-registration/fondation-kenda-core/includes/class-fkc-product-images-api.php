<?php
if (!defined('ABSPATH')) { exit; }
/** Content-addressed product files. Retries return the same tenant/branch URL. */
final class FKC_Product_Images_API {
 public static function boot(){add_action('rest_api_init',array(__CLASS__,'routes'));}
 public static function routes(){register_rest_route('bta/v1','/tenants/(?P<tenant_id>\d+)/products/image',array('methods'=>'POST','callback'=>array(__CLASS__,'upload'),'permission_callback'=>array(__CLASS__,'permission')));}
 public static function permission($r){
  $auth=FKC_Core::instance()->require_session($r);if(is_wp_error($auth))return $auth;
  $access=FKC_Branch_Access::guard(null,null,$r);return is_wp_error($access)?$access:true;
 }
 private static function error($code,$message,$status=400){return new WP_Error($code,$message,array('status'=>$status));}
 public static function upload($r){
  $allowed=self::permission($r);if(is_wp_error($allowed))return $allowed;
  $tenant=absint($r['tenant_id']);$branch=absint($r->get_param('branch_id'));
  if(!$tenant||!$branch)return self::error('bta_image_scope','Établissement requis.');
  $data=$r->get_param('data_url');
  if(!is_string($data)||strlen($data)>2800000||!preg_match('#^data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$#D',$data,$m))return self::error('bta_invalid_image','Image JPG, PNG ou WebP requise (2 Mo maximum).');
  $bytes=base64_decode($m[2],true);$info=$bytes!==false?@getimagesizefromstring($bytes):false;
  if(!$bytes||strlen($bytes)>2097152||!$info||($info['mime']??'')!=='image/'.$m[1]||$info[0]>10000||$info[1]>10000)return self::error('bta_invalid_image','Contenu image invalide.');
  $sha=hash('sha256',$bytes);$ext=$m[1]==='jpeg'?'jpg':$m[1];
  $uploads=wp_upload_dir();if(!empty($uploads['error']))return self::error('bta_image_storage','Stockage indisponible.',503);
  $relative='/bta-products/'.$tenant.'/'.$branch;
  $directory=$uploads['basedir'].$relative;
  if(!wp_mkdir_p($directory))return self::error('bta_image_storage','Dossier image indisponible.',503);
  $name=$sha.'.'.$ext;$path=$directory.'/'.$name;
  if(!is_file($path)){
   $temp=tempnam($directory,'.upload-');
   if(!$temp)return self::error('bta_image_storage','Écriture impossible.',503);
   $written=file_put_contents($temp,$bytes,LOCK_EX);
   if($written!==strlen($bytes)||!rename($temp,$path)){@unlink($temp);return self::error('bta_image_storage','Image non enregistrée.',503);}
   @chmod($path,0644);
  }
  return array('success'=>true,'sha256'=>$sha,'image_url'=>esc_url_raw($uploads['baseurl'].$relative.'/'.$name));
 }
}
