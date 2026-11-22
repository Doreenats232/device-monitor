package com.devicemonitor.agent

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.util.concurrent.Executors

class MainActivity : Activity() {

    private val io = Executors.newSingleThreadExecutor()
    private val ui = Handler(Looper.getMainLooper())
    private lateinit var root: LinearLayout

    private val bg = Color.parseColor("#070B14")
    private val card = Color.parseColor("#111A2E")
    private val sky = Color.parseColor("#38BDF8")
    private val violet = Color.parseColor("#A78BFA")
    private val ink = Color.parseColor("#E2E8F0")
    private val muted = Color.parseColor("#94A3B8")
    private val green = Color.parseColor("#34D399")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(44), dp(20), dp(28))
        }
        setContentView(ScrollView(this).apply { setBackgroundColor(bg); addView(root) })
        requestPermissionsIfNeeded()
        render()
    }

    override fun onResume() {
        super.onResume()
        PairingStore.load(this)?.let { render() }
    }

    override fun onDestroy() {
        io.shutdownNow()
        super.onDestroy()
    }

    private fun render() {
        root.removeAllViews()
        header()
        val pairing = PairingStore.load(this)
        if (pairing == null) renderPairForm() else renderPaired(pairing)
        renderAlerts(pairing?.server)
        if (AlertPrefs.enabled(this)) AlertService.start(this)
    }

    private fun renderAlerts(pairedServer: String?) {
        val c = card()
        title(c, "Phone alerts")
        if (AlertPrefs.enabled(this)) {
            label("Alerts are ON. You get a notification when a device goes offline, battery is low, or CPU spikes.", 13f, color = muted, parent = c)
            button(c, "Turn off alerts", danger = true) { AlertService.stop(this); render() }
            return
        }
        label("Get notified here when any of your devices has a problem. Uses your dashboard password once; the phone then keeps a read-only alerts key.", 13f, color = muted, parent = c)
        val serverField = input(c, "Dashboard URL", InputType.TYPE_TEXT_VARIATION_URI)
        serverField.setText(pairedServer ?: AlertPrefs.server(this))
        val pw = input(c, "Dashboard password (leave empty if none)", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD)
        val status = label("", 13f, color = Color.parseColor("#FCA5A5"), parent = c)
        button(c, "Turn on alerts", primary = true) {
            val server = serverField.text.toString().trim().trimEnd('/')
            if (!server.startsWith("http://") && !server.startsWith("https://")) {
                status.text = "URL must start with http:// or https://"; return@button
            }
            status.setTextColor(muted); status.text = "Signing in…"
            val password = pw.text.toString()
            io.execute {
                try {
                    val res = Api.login(server, password)
                    if (res.status in 200..299) {
                        AlertPrefs.save(this, server, res.body.optString("viewerToken", ""))
                        ui.post { AlertService.start(this); render() }
                    } else {
                        val msg = res.body.optString("error", "Sign-in failed (HTTP ${res.status})")
                        ui.post { status.setTextColor(Color.parseColor("#FCA5A5")); status.text = msg }
                    }
                } catch (e: Exception) {
                    ui.post { status.setTextColor(Color.parseColor("#FCA5A5")); status.text = "Could not reach the dashboard: ${e.message}" }
                }
            }
        }
    }

    private fun header() {
        label("DEVICE MONITOR", 12f, color = sky, bold = true)
        label("Share this phone", 28f, bold = true)
        label("Battery, network and system status — only with a dashboard you control.", 14f, color = muted)
    }

    private fun renderPairForm() {
        val c = card()
        title(c, "Pair this phone")
        val serverField = input(c, "Dashboard URL  (http://192.168.1.10:3000)", InputType.TYPE_TEXT_VARIATION_URI)
        val codeField = input(c, "6-digit pairing code", InputType.TYPE_CLASS_NUMBER)
        val nameField = input(c, "Name for this phone", InputType.TYPE_CLASS_TEXT)
        nameField.setText(Build.MODEL)
        val status = label("", 13f, color = Color.parseColor("#FCA5A5"), parent = c)

        button(c, "Pair and start sharing", primary = true) {
            val server = serverField.text.toString().trim().trimEnd('/')
            val code = codeField.text.toString().trim()
            val name = nameField.text.toString().trim().ifEmpty { Build.MODEL }
            if (!server.startsWith("http://") && !server.startsWith("https://")) {
                status.text = "URL must start with http:// or https://"; return@button
            }
            if (!Regex("\\d{6}").matches(code)) {
                status.text = "Enter the 6-digit code from the dashboard"; return@button
            }
            status.setTextColor(muted); status.text = "Pairing…"
            io.execute {
                try {
                    val res = Api.pair(server, code, name)
                    if (res.status in 200..299) {
                        PairingStore.save(this, PairingStore.Pairing(server, res.body.getString("token"), name))
                        ui.post { MonitorService.start(this); render() }
                    } else {
                        val msg = res.body.optString("error", "Pairing failed (HTTP ${res.status})")
                        ui.post { status.setTextColor(Color.parseColor("#FCA5A5")); status.text = msg }
                    }
                } catch (e: Exception) {
                    ui.post { status.setTextColor(Color.parseColor("#FCA5A5")); status.text = "Could not reach the dashboard: ${e.message}" }
                }
            }
        }
        label("You can stop sharing or unpair at any time. A notification stays visible while sharing.", 12f, color = muted)
    }

    private fun renderPaired(pairing: PairingStore.Pairing) {
        val active = MonitorService.isActive
        val c = card()
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        val dot = TextView(this).apply {
            this.text = "●"; textSize = 18f; setTextColor(if (active) green else muted)
        }
        row.addView(dot)
        row.addView(TextView(this).apply {
            this.text = if (active) "  Sharing is ON" else "  Sharing is OFF"
            textSize = 20f; setTextColor(ink); setTypeface(typeface, Typeface.BOLD)
        })
        c.addView(row)
        label("Paired as \"${pairing.name}\"", 14f, color = muted, parent = c)
        label(pairing.server, 12f, color = muted, parent = c)

        button(c, if (active) "Stop sharing" else "Start sharing", primary = !active) {
            if (active) MonitorService.stop(this) else MonitorService.start(this)
            ui.postDelayed({ render() }, 400)
        }
        button(c, "Open dashboard") {
            startActivity(Intent(this, DashboardActivity::class.java).putExtra("url", pairing.server))
        }

        val tips = card()
        title(tips, "Keep it reliable")
        label("Phones may stop background apps to save battery. Exclude Device Monitor so updates keep coming.", 13f, color = muted, parent = tips)
        button(tips, "Battery optimization settings") { openBatterySettings() }

        val more = card()
        title(more, "What is shared")
        label("Battery level & charging, Wi‑Fi name, IP, CPU, memory, storage, Bluetooth device names (battery when Android exposes it). Never messages, photos, contacts or location history.", 13f, color = muted, parent = more)
        button(more, "Unpair this phone", danger = true) {
            MonitorService.stop(this)
            PairingStore.clear(this)
            render()
        }
    }

    private fun openBatterySettings() {
        try {
            val pm = getSystemService(PowerManager::class.java)
            if (!pm.isIgnoringBatteryOptimizations(packageName)) {
                startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
            } else {
                startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
            }
        } catch (e: Exception) {
            startActivity(Intent(Settings.ACTION_SETTINGS))
        }
    }

    private fun requestPermissionsIfNeeded() {
        val wanted = mutableListOf(Manifest.permission.ACCESS_FINE_LOCATION)
        if (Build.VERSION.SDK_INT >= 33) wanted += Manifest.permission.POST_NOTIFICATIONS
        if (Build.VERSION.SDK_INT >= 31) wanted += Manifest.permission.BLUETOOTH_CONNECT
        val missing = wanted.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) requestPermissions(missing.toTypedArray(), 1)
    }

    // ---- UI helpers ----
    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    private fun rounded(color: Int, radius: Int = 20) = GradientDrawable().apply {
        setColor(color); cornerRadius = dp(radius).toFloat()
    }

    private fun card(): LinearLayout {
        val c = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = rounded(card)
            setPadding(dp(18), dp(16), dp(18), dp(16))
        }
        root.addView(c, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(16) })
        return c
    }

    private fun title(parent: LinearLayout, value: String) {
        label(value, 17f, bold = true, parent = parent)
    }

    private fun label(value: String, size: Float = 15f, color: Int = ink, bold: Boolean = false, parent: LinearLayout = root): TextView {
        val v = TextView(this).apply {
            this.text = value; textSize = size; setTextColor(color)
            if (bold) setTypeface(typeface, Typeface.BOLD)
            setPadding(0, dp(4), 0, dp(4))
        }
        parent.addView(v)
        return v
    }

    private fun input(parent: LinearLayout, hint: String, type: Int): EditText {
        val v = EditText(this).apply {
            this.hint = hint; inputType = type; setSingleLine(true)
            setTextColor(ink); setHintTextColor(Color.parseColor("#64748B"))
            background = rounded(Color.parseColor("#0B1220"), 14)
            setPadding(dp(14), dp(12), dp(14), dp(12))
        }
        parent.addView(v, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(10) })
        return v
    }

    private fun button(parent: LinearLayout, label: String, primary: Boolean = false, danger: Boolean = false, onClick: () -> Unit) {
        val v = Button(this).apply {
            this.text = label; isAllCaps = false; textSize = 15f
            setTypeface(typeface, Typeface.BOLD)
            stateListAnimator = null
            when {
                primary -> {
                    background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(sky, violet)).apply { cornerRadius = dp(16).toFloat() }
                    setTextColor(Color.parseColor("#06101F"))
                }
                danger -> {
                    background = rounded(Color.parseColor("#2A1218"), 16); setTextColor(Color.parseColor("#FCA5A5"))
                }
                else -> {
                    background = rounded(Color.parseColor("#1B2742"), 16); setTextColor(ink)
                }
            }
            setOnClickListener { onClick() }
        }
        parent.addView(v, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(50)).apply { topMargin = dp(12) })
    }
}
