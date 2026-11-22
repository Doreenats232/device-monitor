package com.devicemonitor.agent

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder

/** Stores the dashboard address and the alerts-only token used by [AlertService]. */
object AlertPrefs {
    private fun p(c: Context) = c.getSharedPreferences("alerts", Context.MODE_PRIVATE)
    fun server(c: Context): String = p(c).getString("server", "") ?: ""
    fun token(c: Context): String = p(c).getString("token", "") ?: ""
    fun enabled(c: Context): Boolean = p(c).getBoolean("enabled", false)
    fun lastId(c: Context): String = p(c).getString("lastId", "") ?: ""
    fun save(c: Context, server: String, token: String) =
        p(c).edit().putString("server", server).putString("token", token).putBoolean("enabled", true).remove("lastId").apply()
    fun setLastId(c: Context, id: String) = p(c).edit().putString("lastId", id).apply()
    fun disable(c: Context) = p(c).edit().putBoolean("enabled", false).apply()
}

/**
 * Foreground service that checks the dashboard for new alerts about once a minute and shows them as phone
 * notifications (low battery, device offline, ...). Always shows an ongoing notification with a Stop button.
 */
class AlertService : Service() {

    private var worker: Thread? = null

    @Volatile
    private var running = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            AlertPrefs.disable(this)
            stopWatching()
            return START_NOT_STICKY
        }
        if (!AlertPrefs.enabled(this) || AlertPrefs.server(this).isEmpty()) {
            stopWatching()
            return START_NOT_STICKY
        }
        createChannels()
        val n = watchNotification()
        if (Build.VERSION.SDK_INT >= 34) startForeground(WATCH_ID, n, 0x40000000) else startForeground(WATCH_ID, n)

        if (!running) {
            running = true
            worker = Thread({ loop() }, "device-alerts").also { it.start() }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        worker?.interrupt()
        super.onDestroy()
    }

    private fun stopWatching() {
        running = false
        worker?.interrupt()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun loop() {
        var failures = 0
        try {
            while (running) {
                val server = AlertPrefs.server(this)
                val token = AlertPrefs.token(this)
                try {
                    var since = AlertPrefs.lastId(this)
                    val first = since.isEmpty()
                    val res = Api.alerts(server, token, if (first) "latest" else since)
                    when {
                        res.status == 401 -> {
                            AlertPrefs.disable(this)
                            notifyAlert(9999, "Alerts disconnected", "The dashboard password changed. Open Device Monitor and sign in again.", true)
                            break
                        }
                        res.status !in 200..299 -> throw IllegalStateException("HTTP ${res.status}")
                        else -> {
                            val list = res.body.optJSONArray("alerts")
                            if (!first && list != null) {
                                for (i in 0 until list.length()) {
                                    val a = list.getJSONObject(i)
                                    notifyAlert(a.getInt("id"), a.optString("deviceName", "Device Monitor"), a.getString("text"), a.optString("level") == "crit")
                                }
                            }
                            AlertPrefs.setLastId(this, res.body.optInt("latestId", 0).toString())
                            failures = 0
                        }
                    }
                } catch (e: InterruptedException) {
                    break
                } catch (e: Exception) {
                    failures++
                }
                if (!running) break
                Thread.sleep(minOf(300_000L, 60_000L + failures * 30_000L))
            }
        } catch (e: InterruptedException) {
            // stopped
        } finally {
            stopWatching()
        }
    }

    private fun notifyAlert(id: Int, title: String, text: String, critical: Boolean) {
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val n = Notification.Builder(this, ALERT_CHANNEL)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(Notification.BigTextStyle().bigText(text))
            .setSmallIcon(if (critical) android.R.drawable.ic_dialog_alert else android.R.drawable.ic_dialog_info)
            .setAutoCancel(true)
            .setContentIntent(open)
            .build()
        getSystemService(NotificationManager::class.java).notify(1000 + id, n)
    }

    private fun watchNotification(): Notification {
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val stop = PendingIntent.getService(this, 2, Intent(this, AlertService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE)
        return Notification.Builder(this, WATCH_CHANNEL)
            .setContentTitle("Device Monitor alerts are on")
            .setContentText("Watching your dashboard for alerts")
            .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
            .setOngoing(true)
            .setContentIntent(open)
            .addAction(Notification.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel, "Turn off", stop).build())
            .build()
    }

    private fun createChannels() {
        val nm = getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(WATCH_CHANNEL) == null)
            nm.createNotificationChannel(NotificationChannel(WATCH_CHANNEL, "Alert watcher", NotificationManager.IMPORTANCE_MIN))
        if (nm.getNotificationChannel(ALERT_CHANNEL) == null)
            nm.createNotificationChannel(NotificationChannel(ALERT_CHANNEL, "Device alerts", NotificationManager.IMPORTANCE_HIGH))
    }

    companion object {
        const val ACTION_STOP = "com.devicemonitor.agent.action.STOP_ALERTS"
        private const val WATCH_CHANNEL = "device_monitor_watch"
        private const val ALERT_CHANNEL = "device_monitor_alerts"
        private const val WATCH_ID = 2

        fun start(context: Context) {
            context.startForegroundService(Intent(context, AlertService::class.java))
        }

        fun stop(context: Context) {
            AlertPrefs.disable(context)
            context.stopService(Intent(context, AlertService::class.java))
        }
    }
}
