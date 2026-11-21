<?php
// Isolated endpoint checks: actual file storage, simulated WordPress auth and uploads root.
define('ABSPATH',__DIR__);
class WP_Error {function __construct(public $code,public $message,public $data=[]) {}}
function is_wp_error($x){return $x instanceof WP_Error;}
function absint($v){return abs((int)$v);}
function esc_url_raw($v){return $v;}
function wp_upload_dir(){return ['basedir'=>$GLOBALS['imageRoot'],'baseurl'=>'https://example.test/uploads'];}
function wp_mkdir_p($p){return is_dir($p)||mkdir($p,0777,true);}
class FKC_Core {static $allow=true;static function instance(){return new self;}function require_session($r){return self::$allow?true:new WP_Error('auth','denied');}}
class FKC_Branch_Access {static $allow=true;static function guard($a,$b,$r){return self::$allow?null:new WP_Error('branch','denied');}}
class Req extends ArrayObject {function get_param($k){return $this[$k]??null;}}
function check($v,$message){if(!$v)throw new RuntimeException($message);}
require dirname(__DIR__,2).'/wordpress/fondation-kenda-core/includes/class-fkc-product-images-api.php';
$imageRoot=sys_get_temp_dir().'/bta-image-test-'.bin2hex(random_bytes(5));
$data='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
$r=new Req(['tenant_id'=>7,'branch_id'=>4,'data_url'=>$data]);
try{
 $first=FKC_Product_Images_API::upload($r);check(!is_wp_error($first),'Valid PNG refused');
 $second=FKC_Product_Images_API::upload($r);check($first===$second,'Retry changed acknowledgement');
 check(count(glob($imageRoot.'/bta-products/7/4/*'))===1,'Duplicate media file');
 check($first['sha256']===hash('sha256',base64_decode(explode(',',$data)[1])),'Invalid content ACK');
 $r['branch_id']=5;$other=FKC_Product_Images_API::upload($r);check($other['image_url']!==$first['image_url'],'Branch path not isolated');
 FKC_Branch_Access::$allow=false;check(is_wp_error(FKC_Product_Images_API::upload($r)),'Branch denial ignored');FKC_Branch_Access::$allow=true;
 FKC_Core::$allow=false;check(is_wp_error(FKC_Product_Images_API::upload($r)),'Unauthenticated upload accepted');FKC_Core::$allow=true;
 $r['data_url']='data:image/png;base64,'.base64_encode('<?php echo 1;');check(is_wp_error(FKC_Product_Images_API::upload($r)),'Fake PNG accepted');
 $r['data_url']=str_replace('image/png','image/jpeg',$data);check(is_wp_error(FKC_Product_Images_API::upload($r)),'MIME mismatch accepted');
 echo "PASS: PNG storage, stable content ACK/replay, branch path isolation, auth denial, invalid image and MIME rejection. WordPress authorization simulated.\n";
}finally{
 foreach(glob($imageRoot.'/bta-products/7/*/*')?:[] as $file)unlink($file);
 foreach(glob($imageRoot.'/bta-products/7/*')?:[] as $dir)rmdir($dir);
 @rmdir($imageRoot.'/bta-products/7');@rmdir($imageRoot.'/bta-products');@rmdir($imageRoot);
}
