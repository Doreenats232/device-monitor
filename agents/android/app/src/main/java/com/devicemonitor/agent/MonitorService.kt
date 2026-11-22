package com.devicemonitor.agent

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Foreground service that sends status to the dashboard every ~30 seconds.
 * It always shows a notification with a "Stop sharing" button while running.
 */
class MonitorService : Service() {

    private var worker: Thread? = null

    @Volatile
    private var running = false
    private var failures = 0
    private var lastStatus = "Starting..."

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopMonitoring()
            return START_NOT_STICKY
        }
        if (PairingStore.load(this) == null) {
            stopMonitoring()
            return START_NOT_STICKY
        }

        createChannel()
        val notification = buildNotification(lastStatus)
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        if (!running) {
            running = true
            isActive = true
            worker = Thread({ loop() }, "device-monitor").also { it.start() }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        isActive = false
        worker?.interrupt()
        super.onDestroy()
    }

    private fun stopMonitoring() {
        running = false
        isActive = false
        worker?.interrupt()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun loop() {
        try {
            while (running) {
                val pairing = PairingStore.load(this) ?: break
                var sleepMs = DEFAULT_INTERVAL_MS
                try {
                    val result = Api.heartbeat(pairing.server, pairing.token, Metrics.collect(this))
                    if (result.status == 401) {
                        // The owner removed this device from the dashboard: forget it and stop.
                        PairingStore.clear(this)
                        lastStatus = "Removed from dashboard"
                        break
                    }
                    if (result.status !in 200..299) {
                        throw IllegalStateException("dashboard HTTP ${result.status}")
                    }
                    sleepMs = result.body.optInt("intervalSeconds", 30) * 1000L
                    failures = 0
                    lastStatus = "Last update ${timeNow()}"
                } catch (e: InterruptedException) {
                    break
                } catch (e: Exception) {
                    failures++
                    sleepMs = minOf(60_000L, 5_000L * failures)
                    lastStatus = "Retrying: ${e.message ?: e.javaClass.simpleName}"
                }
                if (!running) break
                updateNotification(lastStatus)
                Thread.sleep(sleepMs)
            }
        } catch (e: InterruptedException) {
            // Stopped by the user or by the system.
        } finally {
            stopMonitoring()
        }
    }

    private fun buildNotification(text: String): Notification {
        val openApp = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE,
        )
        val stopIntent = PendingIntent.getService(
            this,
            1,
            Intent(this, MonitorService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE,
        )
        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("Device Monitor is sharing status")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setOngoing(true)
            .setContentIntent(openApp)
            .addAction(
                Notification.Action.Builder(
                    android.R.drawable.ic_menu_close_clear_cancel,
                    "Stop sharing",
                    stopIntent,
                ).build(),
            )
            .build()
    }

    private fun updateNotification(text: String) {
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, buildNotification(text))
    }

    private fun createChannel() {
        val nm = getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL_ID) == null) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Status sharing", NotificationManager.IMPORTANCE_LOW),
            )
        }
    }

    private fun timeNow(): String = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date())

    companion object {
        const val ACTION_STOP = "com.devicemonitor.agent.action.STOP"
        private const val CHANNEL_ID = "device_monitor_status"
        private const val NOTIFICATION_ID = 1
        private const val DEFAULT_INTERVAL_MS = 30_000L

        @Volatile
        var isActive = false

        fun start(context: Context) {
            context.startForegroundService(Intent(context, MonitorService::class.java))
        }

        fun stop(context: Context) {
            isActive = false
            context.stopService(Intent(context, MonitorService::class.java))
        }
    }
}
