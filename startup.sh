cd /usr/lib/mfeddie2 && sudo forever start --uid "mfeddie" --minUptime 5000 -a --spinSleepTime 5000 -l /var/log/mfeddie.log mf_server.js

