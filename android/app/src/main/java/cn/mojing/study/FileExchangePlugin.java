package cn.mojing.study;

import android.app.Activity;
import android.content.Intent;
import android.util.Base64;
import android.util.Base64InputStream;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.UUID;

/** System document picker writes the backup to a user-chosen location (no broad storage permission). */
@CapacitorPlugin(name = "FileExchange")
public class FileExchangePlugin extends Plugin {
    @PluginMethod
    public void saveFile(PluginCall call) {
        String name = call.getString("name");
        String data = call.getString("data");
        if (name == null || data == null) { call.reject("缺少文件名或文件内容"); return; }

        // Capacitor serializes the outstanding activity call into onSaveInstanceState.
        // Keep only a short cache token there: retaining a PDF's Base64 in call options
        // exceeds Android's Binder transaction limit when the document picker opens.
        call.getData().remove("data");
        String token = UUID.randomUUID().toString();
        call.getData().put("cacheToken", token);
        getBridge().execute(() -> {
            try {
                File cached = cacheFile(token);
                File directory = cached.getParentFile();
                if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("无法创建临时导出目录");
                try (InputStream input = new Base64InputStream(new AsciiStringInputStream(data), Base64.DEFAULT);
                     FileOutputStream output = new FileOutputStream(cached)) {
                    copy(input, output);
                    output.getFD().sync();
                }
                Activity activity = getActivity();
                if (activity == null || activity.isFinishing() || activity.isDestroyed()) {
                    cleanup(call);
                    call.reject("页面已关闭，请重新导出");
                    return;
                }
                activity.runOnUiThread(() -> {
                    try {
                        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                        intent.addCategory(Intent.CATEGORY_OPENABLE);
                        intent.setType(call.getString("mime", "application/zip"));
                        intent.putExtra(Intent.EXTRA_TITLE, name);
                        startActivityForResult(call, intent, "saveResult");
                    } catch (Exception error) {
                        cleanup(call);
                        call.reject("无法打开保存位置：" + error.getMessage(), error);
                    }
                });
            } catch (Exception error) {
                cleanup(call);
                call.reject("准备备份失败：" + error.getMessage(), error);
            }
        });
    }
    @ActivityCallback
    private void saveResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            cleanup(call);
            JSObject canceled = new JSObject(); canceled.put("saved", false); call.resolve(canceled); return;
        }
        getBridge().execute(() -> {
            try (InputStream input = new FileInputStream(cacheFile(call.getString("cacheToken")));
                 OutputStream stream = getContext().getContentResolver().openOutputStream(result.getData().getData(), "wt")) {
                if (stream == null) throw new IllegalStateException("无法打开所选保存位置");
                copy(input, stream);
                stream.flush();
                JSObject saved = new JSObject(); saved.put("saved", true); call.resolve(saved);
            } catch (Exception error) { call.reject("备份写入失败：" + error.getMessage(), error); }
            finally { cleanup(call); }
        });
    }

    private File cacheFile(String token) throws IOException {
        if (token == null || !token.matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")) {
            throw new IOException("临时备份标识无效，请重新导出");
        }
        File base = getContext().getCacheDir().getCanonicalFile();
        File directory = new File(base, "mojing-exports").getCanonicalFile();
        File target = new File(directory, token + ".bin").getCanonicalFile();
        if (!directory.getPath().startsWith(base.getPath() + File.separator) || !directory.equals(target.getParentFile())) {
            throw new IOException("临时备份路径无效");
        }
        return target;
    }

    private void cleanup(PluginCall call) {
        try {
            String token = call.getString("cacheToken");
            if (token != null) cacheFile(token).delete();
        } catch (Exception ignored) { /* Only app-generated, validated cache files may be deleted. */ }
        call.getData().remove("cacheToken");
    }

    private static void copy(InputStream input, OutputStream output) throws IOException {
        byte[] buffer = new byte[64 * 1024];
        int count;
        while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
    }

    /** Decode without allocating another archive-sized ASCII byte array. */
    private static final class AsciiStringInputStream extends InputStream {
        private final String value;
        private int position;
        AsciiStringInputStream(String value) { this.value = value; }
        @Override public int read() { return position < value.length() ? value.charAt(position++) & 0xff : -1; }
        @Override public int read(byte[] bytes, int offset, int length) {
            if (length == 0) return 0;
            if (position >= value.length()) return -1;
            int count = Math.min(length, value.length() - position);
            for (int i = 0; i < count; i++) bytes[offset + i] = (byte) value.charAt(position++);
            return count;
        }
    }
}
