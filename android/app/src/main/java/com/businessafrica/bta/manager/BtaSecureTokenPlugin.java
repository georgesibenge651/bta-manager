package com.businessafrica.bta.manager;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "BtaSecureToken")
public class BtaSecureTokenPlugin extends Plugin {
    private static final String KEY_ALIAS = "bta_core_token_key_v1";
    private static final String PREFS = "bta_core_secure_v1";

    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        java.security.Key existing = store.getKey(KEY_ALIAS, null);
        if (existing instanceof SecretKey) return (SecretKey) existing;
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true).build());
        return generator.generateKey();
    }

    private SharedPreferences prefs() { return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    @PluginMethod public void get(PluginCall call) {
        try {
            String encoded = prefs().getString("token", null);
            if (encoded == null) { JSObject out = new JSObject(); out.put("value", (String) null); call.resolve(out); return; }
            byte[] all = Base64.decode(encoded, Base64.NO_WRAP);
            byte[] iv = java.util.Arrays.copyOfRange(all, 0, 12);
            byte[] cipherText = java.util.Arrays.copyOfRange(all, 12, all.length);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
            String token = new String(cipher.doFinal(cipherText), StandardCharsets.UTF_8);
            JSObject out = new JSObject(); out.put("value", token); call.resolve(out);
        } catch (Exception e) { call.reject("Jeton sécurisé illisible."); }
    }

    @PluginMethod public void set(PluginCall call) {
        String token = call.getString("value");
        if (token == null || !token.matches("(?i)^[a-f0-9]{64}$")) { call.reject("Jeton Core invalide."); return; }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key());
            byte[] iv = cipher.getIV(); byte[] encrypted = cipher.doFinal(token.getBytes(StandardCharsets.UTF_8));
            byte[] all = new byte[iv.length + encrypted.length]; System.arraycopy(iv, 0, all, 0, iv.length); System.arraycopy(encrypted, 0, all, iv.length, encrypted.length);
            if (!prefs().edit().putString("token", Base64.encodeToString(all, Base64.NO_WRAP)).commit()) throw new Exception("prefs");
            call.resolve();
        } catch (Exception e) { call.reject("Impossible de sécuriser le jeton Core."); }
    }

    @PluginMethod public void remove(PluginCall call) { if (!prefs().edit().remove("token").commit()) { call.reject("Impossible d’effacer le jeton."); return; } call.resolve(); }
}
