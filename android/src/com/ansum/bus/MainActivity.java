/*
 * Ansum Transport — MainActivity
 * ==============================
 * Ultra-thin WebView shell. It ships NO web assets; it always loads the live
 * GitHub Pages site, so a `git push` updates every installed app with no
 * reinstall (LOAD_NO_CACHE + clearCache(true)).
 *
 * ── The status-bar gap ────────────────────────────────────────────────────
 * The app is edge-to-edge: the WebView is laid out to the full screen and the
 * web header is supposed to paint right up to y = 0. Reporting said a *white
 * strip* appeared above the blue header. Three separate things have to agree,
 * and the fix pins all three to the same constant HEADER_COLOR:
 *
 *   1. window.statusBarColor — the system status bar itself. Left unset it
 *      defaults to the theme's colour (light), i.e. a grey/white strip.
 *   2. window.navigationBarColor — same problem at the bottom.
 *   3. The WebView's own background (setBackgroundColor) — what shows during
 *      load and behind any translucent area.
 *
 * The web side is told the real inset through --status-inset so the header's
 * top padding clears the clock/battery icons while its *background* still
 * fills the strip. That value is published two ways so the page never has to
 * guess and never locks it to 0:
 *
 *   • window.ANSUM_INSETS.getStatusInset()  (addJavascriptInterface, readable
 *     synchronously on the doc-start frame — the page's boot script reads it
 *     before first paint)
 *   • :root { --status-inset }              (injected on onPageFinished, the
 *     original mechanism, kept as the belt to the interface's braces)
 *
 * The Java package is kept as com.ansum.bus on purpose: the already-installed
 * APK uses it, and changing it would install a *second* app instead of
 * upgrading the existing one.
 */
package com.ansum.bus;

import android.Manifest;
import android.animation.ObjectAnimator;
import android.animation.ValueAnimator;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Resources;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.util.Property;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.animation.AccelerateDecelerateInterpolator;
import android.webkit.GeolocationPermissions;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

public class MainActivity extends Activity {

    /* Each mode has its own header colour, and the system status/navigation
       bars must match the page that is actually loaded - otherwise switching to
       the green (GMB) or red (RMB) mode leaves blue bars above a green/red
       header. These must stay in sync with three places per page:
         - <meta name="theme-color">
         - html { background }
         - header.app-header { background }   (and the APK bar colours here)
       defaultHeaderColor() is the bus mode and the fallback for anything else. */
    private static final String HEADER_COLOR = "#1a3d7c";   // index.html  (bus)
    private static final String GMB_COLOR    = "#0d5e3a";   // gmb.html    (green minibus)
    private static final String RMB_COLOR    = "#c8102e";   // rmb.html    (red minibus)
    private static final String PAGE_COLOR   = "#f5f7fb";

    private static final String START_URL = "https://mattpenny.github.io/transport/";
    private static final String HOST      = "mattpenny.github.io";

    private static final int LOCATION_PERMISSION_REQUEST_CODE = 1001;

    /* Spinner timing (shows while a slow page load is in flight). */
    private static final long LOADING_DELAY_MS = 400;
    private static final long SPINNER_HALF_MS  = 900;

    private WebView webView;
    private View overlayView;
    private ImageView spinnerView;
    private TextView statusView;
    private ObjectAnimator spinnerAnimator;

    private final Handler loadHandler = new Handler(Looper.getMainLooper());
    private boolean pendingShowLoading = false;

    /* Deferred geolocation prompt: WebChromeClient's callback can arrive before
       the runtime permission dialog has been answered, so hold it until the
       user decides. */
    private GeolocationPermissions.Callback pendingGeoCallback;
    private String pendingGeoOrigin;

    /* ================= lifecycle ================= */

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        /* ── system bars ─────────────────────────────────────────────────
           Set the status bar to the header colour and let the WebView draw
           behind it. FLAG_LAYOUT_NO_LIMITS is deliberately NOT used: it also
           lets the page slide under the navigation bar and breaks IME
           behaviour. Instead the content view keeps its normal bounds and we
           only make the *bar colours* match, then hand the measured heights
           to the page so it can pad itself.

           The colour is per-mode and is refreshed on every navigation by
           applyChromeColor(); START_URL is the bus page, so seed with that. */
        final int startColor = Color.parseColor(headerColorFor(START_URL));
        Window window = getWindow();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            window.setStatusBarColor(startColor);
            window.setNavigationBarColor(startColor);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            /* Every header colour is dark (blue/green/red) -> light icons.
               Without this the icons default to dark and disappear. */
            window.getDecorView().setSystemUiVisibility(0);
        }

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(startColor);

        webView = new WebView(this);
        webView.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        /* (3) the WebView's own background while the page is loading. */
        webView.setBackgroundColor(startColor);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setGeolocationEnabled(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        /* Always fetch from the network: the whole "never reinstall the APK"
          design depends on it. */
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);

        /* Expose the measured insets to the page so its boot script can read
           them synchronously, before the first paint. */
        webView.addJavascriptInterface(new InsetBridge(), "ANSUM_INSETS");

        webView.setWebViewClient(new AppWebViewClient());
        webView.setWebChromeClient(new AppChromeClient());

        root.addView(webView);

        buildOverlay(root);

        setContentView(root);

        webView.clearCache(true);
        webView.loadUrl(START_URL);
    }

    /* ================= loading overlay ================= */

    private void buildOverlay(FrameLayout root) {
        FrameLayout overlay = new FrameLayout(this);
        overlay.setBackgroundColor(Color.parseColor(PAGE_COLOR));
        overlay.setVisibility(View.GONE);
        overlayView = overlay;

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        FrameLayout.LayoutParams boxParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        boxParams.gravity = android.view.Gravity.CENTER;
        box.setLayoutParams(boxParams);

        spinnerView = new ImageView(this);
        int spinnerSize = dp(56);
        spinnerView.setLayoutParams(new LinearLayout.LayoutParams(spinnerSize, spinnerSize));
        int spinnerId = getResources().getIdentifier("spinner", "drawable", getPackageName());
        if (spinnerId != 0) {
            Bitmap bmp = BitmapFactory.decodeResource(getResources(), spinnerId);
            if (bmp != null) {
                int density = getResources().getDisplayMetrics().densityDpi;
                if (density != DisplayMetrics.DENSITY_DEFAULT && density != 0) {
                    int target = spinnerSize * DisplayMetrics.DENSITY_DEFAULT / density;
                    if (target > 0) {
                        spinnerView.setImageBitmap(Bitmap.createScaledBitmap(bmp, target, target, true));
                    } else {
                        spinnerView.setImageBitmap(bmp);
                    }
                } else {
                    spinnerView.setImageBitmap(bmp);
                }
            }
        }
        box.addView(spinnerView);

        statusView = new TextView(this);
        statusView.setText("");
        statusView.setTextSize(14f);
        statusView.setTextColor(Color.parseColor(HEADER_COLOR));
        LinearLayout.LayoutParams statusParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        statusParams.topMargin = dp(14);
        statusView.setLayoutParams(statusParams);
        box.addView(statusView);

        overlay.addView(box);
        root.addView(overlay);
    }

    private void showLoading() {
        if (overlayView != null) {
            overlayView.setVisibility(View.VISIBLE);
            statusView.setText("");
            startSpinnerPulse();
        }
    }

    private void cancelShowLoading() {
        pendingShowLoading = false;
        loadHandler.removeCallbacksAndMessages(null);
    }

    private void scheduleShowLoading() {
        pendingShowLoading = true;
        loadHandler.removeCallbacksAndMessages(null);
        loadHandler.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (pendingShowLoading) {
                    showLoading();
                }
            }
        }, LOADING_DELAY_MS);
    }

    private void hideStatus() {
        cancelShowLoading();
        stopSpinnerPulse();
        if (overlayView != null) {
            overlayView.setVisibility(View.GONE);
        }
    }

    private void setPageError(final String message) {
        cancelShowLoading();
        stopSpinnerPulse();
        if (overlayView != null) {
            overlayView.setVisibility(View.VISIBLE);
        }
        if (statusView != null) {
            statusView.setText(message);
        }
    }

    /* ---- spinner pulse ---- */

    private void startSpinnerPulse() {
        if (spinnerView == null || spinnerAnimator != null) return;
        spinnerAnimator = ObjectAnimator.ofFloat(spinnerView, Property.of(View.class, Float.class, "scaleX"), 1f, 1.28f);
        spinnerAnimator.setDuration(SPINNER_HALF_MS);
        spinnerAnimator.setRepeatCount(ValueAnimator.INFINITE);
        spinnerAnimator.setRepeatMode(ValueAnimator.REVERSE);
        spinnerAnimator.setInterpolator(new AccelerateDecelerateInterpolator());
        spinnerAnimator.start();
    }

    private void stopSpinnerPulse() {
        if (spinnerAnimator != null) {
            spinnerAnimator.cancel();
            spinnerAnimator = null;
        }
    }

    /* ================= insets ================= */

    private int dimenPx(String name) {
        Resources res = getResources();
        int id = res.getIdentifier(name, "dimen", "android");
        if (id != 0) {
            return res.getDimensionPixelSize(id);
        }
        /* Fallback: the resource was not found (some vendor ROMs). Estimate
           rather than returning 0, which would put the title under the
           clock/battery icons. 24dp / 48dp are the platform defaults, and
           getDimensionPixelSize() would have applied the density for us — so
           the fallback must do it too. */
        return name.contains("navigation") ? dp(48) : dp(24);
    }

    /**
     * REMOVED: statusBarInset().
     *
     * It measured the status bar height and handed it to the page as
     * --status-inset. That was wrong for this app: the window is not
     * edge-to-edge, so the WebView is already laid out below the bar and the
     * page must not pad for it. Sending the height made the page double-count
     * and the header visibly jumped down after first paint.
     *
     * It is deleted rather than left unused on purpose — dead code that
     * "looks right" is how this bug would come back. If the app is ever made
     * genuinely edge-to-edge, the page reads env(safe-area-inset-top) itself
     * and still needs nothing from here.
     *
     * The unit trap it documented is still worth remembering if it is ever
     * reinstated for a real edge-to-edge window: getDimensionPixelSize()
     * returns PHYSICAL px (density already baked in), so dividing by density
     * is what recovers dp ≈ CSS px. Emitting it unchanged made the header
     * 170 CSS px tall on a 1080x2400 phone; multiplying by density is worse.
     */

    private float density() {
        return getResources().getDisplayMetrics().density;
    }

    /* Navigation bar height, in the unit the page consumes: dp, i.e. CSS px.
       Unlike the status bar this one IS still sent: the page uses it for
       bottom scroll padding, and under a gesture nav bar the real value keeps
       that correct. Same unit contract as above (physical px / density). */
    private int navBarInset() {
        return Math.round(dimenPx("navigation_bar_height") / density());
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    /** Published to the page as window.ANSUM_INSETS. */
    private class InsetBridge {
        @android.webkit.JavascriptInterface
        public int getStatusInset() {
            /* 0, for the same reason injectSafeArea() sends 0: this window is
               not edge-to-edge, so the status bar is not occupying any of the
               page. Reporting the measured bar height here would invite the
               page to pad for a bar it is already below — the exact
               double-count that caused the visible downward flash. */
            return 0;
        }

        @android.webkit.JavascriptInterface
        public int getNavInset() {
            return navBarInset();
        }

        @android.webkit.JavascriptInterface
        public String getHeaderColor() {
            /* The colour of the mode currently loaded, not always bus-blue -
               the page uses this to keep its own chrome consistent. */
            String url = webView != null ? webView.getUrl() : null;
            return headerColorFor(url);
        }
    }

    /**
     * Push the measured insets into the page.
     *
     * IMPORTANT: this must never be the last word on --status-inset. It runs on
     * every onPageFinished, i.e. AFTER the page's boot script has already set
     * the variable, so an unclamped write here silently defeats the page's
     * clamp — which is precisely how a 132px value survived a page that capped
     * at 44 and kept the header 170px tall.
     *
     * Two defences now:
     *   1. the value is already in the page's unit (dp), so it is small; and
     *   2. the page watches <html style> with a MutationObserver and re-clamps
     *      anything out of range.
     *
     * The write is also deferred a tick so it lands after the page's own
     * first-paint application, keeping the ordering deterministic.
     */
    private void injectSafeArea(final WebView view) {
        final int bottom = navBarInset();
        /* DELIBERATELY NOT SENDING A STATUS INSET.
         *
         * This window is not edge-to-edge: the theme is
         * Theme.Material.Light.NoActionBar and FLAG_LAYOUT_NO_LIMITS is never
         * set, so Android already lays the WebView out BELOW the status bar.
         * The bar therefore occupies zero pixels of the page, env() reports 0,
         * and the header needs no top padding for it.
         *
         * We used to push the measured status bar height in as --status-inset
         * anyway. The page then padded itself by that much on top of already
         * being below the bar — double-counting — and because this write lands
         * AFTER first paint, the header visibly STARTED CORRECT AND THEN
         * JUMPED DOWN ~16-24px. That is the flash users reported, and it was
         * caused by this line, not by the page.
         *
         * So we send 0. If the app is ever made genuinely edge-to-edge, the
         * page's resolver derives its padding from env(safe-area-inset-top),
         * which starts reporting the real value at that point — nothing here
         * needs to change.
         *
         * --nav-inset is still sent: the bottom inset behaves the same way, but
         * the page consumes it only for scroll padding, and sending the real
         * height keeps that correct under a gesture navigation bar. */
        final String js =
                "(function(){var d=document.documentElement;" +
                "d.style.setProperty('--status-inset','0px');" +
                "d.style.setProperty('--nav-inset','" + bottom + "px');})();";
        view.postDelayed(new Runnable() {
            @Override
            public void run() {
                view.evaluateJavascript(js, null);
            }
        }, 60);
    }

    /* ================= WebView client ================= */

    private class AppWebViewClient extends WebViewClient {

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return handleUrl(request.getUrl().toString());
        }

        @SuppressWarnings("deprecation")
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return handleUrl(url);
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            /* Repaint the system bars BEFORE the new page paints, so switching
               bus -> GMB never shows blue bars above a green header. */
            applyChromeColor(url);
            scheduleShowLoading();
            super.onPageStarted(view, url, favicon);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            hideStatus();
            /* Re-apply after the load as well: some WebViews restore a default
               bar colour during a navigation, which would undo the line above. */
            applyChromeColor(url);
            injectSafeArea(view);
            super.onPageFinished(view, url);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request,
                                    WebResourceError error) {
            if (request.isForMainFrame()) {
                setPageError("無法載入，請檢查網絡連線");
            }
            super.onReceivedError(view, request, error);
        }

        @SuppressWarnings("deprecation")
        @Override
        public void onReceivedError(WebView view, int errorCode,
                                    String description, String failingUrl) {
            setPageError("無法載入，請檢查網絡連線");
            super.onReceivedError(view, errorCode, description, failingUrl);
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request,
                                        WebResourceResponse response) {
            if (request.isForMainFrame()) {
                setPageError("HTTP " + response.getStatusCode());
            }
            super.onReceivedHttpError(view, request, response);
        }
    }

    /**
     * Keep our own host inside the WebView; send everything else to the system
     * browser. Returns true when the URL was handled elsewhere.
     */
    private boolean handleUrl(String url) {
        if (url == null) return false;
        String lower = url.toLowerCase();
        if (lower.startsWith("http://") || lower.startsWith("https://")) {
            String host = Uri.parse(url).getHost();
            if (host != null && host.endsWith(HOST)) {
                return false;  // stay in the WebView
            }
            openExternally(url);
            return true;
        }
        /* mailto:, tel:, intent:, ... */
        openExternally(url);
        return true;
    }

    private void openExternally(String url) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (ActivityNotFoundException ignored) {
            // No handler installed; nothing sensible to do.
        }
    }

    /* ================= per-mode chrome colour ================= */

    /**
     * The header colour for the page at `url`, so the system bars match the
     * page's own header instead of staying bus-blue in every mode.
     *
     * Keyed on the file name rather than the full URL so it keeps working if the
     * site moves host (the APK only ever loads our own origin anyway). Anything
     * unrecognised falls back to the bus colour, which is also what the root
     * `index.html` uses.
     */
    private String headerColorFor(String url) {
        if (url != null) {
            String u = url.toLowerCase();
            if (u.contains("gmb.html") || u.endsWith("/gmb")) return GMB_COLOR;
            if (u.contains("rmb.html") || u.endsWith("/rmb")) return RMB_COLOR;
        }
        return HEADER_COLOR;
    }

    /**
     * Repaint every chrome surface that shows above/around the page. All four
     * must move together or a differently-coloured strip appears:
     *   system status bar, system navigation bar, the root view, the WebView
     *   itself (visible during load).
     */
    @SuppressWarnings("deprecation")
    private void applyChromeColor(String url) {
        final int color = Color.parseColor(headerColorFor(url));
        Window window = getWindow();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            window.setStatusBarColor(color);
            window.setNavigationBarColor(color);
        }
        View root = findViewById(android.R.id.content);
        if (root != null) root.setBackgroundColor(color);
        if (webView != null) webView.setBackgroundColor(color);
        if (statusView != null) statusView.setTextColor(color);
    }

    /* ================= chrome client (geolocation) ================= */

    private class AppChromeClient extends WebChromeClient {

        @Override
        public void onGeolocationPermissionsShowPrompt(String origin,
                                                       GeolocationPermissions.Callback callback) {
            if (hasLocationPermission()) {
                callback.invoke(origin, true, false);
            } else {
                pendingGeoCallback = callback;
                pendingGeoOrigin = origin;
                requestLocationPermission();
            }
        }

        @Override
        public void onProgressChanged(WebView view, int newProgress) {
            super.onProgressChanged(view, newProgress);
        }
    }

    private boolean hasLocationPermission() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED
            || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
    }

    private void requestLocationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            requestPermissions(
                    new String[] {
                            Manifest.permission.ACCESS_FINE_LOCATION,
                            Manifest.permission.ACCESS_COARSE_LOCATION
                    },
                    LOCATION_PERMISSION_REQUEST_CODE);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions,
                                           int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != LOCATION_PERMISSION_REQUEST_CODE) return;
        if (pendingGeoCallback != null) {
            boolean granted = false;
            for (int result : grantResults) {
                if (result == PackageManager.PERMISSION_GRANTED) {
                    granted = true;
                    break;
                }
            }
            pendingGeoCallback.invoke(pendingGeoOrigin, granted, false);
            pendingGeoCallback = null;
            pendingGeoOrigin = null;
        }
    }

    /* ================= back / teardown ================= */

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        cancelShowLoading();
        stopSpinnerPulse();
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
