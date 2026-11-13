<?php
if (!defined('ABSPATH')) { exit; }

/** Idempotent sync adapters for catalogue and party writes. */
final class FKC_Sync_Adapters {
    private static function request($request,$tenant,$method,$path,$payload,$fields) {
        $sub=new WP_REST_Request($method,'/bta/v1/tenants/'.$tenant.'/'.$path);
        $sub->set_header('Authorization',$request->get_header('authorization'));
        $sub->set_param('tenant_id',(int)$tenant);
        if(isset($payload['branch_id']))$sub->set_param('branch_id',absint($payload['branch_id']));
        foreach($fields as $key)if(array_key_exists($key,$payload))$sub->set_param($key,$payload[$key]);
        return $sub;
    }
    public static function dispatch($request,$tenant,$type,$payload) {
        if($type==='category_create')return FKC_Commercial_API::categories_create(self::request($request,$tenant,'POST','categories',$payload,array('name','parent_id','description')));
        if($type==='category_update')return self::update_category($tenant,$payload);
        if($type==='product_create')return FKC_Commercial_API::products_create(self::request($request,$tenant,'POST','products',$payload,array('sku','barcode','name','description','unit','purchase_price','sale_price','currency','image_url','track_stock','min_stock','category_id','branch_id','initial_stock')));
        if($type==='product_update'||$type==='product_archive'){$sub=self::request($request,$tenant,'PUT','products/'.absint($payload['product_id']??0),$payload,array('name','sku','barcode','description','unit','purchase_price','sale_price','currency','image_url','min_stock','track_stock','category_id','branch_id','status'));$sub->set_param('product_id',absint($payload['product_id']??0));return FKC_Commercial_API::products_update($sub);}
        if($type==='customer_create')return FKC_Sales_API::customer_create(self::request($request,$tenant,'POST','customers',$payload,array('name','phone','email','address','notes','credit_limit')));
        if($type==='customer_update')return self::update_party($tenant,'customers',$payload,true);
        if($type==='supplier_create')return FKC_Purchases_API::supplier_create(self::request($request,$tenant,'POST','suppliers',$payload,array('name','phone','email','address','notes')));
        if($type==='supplier_update')return self::update_party($tenant,'suppliers',$payload,false);
        return null;
    }
    private static function update_category($tenant,$payload) {
        global $wpdb; $id=absint($payload['category_id']??0); $name=sanitize_text_field((string)($payload['name']??''));
        if(!$id||strlen($name)<2||strlen($name)>150)return new WP_Error('bta_invalid_category','ID et nom de catégorie valides requis.',array('status'=>400));
        $table=$wpdb->prefix.'bta_categories'; $existing=$wpdb->get_var($wpdb->prepare("SELECT id FROM {$table} WHERE id=%d AND tenant_id=%d",$id,$tenant));
        if(!$existing)return new WP_Error('bta_category_not_found','Catégorie introuvable.',array('status'=>404));
        $ok=$wpdb->update($table,array('name'=>$name,'description'=>sanitize_textarea_field((string)($payload['description']??'')),'updated_at'=>gmdate('Y-m-d H:i:s')),array('id'=>$id,'tenant_id'=>$tenant));
        if($ok===false)return new WP_Error('bta_category_update_failed','Mise à jour de catégorie impossible.',array('status'=>500));
        return array('success'=>true,'category'=>array('id'=>$id,'name'=>$name,'updated'=>true));
    }
    private static function update_party($tenant,$entity,$payload,$customer) {
        global $wpdb; $id=absint($payload[$customer?'customer_id':'supplier_id']??0); $name=sanitize_text_field((string)($payload['name']??''));
        if(!$id||strlen($name)<2||strlen($name)>190)return new WP_Error('bta_invalid_party','ID et nom valides requis.',array('status'=>400));
        $table=$wpdb->prefix.'bta_'.$entity; $existing=$wpdb->get_var($wpdb->prepare("SELECT id FROM {$table} WHERE id=%d AND tenant_id=%d AND status='ACTIVE'",$id,$tenant));
        if(!$existing)return new WP_Error('bta_party_not_found','Client ou fournisseur introuvable.',array('status'=>404));
        $data=array('name'=>$name,'phone'=>sanitize_text_field((string)($payload['phone']??'')),'email'=>sanitize_email((string)($payload['email']??'')),'address'=>sanitize_textarea_field((string)($payload['address']??'')),'notes'=>sanitize_textarea_field((string)($payload['notes']??'')),'updated_at'=>gmdate('Y-m-d H:i:s'));
        if($customer)$data['credit_limit']=max(0,(float)($payload['credit_limit']??0));
        $ok=$wpdb->update($table,$data,array('id'=>$id,'tenant_id'=>$tenant));
        if($ok===false)return new WP_Error('bta_party_update_failed','Mise à jour impossible.',array('status'=>500));
        $key=$customer?'customer':'supplier';
        return array('success'=>true,$key=>array('id'=>$id,'name'=>$name,'updated'=>true));
    }
}
