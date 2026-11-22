package com.devicemonitor.agent

import android.content.Context

/** Saves the dashboard URL and device token locally on the phone. */
object PairingStore {
    private const val PREFS = "device_monitor"

    data class Pairing(val server: String, val token: String, val name: String)

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun load(context: Context): Pairing? {
        val p = prefs(context)
        val server = p.getString("server", null) ?: return null
        val token = p.getString("token", null) ?: return null
        return Pairing(server, token, p.getString("name", null) ?: "Android device")
    }

    fun save(context: Context, pairing: Pairing) {
        prefs(context).edit()
            .putString("server", pairing.server)
            .putString("token", pairing.token)
            .putString("name", pairing.name)
            .apply()
    }

    fun clear(context: Context) {
        prefs(context).edit().clear().apply()
    }
}
