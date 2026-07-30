# Raspberry Pi — byt vy med GPIO-knapp

Statistiksidan ([display.html](https://wallflow.vastervikclimbing.se/display.html)) har två vyer. En fysisk knapp på en GPIO-pin skickar **Space**, som sidan tolkar som vybyte.

## Vyer

1. **Fördelning** — paj + status + färger  
2. **En lista per färg** (Grön, Blå, Röd, …) — Space bläddrar till nästa färg. Nyaste leden (Byggdatum) längst upp.

Tangentbord (för test): `Space`, `v` eller `PageDown`.

## Koppling

Standardpin: **BCM 17** (fysisk pin 11 på 40-pin-headern).

```
BCM 17 (pin 11) ─────┬──── knapp
                     │
GND  (pin 9)  ───────┘
```

Skriptet använder internt pull-up (aktiv låg). Annan pin:

```bash
python3 gpio-view-toggle.py --pin 27
# eller
WALLFLOW_GPIO_PIN=27 python3 gpio-view-toggle.py
```

## Installation på Pi

```bash
sudo apt update
sudo apt install -y python3-gpiozero python3-evdev
# valfritt fallback: sudo apt install -y xdotool

mkdir -p ~/wallflow-pi
cp gpio-view-toggle.py ~/wallflow-pi/
chmod +x ~/wallflow-pi/gpio-view-toggle.py

# uinput (för tangent-emulering)
sudo usermod -aG input "$USER"
# logga ut/in eller starta om

# testa
python3 ~/wallflow-pi/gpio-view-toggle.py
```

Öppna displayen i Chromium kiosk (måste ha fokus):

```bash
chromium-browser --kiosk --app=https://wallflow.vastervikclimbing.se/display.html
```

## Autostart (systemd)

```bash
sudo cp wallflow-gpio-view.service /etc/systemd/system/
# justera User= och ExecStart=-sökväg i filen
sudo systemctl daemon-reload
sudo systemctl enable --now wallflow-gpio-view.service
```
