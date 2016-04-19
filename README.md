# homebridge-foscam2
Foscam Plugin for [HomeBridge](https://github.com/nfarina/homebridge) (API 2.0)

Older verion with API 1.0: [homebridge-foscam](https://github.com/rooi/homebridge-foscam)

# Installation
1. Install homebridge using `npm install -g homebridge`.
2. Install this plugin using `npm install -g homebridge-foscam2`.
3. Update your configuration file. See configuration sample below.

# Configuration
Edit your `config.json` accordingly. Configuration sample:
 ```
"platforms": [{
    "platform": "Foscam2"
}]
```

### Advanced Configuration (Optional)
This step is not required. HomeBridge with API 2.0 can handle configurations in the HomeKit app.
```
"platforms": [{
    "platform": "Foscam2",
    "cameras": [{
        "name" : "Entrance IP Camera",
        "username": "admin",
        "password": "password",
        "host": "192.168.1.10",
        "port": "88",
        "stay": "13",
        "away": "15",
        "night": "14",
        "path": "Local path for snapshots"
    }]
}]

```
`stay`, `away`, `night` define configuration for different ARMED state.

The supported configurations depend on your device. The Foscam public CGI defines the following:<br>
bit 3 | bit 2 | bit 1 | bit 0<br>
bit 0 = Ring<br>
bit 1 = Send email<br>
bit 2 = Snap picture<br>
bit 3 = Record

The following seems to be valid for the C2 as well (not found in any documentation)<br>
bit 7 | bit 6 | bit 5 | bit 4 | bit 3 | bit 2 | bit 1 | bit 0<br>
bit 0 = Ring<br>
bit 1 = Send email<br>
bit 2 = Snap picture<br>
bit 3 = Record<br>
bit 7 = Push notification

Note: The configuration is defined as int, thus the followings are valid, e.g. 0 (Do Nothing), 1 (Ring), 2 (Email), 3 (Ring + Email), 4 (Record), 12 (Picture and Record), 13 (Ring, Picture and Record), etc.

P.S.: Any ARMED state will activate motion detection by default.

