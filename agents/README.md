# Device Monitor agents (PC .exe and Android .apk)

The web dashboard (the Next.js app in this project) shows every device you pair:
battery level and charging state, Wi-Fi name and IP, CPU, memory, storage, uptime,
battery history, and Bluetooth devices where the OS exposes battery.

Two agents send that data to the dashboard:

| Agent | Folder | Output |
| --- | --- | --- |
| Windows / macOS / Linux PC | `agents/pc` | `DeviceMonitorAgent.exe` (Windows) or `node agent.js` |
| Android phone or tablet | `agents/android` | `app-debug.apk` / `app-release.apk` |

## Consent and privacy

This app is built for devices whose owners know about it and agree to it.

- Pairing needs a 6-digit code that the dashboard creates. A device cannot join on its own.
- Every agent shows a visible window (PC) or a persistent notification with a **Stop sharing** button (Android).
- The owner can unpair at any time. The agent then stops, forgets its token, and the device disappears from the dashboard on its next update.
- The agents do not hide, do not run without being started, and do not read messages, photos, contacts, browsing, or call logs.
- Your brother's phone works the same way: he installs the APK, opens it, and enters the code you give him from the dashboard. He can press **Unpair** at any time.

## 1. Run the dashboard

1. Start the web app (the platform preview does this for you).
2. Open the dashboard in a browser. Note its address, for example `http://192.168.1.10:3000` on your home network.
3. Click **+ Pair a device**. A 6-digit code appears and expires after 10 minutes.

The dashboard must be reachable from the devices you pair. For devices on your home Wi-Fi, use your computer's LAN IP. For devices away from home, deploy the Next.js app to a public host with HTTPS and use that URL.

## 2. Windows PC agent (.exe)

Option A, build the exe yourself (recommended):

1. Install Node.js 18+ on a Windows PC (https://nodejs.org).
2. Copy the `agents/pc` folder to that PC.
3. Double-click `build-exe.bat`. It creates `dist\DeviceMonitorAgent.exe`.
4. Copy the exe to the PC you want to monitor and double-click it.
5. Enter the dashboard URL, the 6-digit code, and a name for the PC.

Option B, run from source on any OS: `node agent.js` (Node.js 18+).

Options:

- `DeviceMonitorAgent.exe --reset` removes the pairing so you can pair again.
- Closing the window stops reporting. The device shows as offline on the dashboard.
- The pairing (dashboard URL and device token) is saved in `agent-config.json` next to the exe.

What the Windows agent reads:

- Battery percent, charging, and AC or battery power (`Win32` power status)
- Wi-Fi network name (`netsh wlan show interfaces`) and local IP
- CPU load, memory use, system drive use, uptime, Windows version

## 3. Android agent (.apk)

The Android project is in `agents/android`. It needs Android Studio (Ladybug or newer, which includes the SDK).

1. Open the `agents/android` folder in Android Studio and let Gradle sync. Android Studio creates the Gradle wrapper automatically.
2. Build the APK: **Build > Build Bundle(s) / APK(s) > Build APK(s)**. The output is `app/build/outputs/apk/debug/app-debug.apk`. Command line alternative: `./gradlew assembleDebug`.
3. Copy the APK to the phone and install it (allow "Install unknown apps" for your file manager or browser).
4. Open **Device Monitor**, enter the dashboard URL (use `http://` for a LAN address), the 6-digit code, and a name, then tap **Pair and start sharing**.
5. Allow notifications and location when asked. Location is requested only because Android requires it to read the Wi-Fi name. The app does not track where you are.

Notes on Android:

- Sharing runs as a foreground service. It keeps running with the screen off, and the notification stays visible.
- Android may still stop the app on aggressive battery-saving phones. If updates stop, exclude Device Monitor from battery optimization in the phone's settings.
- Battery and Bluetooth: Android reports the battery of the phone itself. Bluetooth headphones (for example Beats) show a battery level only when the phone's Bluetooth stack exposes it for that device model. The app shows whatever Android provides, and shows "—" when it provides nothing. Some Beats models only show their battery in the Beats app or on the earbud case.

## Troubleshooting

- "Code is wrong or expired": create a new code on the dashboard. Codes are single-use.
- "Could not reach the dashboard": check the URL, the port, and that the dashboard and device are on the same network. Windows Firewall may block port 3000 for inbound connections.
- Device shows offline: the agent must be running. Updates arrive about every 30 seconds.
- Removed device keeps reporting: it is unpaired only after its next update. If it has no network, it stops once it can reach the dashboard again.

## Building the APK and EXEs (no local setup)

Push this project to GitHub and run **Actions → Build APK and EXE**. It produces:

- `DeviceMonitor-apk` → `app-debug.apk` (phone agent + in-app dashboard viewer)
- `DeviceMonitorAgent-exe` → PC agent exe
- `DeviceMonitor-desktop-exe` → `DeviceMonitor.exe`, a desktop window for the dashboard (tray icon, remembers your dashboard URL)

Deploy the Next.js dashboard publicly (e.g. Render + Postgres, `DATABASE_URL` env var, `npm run build && npm start`) so phones and PCs can reach it.
