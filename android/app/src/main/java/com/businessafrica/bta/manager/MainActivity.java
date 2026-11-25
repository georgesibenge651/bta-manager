package com.businessafrica.bta.manager;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(BtaSecureTokenPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
