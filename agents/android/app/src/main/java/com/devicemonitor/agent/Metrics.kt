package com.devicemonitor.agent

import android.annotation.SuppressLint
import android.app.ActivityManager
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.StatFs
import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.Inet4Address
import java.net.NetworkInterface
import java.util.Collections

/** Collects the same fields the PC agent sends: battery, network, system, extra. */
object Metrics {
    private const val MB = 1024.0 * 1024.0
    private const val GB = 1024.0 * 1024.0 * 1024.0
    private var lastCpu: LongArray? = null

    fun collect(context: Context): JSONObject {
        val extra = JSONObject()
            .put("model", "${Build.MANUFACTURER} ${Build.MODEL}")
            .put("bluetooth", readBluetooth(context))
            .put("agent", "android-1.0")

        return JSONObject()
            .put("battery", readBattery(context) ?: JSONObject.NULL)
            .put("network", readNetwork(context))
            .put("system", readSystem(context))
            .put("extra", extra)
    }

    private fun readBattery(context: Context): JSONObject? {
        val intent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return null
        val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
        if (level < 0 || scale <= 0) return null

        val status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
        val plugged = intent.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0)
        val charging = status == BatteryManager.BATTERY_STATUS_CHARGING ||
            status == BatteryManager.BATTERY_STATUS_FULL
        val source = when (plugged) {
            BatteryManager.BATTERY_PLUGGED_AC -> "AC"
            BatteryManager.BATTERY_PLUGGED_USB -> "USB"
            BatteryManager.BATTERY_PLUGGED_WIRELESS -> "Wireless"
            0 -> "Battery"
            else -> "Other"
        }
        return JSONObject()
            .put("level", level * 100 / scale)
            .put("charging", charging)
            .put("powerSource", source)
    }

    private fun readNetwork(context: Context): JSONObject {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val caps = cm.getNetworkCapabilities(cm.activeNetwork)
        val type = when {
            caps == null -> "none"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN) -> "vpn"
            else -> "other"
        }
        val name = if (type == "wifi") wifiSsid(context) else null
        return JSONObject()
            .put("type", type)
            .put("name", name ?: JSONObject.NULL)
            .put("ip", localIpv4() ?: JSONObject.NULL)
    }

    private fun readSystem(context: Context): JSONObject {
        val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val mem = ActivityManager.MemoryInfo()
        am.getMemoryInfo(mem)

        val stat = StatFs(Environment.getDataDirectory().path)
        val totalGb = stat.totalBytes / GB
        val usedGb = (stat.totalBytes - stat.availableBytes) / GB

        return JSONObject()
            .put("os", "Android ${Build.VERSION.RELEASE}")
            .put("cpuPercent", readCpuPercent() ?: JSONObject.NULL)
            .put("memoryUsedMb", round1((mem.totalMem - mem.availMem) / MB))
            .put("memoryTotalMb", round1(mem.totalMem / MB))
            .put("diskUsedGb", round1(usedGb))
            .put("diskTotalGb", round1(totalGb))
            .put("uptimeSeconds", SystemClock.elapsedRealtime() / 1000)
    }

    // CPU % since the previous sample, from /proc/stat (may be unavailable on some phones).
    private fun readCpuPercent(): Double? {
        try {
            val line = File("/proc/stat").bufferedReader().use { it.readLine() } ?: return null
            val values = line.trim().split(Regex("\\s+")).drop(1).map { it.toLong() }
            val idle = values[3] + (values.getOrNull(4) ?: 0L)
            val total = values.sum()
            val prev = lastCpu
            lastCpu = longArrayOf(idle, total)
            if (prev == null || total - prev[1] <= 0L) return null
            val busy = 1.0 - (idle - prev[0]).toDouble() / (total - prev[1]).toDouble()
            return round1(busy * 100.0)
        } catch (e: Exception) {
            return null
        }
    }

    /**
     * Paired Bluetooth devices (headphones, watches...) with battery when Android exposes it.
     * Battery reporting depends on the device and Android version, so it can show null.
     */
    @SuppressLint("MissingPermission")
    private fun readBluetooth(context: Context): JSONArray {
        val list = JSONArray()
        try {
            val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager ?: return list
            val adapter = manager.adapter ?: return list
            if (!adapter.isEnabled) return list
            for (device in adapter.bondedDevices.orEmpty()) {
                list.put(
                    JSONObject()
                        .put("name", device.name ?: "Unknown")
                        .put("battery", batteryOf(device) ?: JSONObject.NULL),
                )
            }
        } catch (e: SecurityException) {
            // Bluetooth permission not granted; report nothing.
        }
        return list
    }

    private fun batteryOf(device: BluetoothDevice): Int? {
        return try {
            val value = device.javaClass.getMethod("getBatteryLevel").invoke(device) as? Int
            if (value != null && value in 0..100) value else null
        } catch (e: Exception) {
            null
        }
    }

    @Suppress("DEPRECATION")
    private fun wifiSsid(context: Context): String? {
        return try {
            val wm = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
            val ssid = wm.connectionInfo?.ssid?.trim('"')
            if (ssid.isNullOrEmpty() || ssid == "<unknown ssid>") null else ssid
        } catch (e: Exception) {
            null
        }
    }

    private fun localIpv4(): String? {
        return try {
            Collections.list(NetworkInterface.getNetworkInterfaces())
                .filter { it.isUp && !it.isLoopback }
                .flatMap { Collections.list(it.inetAddresses) }
                .firstOrNull { it is Inet4Address && !it.isLoopbackAddress }
                ?.hostAddress
        } catch (e: Exception) {
            null
        }
    }

    private fun round1(value: Double): Double = Math.round(value * 10) / 10.0
}
