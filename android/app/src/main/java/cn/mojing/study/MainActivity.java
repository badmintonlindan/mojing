package cn.mojing.study;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FileExchangePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
