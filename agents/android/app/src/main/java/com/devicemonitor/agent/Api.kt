package com.devicemonitor.agent

import android.os.Build
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class ApiResult(val status: Int, val body: JSONObject)

/** Tiny HTTP client for the Device Monitor dashboard API (no extra libraries). */
object Api {

    private fun post(url: String, token: String?, payload: JSONObject): ApiResult {
        val conn = URL(url).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = 15_000
            conn.readTimeout = 20_000
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            if (token != null) conn.setRequestProperty("Authorization", "Bearer $token")

            conn.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }

            val status = conn.responseCode
            val stream = if (status in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            val body = try {
                JSONObject(text)
            } catch (e: Exception) {
                JSONObject()
            }
            return ApiResult(status, body)
        } finally {
            conn.disconnect()
        }
    }

    private fun get(url: String, bearer: String?): ApiResult {
        val conn = URL(url).openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = 15_000
            conn.readTimeout = 20_000
            if (!bearer.isNullOrEmpty()) conn.setRequestProperty("Authorization", "Bearer $bearer")
            val status = conn.responseCode
            val stream = if (status in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            val body = try { JSONObject(text) } catch (e: Exception) { JSONObject() }
            return ApiResult(status, body)
        } finally {
            conn.disconnect()
        }
    }

    /** Signs in with the dashboard password and returns a long-lived token that can only read alerts. */
    fun login(server: String, password: String): ApiResult =
        post("$server/api/auth/login", null, JSONObject().put("password", password).put("app", true))

    fun alerts(server: String, viewerToken: String, since: String): ApiResult =
        get("$server/api/alerts?since=$since", viewerToken)

    fun pair(server: String, code: String, name: String): ApiResult {
        val payload = JSONObject()
            .put("code", code)
            .put("name", name)
            .put("kind", "android")
            .put("os", "Android ${Build.VERSION.RELEASE}")
        return post("$server/api/agent/pair", null, payload)
    }

    fun heartbeat(server: String, token: String, metrics: JSONObject): ApiResult =
        post("$server/api/agent/heartbeat", token, metrics)
}
